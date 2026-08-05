import { DomainValidationError } from '../domain/validation.js';
import { calculateChannelMetrics } from './channelMetrics.js';
import { buildPdp } from './pdp.js';

const SPEED_OF_LIGHT_mps = 299_792_458;
const EARTH_RADIUS_m = 6_371_000;

function positive(value, path) {
  if (!Number.isFinite(value) || value <= 0) {
    throw new DomainValidationError('STATISTICAL_CIR_INPUT_INVALID', `${path} must be positive`);
  }
  return value;
}

function resolveSlantRange_m({ slantRange_m, satelliteAltitude_m, elevation_deg }) {
  if (slantRange_m !== undefined && slantRange_m !== null) {
    return positive(slantRange_m, 'slantRange_m');
  }
  const altitude_m = positive(satelliteAltitude_m ?? 550_000, 'satelliteAltitude_m');
  const sinElevation = Math.sin(Math.max(0.1, elevation_deg) * Math.PI / 180);
  const projectedRadius_m = EARTH_RADIUS_m * sinElevation;
  return -projectedRadius_m + Math.sqrt(
    projectedRadius_m ** 2
      + 2 * EARTH_RADIUS_m * altitude_m
      + altitude_m ** 2,
  );
}

function makeTap({ kind, label, absoluteDelay_s, firstDelay_s, power_dB, phase_rad }) {
  const amplitude = 10 ** (power_dB / 20);
  return {
    kind,
    label,
    absoluteDelay_s,
    excessDelay_s: absoluteDelay_s - firstDelay_s,
    complexAmplitude: {
      real: amplitude * Math.cos(phase_rad),
      imag: amplitude * Math.sin(phase_rad),
    },
    power_linear: amplitude ** 2,
    power_dB,
    phase_rad,
  };
}

export function computeStatisticalCir({
  frequency_Hz,
  elevation_deg,
  slantRange_m,
  satelliteAltitude_m,
  environment = 'rural',
  tec_TECU = 50,
  bandwidth_Hz = 400e6,
  scatterPowerOffset_dB = 0,
  atmosphericLoss_dB = 0,
  simTime_s = 0,
}) {
  positive(frequency_Hz, 'frequency_Hz');
  positive(bandwidth_Hz, 'bandwidth_Hz');
  if (!Number.isFinite(elevation_deg)) {
    throw new DomainValidationError(
      'STATISTICAL_CIR_INPUT_INVALID',
      'elevation_deg must be finite',
    );
  }
  if (!Number.isFinite(tec_TECU) || tec_TECU < 0) {
    throw new DomainValidationError('STATISTICAL_CIR_INPUT_INVALID', 'tec_TECU must be non-negative');
  }

  const resolvedSlantRange_m = resolveSlantRange_m({
    slantRange_m,
    satelliteAltitude_m,
    elevation_deg,
  });
  const absoluteFspl_dB = 20 * Math.log10(
    (4 * Math.PI * resolvedSlantRange_m * frequency_Hz) / SPEED_OF_LIGHT_mps,
  );
  const firstDelay_s = resolvedSlantRange_m / SPEED_OF_LIGHT_mps;
  const losPower_dB = -(absoluteFspl_dB + atmosphericLoss_dB);
  const taps = [makeTap({
    kind: 'los',
    label: 'LOS (直射)',
    absoluteDelay_s: firstDelay_s,
    firstDelay_s,
    power_dB: losPower_dB,
    phase_rad: 0,
  })];
  const sinElevation = Math.sin(Math.max(0.1, elevation_deg) * Math.PI / 180);

  if (environment === 'maritime') {
    const excessDelay_s = (2 * 15 * sinElevation) / SPEED_OF_LIGHT_mps;
    taps.push(makeTap({
      kind: 'reflection',
      label: '海面反射',
      absoluteDelay_s: firstDelay_s + excessDelay_s,
      firstDelay_s,
      power_dB: losPower_dB + 20 * Math.log10(0.85),
      phase_rad: Math.PI,
    }));
  }

  if (environment === 'urban' || environment === 'suburban') {
    const scatter = environment === 'urban'
      ? [
        { delay_s: 100e-9, relativePower_dB: -15, label: '建筑散射-近' },
        { delay_s: 300e-9, relativePower_dB: -22, label: '建筑散射-远' },
      ]
      : [
        { delay_s: 80e-9, relativePower_dB: -18, label: '植被散射-近' },
        { delay_s: 200e-9, relativePower_dB: -25, label: '植被散射-远' },
      ];
    const elevationSuppression_dB = Math.max(0, elevation_deg) * 0.12;
    scatter.forEach((component, index) => {
      const phase_rad = simTime_s > 0
        ? Math.sin(simTime_s * (0.11 + index * 0.07)) * Math.PI
        : (index + 1) * 1.7;
      taps.push(makeTap({
        kind: 'scatter',
        label: component.label,
        absoluteDelay_s: firstDelay_s + component.delay_s,
        firstDelay_s,
        power_dB: losPower_dB
          + component.relativePower_dB
          - elevationSuppression_dB
          + scatterPowerOffset_dB,
        phase_rad,
      }));
    });
  }

  const frequency_GHz = frequency_Hz / 1e9;
  const bandwidth_GHz = bandwidth_Hz / 1e9;
  const dispersion_s = (
    (2 * 1.3433 * tec_TECU * bandwidth_GHz)
    / (frequency_GHz ** 3 * Math.max(0.001, sinElevation))
  ) * 1e-9;
  if (tec_TECU > 0 && dispersion_s > 0.01e-9) {
    taps.push(makeTap({
      kind: 'ionosphere',
      label: '电离层色散',
      absoluteDelay_s: firstDelay_s + dispersion_s,
      firstDelay_s,
      power_dB: losPower_dB - 30 - 10 * Math.log10(frequency_GHz),
      phase_rad: simTime_s > 0 ? Math.sin(simTime_s * 0.3) * Math.PI * 0.5 : 0.5,
    }));
  }

  const pdp = buildPdp(taps, { bandwidth_Hz });
  const metrics = calculateChannelMetrics(pdp);
  return {
    slantRange_m: resolvedSlantRange_m,
    absoluteFspl_dB,
    atmosphericLoss_dB,
    taps,
    pdp,
    metrics,
  };
}

