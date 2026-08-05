import { describe, expect, it } from 'vitest';
import {
  buildComparisonFrameView,
  buildComparisonPlaybackSummary,
  buildComparisonPlotData,
  nextComparisonPosition,
} from '../../src/features/channel-comparison/comparisonViewModel.js';

function comparisonFrameFixture({
  frameId = 3,
  timestampUtc = '2026-08-05T00:00:03.000Z',
  receiverX_m = 0,
  longitude_deg = 116.3,
  latitude_deg = 39.9,
} = {}) {
  return {
    frameId,
    timestampUtc,
    receiver: {
      frameId,
      timestampUtc,
      longitude_deg,
      latitude_deg,
      altitude_m: 50,
      projectedPosition_m: { x: receiverX_m, y: 0, z: 0 },
      source: 'rayTracing.rxPosition',
    },
    geometry: {
      frameId,
      timestampUtc,
      receiverPosition_m: { x: receiverX_m, y: 0, z: 0 },
      transmitterPosition_m: { x: 2_000, y: 0, z: 700_000 },
      elevation_deg: 89.5,
      slantRange_m: 700_003,
    },
    rt: {
      pdp: {
        binWidth_s: 10e-9,
        bins: [
          { binIndex: 0, excessDelay_s: 0, relativePower_dB: 0 },
          { binIndex: 1, excessDelay_s: 10e-9, relativePower_dB: -6 },
        ],
      },
      absolutePower: { available: false, reason: 'UNDEFINED_H_NORMALIZATION' },
    },
    statistical: {
      realizationCount: 32,
      binWidth_s: 10e-9,
      binIndices: [0, 1],
      excessDelay_s: [0, 10e-9],
      summary: {
        median: [1, 0.1],
        p5: [0.5, 0.05],
        p95: [1, 0.2],
      },
    },
    metrics: {
      jsDivergence_bits: 0.125,
      rmsDelaySpreadDifference_s: -2e-9,
      weightedDelayDistance_s: 4e-9,
    },
  };
}

function comparisonReportFixture() {
  return {
    scenarioId: 'sha256:test',
    modelVersion: 'mpdb-statistical-comparison/v2',
    receiverGeometry: {
      mode: 'mpdb-track',
      source: 'rayTracing.rxPosition',
      frameCount: 2,
    },
    diagnostics: [{
      code: 'RT_ABSOLUTE_POWER_UNAVAILABLE',
      severity: 'warning',
      reason: 'UNDEFINED_H_NORMALIZATION',
    }],
    frames: [
      comparisonFrameFixture(),
      comparisonFrameFixture({
        frameId: 8,
        timestampUtc: '2026-08-05T00:00:08.000Z',
        receiverX_m: 1,
        longitude_deg: 116.30001,
        latitude_deg: 39.90001,
      }),
    ],
  };
}

