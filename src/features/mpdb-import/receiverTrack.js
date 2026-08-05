import { DomainValidationError } from '../../domain/validation.js';

const DEFAULT_STATIONARY_THRESHOLD_M = 0.1;

function invalidReceiverTrack(message) {
  throw new DomainValidationError('RECEIVER_TRACK_INVALID', message);
}

function validateThreshold(stationaryThreshold_m) {
  if (!Number.isFinite(stationaryThreshold_m) || stationaryThreshold_m < 0) {
    invalidReceiverTrack('Receiver stationary threshold must be a finite non-negative number');
  }
}

function validateTrack(track) {
  if (!Array.isArray(track) || track.length === 0) {
    invalidReceiverTrack('Receiver track must be a non-empty array');
  }

  for (let frameIndex = 0; frameIndex < track.length; frameIndex += 1) {
    const point = track[frameIndex];
    if (!point || point.frameId !== frameIndex) {
      invalidReceiverTrack(`Receiver track frame ${frameIndex} must match its array position`);
    }
    const position = point.projectedPosition_m;
    if (!position || !['x', 'y', 'z'].every((axis) => Number.isFinite(position[axis]))) {
      invalidReceiverTrack(`Receiver track frame ${frameIndex} must have a finite projected position`);
    }
  }
}

function displacementBetween(left, right) {
  return Math.hypot(
    right.projectedPosition_m.x - left.projectedPosition_m.x,
    right.projectedPosition_m.y - left.projectedPosition_m.y,
    right.projectedPosition_m.z - left.projectedPosition_m.z,
  );
}

function validateFrameIndex(track, frameIndex) {
  if (!Number.isInteger(frameIndex) || frameIndex < 0 || frameIndex >= track.length) {
    invalidReceiverTrack('Receiver frame index must identify a frame in the track');
  }
}

export function receiverMotionAt(track, frameIndex, {
  stationaryThreshold_m = DEFAULT_STATIONARY_THRESHOLD_M,
} = {}) {
  validateTrack(track);
  validateFrameIndex(track, frameIndex);
  validateThreshold(stationaryThreshold_m);

  if (frameIndex === 0) {
    return { state: 'initial', displacement_m: 0 };
  }

  const displacement_m = displacementBetween(track[frameIndex - 1], track[frameIndex]);
  return {
    state: displacement_m <= stationaryThreshold_m ? 'stationary' : 'moving',
    displacement_m,
  };
}

export function summarizeReceiverTrack(track, {
  stationaryThreshold_m = DEFAULT_STATIONARY_THRESHOLD_M,
} = {}) {
  validateTrack(track);
  validateThreshold(stationaryThreshold_m);

  let movingFrameCount = 0;
  let stationaryFrameCount = 0;
  let totalDistance_m = 0;

  for (let frameIndex = 1; frameIndex < track.length; frameIndex += 1) {
    const displacement_m = displacementBetween(track[frameIndex - 1], track[frameIndex]);
    totalDistance_m += displacement_m;
    if (displacement_m <= stationaryThreshold_m) {
      stationaryFrameCount += 1;
    } else {
      movingFrameCount += 1;
    }
  }

  return {
    frameCount: track.length,
    movingFrameCount,
    stationaryFrameCount,
    totalDistance_m,
    start: track[0],
    end: track.at(-1),
  };
}
