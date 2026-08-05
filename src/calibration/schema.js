export const CALIBRATION_SCHEMA_VERSION = 'satellite-channel-sim/calibration-v1';

export const CALIBRATION_PARAMETER_DEFS = Object.freeze([
  { key: 'correctionFactor', label: '雨衰修正系数', defaultValue: 1, min: 0.3, max: 3, step: 0.02 },
  { key: 'gasAttenOffset_dB', label: '气体衰减偏移 (dB)', defaultValue: 0, min: -2, max: 2, step: 0.02 },
  { key: 'scatterPowerOffset_dB', label: '散射功率偏移 (dB)', defaultValue: 0, min: -10, max: 5, step: 0.1 },
  { key: 'eirpOffset_dB', label: 'EIRP 偏移 (dB)', defaultValue: 0, min: -5, max: 5, step: 0.1 },
  { key: 'systemNoiseOffset_K', label: '系统噪温偏移 (K)', defaultValue: 0, min: -50, max: 100, step: 1 },
]);

function defaultParams() {
  return Object.fromEntries(CALIBRATION_PARAMETER_DEFS.map((definition) => [
    definition.key,
    definition.defaultValue,
  ]));
}

export function createDefaultCalibration() {
  return {
    schemaVersion: CALIBRATION_SCHEMA_VERSION,
    calibrated: false,
    createdAt: null,
    dataPointCount: 0,
    residualRms: null,
    params: defaultParams(),
    parameterStatus: Object.fromEntries(
      CALIBRATION_PARAMETER_DEFS.map(({ key }) => [key, 'frozen']),
    ),
    confidence: {
      status: 'unavailable',
      reason: 'NO_CALIBRATION_DATA',
    },
    condition: {
      status: 'not-evaluated',
      estimatedRank: 0,
      parameterCount: CALIBRATION_PARAMETER_DEFS.length,
    },
    diagnostics: [],
    provenance: {
      measurementSchema: null,
      referenceFields: {},
    },
  };
}

export function validateCalibrationProfile(value) {
  if (!value || typeof value !== 'object') {
    throw new TypeError('calibration profile must be an object');
  }
  if (value.schemaVersion !== CALIBRATION_SCHEMA_VERSION) {
    throw new TypeError(`unsupported calibration schemaVersion: ${String(value.schemaVersion)}`);
  }
  if (!value.params || typeof value.params !== 'object') {
    throw new TypeError('calibration profile params must be an object');
  }
  for (const { key } of CALIBRATION_PARAMETER_DEFS) {
    if (typeof value.params[key] !== 'number' || !Number.isFinite(value.params[key])) {
      throw new TypeError(`calibration profile params.${key} must be finite`);
    }
  }
  if (!value.confidence || !value.condition || !Array.isArray(value.diagnostics)) {
    throw new TypeError('calibration profile diagnostics are incomplete');
  }
  return value;
}

export function getCalibrationParameterDefs() {
  return CALIBRATION_PARAMETER_DEFS.map((definition) => ({ ...definition }));
}
