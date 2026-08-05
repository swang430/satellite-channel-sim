import { SCENARIO_SCHEMA_VERSION } from './schemaVersion.js';
import {
  DomainValidationError,
  isFiniteNumber,
  validationIssue,
} from './validation.js';

const UNITLESS_PHYSICAL_KEYS = new Set([
  'alt',
  'azimuth',
  'bandwidth',
  'delay',
  'eirp',
  'elevation',
  'freq',
  'frequency',
  'power',
  'slantRange',
]);

export function createScenarioDraft(input = {}) {
  return {
    schemaVersion: SCENARIO_SCHEMA_VERSION,
    scenarioId: input.scenarioId ?? null,
    source: input.source ?? { format: null, files: [] },
    link: input.link ?? {
      direction: null,
      transmitterId: null,
      receiverId: null,
    },
    time: input.time ?? {
      startTimeUtc: null,
      sampleInterval_s: null,
      frameCount: 0,
    },
    carrier: input.carrier ?? {
      frequency_Hz: null,
      bandwidth_Hz: null,
    },
    coordinateReference: input.coordinateReference ?? null,
    transmitter: input.transmitter ?? {},
    receiver: input.receiver ?? {},
    geometry: input.geometry ?? null,
    rayTracing: input.rayTracing ?? null,
    diagnostics: input.diagnostics ?? { warnings: [], assumptions: [] },
  };
}

function collectUnitlessPhysicalFields(value, path, issues) {
  if (value === null || typeof value !== 'object' || ArrayBuffer.isView(value)) return;

  for (const [key, child] of Object.entries(value)) {
    const childPath = path ? `${path}.${key}` : key;
    if (UNITLESS_PHYSICAL_KEYS.has(key)) {
      issues.push(validationIssue(
        'UNITLESS_PHYSICAL_FIELD',
        childPath,
        `Physical field ${childPath} must include an explicit unit suffix`,
      ));
    }
    collectUnitlessPhysicalFields(child, childPath, issues);
  }
}

export function validateScenario(scenario) {
  const issues = [];

  if (!scenario || typeof scenario !== 'object') {
    return [validationIssue('INVALID_SCENARIO', '', 'Scenario must be an object')];
  }
  if (scenario.schemaVersion !== SCENARIO_SCHEMA_VERSION) {
    issues.push(validationIssue(
      'UNSUPPORTED_SCHEMA_VERSION',
      'schemaVersion',
      `Expected ${SCENARIO_SCHEMA_VERSION}`,
    ));
  }

  const positiveFields = [
    ['carrier.frequency_Hz', scenario.carrier?.frequency_Hz],
    ['carrier.bandwidth_Hz', scenario.carrier?.bandwidth_Hz],
    ['time.sampleInterval_s', scenario.time?.sampleInterval_s],
    ['time.frameCount', scenario.time?.frameCount],
  ];
  for (const [path, value] of positiveFields) {
    if (!isFiniteNumber(value) || value <= 0) {
      issues.push(validationIssue(
        'INVALID_PHYSICAL_RANGE',
        path,
        `${path} must be a finite number greater than zero`,
      ));
    }
  }

  if (!scenario.link?.transmitterId || !scenario.link?.receiverId) {
    issues.push(validationIssue(
      'MISSING_LINK_ENTITY',
      'link',
      'Both transmitterId and receiverId are required',
    ));
  }

  const receiverTrack = scenario.receiver?.track;
  if (!Array.isArray(receiverTrack)
    || receiverTrack.length !== scenario.time?.frameCount) {
    issues.push(validationIssue(
      'RECEIVER_TRACK_FRAME_COUNT_MISMATCH',
      'receiver.track',
      'receiver.track must contain exactly one point per scenario frame',
    ));
  }

  if (Array.isArray(receiverTrack)) {
    receiverTrack.forEach((point, frameId) => {
      if (point?.frameId !== frameId) {
        issues.push(validationIssue(
          'RECEIVER_TRACK_FRAME_ID_MISMATCH',
          `receiver.track[${frameId}].frameId`,
          `Receiver track point ${frameId} must have frameId ${frameId}`,
        ));
      }

      const coordinates = [
        ['longitude_deg', point?.longitude_deg],
        ['latitude_deg', point?.latitude_deg],
        ['altitude_m', point?.altitude_m],
        ['projectedPosition_m.x', point?.projectedPosition_m?.x],
        ['projectedPosition_m.y', point?.projectedPosition_m?.y],
        ['projectedPosition_m.z', point?.projectedPosition_m?.z],
      ];
      coordinates.forEach(([coordinatePath, value]) => {
        if (!isFiniteNumber(value)) {
          issues.push(validationIssue(
            'INVALID_RECEIVER_TRACK_COORDINATE',
            `receiver.track[${frameId}].${coordinatePath}`,
            `Receiver track coordinate ${coordinatePath} must be finite`,
          ));
        }
      });
    });
  }

  collectUnitlessPhysicalFields(scenario, '', issues);
  return issues;
}

export function assertScenarioReadyForComparison(scenario) {
  const issues = validateScenario(scenario);

  if (issues.length > 0) {
    throw new DomainValidationError(
      'SCENARIO_NOT_READY',
      'Scenario is not ready for comparison',
      issues,
    );
  }
  return scenario;
}
