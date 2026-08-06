import { DomainValidationError } from '../domain/validation.js';

function pathPower(path) {
  if (Number.isFinite(path.power_linear) && path.power_linear >= 0) {
    return path.power_linear;
  }
  const real = path.complexAmplitude?.real;
  const imag = path.complexAmplitude?.imag;
  if (!Number.isFinite(real) || !Number.isFinite(imag)) {
    throw new DomainValidationError(
      'PDP_PATH_AMPLITUDE_INVALID',
      'Every PDP path requires a finite complex amplitude',
    );
  }
  return real * real + imag * imag;
}

function addWeightedAngle(accumulator, angle_deg, weight) {
  if (!Number.isFinite(angle_deg)) return;
  const radians = angle_deg * Math.PI / 180;
  accumulator.sin += Math.sin(radians) * weight;
  accumulator.cos += Math.cos(radians) * weight;
  accumulator.weight += weight;
}

function weightedAngle(accumulator) {
  return accumulator.weight > 0
    ? (Math.atan2(accumulator.sin, accumulator.cos) * 180 / Math.PI + 360) % 360
    : null;
}

export function buildPdp(paths, { bandwidth_Hz }) {
  if (!Number.isFinite(bandwidth_Hz) || bandwidth_Hz <= 0) {
    throw new DomainValidationError(
      'PDP_BANDWIDTH_INVALID',
      'PDP bandwidth must be a finite positive number',
    );
  }
  if (!Array.isArray(paths) || paths.length === 0) {
    throw new DomainValidationError('PDP_PATHS_EMPTY', 'PDP requires at least one path');
  }
  for (const path of paths) {
    if (!Number.isFinite(path.absoluteDelay_s)) {
      throw new DomainValidationError(
        'PDP_PATH_DELAY_INVALID',
        'Every PDP path requires a finite absoluteDelay_s',
      );
    }
  }

  const binWidth_s = 1 / bandwidth_Hz;
  const delayReference_s = Math.min(...paths.map((path) => path.absoluteDelay_s));
  const byBin = new Map();
  for (const path of paths) {
    const excessDelay_s = path.absoluteDelay_s - delayReference_s;
    const binIndex = Math.round(excessDelay_s / binWidth_s);
    const bin = byBin.get(binIndex) ?? {
      binIndex,
      excessDelay_s: binIndex * binWidth_s,
      pathCount: 0,
      complexAmplitude: { real: 0, imag: 0 },
      noncoherentPower_linear: 0,
      pathMetadata: {
        weight: 0,
        dopplerWeighted: 0,
        dopplerSquaredWeighted: 0,
        aoa: { sin: 0, cos: 0, weight: 0 },
        aod: { sin: 0, cos: 0, weight: 0 },
      },
    };
    const power = pathPower(path);
    bin.pathCount += 1;
    bin.complexAmplitude.real += path.complexAmplitude.real;
    bin.complexAmplitude.imag += path.complexAmplitude.imag;
    bin.noncoherentPower_linear += power;
    if (Number.isFinite(path.doppler_Hz)) {
      bin.pathMetadata.weight += power;
      bin.pathMetadata.dopplerWeighted += path.doppler_Hz * power;
      bin.pathMetadata.dopplerSquaredWeighted += path.doppler_Hz ** 2 * power;
    }
    addWeightedAngle(bin.pathMetadata.aoa, path.aoa_deg, power);
    addWeightedAngle(bin.pathMetadata.aod, path.aod_deg, power);
    byBin.set(binIndex, bin);
  }

  const bins = [...byBin.values()]
    .sort((left, right) => left.binIndex - right.binIndex)
    .map((bin) => {
      const { pathMetadata, ...publicBin } = bin;
      const dopplerCentroid_Hz = pathMetadata.weight > 0
        ? pathMetadata.dopplerWeighted / pathMetadata.weight : null;
      const dopplerVariance_Hz2 = pathMetadata.weight > 0
        ? pathMetadata.dopplerSquaredWeighted / pathMetadata.weight - dopplerCentroid_Hz ** 2
        : null;
      return {
        ...publicBin,
        coherentPower_linear:
          bin.complexAmplitude.real ** 2 + bin.complexAmplitude.imag ** 2,
        metadata: {
          pathCount: bin.pathCount,
          dopplerCentroid_Hz,
          dopplerRmsSpread_Hz: dopplerVariance_Hz2 === null
            ? null : Math.sqrt(Math.max(0, dopplerVariance_Hz2)),
          meanAoa_deg: weightedAngle(pathMetadata.aoa),
          meanAod_deg: weightedAngle(pathMetadata.aod),
        },
      };
    });
  const maxCoherentPower = Math.max(...bins.map((bin) => bin.coherentPower_linear));
  for (const bin of bins) {
    bin.coherentPower_dB = bin.coherentPower_linear > 0
      ? 10 * Math.log10(bin.coherentPower_linear)
      : -Infinity;
    bin.relativePower_dB = bin.coherentPower_linear > 0 && maxCoherentPower > 0
      ? 10 * Math.log10(bin.coherentPower_linear / maxCoherentPower)
      : -Infinity;
  }

  return {
    bandwidth_Hz,
    binWidth_s,
    delayReference_s,
    aggregation: 'coherent-complex-sum',
    bins,
  };
}
