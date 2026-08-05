import { describe, expect, it } from 'vitest';
import { createDeterministicRng, seedForRealization } from '../../src/comparison/deterministicRng.js';
import { runStatisticalEnsemble } from '../../src/comparison/statisticalEnsemble.js';

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
  });

  it('rejects a non-finite scatter power offset before generating realizations', () => {
    expect(() => runStatisticalEnsemble({
      scenarioId: 'sha256:abc',
      frameId: 0,
      geometry: { slantRange_m: 700_000, elevation_deg: 30 },
      carrier: { frequency_Hz: 25e9, bandwidth_Hz: 100e6 },
      environment: 'urban',
      scatterPowerOffset_dB: Number.NaN,
      realizationCount: 1,
    })).toThrowError(expect.objectContaining({ code: 'STATISTICAL_CIR_INPUT_INVALID' }));
  });
});
