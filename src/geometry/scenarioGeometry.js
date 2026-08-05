import { DomainValidationError } from '../domain/validation.js';
import { projectedLinkGeometry } from './linkGeometry.js';

function projectedPositionSnapshot(point, code, label) {
  const position = point?.projectedPosition_m;
  if (!position || ![position.x, position.y, position.z].every(Number.isFinite)) {
    throw new DomainValidationError(code, `${label} projected position must be finite`);
  }
  return { x: position.x, y: position.y, z: position.z };
}

export function scenarioFrameGeometry(scenario, frameId) {
  if (!Number.isInteger(frameId) || frameId < 0 || frameId >= scenario.time.frameCount) {
    throw new DomainValidationError(
      'SCENARIO_FRAME_OUT_OF_RANGE',
      `Frame ${frameId} is outside the scenario`,
    );
  }
  const trackPoint = scenario.transmitter?.track?.[frameId];
  if (!trackPoint || trackPoint.frameId !== frameId) {
    throw new DomainValidationError(
      'TRANSMITTER_TRACK_FRAME_MISSING',
      `Transmitter track frame ${frameId} is missing`,
    );
  }
  const receiverPoint = scenario.receiver?.track?.[frameId];
  if (!receiverPoint || receiverPoint.frameId !== frameId) {
    throw new DomainValidationError(
      'RECEIVER_TRACK_FRAME_MISSING',
      `Receiver track frame ${frameId} is missing`,
    );
  }
  const transmitterPosition_m = projectedPositionSnapshot(
    trackPoint,
    'TRANSMITTER_TRACK_POSITION_INVALID',
    'Transmitter',
  );
  const receiverPosition_m = projectedPositionSnapshot(
    receiverPoint,
    'RECEIVER_TRACK_POSITION_INVALID',
    'Receiver',
  );
  return {
    frameId,
    timestampUtc: trackPoint.timestampUtc,
    source: 'scenario-coordinates',
    ...projectedLinkGeometry(transmitterPosition_m, receiverPosition_m),
    transmitterPosition_m,
    receiverPosition_m,
  };
}
