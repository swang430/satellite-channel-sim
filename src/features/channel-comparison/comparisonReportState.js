import { normalizeStatisticalEnsembleParameters } from '../../comparison/statisticalEnsemble.js';
import { DomainValidationError } from '../../domain/validation.js';

export const COMPARISON_REALIZATION_COUNT = 32;
const COMPARISON_ENVIRONMENTS = new Set(['rural', 'suburban', 'urban', 'maritime']);

export function normalizeComparisonEnvironment(environment) {
  if (environment === 'open') return 'rural';
  if (COMPARISON_ENVIRONMENTS.has(environment)) return environment;
  throw new DomainValidationError(
    'COMPARISON_ENVIRONMENT_INVALID',
    `Unsupported comparison environment: ${String(environment)}`,
  );
}

export function buildComparisonRequestKey({
  scenarioId,
  statisticalParameters = {},
  realizationCount,
} = {}) {
  if (typeof scenarioId !== 'string' || scenarioId.length === 0) {
    throw new DomainValidationError(
      'COMPARISON_REQUEST_INVALID',
      'Comparison request requires a non-empty scenarioId',
    );
  }
  const normalized = normalizeStatisticalEnsembleParameters({
    realizationCount,
    environment: statisticalParameters?.environment,
    tec_TECU: statisticalParameters?.tec_TECU,
    scatterPowerOffset_dB: statisticalParameters?.scatterPowerOffset_dB,
  });
  return JSON.stringify([
    'mpdb-comparison-request/v1',
    scenarioId,
    normalized.environment,
    normalized.tec_TECU,
    normalized.scatterPowerOffset_dB,
    normalized.realizationCount,
  ]);
}

export function deriveComparisonRequest({
  scenarioId,
  environment,
  tec_TECU,
  useCalibration = false,
  calibrationProfile = null,
  realizationCount = COMPARISON_REALIZATION_COUNT,
} = {}) {
  if (scenarioId === null || scenarioId === undefined) {
    return { requestKey: null, statisticalParameters: null, error: null };
  }

  try {
    const calibratedScatterOffset = calibrationProfile?.params?.scatterPowerOffset_dB;
    const statisticalParameters = {
      environment: normalizeComparisonEnvironment(environment),
      tec_TECU,
      scatterPowerOffset_dB: useCalibration
        && calibrationProfile?.calibrated
        && Number.isFinite(calibratedScatterOffset)
        ? calibratedScatterOffset
        : 0,
    };
    return {
      requestKey: buildComparisonRequestKey({
        scenarioId,
        statisticalParameters,
        realizationCount,
      }),
      statisticalParameters,
      error: null,
    };
  } catch (caught) {
    if (!(caught instanceof DomainValidationError)) throw caught;
    return {
      requestKey: null,
      statisticalParameters: null,
      error: {
        code: caught.code,
        message: caught.message,
        issues: caught.issues,
      },
    };
  }
}

export function currentComparisonReport(report, scenarioId, requestKey) {
  const hasCurrentIdentity = typeof scenarioId === 'string'
    && scenarioId.length > 0
    && typeof requestKey === 'string'
    && requestKey.length > 0;
  return hasCurrentIdentity
    && report?.scenarioId === scenarioId
    && report?.requestKey === requestKey
    ? report
    : null;
}
