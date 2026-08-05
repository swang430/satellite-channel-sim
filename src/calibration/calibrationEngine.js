import { calculateLinkBudget } from '../model.js';
import {
  CALIBRATION_PARAMETER_DEFS,
  CALIBRATION_SCHEMA_VERSION,
  createDefaultCalibration,
} from './schema.js';

const BOLTZMANN_DBW_PER_K_HZ = 10 * Math.log10(1.380649e-23);

function requiredFinite(value, name, { positive = false } = {}) {
  if (typeof value !== 'number' || !Number.isFinite(value) || (positive && value <= 0)) {
    throw new TypeError(`${name} must be a ${positive ? 'positive ' : ''}finite number`);
  }
  return value;
}

export function normalizeCalibrationLinkParams(input, reference = null) {
  const result = {
    frequency_GHz: input.frequency_GHz ?? input.freq,
    eirp_dBW: input.eirp_dBW ?? input.eirp,
    rxGain_dBi: input.rxGain_dBi ?? input.gRx,
    systemNoiseTemperature_K: input.systemNoiseTemperature_K ?? input.tRx,
    bandwidth_Hz: input.bandwidth_Hz ?? (input.bandwidth == null ? undefined : input.bandwidth * 1e6),
    tec_TECU: input.tec_TECU ?? input.tec,
    environment: input.environment ?? input.env ?? 'rural',
    rainRate_mmph: input.rainRate_mmph ?? input.rainRate,
    slantRange_km: input.slantRange_km ?? input.slantRange,
    scatterPowerBaseline_dB: input.scatterPowerBaseline_dB ?? -20,
  };
  const referenceFields = {};
  if (reference && typeof reference === 'object') {
    const mappings = [
      ['frequency_GHz', reference.frequency_GHz ?? reference.freq],
      ['eirp_dBW', reference.eirp_dBW ?? reference.eirp],
      ['bandwidth_Hz', reference.bandwidth_Hz ?? (reference.bandwidth == null ? undefined : reference.bandwidth * 1e6)],
      ['rxGain_dBi', reference.rxGain_dBi ?? reference.gRx],
      ['systemNoiseTemperature_K', reference.systemNoiseTemperature_K ?? reference.tRx],
    ];
    for (const [field, value] of mappings) {
      if (value != null) {
        result[field] = value;
        referenceFields[field] = 'reference-satellite';
      }
    }
  }
  return { params: result, referenceFields };
}

export function applyCalibration(rawParams, profile) {
  if (!profile?.calibrated) return rawParams;
  const params = profile.params;
  return {
    ...rawParams,
    correctionFactor: params.correctionFactor ?? 1,
    gasAttenOffset_dB: params.gasAttenOffset_dB ?? 0,
    scatterPowerOffset_dB: params.scatterPowerOffset_dB ?? 0,
    eirp_dBW: (rawParams.eirp_dBW ?? rawParams.eirp) + (params.eirpOffset_dB ?? 0),
    systemNoiseTemperature_K:
      (rawParams.systemNoiseTemperature_K ?? rawParams.tRx) + (params.systemNoiseOffset_K ?? 0),
  };
}

