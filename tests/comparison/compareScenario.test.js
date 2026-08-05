import { describe, expect, it } from 'vitest';
import { compareScenario } from '../../src/comparison/compareScenario.js';
import { createScenarioDraft } from '../../src/domain/scenario.js';
import { markConfidence } from '../../src/oracleCore.js';

function scenarioFixture() {
  const scenario = createScenarioDraft({
    scenarioId: 'sha256:test',
    source: { format: 'lauraycs-mpdb', files: [{ role: 'mpdb', sha256: 'a' }] },
    link: {
      direction: 'downlink',
      transmitterId: 'satellite-1',
      receiverId: 'terminal-1',
    },
    carrier: { frequency_Hz: 25e9, bandwidth_Hz: 100e6 },
    time: {
      startTimeUtc: '2026-08-05T00:00:00.000Z',
      sampleInterval_s: 1,
      frameCount: 2,
    },
    transmitter: {
      track: [
        {
          frameId: 0,
          timestampUtc: '2026-08-05T00:00:00.000Z',
          projectedPosition_m: { x: 0, y: 0, z: 700_000 },
        },
        {
          frameId: 1,
          timestampUtc: '2026-08-05T00:00:01.000Z',
          projectedPosition_m: { x: 2_000, y: 0, z: 700_000 },
        },
      ],
    },
    receiver: {
      id: 'terminal-1',
      track: [
        {
          frameId: 0,
          timestampUtc: '2026-08-05T00:00:00.000Z',
          longitude_deg: 116.3,
          latitude_deg: 39.9,
          altitude_m: 50,
          projectedPosition_m: { x: 0, y: 0, z: 0 },
        },
        {
          frameId: 1,
          timestampUtc: '2026-08-05T00:00:01.000Z',
          longitude_deg: 116.30001,
          latitude_deg: 39.90001,
          altitude_m: 50,
          projectedPosition_m: { x: 1_000, y: 0, z: 0 },
        },
      ],
    },
    rayTracing: {
      frameOffsets: new Uint32Array([0, 2, 3]),
      delay_s: new Float32Array([0.0023, 0.00230002, 0.00231]),
      hReal: new Float32Array([1, 0.5, 1]),
      hImag: new Float32Array([0, 0.25, 0]),
      channelType: new Int16Array([99, 2, 0]),
      aoa_deg: new Float32Array([0, 20, 30]),
      aod_deg: new Float32Array([10, 30, 40]),
      doppler_Hz: new Float32Array([100, 200, 300]),
    },
  });
  scenario.comparisonRevision = 1;
  return scenario;
}

describe('scenario comparison report', () => {
  it('compares every MPDB frame using native receiver geometry', async () => {
    const progress = [];
    const report = await compareScenario(scenarioFixture(), {
      realizationCount: 2,
      statisticalParameters: {
        environment: 'urban',
        tec_TECU: 20,
        scatterPowerOffset_dB: -2,
      },
      onProgress: (value) => progress.push(value),
    });

    expect(report.frames.map((frame) => frame.frameId)).toEqual([0, 1]);
    expect(report.frameCounts).toEqual({ total: 2, compared: 2 });
    expect(report.receiverGeometry).toEqual({
      mode: 'mpdb-track',
      source: 'rayTracing.rxPosition',
      frameCount: 2,
    });
    expect(report.statisticalParameters).toEqual({
      environment: 'urban',
      tec_TECU: 20,
      scatterPowerOffset_dB: -2,
    });
    expect(report.frames.map((frame) => frame.geometry.receiverPosition_m.x)).toEqual([0, 1_000]);
    expect(report.frames[1]).toMatchObject({
      frameId: 1,
      timestampUtc: '2026-08-05T00:00:01.000Z',
      receiver: {
        frameId: 1,
        source: 'rayTracing.rxPosition',
        longitude_deg: 116.30001,
        latitude_deg: 39.90001,
        altitude_m: 50,
      },
      geometry: {
        frameId: 1,
        timestampUtc: '2026-08-05T00:00:01.000Z',
        receiverPosition_m: { x: 1_000, y: 0, z: 0 },
        transmitterPosition_m: { x: 2_000, y: 0, z: 700_000 },
      },
    });
    expect(report.frames[0].rt.absolutePower.reason).toBe('UNDEFINED_H_NORMALIZATION');
    expect(report.realizationCount).toBe(2);
    expect(progress).toEqual([0.5, 1]);
    expect(report).toMatchObject({
      scenarioId: 'sha256:test',
      comparisonRevision: 1,
      modelVersion: 'mpdb-statistical-comparison/v2',
      provenance: expect.any(Object),
    });
    expect(report).not.toHaveProperty('groundSelection');
    expect(report).not.toHaveProperty('approximateFrames');
  });

  it('rejects a scenario whose receiver track is incomplete', async () => {
    const scenario = scenarioFixture();
    scenario.receiver.track.pop();

    await expect(compareScenario(scenario)).rejects.toMatchObject({
      code: 'SCENARIO_NOT_READY',
    });
  });

  it('applies scatter power offset to the statistical PDP instead of report metadata only', async () => {
    const baseline = await compareScenario(scenarioFixture(), {
      realizationCount: 2,
      statisticalParameters: {
        environment: 'urban',
        tec_TECU: 20,
        scatterPowerOffset_dB: 0,
      },
    });
    const reduced = await compareScenario(scenarioFixture(), {
      realizationCount: 2,
      statisticalParameters: {
        environment: 'urban',
        tec_TECU: 20,
        scatterPowerOffset_dB: -6,
      },
    });
    const baselineNearScatter = baseline.frames[0].statistical.summary.median[
      baseline.frames[0].statistical.binIndices.indexOf(10)
    ];
    const reducedNearScatter = reduced.frames[0].statistical.summary.median[
      reduced.frames[0].statistical.binIndices.indexOf(10)
    ];

    expect(reducedNearScatter / baselineNearScatter).toBeCloseTo(10 ** (-6 / 10), 10);
  });

  it('lets Oracle consume relative comparison reports without fabricating RT SNR', () => {
    const states = [{ frameId: 0, confidence: 'statistical' }];
    const marked = markConfidence(states, {
      frames: [{ frameId: 0, metrics: { jsDivergence_bits: 0.1 } }],
    });

    expect(marked[0]).toMatchObject({
      confidence: 'rt-relative-pdp',
      comparison: { jsDivergence_bits: 0.1 },
    });
    expect(marked[0]).not.toHaveProperty('rtSnr_dB');
  });
});
