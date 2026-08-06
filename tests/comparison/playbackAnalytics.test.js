import { describe, expect, it } from 'vitest';
import { buildPlaybackAnalytics } from '../../src/features/channel-comparison/playbackAnalytics.js';

function frame({ rt = false } = {}) {
  return {
    frameId: 0,
    timestampUtc: '2026-08-05T00:00:00.000Z',
    receiver: {
      longitude_deg: 121,
      latitude_deg: 31,
      altitude_m: 15,
      projectedPosition_m: { x: 0, y: 0, z: 0 },
    },
    geometry: { elevation_deg: 45, slantRange_m: 700_000 },
    link: { rxPower_dBm: -90, snr_dB: 12 },
    statistical: {
      linkBudget: {
        loss: { totalPropagationLoss_dB: 180, components_dB: { rain: 1 } },
        link: { rxPower_dBm: -90, snr_dB: 12 },
        delay: { rmsDelaySpread_s: 8e-9 },
        sources: { values: 'test' },
      },
      doppler: { geometric_Hz: 10_000, method: 'test-range-rate' },
    },
    ...(rt ? {
      rt: {
        pdp: { bins: [{ pathCount: 2 }] },
        metrics: { rmsDelaySpread_s: 4e-9, meanExcessDelay_s: 3e-9 },
        relativeGain: { relativeToWindowPeak_dB: -2, relativeToFirstFrame_dB: 0 },
        pathStatistics: {
          status: 'available',
          dopplerCentroid_Hz: 9000,
          dopplerRmsSpread_Hz: 500,
          dominantPathDoppler_Hz: 9200,
          dominantPathPowerShare: 0.75,
          dopplerMin_Hz: 8000,
          dopplerMax_Hz: 10000,
          dopplerMethod: 'noncoherent-path-power-weighted',
        },
      },
      metrics: { jsDivergence_bits: 0.1 },
    } : {}),
  };
}

describe('playback analytics', () => {
  it('keeps statistical analytics complete when RT has not been imported', () => {
    const analytics = buildPlaybackAnalytics({
      scenarioId: 'selected',
      timeWindow: { source: 'selected-pass' },
      frames: [frame()],
    });
    expect(analytics.frames[0]).toMatchObject({
      statistical: {
        loss: { totalPropagationLoss_dB: 180 },
        doppler: { geometric_Hz: 10_000 },
      },
      rt: { availability: { status: 'not-imported' } },
      alerts: [],
    });
  });

  it('normalizes MPDB RT gain, delay, Doppler, path count, and fit metrics', () => {
    const [result] = buildPlaybackAnalytics({
      scenarioId: 'mpdb',
      timeWindow: { source: 'mpdb' },
      frames: [frame({ rt: true })],
    }).frames;
    expect(result).toMatchObject({
      rt: {
        availability: { status: 'available' },
        relativeGain: { relativeToWindowPeak_dB: -2 },
        delay: { rmsDelaySpread_s: 4e-9 },
        doppler: { centroid_Hz: 9000, rmsSpread_Hz: 500, dominantPath_Hz: 9200 },
        pathCount: 2,
      },
      comparison: { jsDivergence_bits: 0.1 },
      alerts: [{ code: 'RT_ABSOLUTE_PATH_LOSS_UNAVAILABLE' }],
    });
  });
});
