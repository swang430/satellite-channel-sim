import { normalizeStatisticalEnsembleParameters } from '../../comparison/statisticalEnsemble.js';
import { DomainValidationError } from '../../domain/validation.js';

export const COMPARISON_REALIZATION_COUNT = 32;

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
