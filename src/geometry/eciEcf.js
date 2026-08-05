import { DomainValidationError } from '../domain/validation.js';

export const EARTH_ROTATION_RATE_radps = 7.292_115_0e-5;
const SPEED_OF_LIGHT_mps = 299_792_458;

function rotateEciToEcf(vector, gmst_rad) {
  const cosine = Math.cos(gmst_rad);
  const sine = Math.sin(gmst_rad);
  return {
    x: vector.x * cosine + vector.y * sine,
    y: -vector.x * sine + vector.y * cosine,
    z: vector.z,
  };
}

function assertVector(vector, path) {
  if (!vector || !['x', 'y', 'z'].every((axis) => Number.isFinite(vector[axis]))) {
    throw new DomainValidationError('ORBIT_VECTOR_INVALID', `${path} must be a finite vector`);
  }
}

export function eciStateToEcf({ positionEci_km, velocityEci_kmps, gmst_rad }) {
  assertVector(positionEci_km, 'positionEci_km');
  assertVector(velocityEci_kmps, 'velocityEci_kmps');
  if (!Number.isFinite(gmst_rad)) {
    throw new DomainValidationError('ORBIT_GMST_INVALID', 'gmst_rad must be finite');
  }
  const positionEcf_km = rotateEciToEcf(positionEci_km, gmst_rad);
  const rotatedVelocity_kmps = rotateEciToEcf(velocityEci_kmps, gmst_rad);
  const earthRotationCrossPosition_kmps = {
    x: -EARTH_ROTATION_RATE_radps * positionEcf_km.y,
    y: EARTH_ROTATION_RATE_radps * positionEcf_km.x,
    z: 0,
  };
  return {
    positionEcf_km,
    velocityEcf_kmps: {
      x: rotatedVelocity_kmps.x - earthRotationCrossPosition_kmps.x,
      y: rotatedVelocity_kmps.y - earthRotationCrossPosition_kmps.y,
      z: rotatedVelocity_kmps.z,
    },
  };
}

export function calculateDopplerFromEciState({
  positionEci_km,
  velocityEci_kmps,
  observerPositionEcf_km,
  gmst_rad,
  frequency_Hz,
}) {
  assertVector(observerPositionEcf_km, 'observerPositionEcf_km');
  if (!Number.isFinite(frequency_Hz) || frequency_Hz <= 0) {
    throw new DomainValidationError('DOPPLER_FREQUENCY_INVALID', 'frequency_Hz must be positive');
  }
  const state = eciStateToEcf({ positionEci_km, velocityEci_kmps, gmst_rad });
  const lineOfSight_km = {
    x: state.positionEcf_km.x - observerPositionEcf_km.x,
    y: state.positionEcf_km.y - observerPositionEcf_km.y,
    z: state.positionEcf_km.z - observerPositionEcf_km.z,
  };
  const slantRange_km = Math.hypot(
    lineOfSight_km.x,
    lineOfSight_km.y,
    lineOfSight_km.z,
  );
  if (slantRange_km === 0) {
    return { ...state, slantRange_km: 0, rangeRate_kmps: 0, doppler_Hz: 0 };
  }
  const rangeRate_kmps = (
    state.velocityEcf_kmps.x * lineOfSight_km.x
    + state.velocityEcf_kmps.y * lineOfSight_km.y
    + state.velocityEcf_kmps.z * lineOfSight_km.z
  ) / slantRange_km;
  return {
    ...state,
    slantRange_km,
    rangeRate_kmps,
    doppler_Hz: -frequency_Hz * rangeRate_kmps * 1_000 / SPEED_OF_LIGHT_mps,
  };
}

