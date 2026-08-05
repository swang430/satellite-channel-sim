import { DomainValidationError } from '../../domain/validation.js';

const PLOT_FLOOR_DB = -120;
const DEFAULT_STATIONARY_THRESHOLD_M = 0.1;
const UNDEFINED_H_NORMALIZATION = 'UNDEFINED_H_NORMALIZATION';

function invalidComparisonData(message) {
  throw new DomainValidationError('COMPARISON_PLOT_DATA_INVALID', message);
}

function requireFinite(value, path) {
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    invalidComparisonData(`${path} must be finite`);
  }
  return value;
}

function requireFinitePoint(point, path) {
  requireFinite(point.x, `${path}.x`);
  requireFinite(point.y, `${path}.y`);
  return point;
}

function relativeDb(value, reference) {
  return value > 0 && reference > 0
    ? 10 * Math.log10(value / reference)
    : PLOT_FLOOR_DB;
}

function statisticalSeries(frame) {
  const delays = frame?.statistical?.excessDelay_s;
  const summary = frame?.statistical?.summary;
  const seriesEntries = [
    ['statisticalMedian', summary?.median],
    ['statisticalP5', summary?.p5],
    ['statisticalP95', summary?.p95],
  ];
  if (!Array.isArray(delays) || delays.length === 0) {
    invalidComparisonData('Statistical PDP must contain at least one delay bin');
  }
  for (const [seriesName, values] of seriesEntries) {
    if (!Array.isArray(values) || values.length !== delays.length) {
      invalidComparisonData(`${seriesName} must match the statistical delay bins`);
    }
    values.forEach((value, index) => {
      requireFinite(value, `${seriesName}[${index}]`);
      if (value < 0) invalidComparisonData(`${seriesName}[${index}] must be non-negative`);
    });
  }
  delays.forEach((delay, index) => requireFinite(delay, `statistical.excessDelay_s[${index}]`));

  const reference = Math.max(...summary.median);
  if (!(reference > 0) || !Number.isFinite(reference)) {
    invalidComparisonData('Statistical PDP cannot be peak-normalized');
  }

  const buildSeries = (values, name) => values.map((value, index) => requireFinitePoint({
    x: delays[index] * 1e9,
    y: relativeDb(value, reference),
  }, `${name}[${index}]`));
  return Object.fromEntries(seriesEntries.map(([name, values]) => [
    name,
    buildSeries(values, name),
  ]));
}

function rtSeries(frame) {
  const bins = frame?.rt?.pdp?.bins;
  if (!Array.isArray(bins) || bins.length === 0) {
    invalidComparisonData('RT PDP must contain at least one delay bin');
  }
  if (!bins.some((bin) => Number.isFinite(bin?.relativePower_dB))) {
    invalidComparisonData('RT PDP cannot be peak-normalized');
  }
  return bins.map((bin, index) => {
    requireFinite(bin?.excessDelay_s, `rt.pdp.bins[${index}].excessDelay_s`);
    const power = bin?.relativePower_dB;
    if (typeof power !== 'number' || Number.isNaN(power) || power === Number.POSITIVE_INFINITY) {
      invalidComparisonData(`rt.pdp.bins[${index}].relativePower_dB is invalid`);
    }
    return requireFinitePoint({
      x: bin.excessDelay_s * 1e9,
      y: power === Number.NEGATIVE_INFINITY ? PLOT_FLOOR_DB : power,
    }, `rt[${index}]`);
  });
}

function validateReportPosition(report, position) {
  if (!Array.isArray(report?.frames) || report.frames.length === 0) {
    invalidComparisonData('Comparison report must contain at least one frame');
  }
  if (!Number.isInteger(position) || position < 0 || position >= report.frames.length) {
    invalidComparisonData('Comparison position must identify a report frame');
  }
}

function projectedPosition(frame, path) {
  const position = frame?.receiver?.projectedPosition_m;
  if (!position || typeof position !== 'object') {
    invalidComparisonData(`${path} must contain a projected receiver position`);
  }
  return {
    x: requireFinite(position.x, `${path}.x`),
    y: requireFinite(position.y, `${path}.y`),
    z: requireFinite(position.z, `${path}.z`),
  };
}

