import { normalizeStatisticalEnsembleParameters } from '../../comparison/statisticalEnsemble.js';
import { DomainValidationError } from '../../domain/validation.js';

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
  return report?.scenarioId === scenarioId && report?.requestKey === requestKey
    ? report
    : null;
}
