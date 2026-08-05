import { DomainValidationError } from '../domain/validation.js';
import { projectedLinkGeometry } from './linkGeometry.js';

export function scenarioFrameGeometry(scenario, frameId) {
  if (!scenario?.groundSelection || scenario.groundSelection.selectedBy !== 'user') {
    throw new DomainValidationError(
      'GROUND_FRAME_REQUIRED',
      'A user-selected static ground point is required for scenario geometry',
    );
  }
  if (!Number.isInteger(frameId) || frameId < 0 || frameId >= scenario.time.frameCount) {
    throw new DomainValidationError(
      'SCENARIO_FRAME_OUT_OF_RANGE',
      `Frame ${frameId} is outside the scenario`,
    );
  }
  const trackPoint = scenario.transmitter.track[frameId];
  const transmitterPosition_m = trackPoint.projectedPosition_m;
  const receiverPosition_m = scenario.groundSelection.projectedPosition_m;
  return {
    frameId,
    timestampUtc: trackPoint.timestampUtc,
    source: 'scenario-coordinates',
    ...projectedLinkGeometry(transmitterPosition_m, receiverPosition_m),
    transmitterPosition_m,
    receiverPosition_m,
  };
}

