import { runStatisticalEnsemble } from '../../comparison/statisticalEnsemble.js';
import { DomainValidationError } from '../../domain/validation.js';

export const STATISTICAL_PLAYBACK_MODEL_VERSION = 'statistical-playback/v1';

function invalid(message) {
  throw new DomainValidationError('STATISTICAL_PLAYBACK_INPUT_INVALID', message);
}

function timestampUtc(frame, index) {
  const value = frame?.time instanceof Date ? frame.time : new Date(frame?.time);
  if (Number.isNaN(value.getTime())) invalid(`timeline[${index}].time must be valid`);
  return value.toISOString();
}

function finite(value, path) {
  if (!Number.isFinite(value)) invalid(`${path} must be finite`);
  return value;
}

export function buildStatisticalPlaybackReport({
  timeline,
  windowId,
  satelliteName = '',
  receiver,
  carrier,
  statisticalParameters = {},
  realizationCount = 32,
}) {
  if (!Array.isArray(timeline) || timeline.length === 0) {
    invalid('timeline must contain at least one frame');
  }
  if (typeof windowId !== 'string' || windowId.length === 0) {
    invalid('windowId must be a non-empty string');
  }
  const receiverPosition_m = { x: 0, y: 0, z: 0 };
  const timestamps = timeline.map(timestampUtc);
  const sampleInterval_s = timeline.length > 1
    ? (Date.parse(timestamps[1]) - Date.parse(timestamps[0])) / 1_000
    : 1;
  if (!(sampleInterval_s > 0)) invalid('timeline timestamps must increase');

  const frames = timeline.map((frame, index) => {
    const frameId = Number.isInteger(frame.frameIndex) && frame.frameIndex >= 0
      ? frame.frameIndex
      : index;
    const timestamp = timestamps[index];
    const geometry = {
      frameId,
      timestampUtc: timestamp,
      receiverPosition_m: { ...receiverPosition_m },
      elevation_deg: finite(frame.elevation, `timeline[${index}].elevation`),
      slantRange_m: finite(frame.slantRange, `timeline[${index}].slantRange`) * 1_000,
    };
    return {
      frameId,
      timestampUtc: timestamp,
      receiver: {
        frameId,
        timestampUtc: timestamp,
        latitude_deg: finite(receiver?.latitude_deg, 'receiver.latitude_deg'),
        longitude_deg: finite(receiver?.longitude_deg, 'receiver.longitude_deg'),
        altitude_m: finite(receiver?.altitude_m, 'receiver.altitude_m'),
        projectedPosition_m: { ...receiverPosition_m },
        source: 'configured-ground-station',
      },
      geometry,
      link: {
        rxPower_dBm: finite(frame.rxPowerDbm, `timeline[${index}].rxPowerDbm`),
        snr_dB: finite(frame.snrDb, `timeline[${index}].snrDb`),
      },
      statistical: runStatisticalEnsemble({
        scenarioId: windowId,
        frameId,
        geometry,
        carrier,
        ...statisticalParameters,
        realizationCount,
      }),
    };
  });

  return {
    scenarioId: windowId,
    modelVersion: STATISTICAL_PLAYBACK_MODEL_VERSION,
    realizationCount,
    satelliteName,
    receiverGeometry: {
      mode: 'fixed-ground-station',
      source: 'configured-ground-station',
      frameCount: frames.length,
    },
    timeWindow: {
      source: 'selected-pass',
      startTimeUtc: timestamps[0],
      endTimeUtc: timestamps.at(-1),
      sampleInterval_s,
      frameCount: frames.length,
    },
    statisticalParameters: { ...statisticalParameters },
    frameCounts: { total: frames.length, statistical: frames.length },
    frames,
    diagnostics: [],
  };
}
