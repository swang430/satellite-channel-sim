import { DomainValidationError } from '../domain/validation.js';

export function classifyScenarioFrames(scenario) {
  const tolerance_m = scenario?.groundSelection?.matchTolerance_m;
  if (!Number.isFinite(tolerance_m) || tolerance_m < 0) {
    throw new DomainValidationError(
      'GROUND_FRAME_REQUIRED',
      'A user ground selection with matchTolerance_m is required',
    );
  }
  const exact = [];
  const approximate = [];
  for (const candidate of scenario.groundCandidates) {
    const classification = {
      frameId: candidate.frameId,
      groundPositionMismatch_m: candidate.groundPositionMismatch_m,
      match: candidate.groundPositionMismatch_m <= tolerance_m ? 'exact' : 'approximate',
    };
    (classification.match === 'exact' ? exact : approximate).push(classification);
  }
  return { tolerance_m, exact, approximate };
}

