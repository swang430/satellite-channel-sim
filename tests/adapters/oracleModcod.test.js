import { describe, expect, it } from 'vitest';
import { recommendMODCOD } from '../../src/oracleCore.js';

describe('Oracle MODCOD heuristic', () => {
  it('labels SNR-based output as non-standard heuristic', () => {
    const result = recommendMODCOD(8);
    expect(result.inputMetric).toBe('SNR');
    expect(result.modelStatus).toBe('heuristic-not-standard-compliant');
  });

  it('returns outage below its minimum heuristic threshold', () => {
    const result = recommendMODCOD(-20);
    expect(result.status).toBe('outage');
    expect(result.spectralEfficiency_bpsHz).toBeNull();
    expect(result.predicted).toBeNull();
  });
});
