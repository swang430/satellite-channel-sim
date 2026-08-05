import { describe, expect, it } from 'vitest';
import { calculateChannelMetrics } from '../../src/channel/channelMetrics.js';
import { buildPdp } from '../../src/channel/pdp.js';

function path(absoluteDelay_s, real, imag = 0) {
  return { absoluteDelay_s, complexAmplitude: { real, imag } };
}

describe('unified PDP', () => {
  it('uses 10 ns bins at 100 MHz and coherently aggregates complex paths', () => {
    const pdp = buildPdp([
      path(1, 1),
      path(1 + 4e-9, -1),
      path(1 + 20e-9, 0.5),
    ], { bandwidth_Hz: 100e6 });

    expect(pdp.binWidth_s).toBe(10e-9);
    expect(pdp.bins[0]).toMatchObject({
      pathCount: 2,
      coherentPower_linear: 0,
      noncoherentPower_linear: 2,
    });
    expect(pdp.bins[1].excessDelay_s).toBeCloseTo(20e-9, 12);
  });

  it('references excess delay to the earliest path rather than the strongest path', () => {
    const pdp = buildPdp([
      path(100e-9, 0.01),
      path(130e-9, 10),
    ], { bandwidth_Hz: 100e6 });

    expect(pdp.delayReference_s).toBe(100e-9);
    expect(pdp.bins[0].excessDelay_s).toBe(0);
    expect(pdp.bins[1].excessDelay_s).toBeCloseTo(30e-9, 12);
  });

  it('computes mean delay, RMS spread, and coherence bandwidth from the same PDP power', () => {
    const pdp = buildPdp([
      path(0, 1),
      path(20e-9, 1),
    ], { bandwidth_Hz: 100e6 });
    const metrics = calculateChannelMetrics(pdp);

    expect(metrics.meanExcessDelay_s).toBeCloseTo(10e-9, 12);
    expect(metrics.rmsDelaySpread_s).toBeCloseTo(10e-9, 12);
    expect(metrics.coherenceBandwidth_Hz).toBeCloseTo(20e6, 3);
    expect(metrics.powerDefinition).toBe('coherentPower_linear');
  });
});

