import { DomainValidationError } from '../domain/validation.js';

export function calculateChannelMetrics(
  pdp,
  { powerDefinition = 'coherentPower_linear' } = {},
) {
  if (!Array.isArray(pdp?.bins) || pdp.bins.length === 0) {
    throw new DomainValidationError('CHANNEL_METRICS_PDP_INVALID', 'PDP bins are required');
  }
  const totalPower = pdp.bins.reduce((sum, bin) => sum + bin[powerDefinition], 0);
  if (!Number.isFinite(totalPower) || totalPower <= 0) {
    return {
      powerDefinition,
      totalPower_linear: totalPower,
      meanExcessDelay_s: 0,
      rmsDelaySpread_s: 0,
      coherenceBandwidth_Hz: Infinity,
    };
  }
  const meanExcessDelay_s = pdp.bins.reduce((sum, bin) => (
    sum + bin.excessDelay_s * bin[powerDefinition]
  ), 0) / totalPower;
  const variance_s2 = pdp.bins.reduce((sum, bin) => (
    sum + (bin.excessDelay_s - meanExcessDelay_s) ** 2 * bin[powerDefinition]
  ), 0) / totalPower;
  const rmsDelaySpread_s = Math.sqrt(Math.max(0, variance_s2));

  return {
    powerDefinition,
    totalPower_linear: totalPower,
    meanExcessDelay_s,
    rmsDelaySpread_s,
    coherenceBandwidth_Hz: rmsDelaySpread_s > 0
      ? 1 / (5 * rmsDelaySpread_s)
      : Infinity,
  };
}

