import { describe, expect, it } from 'vitest';
import { compareScenario } from '../../src/comparison/compareScenario.js';
import { markConfidence } from '../../src/oracleCore.js';

function scenarioFixture() {
  return {
    scenarioId: 'sha256:test',
    source: { format: 'lauraycs-mpdb', files: [{ role: 'mpdb', sha256: 'a' }] },
    carrier: { frequency_Hz: 25e9, bandwidth_Hz: 100e6 },
    time: { frameCount: 2 },
    groundSelection: {
      selectedFrameId: 0,
      selectedBy: 'user',
      matchTolerance_m: 0.1,
      projectedPosition_m: { x: 0, y: 0, z: 0 },
    },
    comparisonRevision: 1,
    groundCandidates: [
      { frameId: 0, groundPositionMismatch_m: 0 },
      { frameId: 1, groundPositionMismatch_m: 0.2 },
    ],
    transmitter: {
      track: [
        { timestampUtc: '2026-08-05T00:00:00.000Z', projectedPosition_m: { x: 0, y: 0, z: 700_000 } },
        { timestampUtc: '2026-08-05T00:00:01.000Z', projectedPosition_m: { x: 1_000, y: 0, z: 700_000 } },
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
  };
}

describe('scenario comparison report', () => {
  it('summarizes exact frames by default while retaining approximate frame access', async () => {
    const report = await compareScenario(scenarioFixture());

    expect(report.frameCounts).toEqual({ exact: 1, approximate: 1, compared: 1 });
    expect(report.frames.map((frame) => frame.frameId)).toEqual([0]);
    expect(report.approximateFrames.map((frame) => frame.frameId)).toEqual([1]);
    expect(report.frames[0].rt.absolutePower.reason).toBe('UNDEFINED_H_NORMALIZATION');
    expect(report.realizationCount).toBe(32);
    expect(report).toMatchObject({
      scenarioId: 'sha256:test',
      comparisonRevision: 1,
      modelVersion: expect.any(String),
      provenance: expect.any(Object),
    });
  });

  it('refuses to compare before a user ground frame is selected', async () => {
    const scenario = scenarioFixture();
    scenario.groundSelection = null;

    await expect(compareScenario(scenario)).rejects.toMatchObject({
      code: 'GROUND_FRAME_REQUIRED',
    });
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
