import { describe, expect, it } from 'vitest';
import { createDeterministicRng, seedForRealization } from '../../src/comparison/deterministicRng.js';
import { runStatisticalEnsemble } from '../../src/comparison/statisticalEnsemble.js';

function ensembleFixture(overrides = {}) {
  return {
    scenarioId: 'sha256:abc',
    frameId: 0,
    geometry: { slantRange_m: 700_000, elevation_deg: 30 },
    carrier: { frequency_Hz: 25e9, bandwidth_Hz: 100e6 },
    environment: 'urban',
    realizationCount: 1,
    ...overrides,
  };
}

const invalidParameterCases = [
  ['zero realization count', { realizationCount: 0 }],
  ['negative realization count', { realizationCount: -1 }],
  ['NaN realization count', { realizationCount: Number.NaN }],
  ['fractional realization count', { realizationCount: 1.5 }],
  ['string realization count', { realizationCount: '2' }],
  ['unknown environment', { environment: 'forest' }],
  ['numeric environment', { environment: 2 }],
  ['null environment', { environment: null }],
  ['negative TEC', { tec_TECU: -1 }],
  ['NaN TEC', { tec_TECU: Number.NaN }],
  ['NaN scatter offset', { scatterPowerOffset_dB: Number.NaN }],
  ['string scatter offset', { scatterPowerOffset_dB: '-2' }],
];

describe('deterministic statistical ensemble', () => {
  it('generates byte-for-byte identical values for the same scenario/frame/realization seed', () => {
    const seed = seedForRealization('sha256:abc', 7, 3);
    const first = createDeterministicRng(seed);
    const second = createDeterministicRng(seed);
    const firstBytes = new Float64Array(Array.from({ length: 16 }, first));
    const secondBytes = new Float64Array(Array.from({ length: 16 }, second));

    expect(new Uint8Array(secondBytes.buffer)).toEqual(new Uint8Array(firstBytes.buffer));
  });

  it('uses 32 realizations by default and returns median/P5/P95', () => {
    const ensemble = runStatisticalEnsemble({
      scenarioId: 'sha256:abc',
      frameId: 0,
      geometry: { slantRange_m: 700_000, elevation_deg: 30 },
      carrier: { frequency_Hz: 25e9, bandwidth_Hz: 100e6 },
      environment: 'urban',
    });

    expect(ensemble.realizationCount).toBe(32);
    expect(ensemble.summary).toEqual(expect.objectContaining({
      median: expect.any(Array),
      p5: expect.any(Array),
      p95: expect.any(Array),
    }));
    expect(ensemble.summary.median.length).toBeGreaterThan(0);
    expect(ensemble.summary.p5[0]).toBeLessThanOrEqual(ensemble.summary.median[0]);
    expect(ensemble.summary.median[0]).toBeLessThanOrEqual(ensemble.summary.p95[0]);
    expect(ensemble.metricSummary.rmsDelaySpread_s).toEqual(expect.objectContaining({
      median: expect.any(Number),
      p5: expect.any(Number),
      p95: expect.any(Number),
    }));
    expect(ensemble.metricSummary.coherenceBandwidth_Hz).toEqual(expect.objectContaining({
      median: expect.any(Number),
    }));
  });

  it.each(invalidParameterCases)('rejects %s', (_label, overrides) => {
    expect(() => runStatisticalEnsemble(ensembleFixture(overrides))).toThrowError(
      expect.objectContaining({ code: 'STATISTICAL_CIR_INPUT_INVALID' }),
    );
  });
});
