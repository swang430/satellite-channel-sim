import { computeStatisticalCir } from '../channel/statisticalCir.js';
import { DomainValidationError } from '../domain/validation.js';
import { createDeterministicRng, seedForRealization } from './deterministicRng.js';

function quantile(sorted, probability) {
  if (sorted.length === 1) return sorted[0];
  const position = (sorted.length - 1) * probability;
  const lower = Math.floor(position);
  const upper = Math.ceil(position);
  const fraction = position - lower;
  return sorted[lower] * (1 - fraction) + sorted[upper] * fraction;
}

export function runStatisticalEnsemble({
  scenarioId,
  frameId,
  geometry,
  carrier,
  environment = 'suburban',
  tec_TECU = 50,
  scatterPowerOffset_dB = 0,
  realizationCount = 32,
}) {
  if (!Number.isFinite(scatterPowerOffset_dB)) {
    throw new DomainValidationError(
      'STATISTICAL_CIR_INPUT_INVALID',
      'scatterPowerOffset_dB must be finite',
    );
  }
  const realizations = [];
  const binIndices = new Set();
  for (let realizationId = 0; realizationId < realizationCount; realizationId += 1) {
    const seed = seedForRealization(scenarioId, frameId, realizationId);
    const rng = createDeterministicRng(seed);
    const cir = computeStatisticalCir({
      frequency_Hz: carrier.frequency_Hz,
      bandwidth_Hz: carrier.bandwidth_Hz,
      slantRange_m: geometry.slantRange_m,
      elevation_deg: geometry.elevation_deg,
      environment,
      tec_TECU,
      scatterPowerOffset_dB,
      simTime_s: rng() * 10_000,
    });
    const powers = new Map();
    for (const bin of cir.pdp.bins) {
      binIndices.add(bin.binIndex);
      powers.set(bin.binIndex, bin.relativePower_dB === -Infinity
        ? 0 : 10 ** (bin.relativePower_dB / 10));
    }
    realizations.push({ realizationId, seed, powers, metrics: cir.metrics });
  }
  const orderedBinIndices = [...binIndices].sort((left, right) => left - right);
  const valuesByBin = orderedBinIndices.map((binIndex) => realizations
    .map((realization) => realization.powers.get(binIndex) ?? 0)
    .sort((left, right) => left - right));
  return {
    realizationCount,
    seedScheme: 'fnv1a32(scenarioId,frameId,realizationId)+mulberry32',
    binWidth_s: 1 / carrier.bandwidth_Hz,
    binIndices: orderedBinIndices,
    excessDelay_s: orderedBinIndices.map((index) => index / carrier.bandwidth_Hz),
    summary: {
      median: valuesByBin.map((values) => quantile(values, 0.5)),
      p5: valuesByBin.map((values) => quantile(values, 0.05)),
      p95: valuesByBin.map((values) => quantile(values, 0.95)),
    },
    realizations,
  };
}
