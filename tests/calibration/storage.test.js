import { describe, expect, it } from 'vitest';
import { createDefaultCalibration } from '../../src/calibration/schema.js';
import {
  CALIBRATION_STORAGE_KEY,
  loadCalibrationProfile,
  saveCalibrationProfile,
} from '../../src/calibration/storage.js';

function memoryStorage() {
  const values = new Map();
  return {
    getItem: (key) => values.get(key) ?? null,
    setItem: (key, value) => values.set(key, value),
  };
}

describe('calibration profile storage', () => {
  it('round-trips a validated profile under a versioned key', () => {
    const storage = memoryStorage();
    const profile = createDefaultCalibration();

    saveCalibrationProfile(profile, storage);

    expect(CALIBRATION_STORAGE_KEY).toContain('v1');
    expect(loadCalibrationProfile(storage)).toEqual(profile);
  });

  it('rejects corrupted stored content', () => {
    const storage = memoryStorage();
    storage.setItem(CALIBRATION_STORAGE_KEY, '{bad json');

    expect(() => loadCalibrationProfile(storage)).toThrow(/stored calibration profile/i);
  });
});
