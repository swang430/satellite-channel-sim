import { calculateChannelMetrics } from '../channel/channelMetrics.js';

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

export function summarizeRtPathStatistics(view) {
  const weights = [...view.hReal].map((real, index) => (
    real ** 2 + view.hImag[index] ** 2
  ));
  const total = weights.reduce((sum, value) => sum + value, 0) || 1;
  return {
    meanAoa_deg: circularMean_deg([...view.aoa_deg], weights),
    meanAod_deg: circularMean_deg([...view.aod_deg], weights),
    meanDoppler_Hz: [...view.doppler_Hz].reduce((sum, value, index) => (
      sum + value * weights[index]
    ), 0) / total,
    rawChannelTypes: [...new Set(view.channelType)].sort((left, right) => left - right),
  };
}

