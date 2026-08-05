import { describe, expect, it } from 'vitest';
import {
  assertDynamicComparisonReport,
  assertExpectedMpdbSample,
  assertExpectedReceiverTrackMotion,
  buildMismatchedConfigFiles,
  MPDB_SAMPLE_COMPARISON_OPTIONS,
  renameSampleFiles,
} from '../../scripts/mpdbSampleVerification.js';

const encoder = new TextEncoder();
const decoder = new TextDecoder();

function config(nodeGroup, endTime = 2000) {
  return {
    name: `${nodeGroup}.json`,
    data: encoder.encode(JSON.stringify({
      nodeGroup,
      simulation: { simulationWindow: { startTime: 1000, endTime } },
    })),
  };
}

function dynamicComparisonFrames(frameCount = 179) {
  return Array.from({ length: frameCount }, (_, frameId) => ({
    frameId,
    metrics: {
      jsDivergence_bits: 0.1,
      weightedDelayDistance_s: 2e-9,
      rmsDelaySpreadDifference_s: -3e-9,
    },
  }));
}

function dynamicComparisonReport(frameCount = 179) {
  return {
    modelVersion: 'mpdb-statistical-comparison/v2',
    realizationCount: 32,
    receiverGeometry: {
      mode: 'mpdb-track',
      frameCount,
    },
    frameCounts: {
      total: frameCount,
      compared: frameCount,
    },
    statisticalParameters: {
      environment: 'suburban',
      tec_TECU: 50,
      scatterPowerOffset_dB: 0,
    },
    frames: dynamicComparisonFrames(frameCount),
  };
}

