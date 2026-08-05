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
    groundSelection: input.groundSelection ?? null,
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

  collectUnitlessPhysicalFields(scenario, '', issues);
  return issues;
}

export function normalizeGroundSelection(selection, frameCount) {
  const selectedFrameId = selection?.selectedFrameId;
  if (!Number.isInteger(selectedFrameId) || selectedFrameId < 0 || selectedFrameId >= frameCount) {
    throw new DomainValidationError(
      'GROUND_FRAME_OUT_OF_RANGE',
      `selectedFrameId must be between 0 and ${frameCount - 1}`,
    );
  }
  if (selection.selectedBy !== 'user') {
    throw new DomainValidationError(
      'GROUND_SELECTION_NOT_EXPLICIT',
      'Ground selection must be explicitly confirmed by the user',
    );
  }
  const matchTolerance_m = selection.matchTolerance_m ?? 0.1;
  if (!isFiniteNumber(matchTolerance_m) || matchTolerance_m < 0) {
    throw new DomainValidationError(
      'INVALID_GROUND_MATCH_TOLERANCE',
      'matchTolerance_m must be a finite non-negative number',
    );
  }

  return {
    selectedFrameId,
    selectedBy: 'user',
    selectedAtUtc: selection.selectedAtUtc ?? new Date().toISOString(),
    matchTolerance_m,
  };
}

export function assertScenarioReadyForComparison(scenario) {
  const issues = validateScenario(scenario);
  if (!scenario?.groundSelection) {
    issues.push(validationIssue(
      'GROUND_FRAME_REQUIRED',
      'groundSelection',
      'Select and confirm a ground frame before comparison',
    ));
  }

  if (issues.length > 0) {
    throw new DomainValidationError(
      'SCENARIO_NOT_READY',
      'Scenario is not ready for comparison',
      issues,
    );
  }
  return scenario;
}
