import { describe, expect, it } from 'vitest';
import { linkStateToNTNParams, passToNTNProfile } from '../../src/adapters/ntnAdapter.js';

describe('NTN adapter semantics', () => {
  it('does not fabricate path loss from SNR or received power', () => {
    const result = linkStateToNTNParams({
      elevation_deg: 45,
      rxPower_dBm: -90,
      snr: { db: 12 },
      channel: { rmsDelaySpread_ns: 8 },
    });

    expect(result.largeScaleParams.pathLoss).toEqual({
      status: 'unavailable',
      reason: 'PATH_LOSS_NOT_PROVIDED',
    });
    expect(result.largeScaleParams).not.toHaveProperty('pathLoss_dB');
    expect(result.modelStatus).toBe('heuristic-not-standard-compliant');
  });

  it('passes through an explicitly supplied path loss', () => {
    const result = linkStateToNTNParams({
      elevation_deg: 45,
      pathLoss_dB: 181.5,
      snr: { db: 12 },
      channel: { rmsDelaySpread_ns: 8 },
    });
    expect(result.largeScaleParams.pathLoss).toEqual({ status: 'available', value_dB: 181.5 });
  });

  it('does not derive a pass path-loss range from SNR', () => {
    const profile = passToNTNProfile({
      pass: { maxElevation: 50 },
      stepSec: 1,
      linkStates: [
        { time: '2026-08-05T00:00:00Z', elevation_deg: 20, snr: { db: 2 }, channel: {} },
        { time: '2026-08-05T00:00:01Z', elevation_deg: 30, snr: { db: 8 }, channel: {} },
      ],
    });
    expect(profile.ntnProfile.gppParams.pathLossRange).toEqual({
      status: 'unavailable',
      reason: 'PATH_LOSS_NOT_PROVIDED',
    });
  });
});