describe('MPDB sample acceptance helpers', () => {
  it('renames every file without changing its bytes', () => {
    const files = [{ name: 'sample.zip', data: new Uint8Array([1, 2]) }, config('baseStation'), config('terminal')];
    const renamed = renameSampleFiles(files);
    expect(renamed.map((file) => file.name)).toEqual(['renamed-result.bin', 'renamed-config-a.json', 'renamed-config-b.json']);
    expect([...renamed[0].data]).toEqual([1, 2]);
  });

  it('creates a receiver config with a mismatched simulation window', () => {
    const mismatched = buildMismatchedConfigFiles([
      { name: 'sample.zip', data: new Uint8Array([1]) },
      config('baseStation'),
      config('terminal'),
    ]);
    const receiver = mismatched.find((file) => file.name.includes('mismatched'));
    expect(JSON.parse(decoder.decode(receiver.data)).simulation.simulationWindow.endTime).toBe(3000);
  });

  it('asserts the approved real-sample invariants', () => {
    expect(() => assertExpectedMpdbSample({
      time: { frameCount: 179 },
      rayTracing: { delay_s: { length: 465_512 } },
      carrier: { frequency_Hz: 24_950_000_000 },
      coordinateReference: { alignmentRmsResidual_m: 0.01 },
    })).not.toThrow();
    expect(() => assertExpectedMpdbSample({
      time: { frameCount: 178 },
      rayTracing: { delay_s: { length: 465_512 } },
      carrier: { frequency_Hz: 24_950_000_000 },
      coordinateReference: { alignmentRmsResidual_m: 0.01 },
    })).toThrow(/frameCount/);
  });

  it('asserts the approved real-sample receiver motion structure', () => {
    expect(() => assertExpectedReceiverTrackMotion({
      frameCount: 179,
      movingFrameCount: 108,
      stationaryFrameCount: 70,
      totalDistance_m: 75.25,
    })).not.toThrow();
  });

  it.each([
    ['frame count', { frameCount: 178 }, /frameCount/],
    ['moving count type', { movingFrameCount: 108.5 }, /movingFrameCount/],
    ['stationary count sign', { stationaryFrameCount: -1 }, /stationaryFrameCount/],
    ['interval sum', { movingFrameCount: 107 }, /interval count/],
    ['no moving interval', { movingFrameCount: 0, stationaryFrameCount: 178 }, /movingFrameCount/],
    ['no stationary interval', { movingFrameCount: 178, stationaryFrameCount: 0 }, /stationaryFrameCount/],
    ['known moving count', { movingFrameCount: 107, stationaryFrameCount: 71 }, /movingFrameCount/],
    ['known stationary count', { movingFrameCount: 109, stationaryFrameCount: 69 }, /movingFrameCount/],
    ['non-finite distance', { totalDistance_m: Number.NaN }, /totalDistance_m/],
    ['non-positive distance', { totalDistance_m: 0 }, /totalDistance_m/],
  ])('rejects invalid real-sample receiver motion: %s', (_label, override, message) => {
    expect(() => assertExpectedReceiverTrackMotion({
      frameCount: 179,
      movingFrameCount: 108,
      stationaryFrameCount: 70,
      totalDistance_m: 75.25,
      ...override,
    })).toThrow(message);
  });

  it('accepts a complete dynamic comparison report with finite fit metrics', () => {
    expect(() => assertDynamicComparisonReport(dynamicComparisonReport(), 179)).not.toThrow();
  });

  it('exports fixed real-sample comparison parameters', () => {
    expect(MPDB_SAMPLE_COMPARISON_OPTIONS).toEqual({
      realizationCount: 32,
      statisticalParameters: {
        environment: 'suburban',
        tec_TECU: 50,
        scatterPowerOffset_dB: 0,
      },
    });
  });

  it('rejects the wrong dynamic comparison frame count', () => {
    expect(() => assertDynamicComparisonReport(dynamicComparisonReport(178), 179))
      .toThrow(/frames\.length=178, expected 179/);
  });

  it('rejects a discontinuous dynamic comparison frame ID', () => {
    const frames = dynamicComparisonFrames();
    frames[4].frameId = 5;

    expect(() => assertDynamicComparisonReport({
      ...dynamicComparisonReport(),
      frames,
    }, 179))
      .toThrow(/frame\[4\]\.frameId=5, expected 4/);
  });

  it.each([
    ['jsDivergence_bits', Number.NaN],
    ['weightedDelayDistance_s', Number.POSITIVE_INFINITY],
    ['rmsDelaySpreadDifference_s', Number.NEGATIVE_INFINITY],
  ])('rejects a non-finite %s metric', (metricName, value) => {
    const frames = dynamicComparisonFrames();
    frames[4].metrics[metricName] = value;

    expect(() => assertDynamicComparisonReport({
      ...dynamicComparisonReport(),
      frames,
    }, 179))
      .toThrow(new RegExp(`frame\\[4\\]\\.metrics\\.${metricName}`));
  });

  it.each([
    ['receiver geometry mode', 'receiverGeometry.mode', (report) => { report.receiverGeometry.mode = 'fixed'; }],
    ['receiver geometry frame count', 'receiverGeometry.frameCount', (report) => { report.receiverGeometry.frameCount = 178; }],
    ['realization count', 'realizationCount', (report) => { report.realizationCount = 16; }],
    ['total frame count', 'frameCounts.total', (report) => { report.frameCounts.total = 178; }],
    ['compared frame count', 'frameCounts.compared', (report) => { report.frameCounts.compared = 178; }],
    ['environment', 'statisticalParameters.environment', (report) => { report.statisticalParameters.environment = 'urban'; }],
    ['TEC', 'statisticalParameters.tec_TECU', (report) => { report.statisticalParameters.tec_TECU = 51; }],
    ['scatter offset', 'statisticalParameters.scatterPowerOffset_dB', (report) => { report.statisticalParameters.scatterPowerOffset_dB = -1; }],
    ['model version', 'modelVersion', (report) => { report.modelVersion = 'mpdb-statistical-comparison/v1'; }],
  ])('rejects mismatched %s metadata', (_label, path, mutate) => {
    const report = dynamicComparisonReport();
    mutate(report);

    expect(() => assertDynamicComparisonReport(report, 179))
      .toThrow(new RegExp(path.replaceAll('.', '\\.')));
  });

  it('rejects a fully sparse frame array at its first hole', () => {
    const report = dynamicComparisonReport();
    report.frames = new Array(179);

    expect(() => assertDynamicComparisonReport(report, 179))
      .toThrow(/frame\[0\]/);
  });

  it('rejects a single sparse frame hole at its array position', () => {
    const report = dynamicComparisonReport();
    delete report.frames[4];

    expect(() => assertDynamicComparisonReport(report, 179))
      .toThrow(/frame\[4\]/);
  });

  it.each([
    [null, 'null'],
    [42, '42'],
  ])('rejects a non-object frame entry %s', (frame, displayedValue) => {
    const report = dynamicComparisonReport();
    report.frames[4] = frame;

    expect(() => assertDynamicComparisonReport(report, 179))
      .toThrow(new RegExp(`frame\\[4\\]=${displayedValue}, expected object`));
  });
});