function receiverMotion(report, position) {
  if (position === 0) return { state: 'initial', displacement_m: 0 };
  const previous = projectedPosition(report.frames[position - 1], 'previous receiver position');
  const current = projectedPosition(report.frames[position], 'receiver position');
  const displacement_m = Math.hypot(
    current.x - previous.x,
    current.y - previous.y,
    current.z - previous.z,
  );
  requireFinite(displacement_m, 'receiver displacement');
  return {
    state: displacement_m <= DEFAULT_STATIONARY_THRESHOLD_M ? 'stationary' : 'moving',
    displacement_m,
  };
}

export function buildComparisonPlotData(frame) {
  return {
    rt: rtSeries(frame),
    ...statisticalSeries(frame),
  };
}

export function buildComparisonFrameView(frame, { showRtOverlay = true } = {}) {
  if (!Number.isInteger(frame?.frameId) || frame.frameId < 0) {
    invalidComparisonData('Comparison frameId must be a non-negative integer');
  }
  if (typeof showRtOverlay !== 'boolean') {
    invalidComparisonData('showRtOverlay must be boolean');
  }
  const plot = buildComparisonPlotData(frame);
  const datasets = [
    {
      source: 'statistical-median',
      frameId: frame.frameId,
      data: plot.statisticalMedian,
    },
    {
      source: 'statistical-p5',
      frameId: frame.frameId,
      data: plot.statisticalP5,
    },
    {
      source: 'statistical-p95',
      frameId: frame.frameId,
      data: plot.statisticalP95,
    },
  ];
  if (showRtOverlay) {
    datasets.push({ source: 'rt', frameId: frame.frameId, data: plot.rt });
  }
  return { frameId: frame.frameId, datasets };
}

export function nextComparisonPosition(report, position) {
  validateReportPosition(report, position);
  return (position + 1) % report.frames.length;
}

export function buildComparisonPlaybackSummary(report, position) {
  validateReportPosition(report, position);
  const frame = report.frames[position];
  if (!Number.isInteger(frame?.frameId) || frame.frameId < 0) {
    invalidComparisonData('Comparison frameId must be a non-negative integer');
  }
  if (typeof frame.timestampUtc !== 'string' || Number.isNaN(Date.parse(frame.timestampUtc))) {
    invalidComparisonData('Comparison frame timestampUtc must be an ISO-8601 timestamp');
  }
  const receiver = frame.receiver;
  projectedPosition(frame, 'receiver position');
  const motion = receiverMotion(report, position);
  const normalizationStatus = frame.rt?.absolutePower?.reason
    ?? report.diagnostics?.find((diagnostic) => (
      diagnostic?.reason === UNDEFINED_H_NORMALIZATION
    ))?.reason
    ?? UNDEFINED_H_NORMALIZATION;

  return {
    frameId: frame.frameId,
    timestampUtc: frame.timestampUtc,
    receiverMotion: motion.state,
    receiverDisplacement_m: requireFinite(motion.displacement_m, 'receiverDisplacement_m'),
    receiverLongitude_deg: requireFinite(receiver?.longitude_deg, 'receiver.longitude_deg'),
    receiverLatitude_deg: requireFinite(receiver?.latitude_deg, 'receiver.latitude_deg'),
    receiverAltitude_m: requireFinite(receiver?.altitude_m, 'receiver.altitude_m'),
    elevation_deg: requireFinite(frame.geometry?.elevation_deg, 'geometry.elevation_deg'),
    slantRange_m: requireFinite(frame.geometry?.slantRange_m, 'geometry.slantRange_m'),
    jsDivergence_bits: requireFinite(
      frame.metrics?.jsDivergence_bits,
      'metrics.jsDivergence_bits',
    ),
    rmsDelaySpreadDifference_s: requireFinite(
      frame.metrics?.rmsDelaySpreadDifference_s,
      'metrics.rmsDelaySpreadDifference_s',
    ),
    weightedDelayDistance_s: requireFinite(
      frame.metrics?.weightedDelayDistance_s,
      'metrics.weightedDelayDistance_s',
    ),
    rtNormalizationStatus: normalizationStatus,
  };
}