describe('comparison PDP view model', () => {
  it('keeps the legacy RT and statistical percentile overlay series in relative dB', () => {
    const data = buildComparisonPlotData(comparisonFrameFixture());

    expect(data.rt).toEqual([{ x: 0, y: 0 }, { x: 10, y: -6 }]);
    expect(data.statisticalMedian).toEqual([{ x: 0, y: 0 }, { x: 10, y: -10 }]);
    expect(data.statisticalP5[0].y).toBeCloseTo(-3.0103, 3);
    expect(data.statisticalP95[1].y).toBeCloseTo(-6.9897, 3);
  });

  it('uses one real frame ID for every dataset and omits RT when disabled', () => {
    const frame = comparisonFrameFixture({ frameId: 8 });
    const hidden = buildComparisonFrameView(frame, { showRtOverlay: false });
    const shown = buildComparisonFrameView(frame, { showRtOverlay: true });

    expect(hidden.datasets.some((set) => set.source === 'rt')).toBe(false);
    expect(hidden.datasets.map((set) => set.source)).toEqual([
      'statistical-median',
      'statistical-p5',
      'statistical-p95',
    ]);
    expect(shown.datasets.some((set) => set.source === 'rt')).toBe(true);
    expect(shown.datasets.every((set) => set.frameId === 8)).toBe(true);
  });

  it('advances by report position instead of assuming contiguous frame IDs', () => {
    const report = { frames: [{ frameId: 3 }, { frameId: 8 }] };

    expect(nextComparisonPosition(report, 0)).toBe(1);
    expect(nextComparisonPosition(report, 1)).toBe(0);
  });

  it('exposes receiver motion, geometry, fit metrics, and normalization for the active frame', () => {
    const summary = buildComparisonPlaybackSummary(comparisonReportFixture(), 1);

    expect(summary).toEqual({
      frameId: 8,
      timestampUtc: '2026-08-05T00:00:08.000Z',
      receiverMotion: 'moving',
      receiverDisplacement_m: 1,
      receiverLongitude_deg: 116.30001,
      receiverLatitude_deg: 39.90001,
      receiverAltitude_m: 50,
      elevation_deg: 89.5,
      slantRange_m: 700_003,
      jsDivergence_bits: 0.125,
      rmsDelaySpreadDifference_s: -2e-9,
      weightedDelayDistance_s: 4e-9,
      rtNormalizationStatus: 'UNDEFINED_H_NORMALIZATION',
    });
    expect(buildComparisonPlaybackSummary(comparisonReportFixture(), 0)).toMatchObject({
      receiverMotion: 'initial',
      receiverDisplacement_m: 0,
    });
  });

  it('classifies receiver movement at the inclusive 0.1 metre threshold', () => {
    const report = comparisonReportFixture();
    report.frames[1].receiver.projectedPosition_m.x = 0.1;

    expect(buildComparisonPlaybackSummary(report, 1)).toMatchObject({
      receiverMotion: 'stationary',
      receiverDisplacement_m: expect.closeTo(0.1),
    });
  });

  it.each([
    ['non-zero coordinates', 1, 1.1],
    ['large projected coordinates', 1_000_000, 1_000_000.1],
  ])('keeps the shared 0.1 metre stationary semantics at %s', (_label, startX_m, endX_m) => {
    const report = comparisonReportFixture();
    report.frames[0].receiver.projectedPosition_m.x = startX_m;
    report.frames[1].receiver.projectedPosition_m.x = endX_m;

    expect(buildComparisonPlaybackSummary(report, 1)).toMatchObject({
      receiverMotion: 'stationary',
      receiverDisplacement_m: expect.closeTo(0.1),
    });
  });

  it('does not hide receiver movement just above the stationary threshold', () => {
    const report = comparisonReportFixture();
    report.frames[0].receiver.projectedPosition_m.x = 1_000_000;
    report.frames[1].receiver.projectedPosition_m.x = 1_000_000.1001;

    expect(buildComparisonPlaybackSummary(report, 1)).toMatchObject({
      receiverMotion: 'moving',
      receiverDisplacement_m: expect.closeTo(0.1001),
    });
  });

  it.each([
    ['empty report', () => nextComparisonPosition({ frames: [] }, 0)],
    ['negative position', () => nextComparisonPosition(comparisonReportFixture(), -1)],
    ['fractional position', () => nextComparisonPosition(comparisonReportFixture(), 0.5)],
    ['out-of-range position', () => buildComparisonPlaybackSummary(comparisonReportFixture(), 2)],
  ])('rejects %s with a structured plotting error', (_label, action) => {
    expect(action).toThrowError(expect.objectContaining({
      code: 'COMPARISON_PLOT_DATA_INVALID',
    }));
  });

  it('clips a coherently cancelled RT bin to the finite plotting floor', () => {
    const frame = comparisonFrameFixture();
    frame.rt.pdp.bins[1].relativePower_dB = -Infinity;

    expect(buildComparisonFrameView(frame, { showRtOverlay: true })
      .datasets.find((dataset) => dataset.source === 'rt').data[1]).toEqual({
      x: 10,
      y: -120,
    });
  });

  it.each([
    ['empty RT PDP', (frame) => { frame.rt.pdp.bins = []; }],
    ['unnormalizable RT PDP', (frame) => {
      frame.rt.pdp.bins.forEach((bin) => { bin.relativePower_dB = -Infinity; });
    }],
    ['invalid RT power', (frame) => { frame.rt.pdp.bins[0].relativePower_dB = NaN; }],
    ['empty statistical PDP', (frame) => {
      frame.statistical.excessDelay_s = [];
      frame.statistical.summary = { median: [], p5: [], p95: [] };
    }],
    ['unnormalizable statistical PDP', (frame) => {
      frame.statistical.summary = { median: [0, 0], p5: [0, 0], p95: [0, 0] };
    }],
    ['non-finite statistical power', (frame) => {
      frame.statistical.summary.p95[1] = Number.NaN;
    }],
    ['mismatched statistical bins', (frame) => { frame.statistical.summary.p5.pop(); }],
  ])('rejects %s instead of emitting invalid chart coordinates', (_label, mutate) => {
    const frame = comparisonFrameFixture();
    mutate(frame);

    expect(() => buildComparisonFrameView(frame, { showRtOverlay: true }))
      .toThrowError(expect.objectContaining({ code: 'COMPARISON_PLOT_DATA_INVALID' }));
  });

  it.each([
    ['receiver coordinate', (report) => { report.frames[1].receiver.longitude_deg = NaN; }],
    ['receiver projected position', (report) => {
      report.frames[1].receiver.projectedPosition_m.z = Infinity;
    }],
    ['geometry', (report) => { report.frames[1].geometry.slantRange_m = Infinity; }],
    ['fit metric', (report) => { report.frames[1].metrics.jsDivergence_bits = NaN; }],
  ])('rejects a non-finite %s in playback summaries', (_label, mutate) => {
    const report = comparisonReportFixture();
    mutate(report);

    expect(() => buildComparisonPlaybackSummary(report, 1))
      .toThrowError(expect.objectContaining({ code: 'COMPARISON_PLOT_DATA_INVALID' }));
  });
});
