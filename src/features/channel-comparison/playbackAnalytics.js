import { DomainValidationError } from '../../domain/validation.js';
import { receiverMotionAt } from '../mpdb-import/receiverTrack.js';

function invalid(message) {
  throw new DomainValidationError('PLAYBACK_ANALYTICS_INVALID', message);
}

function finiteOrNull(value, path) {
  if (value === undefined || value === null) return null;
  if (!Number.isFinite(value)) invalid(`${path} must be finite or null`);
  return value;
}

function motionFor(report, position) {
  if (position === 0) return { state: 'initial', displacement_m: 0 };
  const previous = report.frames[position - 1]?.receiver?.projectedPosition_m;
  const current = report.frames[position]?.receiver?.projectedPosition_m;
  if (!previous || !current) invalid(`frames[${position}] receiver track is incomplete`);
  return receiverMotionAt([
    { frameId: 0, projectedPosition_m: previous },
    { frameId: 1, projectedPosition_m: current },
  ], 1);
}

function rtAnalytics(frame) {
  if (!frame.rt) {
    return {
      availability: { status: 'not-imported', reason: 'RT_NOT_IMPORTED' },
      relativeGain: null,
      delay: null,
      doppler: null,
      pathCount: null,
    };
  }
  const pathStatistics = frame.rt.pathStatistics ?? null;
  const relativeGain = frame.rt.relativeGain ?? null;
  const metrics = frame.rt.metrics ?? null;
  return {
    availability: { status: 'available', reason: null },
    relativeGain,
    delay: metrics ? {
      rmsDelaySpread_s: finiteOrNull(metrics.rmsDelaySpread_s, 'rt.metrics.rmsDelaySpread_s'),
      meanExcessDelay_s: finiteOrNull(metrics.meanExcessDelay_s, 'rt.metrics.meanExcessDelay_s'),
      coherenceBandwidth_Hz: finiteOrNull(
        metrics.coherenceBandwidth_Hz,
        'rt.metrics.coherenceBandwidth_Hz',
      ),
    } : null,
    doppler: pathStatistics ? {
      status: pathStatistics.status,
      reason: pathStatistics.reason ?? null,
      centroid_Hz: finiteOrNull(pathStatistics.dopplerCentroid_Hz, 'rt.doppler.centroid_Hz'),
      rmsSpread_Hz: finiteOrNull(
        pathStatistics.dopplerRmsSpread_Hz,
        'rt.doppler.rmsSpread_Hz',
      ),
      dominantPath_Hz: finiteOrNull(
        pathStatistics.dominantPathDoppler_Hz,
        'rt.doppler.dominantPath_Hz',
      ),
      dominantPowerShare: finiteOrNull(
        pathStatistics.dominantPathPowerShare,
        'rt.doppler.dominantPowerShare',
      ),
      min_Hz: finiteOrNull(pathStatistics.dopplerMin_Hz, 'rt.doppler.min_Hz'),
      max_Hz: finiteOrNull(pathStatistics.dopplerMax_Hz, 'rt.doppler.max_Hz'),
      method: pathStatistics.dopplerMethod ?? null,
    } : null,
    pathCount: frame.rt.pdp?.bins?.reduce((count, bin) => count + (bin.pathCount ?? 0), 0)
      || null,
  };
}

function normalizeFrame(report, frame, position) {
  if (!frame || !Number.isInteger(frame.frameId)) invalid(`frames[${position}] is invalid`);
  const motion = motionFor(report, position);
  const rt = rtAnalytics(frame);
  const linkBudget = frame.statistical?.linkBudget ?? null;
  const alerts = [];
  if (rt.availability.status === 'available') {
    alerts.push({
      code: 'RT_ABSOLUTE_PATH_LOSS_UNAVAILABLE',
      severity: 'warning',
      reason: 'UNDEFINED_H_NORMALIZATION',
    });
  }
  return {
    position,
    frameId: frame.frameId,
    timestampUtc: frame.timestampUtc,
    geometry: {
      receiver: frame.receiver,
      elevation_deg: finiteOrNull(frame.geometry?.elevation_deg, 'geometry.elevation_deg'),
      azimuth_deg: finiteOrNull(frame.geometry?.azimuth_deg, 'geometry.azimuth_deg'),
      slantRange_m: finiteOrNull(frame.geometry?.slantRange_m, 'geometry.slantRange_m'),
      receiverMotion: motion.state,
      receiverDisplacement_m: motion.displacement_m,
    },
    statistical: {
      loss: linkBudget?.loss ?? null,
      link: linkBudget?.link ?? (frame.link ?? null),
      delay: linkBudget?.delay ?? {
        rmsDelaySpread_s: finiteOrNull(
          frame.statistical?.metricSummary?.rmsDelaySpread_s?.median,
          'statistical.rmsDelaySpread_s',
        ),
        coherenceBandwidth_Hz: finiteOrNull(
          frame.statistical?.metricSummary?.coherenceBandwidth_Hz?.median,
          'statistical.coherenceBandwidth_Hz',
        ),
      },
      doppler: frame.statistical?.doppler ?? null,
      sources: linkBudget?.sources ?? null,
    },
    rt,
    comparison: frame.metrics ?? null,
    alerts,
  };
}

export function buildPlaybackAnalytics(report) {
  if (!report || !Array.isArray(report.frames) || report.frames.length === 0) {
    invalid('report.frames must contain at least one frame');
  }
  return {
    scenarioId: report.scenarioId,
    timeWindow: report.timeWindow,
    frames: report.frames.map((frame, position) => normalizeFrame(report, frame, position)),
  };
}
