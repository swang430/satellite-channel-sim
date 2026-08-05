import { describe, expect, it } from 'vitest';
import { generateMODCOTimeline, selectMODCOD } from '../../src/adapters/dvbS2xAdapter.js';

describe('DVB-S2X adapter semantics', () => {
  it('returns outage below the minimum Es/N0 threshold', () => {
    const result = selectMODCOD(-20, 'clearSky');

    expect(result.predictedMODCOD).toEqual({ status: 'outage', reason: 'BELOW_MINIMUM_ESN0' });
    expect(result.safeRecommendation).toEqual({ status: 'outage', reason: 'BELOW_MINIMUM_ESN0' });
    expect(result.spectralEfficiency_bpsHz).toBeNull();
  });

  it('selects MODCOD from explicit Es/N0', () => {
    const result = selectMODCOD(5, 'clearSky');
    expect(result.inputMetric).toBe('Es/N0');
    expect(result.linkBudget.predictedEsN0_dB).toBe(5);
    expect(result.predictedMODCOD.status).toBe('available');
  });

  it('does not substitute SNR for Es/N0 in a timeline', () => {
    const timeline = generateMODCOTimeline([{
      time: '2026-08-05T00:00:00Z',
      elevation_deg: 30,
      snr: { db: 15 },
    }]);

    expect(timeline).toEqual([expect.objectContaining({
      status: 'unavailable',
      reason: 'ESN0_NOT_PROVIDED',
    })]);
  });
});
