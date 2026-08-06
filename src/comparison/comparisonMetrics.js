import { calculateChannelMetrics } from '../channel/channelMetrics.js';
import { DomainValidationError } from '../domain/validation.js';

function normalizedPowerMap(pdp) {
  const total = pdp.bins.reduce((sum, bin) => sum + bin.coherentPower_linear, 0);
  return new Map(pdp.bins.map((bin) => [
    bin.binIndex,
    total > 0 ? bin.coherentPower_linear / total : 0,
  ]));
}

function klTerm(value, reference) {
  return value > 0 && reference > 0 ? value * Math.log2(value / reference) : 0;
}

export function comparePdpMetrics(first, second) {
  const firstPower = normalizedPowerMap(first);
  const secondPower = normalizedPowerMap(second);
  const indices = [...new Set([...firstPower.keys(), ...secondPower.keys()])]
    .sort((left, right) => left - right);
  let jsDivergence_bits = 0;
  let cumulativeDifference = 0;
  let weightedDelayDistance_s = 0;
  const binWidth_s = Math.min(first.binWidth_s, second.binWidth_s);
  for (const index of indices) {
    const left = firstPower.get(index) ?? 0;
    const right = secondPower.get(index) ?? 0;
    const middle = (left + right) / 2;
    jsDivergence_bits += (klTerm(left, middle) + klTerm(right, middle)) / 2;
    cumulativeDifference += left - right;
    weightedDelayDistance_s += Math.abs(cumulativeDifference) * binWidth_s;
  }
  const firstMetrics = calculateChannelMetrics(first);
  const secondMetrics = calculateChannelMetrics(second);
  return {
    jsDivergence_bits,
    weightedDelayDistance_s,
    rmsDelaySpreadDifference_s:
      secondMetrics.rmsDelaySpread_s - firstMetrics.rmsDelaySpread_s,
  };
}

function circularMean_deg(values, weights) {
  let sine = 0;
  let cosine = 0;
  values.forEach((value, index) => {
    const radians = value * Math.PI / 180;
    sine += Math.sin(radians) * weights[index];
    cosine += Math.cos(radians) * weights[index];
  });
  return (Math.atan2(sine, cosine) * 180 / Math.PI + 360) % 360;
}

const RT_PATH_COLUMNS = [
  'hReal',
  'hImag',
  'doppler_Hz',
  'aoa_deg',
  'aod_deg',
  'channelType',
];

function validateRtPathStatisticsView(view) {
  const rayCount = view?.hReal?.length;
  if (!Number.isInteger(rayCount) || rayCount === 0) {
    throw new DomainValidationError(
      'RT_PATH_STATISTICS_EMPTY',
      'At least one RT ray is required',
    );
  }
  if (RT_PATH_COLUMNS.some((column) => view?.[column]?.length !== rayCount)) {
    throw new DomainValidationError(
      'RT_PATH_ARRAY_LENGTH_MISMATCH',
      'RT path statistic arrays must have matching lengths',
    );
  }
  if (RT_PATH_COLUMNS.some((column) => (
    [...view[column]].some((value) => !Number.isFinite(value))
  ))) {
    throw new DomainValidationError(
      'RT_PATH_VALUE_INVALID',
      'RT path statistic values must be finite',
    );
  }
}

export function summarizeRtPathStatistics(view) {
  validateRtPathStatisticsView(view);
  const weights = [...view.hReal].map((real, index) => (
    real ** 2 + view.hImag[index] ** 2
  ));
  const totalPower = weights.reduce((sum, value) => sum + value, 0);
  const rawChannelTypes = [...new Set(view.channelType)]
    .sort((left, right) => left - right);
  if (totalPower === 0) {
    return {
      status: 'unavailable',
      reason: 'ZERO_TOTAL_PATH_POWER',
      meanAoa_deg: null,
      meanAod_deg: null,
      meanDoppler_Hz: null,
      dopplerCentroid_Hz: null,
      dopplerRmsSpread_Hz: null,
      dominantPathDoppler_Hz: null,
      dominantPathPowerShare: null,
      dopplerMin_Hz: null,
      dopplerMax_Hz: null,
      dopplerMethod: 'noncoherent-path-power-weighted',
      rawChannelTypes,
    };
  }
  const dopplers = [...view.doppler_Hz];
  const dopplerCentroid_Hz = dopplers.reduce((sum, value, index) => (
    sum + value * weights[index]
  ), 0) / totalPower;
  const dopplerVariance_Hz2 = dopplers.reduce((sum, value, index) => (
    sum + weights[index] * (value - dopplerCentroid_Hz) ** 2
  ), 0) / totalPower;
  const dominantIndex = weights.reduce((strongestIndex, weight, index) => (
    weight > weights[strongestIndex] ? index : strongestIndex
  ), 0);
  const { dopplerMin_Hz, dopplerMax_Hz } = dopplers.reduce((range, value) => ({
    dopplerMin_Hz: Math.min(range.dopplerMin_Hz, value),
    dopplerMax_Hz: Math.max(range.dopplerMax_Hz, value),
  }), { dopplerMin_Hz: dopplers[0], dopplerMax_Hz: dopplers[0] });
  return {
    status: 'available',
    meanAoa_deg: circularMean_deg([...view.aoa_deg], weights),
    meanAod_deg: circularMean_deg([...view.aod_deg], weights),
    meanDoppler_Hz: dopplerCentroid_Hz,
    dopplerCentroid_Hz,
    dopplerRmsSpread_Hz: Math.sqrt(Math.max(0, dopplerVariance_Hz2)),
    dominantPathDoppler_Hz: dopplers[dominantIndex],
    dominantPathPowerShare: weights[dominantIndex] / totalPower,
    dopplerMin_Hz,
    dopplerMax_Hz,
    dopplerMethod: 'noncoherent-path-power-weighted',
    rawChannelTypes,
  };
}

export function summarizeRtWindowRelativeGain(totalPowers_linear) {
  if (!Array.isArray(totalPowers_linear) || totalPowers_linear.length === 0) {
    throw new DomainValidationError(
      'RT_WINDOW_POWER_EMPTY',
      'At least one RT frame total power is required',
    );
  }
  if (totalPowers_linear.some((power) => !Number.isFinite(power) || power < 0)) {
    throw new DomainValidationError(
      'RT_WINDOW_POWER_INVALID',
      'RT frame total powers must be finite and non-negative',
    );
  }

  const windowPeakPower = Math.max(...totalPowers_linear);
  const firstFramePower = totalPowers_linear[0];
  return totalPowers_linear.map((totalPower_linear) => {
    if (totalPower_linear === 0) {
      return {
        status: 'unavailable',
        reason: 'ZERO_TOTAL_POWER',
        totalPower_linear,
      };
    }
    const relativeToWindowPeak_dB = 10 * Math.log10(totalPower_linear / windowPeakPower);
    if (firstFramePower === 0) {
      return {
        status: 'unavailable',
        reason: 'ZERO_FIRST_FRAME_POWER',
        totalPower_linear,
        relativeToWindowPeak_dB,
        relativeToFirstFrame_dB: null,
      };
    }
    return {
      status: 'available',
      totalPower_linear,
      relativeToWindowPeak_dB,
      relativeToFirstFrame_dB: 10 * Math.log10(totalPower_linear / firstFramePower),
    };
  });
}
