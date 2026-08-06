import { DomainValidationError } from '../../domain/validation.js';
import { receiverMotionAt } from '../mpdb-import/receiverTrack.js';

const PLOT_FLOOR_DB = -120;
const UNDEFINED_H_NORMALIZATION = 'UNDEFINED_H_NORMALIZATION';
const CHART_DATASET_STYLES = Object.freeze({
  'statistical-median': Object.freeze({
    label: '统计中位数',
    borderColor: '#53dfc3',
    pointRadius: 1,
    borderWidth: 2,
  }),
  'statistical-p5': Object.freeze({
    label: '统计 P5',
    borderColor: 'rgba(83, 223, 195, 0.35)',
    pointRadius: 0,
    borderWidth: 1,
    borderDash: Object.freeze([4, 4]),
  }),
  'statistical-p95': Object.freeze({
    label: '统计 P95',
    borderColor: 'rgba(83, 223, 195, 0.35)',
    pointRadius: 0,
    borderWidth: 1,
    borderDash: Object.freeze([4, 4]),
  }),
  rt: Object.freeze({
    label: 'RT PDP',
    borderColor: '#ff665f',
    pointRadius: 2,
    borderWidth: 2,
  }),
});

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
  return receiverMotionAt([
    { frameId: 0, projectedPosition_m: previous },
    { frameId: 1, projectedPosition_m: current },
  ], 1);
}

function normalizationStatus(report, frame) {
  const diagnostics = report?.diagnostics;
  if (diagnostics !== undefined && !Array.isArray(diagnostics)) {
    invalidComparisonData('Comparison report diagnostics must be an array');
  }
  diagnostics?.forEach((diagnostic, index) => {
    if (!diagnostic || typeof diagnostic !== 'object' || Array.isArray(diagnostic)) {
      invalidComparisonData(`diagnostics[${index}] must be an object`);
    }
    if (diagnostic.reason !== undefined && typeof diagnostic.reason !== 'string') {
      invalidComparisonData(`diagnostics[${index}].reason must be a string`);
    }
  });

  const frameReason = frame?.rt?.absolutePower?.reason;
  if (frameReason !== undefined && typeof frameReason !== 'string') {
    invalidComparisonData('rt.absolutePower.reason must be a string');
  }
  const diagnosticReason = diagnostics?.find((diagnostic) => (
    diagnostic.reason === UNDEFINED_H_NORMALIZATION
  ))?.reason;
  const status = frameReason ?? diagnosticReason ?? UNDEFINED_H_NORMALIZATION;
  if (status !== UNDEFINED_H_NORMALIZATION) {
    invalidComparisonData(`Unsupported RT normalization status: ${status}`);
  }
  return status;
}

export function buildComparisonPlotData(frame) {
  const plot = statisticalSeries(frame);
  if (frame?.rt !== undefined) plot.rt = rtSeries(frame);
  return plot;
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
  if (showRtOverlay && plot.rt) {
    datasets.push({ source: 'rt', frameId: frame.frameId, data: plot.rt });
  }
  return { frameId: frame.frameId, datasets };
}

export function buildComparisonChartData(frameView) {
  if (!Array.isArray(frameView?.datasets)) {
    invalidComparisonData('Comparison frame view must contain datasets');
  }
  return {
    datasets: frameView.datasets.map((dataset) => {
      const style = CHART_DATASET_STYLES[dataset?.source];
      if (!style) {
        invalidComparisonData(`Unsupported comparison dataset source: ${dataset?.source}`);
      }
      return {
        ...dataset,
        ...style,
        borderDash: style.borderDash ? [...style.borderDash] : undefined,
        showLine: true,
        parsing: false,
        tension: 0,
        fill: false,
      };
    }),
  };
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
  const rtAvailable = frame.rt !== undefined;
  const rmsDelaySpread = frame.statistical?.metricSummary?.rmsDelaySpread_s?.median;
  const coherenceBandwidth = frame.statistical?.metricSummary?.coherenceBandwidth_Hz?.median;

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
    statisticalRmsDelaySpread_s: rmsDelaySpread === undefined || rmsDelaySpread === null
      ? null
      : requireFinite(rmsDelaySpread, 'statistical.metricSummary.rmsDelaySpread_s.median'),
    statisticalCoherenceBandwidth_Hz:
      coherenceBandwidth === undefined || coherenceBandwidth === null
        ? null
        : requireFinite(
          coherenceBandwidth,
          'statistical.metricSummary.coherenceBandwidth_Hz.median',
        ),
    rxPower_dBm: frame.link?.rxPower_dBm === undefined
      ? null
      : requireFinite(frame.link.rxPower_dBm, 'link.rxPower_dBm'),
    snr_dB: frame.link?.snr_dB === undefined
      ? null
      : requireFinite(frame.link.snr_dB, 'link.snr_dB'),
    rtAvailable,
    jsDivergence_bits: rtAvailable
      ? requireFinite(frame.metrics?.jsDivergence_bits, 'metrics.jsDivergence_bits')
      : null,
    rmsDelaySpreadDifference_s: rtAvailable
      ? requireFinite(
        frame.metrics?.rmsDelaySpreadDifference_s,
        'metrics.rmsDelaySpreadDifference_s',
      )
      : null,
    weightedDelayDistance_s: rtAvailable
      ? requireFinite(frame.metrics?.weightedDelayDistance_s, 'metrics.weightedDelayDistance_s')
      : null,
    rtNormalizationStatus: rtAvailable ? normalizationStatus(report, frame) : null,
  };
}

export function buildComparisonPlaybackFrames(report, { showRtOverlay = true } = {}) {
  validateReportPosition(report, 0);
  if (typeof showRtOverlay !== 'boolean') {
    invalidComparisonData('showRtOverlay must be boolean');
  }
  const playbackFrames = [];
  for (let position = 0; position < report.frames.length; position += 1) {
    if (!(position in report.frames)) {
      invalidComparisonData(`frames[${position}] must be an object`);
    }
    const frame = report.frames[position];
    if (frame === null || typeof frame !== 'object' || Array.isArray(frame)) {
      invalidComparisonData(`frames[${position}] must be an object`);
    }
    const frameView = buildComparisonFrameView(frame, { showRtOverlay });
    playbackFrames.push({
      position,
      frameId: frame.frameId,
      frame,
      frameView,
      chartData: buildComparisonChartData(frameView),
      summary: buildComparisonPlaybackSummary(report, position),
    });
  }
  return playbackFrames;
}
