import { calculateLinkBudget, calculateMIMOCapacity } from '../model.js';
import { DomainValidationError } from '../domain/validation.js';

const SPEED_OF_LIGHT_MPS = 299_792_458;
const BOLTZMANN_J_PER_K = 1.380649e-23;

const COMPONENT_FIELDS = Object.freeze({
  rain: 'attRain',
  gas: 'attGas',
  cloud: 'attCloud',
  shadow: 'fadeLMS',
  faraday: 'lossFaraday',
  pointing: 'pointingLoss',
  scan: 'scanLoss',
  multipath: 'multipathLoss',
  scintillation: 'scintLoss',
});

function invalid(message) {
  throw new DomainValidationError('STATISTICAL_FRAME_ANALYTICS_INPUT_INVALID', message);
}

function requiredFinite(value, path) {
  if (!Number.isFinite(value)) invalid(`${path} must be finite`);
  return value;
}

function nullableFinite(value) {
  return Number.isFinite(value) ? value : null;
}

function sumLoss(fspl_dB, components_dB) {
  return fspl_dB + Object.values(components_dB)
    .reduce((total, component) => total + component, 0);
}

function buildLoss(fspl_dB, components_dB, source) {
  return {
    method: 'statistical-link-budget/v1',
    fspl_dB,
    components_dB,
    totalPropagationLoss_dB: sumLoss(fspl_dB, components_dB),
    fieldSources: {
      fspl_dB: source,
      components_dB: source,
      totalPropagationLoss_dB: 'fspl-plus-propagation-components',
    },
  };
}

export function buildStatisticalFrameAnalytics({
  carrier,
  geometry,
  linkParameters = {},
  statisticalResult = {},
}) {
  const frequency_Hz = requiredFinite(carrier?.frequency_Hz, 'carrier.frequency_Hz');
  const bandwidth_Hz = requiredFinite(carrier?.bandwidth_Hz, 'carrier.bandwidth_Hz');
  const elevation_deg = requiredFinite(geometry?.elevation_deg, 'geometry.elevation_deg');
  const slantRange_m = requiredFinite(geometry?.slantRange_m, 'geometry.slantRange_m');
  if (frequency_Hz <= 0 || bandwidth_Hz <= 0 || slantRange_m <= 0) {
    invalid('carrier frequency, bandwidth, and slant range must be positive');
  }

  const normalizedParameters = {
    ...linkParameters,
    freq: frequency_Hz / 1e9,
    bandwidth: bandwidth_Hz / 1e6,
    elevation: elevation_deg,
    slantRange: slantRange_m / 1e3,
  };
  const budget = calculateLinkBudget(normalizedParameters);
  const fspl_dB = 20 * Math.log10(slantRange_m / 1e3)
    + 20 * Math.log10(frequency_Hz / 1e9) + 92.45;
  const components_dB = Object.fromEntries(Object.entries(COMPONENT_FIELDS)
    .map(([name, field]) => [name, requiredFinite(budget[field] ?? 0, `budget.${field}`)]));
  components_dB.gas += requiredFinite(
    normalizedParameters.gasAttenOffset_dB ?? 0,
    'linkParameters.gasAttenOffset_dB',
  );
  const loss = buildLoss(fspl_dB, components_dB, 'calculated-link-budget');

  const eirp_dBW = requiredFinite(linkParameters.eirp ?? 60, 'linkParameters.eirp');
  const receiverGain_dBi = requiredFinite(linkParameters.gRx ?? 42, 'linkParameters.gRx');
  const receiverNoiseTemperature_K = requiredFinite(
    linkParameters.tRx ?? 150,
    'linkParameters.tRx',
  );
  const rxPower_dBm = eirp_dBW + 30 + receiverGain_dBi - loss.totalPropagationLoss_dB;
  const systemNoiseTemperature_K = receiverNoiseTemperature_K
    + requiredFinite(budget.tSky, 'budget.tSky') + 3;
  const noisePower_dBm = 10 * Math.log10(
    BOLTZMANN_J_PER_K * systemNoiseTemperature_K * bandwidth_Hz,
  ) + 30;
  const snr_dB = Math.max(-30, rxPower_dBm - noisePower_dBm);
  const capacity = calculateMIMOCapacity(snr_dB, budget.xpd);
  const metricSummary = statisticalResult?.metricSummary ?? {};
  const firstArrival_s = slantRange_m / SPEED_OF_LIGHT_MPS;

  const result = {
    loss,
    link: {
      method: 'statistical-link-budget/v1',
      frequency_Hz,
      bandwidth_Hz,
      eirp_dBW,
      receiverGain_dBi,
      receiverNoiseTemperature_K,
      systemNoiseTemperature_K,
      rxPower_dBm,
      noisePower_dBm,
      snr_dB,
      xpd_dB: budget.xpd,
      capacity_bpsHz: { rank1: capacity.capRank1, rank2: capacity.capRank2 },
      fieldSources: {
        rxPower_dBm: 'calculated-link-budget',
        noisePower_dBm: 'thermal-noise-model',
        snr_dB: 'rx-minus-noise',
        capacity_bpsHz: 'mimo-capacity-model',
      },
    },
    delay: {
      method: 'statistical-cir/v1',
      firstArrival_s,
      ionosphericGroupDelay_s: budget.groupDelayNs * 1e-9,
      ionosphericDispersion_s: budget.dispersionNs * 1e-9,
      rmsDelaySpread_s: nullableFinite(metricSummary.rmsDelaySpread_s?.median),
      coherenceBandwidth_Hz: nullableFinite(metricSummary.coherenceBandwidth_Hz?.median),
      fieldSources: {
        firstArrival_s: 'frame-slant-range',
        ionosphericGroupDelay_s: 'statistical-link-budget',
        ionosphericDispersion_s: 'statistical-link-budget',
        rmsDelaySpread_s: 'statistical-ensemble-median',
        coherenceBandwidth_Hz: 'statistical-ensemble-median',
      },
    },
    sources: {
      carrierFrequency: 'scenario-carrier',
      bandwidth: 'scenario-carrier',
      geometry: 'frame-geometry',
      values: 'calculated-statistical-model',
    },
  };
  if (!Object.values(result.link).filter((value) => typeof value === 'number')
    .every(Number.isFinite)) invalid('calculated link values must be finite');
  return result;
}

