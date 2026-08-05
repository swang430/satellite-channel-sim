import { CHANNEL_FRAME_SCHEMA_VERSION } from './schemaVersion.js';
import {
  DomainValidationError,
  isFiniteNumber,
  validationIssue,
} from './validation.js';

const REQUIRED_GEOMETRY_FIELDS = [
  'slantRange_m',
  'elevation_deg',
  'azimuth_deg',
  'groundPositionMismatch_m',
];

export function createChannelFrame(input) {
  const issues = [];

  if (!Number.isInteger(input?.frameId) || input.frameId < 0) {
    issues.push(validationIssue('INVALID_FRAME_ID', 'frameId', 'frameId must be a non-negative integer'));
  }
  if (typeof input?.timestampUtc !== 'string' || Number.isNaN(Date.parse(input.timestampUtc))) {
    issues.push(validationIssue('INVALID_UTC_TIMESTAMP', 'timestampUtc', 'Expected an ISO-8601 timestamp'));
  }
  for (const field of REQUIRED_GEOMETRY_FIELDS) {
    if (!isFiniteNumber(input?.geometry?.[field])) {
      issues.push(validationIssue('MISSING_GEOMETRY_FIELD', `geometry.${field}`, `${field} is required`));
    }
  }
  if ((input?.geometry?.slantRange_m ?? 0) <= 0) {
    issues.push(validationIssue('INVALID_PHYSICAL_RANGE', 'geometry.slantRange_m', 'slant range must be positive'));
  }
  if ((input?.geometry?.groundPositionMismatch_m ?? -1) < 0) {
    issues.push(validationIssue(
      'INVALID_PHYSICAL_RANGE',
      'geometry.groundPositionMismatch_m',
      'ground mismatch must be non-negative',
    ));
  }
  if (!['exact', 'approximate'].includes(input?.geometry?.geometryMatch)) {
    issues.push(validationIssue(
      'INVALID_GEOMETRY_MATCH',
      'geometry.geometryMatch',
      'geometryMatch must be exact or approximate',
    ));
  }
  if (!input?.cir || !input?.pdp || !input?.provenance) {
    issues.push(validationIssue(
      'INCOMPLETE_CHANNEL_FRAME',
      '',
      'CIR, PDP, and provenance are required',
    ));
  }

  if (issues.length > 0) {
    throw new DomainValidationError('INVALID_CHANNEL_FRAME', 'Invalid ChannelFrame', issues);
  }

  return {
    schemaVersion: CHANNEL_FRAME_SCHEMA_VERSION,
    frameId: input.frameId,
    timestampUtc: new Date(input.timestampUtc).toISOString(),
    geometry: { ...input.geometry },
    cir: input.cir,
    pdp: input.pdp,
    metrics: input.metrics ?? {},
    provenance: { ...input.provenance },
  };
}
