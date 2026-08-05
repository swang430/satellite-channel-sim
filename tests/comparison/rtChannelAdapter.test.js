import { describe, expect, it } from 'vitest';
import { getRtFrameView, rtFrameToPdp } from '../../src/comparison/rtChannelAdapter.js';

function scenarioFixture() {
  return {
    carrier: { bandwidth_Hz: 100e6 },
    rayTracing: {
      frameOffsets: new Uint32Array([0, 2, 3]),
      delay_s: new Float32Array([1, 1 + 4e-9, 2]),
      hReal: new Float32Array([1, -1, 0.5]),
      hImag: new Float32Array([0, 0, 0.5]),
      channelType: new Int16Array([99, 2, 0]),
      aoa_deg: new Float32Array([0, 90, 180]),
      aod_deg: new Float32Array([10, 20, 30]),
      doppler_Hz: new Float32Array([100, -100, 50]),
    },
  };
}

describe('RT channel frame adapter', () => {
  it('returns zero-copy subarray views and preserves raw channel type codes', () => {
    const scenario = scenarioFixture();
    const view = getRtFrameView(scenario, 0);

    expect(view.delay_s.buffer).toBe(scenario.rayTracing.delay_s.buffer);
    expect([...view.channelType]).toEqual([99, 2]);
    expect(view.channelTypeLabels).toBeUndefined();
  });

  it('builds a relative PDP and explicitly refuses absolute RT power', () => {
    const adapted = rtFrameToPdp(scenarioFixture(), 0);

    expect(adapted.pdp.bins[0]).toMatchObject({
      pathCount: 2,
      coherentPower_linear: 0,
      noncoherentPower_linear: 2,
    });
    expect(adapted.absolutePower).toEqual({
      status: 'unavailable',
      reason: 'UNDEFINED_H_NORMALIZATION',
    });
    expect(JSON.stringify(adapted)).not.toContain('23 + 10');
  });
});

