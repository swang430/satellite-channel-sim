import { DomainValidationError } from '../domain/validation.js';
import { projectedLinkGeometry } from './linkGeometry.js';

export function scenarioFrameGeometry(scenario, frameId) {
  if (!Number.isInteger(frameId) || frameId < 0 || frameId >= scenario.time.frameCount) {
    throw new DomainValidationError(
      'SCENARIO_FRAME_OUT_OF_RANGE',
      `Frame ${frameId} is outside the scenario`,
    );
  }
  const trackPoint = scenario.transmitter.track[frameId];
  const receiverPoint = scenario.receiver?.track?.[frameId];
  if (!receiverPoint || receiverPoint.frameId !== frameId) {
    throw new DomainValidationError(
      'RECEIVER_TRACK_FRAME_MISSING',
      `Receiver track frame ${frameId} is missing`,
    );
  }
  const transmitterPosition_m = trackPoint.projectedPosition_m;
  const receiverPosition_m = receiverPoint.projectedPosition_m;
  return {
    frameId,
    timestampUtc: trackPoint.timestampUtc,
    source: 'scenario-coordinates',
    ...projectedLinkGeometry(transmitterPosition_m, receiverPosition_m),
    transmitterPosition_m,
    receiverPosition_m,
  };
}
