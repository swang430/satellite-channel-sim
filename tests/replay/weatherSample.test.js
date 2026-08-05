import { describe, expect, it } from 'vitest';
import { deriveOpenMeteoSample } from '../../src/replay/weatherSample.js';

describe('Open-Meteo sample derivation', () => {
  it('separates observed precipitation from model-derived loss', () => {
    const sample = deriveOpenMeteoSample({
      timestampUtc: '2026-08-05T00:00:00Z',
      precipitation_mmph: 5,
    });

    expect(sample.metrics.observation).toEqual({
      rainRate_mmph: 5,
      source: 'observed-input',
      provider: 'open-meteo',
    });
    expect(sample.metrics.derived.source).toBe('synthetic-derived');
    expect(sample.metrics.derived).not.toHaveProperty('measuredLoss');
  });

  it('is deterministic for the same weather input', () => {
    const input = { timestampUtc: '2026-08-05T00:00:00Z', precipitation_mmph: 8 };
    expect(deriveOpenMeteoSample(input)).toEqual(deriveOpenMeteoSample(input));
  });
});