export function simulateCalibrationMeasurement(rawLinkParams, measurement, offsets = {}) {
  const { params } = normalizeCalibrationLinkParams(rawLinkParams);
  const frequency_GHz = requiredFinite(params.frequency_GHz, 'frequency_GHz', { positive: true });
  const eirp_dBW = requiredFinite(params.eirp_dBW, 'eirp_dBW');
  const rxGain_dBi = requiredFinite(params.rxGain_dBi, 'rxGain_dBi');
  const systemNoiseTemperature_K = requiredFinite(
    params.systemNoiseTemperature_K + (offsets.systemNoiseOffset_K ?? 0),
    'systemNoiseTemperature_K',
    { positive: true },
  );
  const bandwidth_Hz = requiredFinite(params.bandwidth_Hz, 'bandwidth_Hz', { positive: true });
  const slantRange_km = requiredFinite(
    measurement.slantRange_km ?? params.slantRange_km,
    'slantRange_km',
    { positive: true },
  );
  const elevation_deg = requiredFinite(measurement.elevation_deg, 'elevation_deg');
  const rainRate_mmph = measurement.rainRate_mmph ?? params.rainRate_mmph ?? 0;
  const budget = calculateLinkBudget({
    freq: frequency_GHz,
    elevation: elevation_deg,
    slantRange: slantRange_km,
    rainRate: rainRate_mmph,
    tec: params.tec_TECU ?? 0,
    env: params.environment,
    bandwidth: bandwidth_Hz / 1e6,
    correctionFactor: offsets.correctionFactor ?? 1,
    gasAttenOffset_dB: offsets.gasAttenOffset_dB ?? 0,
  });
  const totalPropagationLoss_dB = budget.actualFspl
    + budget.totalAtmosphericLoss
    + budget.fadeLMS
    + budget.lossFaraday
    + budget.pointingLoss
    + budget.scanLoss
    + budget.multipathLoss
    + budget.scintLoss;
  const predictedRssi_dBm = eirp_dBW + (offsets.eirpOffset_dB ?? 0) + 30
    + rxGain_dBi - totalPropagationLoss_dB;
  const skyNoiseTemperature_K = budget.tSky + 3;
  const totalNoiseTemperature_K = systemNoiseTemperature_K + skyNoiseTemperature_K;
  const noiseDensity_dBmHz = BOLTZMANN_DBW_PER_K_HZ
    + 10 * Math.log10(totalNoiseTemperature_K) + 30;
  const predictedCn0_dBHz = predictedRssi_dBm - noiseDensity_dBmHz;
  const predictedCn_dB = predictedCn0_dBHz - 10 * Math.log10(bandwidth_Hz);

  return {
    predictedCn0_dBHz,
    predictedCn_dB,
    predictedSnr_dB: predictedCn_dB,
    predictedRssi_dBm,
    predictedXpd_dB: budget.xpd,
    predictedAttenuation_dB: budget.totalAtmosphericLoss,
    predictedScatterPower_dB:
      params.scatterPowerBaseline_dB + (offsets.scatterPowerOffset_dB ?? 0),
    slantRange_km,
    bandwidth_Hz,
  };
}

const METRIC_MAP = [
  ['cn0_dBHz', 'predictedCn0_dBHz'],
  ['cn_dB', 'predictedCn_dB'],
  ['snr_dB', 'predictedSnr_dB'],
  ['rssi_dBm', 'predictedRssi_dBm'],
  ['xpd_dB', 'predictedXpd_dB'],
  ['attenuation_dB', 'predictedAttenuation_dB'],
  ['scatterPower_dB', 'predictedScatterPower_dB'],
];

function residuals(measurements, linkParams, offsets) {
  const values = [];
  for (const measurement of measurements) {
    const prediction = simulateCalibrationMeasurement(linkParams, measurement, offsets);
    for (const [measuredField, predictedField] of METRIC_MAP) {
      if (measurement[measuredField] != null) {
        values.push(prediction[predictedField] - measurement[measuredField]);
      }
    }
  }
  return values;
}

function identifiableParameters(measurements) {
  const count = (field) => measurements.filter((item) => item[field] != null).length;
  const linkMetricCount = count('cn0_dBHz') + count('cn_dB') + count('snr_dB') + count('rssi_dBm');
  const rainValues = new Set(measurements
    .filter((item) => item.attenuation_dB != null && item.rainRate_mmph > 0)
    .map((item) => item.rainRate_mmph));
  return new Set([
    ...(rainValues.size >= 2 ? ['correctionFactor'] : []),
    ...(count('attenuation_dB') >= 2 ? ['gasAttenOffset_dB'] : []),
    ...(count('scatterPower_dB') >= 2 ? ['scatterPowerOffset_dB'] : []),
    ...(count('rssi_dBm') >= 2 ? ['eirpOffset_dB'] : []),
    ...(linkMetricCount >= 2 && (count('cn0_dBHz') + count('cn_dB') + count('snr_dB')) >= 2
      ? ['systemNoiseOffset_K'] : []),
  ]);
}

