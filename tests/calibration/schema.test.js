import { describe, expect, it } from 'vitest';
import {
  CALIBRATION_SCHEMA_VERSION,
  createDefaultCalibration,
  validateCalibrationProfile,
} from '../../src/calibration/schema.js';

describe('calibration profile schema', () => {
  it('includes versioned confidence and condition diagnostics', () => {
    const profile = createDefaultCalibration();

    expect(profile.schemaVersion).toBe(CALIBRATION_SCHEMA_VERSION);
    expect(profile.confidence).toMatchObject({ status: 'unavailable' });
    expect(profile.condition).toMatchObject({ status: 'not-evaluated' });
    expect(validateCalibrationProfile(JSON.parse(JSON.stringify(profile)))).toEqual(profile);
  });

  it('preserves zero offsets during validation', () => {
    const profile = createDefaultCalibration();
    profile.params = {
      ...profile.params,
      correctionFactor: 0,
      gasAttenOffset_dB: 0,
      scatterPowerOffset_dB: 0,
      eirpOffset_dB: 0,
      systemNoiseOffset_K: 0,
    };

    expect(validateCalibrationProfile(profile).params).toEqual(profile.params);
  });

  it('rejects profiles from an unknown schema', () => {
    expect(() => validateCalibrationProfile({
      ...createDefaultCalibration(),
      schemaVersion: 'legacy',
    })).toThrow(/schemaVersion/i);
  });
});
