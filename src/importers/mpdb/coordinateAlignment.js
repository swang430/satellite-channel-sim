import proj4 from 'proj4';
import { DomainValidationError } from '../../domain/validation.js';

function median(values) {
  const sorted = [...values].sort((left, right) => left - right);
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 1
    ? sorted[middle]
    : (sorted[middle - 1] + sorted[middle]) / 2;
}

function positionAt(flatPositions, frameId) {
  const offset = frameId * 3;
  return {
    x: flatPositions[offset],
    y: flatPositions[offset + 1],
    z: flatPositions[offset + 2],
  };
}

export function alignMpdbCoordinates(satelliteTrack, txPosition_m) {
  if (!Array.isArray(satelliteTrack)
    || satelliteTrack.length === 0
    || txPosition_m?.length !== satelliteTrack.length * 3) {
    throw new DomainValidationError(
      'MPDB_COORDINATE_FRAME_MISMATCH',
      'Satellite track and MPDB transmitter positions must have matching frame counts',
    );
  }

  const translations = satelliteTrack.map((point, frameId) => {
    const local = positionAt(txPosition_m, frameId);
    return {
      x: point.projectedPosition_m.x - local.x,
      y: point.projectedPosition_m.y - local.y,
      z: point.projectedPosition_m.z - local.z,
    };
  });
  const localOrigin_m = {
    x: median(translations.map((position) => position.x)),
    y: median(translations.map((position) => position.y)),
    z: median(translations.map((position) => position.z)),
  };
  const residuals_m = translations.map((translation) => Math.hypot(
    translation.x - localOrigin_m.x,
    translation.y - localOrigin_m.y,
    translation.z - localOrigin_m.z,
  ));
  const alignmentRmsResidual_m = Math.sqrt(
    residuals_m.reduce((sum, residual) => sum + residual ** 2, 0) / residuals_m.length,
  );

  return {
    localOrigin_m,
    alignmentRmsResidual_m,
    alignmentMaxResidual_m: Math.max(...residuals_m),
  };
}

function projectedDefinition(epsg) {
  if (epsg >= 32601 && epsg <= 32660) {
    return `+proj=utm +zone=${epsg - 32600} +datum=WGS84 +units=m +no_defs +type=crs`;
  }
  if (epsg >= 32701 && epsg <= 32760) {
    return `+proj=utm +zone=${epsg - 32700} +south +datum=WGS84 +units=m +no_defs +type=crs`;
  }
  return `EPSG:${epsg}`;
}

export function localToProjected(localPosition_m, localOrigin_m) {
  return {
    x: localPosition_m.x + localOrigin_m.x,
    y: localPosition_m.y + localOrigin_m.y,
    z: localPosition_m.z + localOrigin_m.z,
  };
}

export function projectedToGeographic(projectedPosition_m, projectedEpsg) {
  let longitudeLatitude;
  try {
    longitudeLatitude = proj4(
      projectedDefinition(projectedEpsg),
      'EPSG:4326',
      [projectedPosition_m.x, projectedPosition_m.y],
    );
  } catch (error) {
    throw new DomainValidationError(
      'PROJECTED_CRS_NOT_SUPPORTED',
      `Cannot convert EPSG:${projectedEpsg} to WGS84: ${error.message}`,
    );
  }
  return {
    longitude_deg: longitudeLatitude[0],
    latitude_deg: longitudeLatitude[1],
    altitude_m: projectedPosition_m.z,
  };
}

export function readFlatPosition(flatPositions, frameId) {
  return positionAt(flatPositions, frameId);
}

