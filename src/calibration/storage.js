import { validateCalibrationProfile } from './schema.js';

export const CALIBRATION_STORAGE_KEY = 'satellite-channel-sim.calibration.v1';

function requireStorage(storage) {
  if (!storage || typeof storage.getItem !== 'function' || typeof storage.setItem !== 'function') {
    throw new TypeError('a Storage-compatible object is required');
  }
}

export function saveCalibrationProfile(profile, storage = globalThis.localStorage) {
  requireStorage(storage);
  storage.setItem(CALIBRATION_STORAGE_KEY, JSON.stringify(validateCalibrationProfile(profile)));
}

export function loadCalibrationProfile(storage = globalThis.localStorage) {
  requireStorage(storage);
  const serialized = storage.getItem(CALIBRATION_STORAGE_KEY);
  if (serialized == null) return null;
  try {
    return validateCalibrationProfile(JSON.parse(serialized));
  } catch (error) {
    throw new TypeError(`stored calibration profile is invalid: ${error.message}`);
  }
}
