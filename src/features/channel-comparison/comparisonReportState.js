import { normalizeStatisticalEnsembleParameters } from '../../comparison/statisticalEnsemble.js';
import { DomainValidationError } from '../../domain/validation.js';

export const COMPARISON_REALIZATION_COUNT = 32;
const COMPARISON_ENVIRONMENTS = new Set(['rural', 'suburban', 'urban', 'maritime']);

function normalizeLinkBudgetParameters(parameters = {}) {
  const normalized = {
    eirp: parameters.eirp ?? 60,
    gRx: parameters.gRx ?? 42,
    tRx: parameters.tRx ?? 150,
    rainRate: parameters.rainRate ?? 0,
    disableFastFading: parameters.disableFastFading ?? true,
    isPhasedArray: parameters.isPhasedArray ?? false,
    hpbw: parameters.hpbw ?? 2,
    xpdAnt: parameters.xpdAnt ?? 35,
    correctionFactor: parameters.correctionFactor ?? 1,
    gasAttenOffset_dB: parameters.gasAttenOffset_dB ?? 0,
    columnarLWC_kgm2: parameters.columnarLWC_kgm2 ?? 0.5,
  };
  for (const [key, value] of Object.entries(normalized)) {
    if (key === 'disableFastFading' || key === 'isPhasedArray') {
      if (typeof value !== 'boolean') {
        throw new DomainValidationError('COMPARISON_REQUEST_INVALID', `${key} must be boolean`);
      }
    } else if (!Number.isFinite(value)) {
      throw new DomainValidationError('COMPARISON_REQUEST_INVALID', `${key} must be finite`);
    }
  }
  return normalized;
}

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
  linkBudgetParameters = {},
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
  const link = normalizeLinkBudgetParameters(linkBudgetParameters);
  return JSON.stringify([
    'mpdb-comparison-request/v2',
    scenarioId,
    normalized.environment,
    normalized.tec_TECU,
    normalized.scatterPowerOffset_dB,
    normalized.realizationCount,
    link.eirp,
    link.gRx,
    link.tRx,
    link.rainRate,
    link.disableFastFading,
    link.isPhasedArray,
    link.hpbw,
    link.xpdAnt,
    link.correctionFactor,
    link.gasAttenOffset_dB,
    link.columnarLWC_kgm2,
  ]);
}

export function deriveComparisonRequest({
  scenarioId,
  environment,
  tec_TECU,
  useCalibration = false,
  calibrationProfile = null,
  linkBudgetParameters = {},
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
    const normalizedLinkBudgetParameters = normalizeLinkBudgetParameters(linkBudgetParameters);
    return {
      requestKey: buildComparisonRequestKey({
        scenarioId,
        statisticalParameters,
        linkBudgetParameters: normalizedLinkBudgetParameters,
        realizationCount,
      }),
      statisticalParameters,
      linkBudgetParameters: normalizedLinkBudgetParameters,
      error: null,
    };
  } catch (caught) {
    if (!(caught instanceof DomainValidationError)) throw caught;
    return {
      requestKey: null,
      statisticalParameters: null,
      linkBudgetParameters: null,
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