function meanSquare(values) {
  return values.reduce((sum, value) => sum + value * value, 0) / Math.max(1, values.length);
}

function estimateOffsets(measurements, linkParams, active) {
  const params = Object.fromEntries(CALIBRATION_PARAMETER_DEFS.map(({ key, defaultValue }) => [key, defaultValue]));
  const steps = Object.fromEntries(CALIBRATION_PARAMETER_DEFS.map(({ key, step }) => [key, step * 8]));
  for (let iteration = 0; iteration < 80; iteration += 1) {
    let changed = false;
    for (const definition of CALIBRATION_PARAMETER_DEFS) {
      if (!active.has(definition.key)) continue;
      const current = params[definition.key];
      const candidates = [current, current - steps[definition.key], current + steps[definition.key]]
        .map((value) => Math.max(definition.min, Math.min(definition.max, value)));
      let best = current;
      let bestCost = meanSquare(residuals(measurements, linkParams, params));
      for (const candidate of candidates) {
        params[definition.key] = candidate;
        const cost = meanSquare(residuals(measurements, linkParams, params));
        if (cost + 1e-12 < bestCost) {
          best = candidate;
          bestCost = cost;
        }
      }
      params[definition.key] = best;
      if (best !== current) changed = true;
      else steps[definition.key] /= 2;
    }
    if (!changed && [...active].every((key) => steps[key] < 1e-5)) break;
  }
  return params;
}

export function calibrateModel({ measurements, linkParams, referenceSatellite = null }) {
  if (!Array.isArray(measurements) || measurements.length === 0) return createDefaultCalibration();
  const { params: effectiveParams, referenceFields } = normalizeCalibrationLinkParams(
    linkParams,
    referenceSatellite,
  );
  const active = identifiableParameters(measurements);
  const diagnostics = CALIBRATION_PARAMETER_DEFS
    .filter(({ key }) => !active.has(key))
    .map(({ key }) => ({
      code: 'UNIDENTIFIABLE_PARAMETER',
      severity: 'warning',
      parameter: key,
      message: `${key} is frozen because the supplied measurement types do not identify it.`,
    }));
  const params = active.size > 0
    ? estimateOffsets(measurements, effectiveParams, active)
    : createDefaultCalibration().params;
  const finalResiduals = residuals(measurements, effectiveParams, params);

  return {
    schemaVersion: CALIBRATION_SCHEMA_VERSION,
    calibrated: active.size > 0,
    createdAt: new Date().toISOString(),
    dataPointCount: measurements.length,
    residualRms: Math.sqrt(meanSquare(finalResiduals)),
    params,
    parameterStatus: Object.fromEntries(
      CALIBRATION_PARAMETER_DEFS.map(({ key }) => [key, active.has(key) ? 'estimated' : 'frozen']),
    ),
    confidence: active.size > 0
      ? { status: 'limited', reason: 'NO_INDEPENDENT_VALIDATION_SET' }
      : { status: 'unavailable', reason: 'NO_IDENTIFIABLE_PARAMETERS' },
    condition: {
      status: active.size > 0 ? 'limited-analysis' : 'rank-deficient',
      estimatedRank: active.size,
      parameterCount: CALIBRATION_PARAMETER_DEFS.length,
    },
    diagnostics,
    provenance: {
      measurementSchema: 'satellite-channel-sim/calibration-measurements-v1',
      referenceFields,
      bandwidth: referenceFields.bandwidth_Hz ? 'reference-satellite' : 'link-params',
      receiverGain: referenceFields.rxGain_dBi ? 'reference-satellite' : 'link-params',
      receiverNoise: referenceFields.systemNoiseTemperature_K ? 'reference-satellite' : 'link-params',
    },
  };
}