export function adaptSelectedPassFrameAnalytics(frame) {
  const components_dB = Object.fromEntries(Object.entries(COMPONENT_FIELDS)
    .map(([name, field]) => [name, requiredFinite(frame?.[field], `frame.${field}`)]));
  if (Number.isFinite(frame?.totalAtmosphericLoss)) {
    components_dB.gas = frame.totalAtmosphericLoss - components_dB.rain - components_dB.cloud;
  }
  const fspl_dB = requiredFinite(frame?.absoluteFspl, 'frame.absoluteFspl');
  return {
    loss: buildLoss(fspl_dB, components_dB, 'selected-pass-timeline'),
    link: {
      method: 'selected-pass-timeline/v1',
      rxPower_dBm: requiredFinite(frame?.rxPowerDbm, 'frame.rxPowerDbm'),
      noisePower_dBm: requiredFinite(frame?.noiseFloorDbm, 'frame.noiseFloorDbm'),
      snr_dB: requiredFinite(frame?.snrDb, 'frame.snrDb'),
      xpd_dB: requiredFinite(frame?.xpd, 'frame.xpd'),
      capacity_bpsHz: {
        rank1: requiredFinite(frame?.capRank1, 'frame.capRank1'),
        rank2: requiredFinite(frame?.capRank2, 'frame.capRank2'),
      },
      fieldSources: {
        rxPower_dBm: 'selected-pass-timeline',
        noisePower_dBm: 'selected-pass-timeline',
        snr_dB: 'selected-pass-timeline',
        capacity_bpsHz: 'selected-pass-timeline',
      },
    },
    delay: {
      method: 'selected-pass-timeline/v1',
      firstArrival_s: requiredFinite(frame?.slantRange, 'frame.slantRange')
        * 1_000 / SPEED_OF_LIGHT_MPS,
      ionosphericGroupDelay_s: requiredFinite(frame?.groupDelayNs, 'frame.groupDelayNs') * 1e-9,
      ionosphericDispersion_s: requiredFinite(frame?.dispersionNs, 'frame.dispersionNs') * 1e-9,
      rmsDelaySpread_s: nullableFinite(frame?.cir?.rmsDelaySpread_ns) === null
        ? null : frame.cir.rmsDelaySpread_ns * 1e-9,
      coherenceBandwidth_Hz: nullableFinite(frame?.cir?.coherenceBandwidth_MHz) === null
        ? null : frame.cir.coherenceBandwidth_MHz * 1e6,
      fieldSources: {
        firstArrival_s: 'selected-pass-timeline-geometry',
        ionosphericGroupDelay_s: 'selected-pass-timeline',
        ionosphericDispersion_s: 'selected-pass-timeline',
        rmsDelaySpread_s: 'selected-pass-timeline-cir',
        coherenceBandwidth_Hz: 'selected-pass-timeline-cir',
      },
    },
    sources: {
      carrierFrequency: 'selected-pass-scenario',
      bandwidth: 'selected-pass-scenario',
      geometry: 'selected-pass-timeline',
      values: 'selected-pass-timeline',
    },
  };
}
