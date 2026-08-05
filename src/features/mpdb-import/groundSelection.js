import { normalizeGroundSelection } from '../../domain/scenario.js';
import { DomainValidationError } from '../../domain/validation.js';

function distance_m(left, right) {
  return Math.hypot(
    left.x - right.x,
    left.y - right.y,
    left.z - right.z,
  );
}

function candidateAt(scenario, frameId) {
  const candidate = scenario?.groundCandidates?.find((item) => item.frameId === frameId);
  if (!candidate) {
    throw new DomainValidationError(
      'GROUND_FRAME_NOT_FOUND',
      `Ground candidate frame ${frameId} is missing`,
    );
  }
  return candidate;
}

export function canCompareScenario(scenario) {
  const selectedFrameId = scenario?.groundSelection?.selectedFrameId;
  return scenario?.groundSelection?.selectedBy === 'user'
    && Number.isInteger(selectedFrameId)
    && selectedFrameId >= 0
    && selectedFrameId < scenario.time.frameCount;
}

export function selectGroundFrame(scenario, frameId, options = {}) {
  const normalized = normalizeGroundSelection({
    selectedFrameId: frameId,
    selectedBy: 'user',
    selectedAtUtc: options.selectedAtUtc,
    matchTolerance_m: options.matchTolerance_m,
  }, scenario.time.frameCount);
  const selected = candidateAt(scenario, frameId);
  const groundCandidates = scenario.groundCandidates.map((candidate) => ({
    ...candidate,
    groundPositionMismatch_m: distance_m(
      candidate.projectedPosition_m,
      selected.projectedPosition_m,
    ),
  }));
  const exactMatchFrameCount = groundCandidates.filter(
    (candidate) => candidate.groundPositionMismatch_m <= normalized.matchTolerance_m,
  ).length;
  const changed = scenario.groundSelection?.selectedFrameId !== frameId;

  return {
    ...scenario,
    groundCandidates,
    groundSelection: {
      ...normalized,
      groundPosition: {
        longitude_deg: selected.longitude_deg,
        latitude_deg: selected.latitude_deg,
        altitude_m: selected.altitude_m,
      },
      projectedPosition_m: selected.projectedPosition_m,
      exactMatchFrameCount,
    },
    comparisonRevision: (scenario.comparisonRevision ?? 0) + (changed ? 1 : 0),
  };
}

export function suggestGroundFrames(scenario, { stabilityRadius_m = 0.1 } = {}) {
  if (!Number.isFinite(stabilityRadius_m) || stabilityRadius_m < 0) {
    throw new DomainValidationError(
      'GROUND_STABILITY_RADIUS_INVALID',
      'Ground stability radius must be a finite non-negative number',
    );
  }
  return scenario.groundCandidates
    .map((candidate) => ({
      frameId: candidate.frameId,
      nearbyFrameCount: scenario.groundCandidates.filter((other) => (
        distance_m(candidate.projectedPosition_m, other.projectedPosition_m)
        <= stabilityRadius_m
      )).length,
    }))
    .sort((left, right) => (
      right.nearbyFrameCount - left.nearbyFrameCount || left.frameId - right.frameId
    ));
}

