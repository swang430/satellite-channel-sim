import { computeStatisticalCir } from '../channel/statisticalCir.js';
import { DomainValidationError } from '../domain/validation.js';
import { createDeterministicRng, seedForRealization } from './deterministicRng.js';

const SUPPORTED_ENVIRONMENTS = new Set(['rural', 'suburban', 'urban', 'maritime']);

function invalidStatisticalParameter(message) {
  throw new DomainValidationError('STATISTICAL_CIR_INPUT_INVALID', message);
}

export function normalizeStatisticalEnsembleParameters(parameters = {}) {
  const normalized = {
    realizationCount: parameters.realizationCount === undefined
      ? 32 : parameters.realizationCount,
    environment: parameters.environment === undefined
      ? 'suburban' : parameters.environment,
    tec_TECU: parameters.tec_TECU === undefined ? 50 : parameters.tec_TECU,
    scatterPowerOffset_dB: parameters.scatterPowerOffset_dB === undefined
      ? 0 : parameters.scatterPowerOffset_dB,
  };
  if (typeof normalized.realizationCount !== 'number'
    || !Number.isFinite(normalized.realizationCount)
    || !Number.isInteger(normalized.realizationCount)
    || normalized.realizationCount <= 0) {
    invalidStatisticalParameter('realizationCount must be a finite positive integer');
  }
  if (typeof normalized.environment !== 'string'
    || !SUPPORTED_ENVIRONMENTS.has(normalized.environment)) {
    invalidStatisticalParameter(
      'environment must be one of rural, suburban, urban, or maritime',
    );
  }
  if (typeof normalized.tec_TECU !== 'number'
    || !Number.isFinite(normalized.tec_TECU)
    || normalized.tec_TECU < 0) {
    invalidStatisticalParameter('tec_TECU must be a finite non-negative number');
  }
  if (typeof normalized.scatterPowerOffset_dB !== 'number'
    || !Number.isFinite(normalized.scatterPowerOffset_dB)) {
    invalidStatisticalParameter('scatterPowerOffset_dB must be a finite number');
  }
  return normalized;
}

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
  environment,
  tec_TECU,
  scatterPowerOffset_dB,
  realizationCount,
}) {
  const normalized = normalizeStatisticalEnsembleParameters({
    environment,
    tec_TECU,
    scatterPowerOffset_dB,
    realizationCount,
  });
  const realizations = [];
  const binIndices = new Set();
  for (let realizationId = 0;
    realizationId < normalized.realizationCount;
    realizationId += 1) {
    const seed = seedForRealization(scenarioId, frameId, realizationId);
    const rng = createDeterministicRng(seed);
    const cir = computeStatisticalCir({
      frequency_Hz: carrier.frequency_Hz,
      bandwidth_Hz: carrier.bandwidth_Hz,
      slantRange_m: geometry.slantRange_m,
      elevation_deg: geometry.elevation_deg,
      environment: normalized.environment,
      tec_TECU: normalized.tec_TECU,
      scatterPowerOffset_dB: normalized.scatterPowerOffset_dB,
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
    realizationCount: normalized.realizationCount,
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
