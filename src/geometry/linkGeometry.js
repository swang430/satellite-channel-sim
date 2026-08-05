import {
  degreesToRadians,
  geodeticToEcf,
} from 'satellite.js';
import { DomainValidationError } from '../domain/validation.js';

export function groundPositionEcf({ latitude_deg, longitude_deg, altitude_m }) {
  if (![latitude_deg, longitude_deg, altitude_m].every(Number.isFinite)) {
    throw new DomainValidationError(
      'GROUND_POSITION_INVALID',
      'Ground latitude, longitude, and altitude must be finite',
    );
  }
  return geodeticToEcf({
    latitude: degreesToRadians(latitude_deg),
    longitude: degreesToRadians(longitude_deg),
    height: altitude_m / 1_000,
  });
}

export function projectedLinkGeometry(transmitterPosition_m, receiverPosition_m) {
  const east_m = transmitterPosition_m.x - receiverPosition_m.x;
  const north_m = transmitterPosition_m.y - receiverPosition_m.y;
  const up_m = transmitterPosition_m.z - receiverPosition_m.z;
  const slantRange_m = Math.hypot(east_m, north_m, up_m);
  if (slantRange_m === 0) {
    throw new DomainValidationError(
      'LINK_GEOMETRY_ZERO_RANGE',
      'Transmitter and receiver positions must differ',
    );
  }
  return {
    slantRange_m,
    elevation_deg: Math.asin(up_m / slantRange_m) * 180 / Math.PI,
    azimuth_deg: (Math.atan2(east_m, north_m) * 180 / Math.PI + 360) % 360,
  };
}

