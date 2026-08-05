import { createScenarioDraft, validateScenario } from '../../domain/scenario.js';
import { DomainValidationError } from '../../domain/validation.js';
import {
  alignMpdbCoordinates,
  localToProjected,
  projectedToGeographic,
  readFlatPosition,
} from './coordinateAlignment.js';

const NEAR_FREQUENCY_RELATIVE_TOLERANCE = 0.005;

function assertUniformMpdbFrequency(frequencies_Hz) {
  if (!frequencies_Hz || frequencies_Hz.length === 0) return null;
  const frequency_Hz = frequencies_Hz[0];
  for (let frameId = 1; frameId < frequencies_Hz.length; frameId += 1) {
    if (frequencies_Hz[frameId] !== frequency_Hz) {
      throw new DomainValidationError(
        'MPDB_FRAME_FREQUENCY_MISMATCH',
        `MPDB frame ${frameId} has a different carrier frequency`,
      );
    }
  }
  return frequency_Hz;
}

export function resolveAuthoritativeFrequency(mpdbFrequency_Hz, candidates = []) {
  if (mpdbFrequency_Hz !== null && mpdbFrequency_Hz !== undefined) {
    return {
      frequency_Hz: mpdbFrequency_Hz,
      warnings: candidates
        .filter(({ frequency_Hz }) => frequency_Hz !== mpdbFrequency_Hz)
        .map((candidate) => {
          const relativeDifference = Math.abs(candidate.frequency_Hz - mpdbFrequency_Hz)
            / mpdbFrequency_Hz;
          const isNearMatch = relativeDifference <= NEAR_FREQUENCY_RELATIVE_TOLERANCE;
          return {
            code: isNearMatch
              ? 'CONFIG_FREQUENCY_NEAR_MATCH'
              : 'CONFIG_FREQUENCY_CONFLICT',
            severity: 'warning',
            path: 'carrier.frequency_Hz',
            source: candidate.source,
            message: `Configured ${candidate.frequency_Hz} Hz ${isNearMatch ? 'differs slightly from' : 'conflicts with'} MPDB ${mpdbFrequency_Hz} Hz; MPDB is authoritative`,
          };
        }),
    };
  }

  const unique = [...new Set(candidates.map(({ frequency_Hz }) => frequency_Hz))];
  if (unique.length !== 1) {
    throw new DomainValidationError(
      'CONFIG_FREQUENCY_AMBIGUOUS',
      'No MPDB frequency is available and config frequency candidates disagree',
    );
  }
  return { frequency_Hz: unique[0], warnings: [] };
}

function assertLinkIdentity(config, mpdb) {
  const platform = mpdb.meta?.lauraycsPlatform;
  if (platform && (platform.version !== 1 || platform.format !== 'route_link')) {
    throw new DomainValidationError(
      'MPDB_PLATFORM_METADATA_NOT_SUPPORTED',
      `Unsupported Lauraycs platform metadata version ${platform.version} format ${platform.format}`,
    );
  }
  const routeLink = platform ?? mpdb.meta?.route_link;
  const actual = {
    direction: routeLink?.direction,
    transmitterId: routeLink?.transmitter?.id === undefined
      ? null : String(routeLink.transmitter.id),
    receiverId: routeLink?.receiver?.id === undefined
      ? null : String(routeLink.receiver.id),
  };
  if (actual.direction !== config.link.direction
    || actual.transmitterId !== config.link.transmitterId
    || actual.receiverId !== config.link.receiverId) {
    throw new DomainValidationError(
      'MPDB_LINK_ENTITY_MISMATCH',
      `MPDB link ${JSON.stringify(actual)} does not match configs ${JSON.stringify(config.link)}`,
    );
  }
}

function buildGroundCandidates(mpdb, config, alignment) {
  return Array.from({ length: mpdb.frameCount }, (_, frameId) => {
    const localPosition_m = readFlatPosition(mpdb.linkFrames.rxPosition_m, frameId);
    const projectedPosition_m = localToProjected(localPosition_m, alignment.localOrigin_m);
    return {
      frameId,
      timestampUtc: config.timestampsUtc[frameId],
      localPosition_m,
      projectedPosition_m,
      ...projectedToGeographic(
        projectedPosition_m,
        config.coordinateReference.projectedEpsg,
      ),
    };
  });
}

export function assembleMpdbScenario({
  config,
  mpdb,
  sourceFiles,
  scenarioId = null,
  alignmentTolerance_m = 0.1,
}) {
  assertLinkIdentity(config, mpdb);
  if (mpdb.frameCount !== config.time.frameCount) {
    throw new DomainValidationError(
      'MPDB_FRAME_COUNT_MISMATCH',
      `MPDB has ${mpdb.frameCount} frames but configs define ${config.time.frameCount}`,
    );
  }

  const mpdbFrequency_Hz = assertUniformMpdbFrequency(mpdb.linkFrames.frequency_Hz);
  const frequency = resolveAuthoritativeFrequency(
    mpdbFrequency_Hz,
    config.carrier.frequencyCandidates,
  );
  const alignment = alignMpdbCoordinates(
    config.satelliteTrack,
    mpdb.linkFrames.txPosition_m,
  );
  if (!Number.isFinite(alignmentTolerance_m) || alignmentTolerance_m < 0) {
    throw new DomainValidationError(
      'MPDB_COORDINATE_TOLERANCE_INVALID',
      'Coordinate alignment tolerance must be a finite non-negative number',
    );
  }
  if (alignment.alignmentMaxResidual_m > alignmentTolerance_m) {
    throw new DomainValidationError(
      'MPDB_COORDINATE_ALIGNMENT_FAILED',
      `Coordinate alignment max residual ${alignment.alignmentMaxResidual_m} m exceeds ${alignmentTolerance_m} m`,
    );
  }
  const groundCandidates = buildGroundCandidates(mpdb, config, alignment);

  const scenario = createScenarioDraft({
    scenarioId,
    source: { format: 'lauraycs-mpdb', files: sourceFiles },
    link: config.link,
    time: config.time,
    carrier: {
      frequency_Hz: frequency.frequency_Hz,
      bandwidth_Hz: config.carrier.bandwidth_Hz,
    },
    coordinateReference: {
      ...config.coordinateReference,
      ...alignment,
    },
    transmitter: {
      ...config.transmitter,
      track: config.satelliteTrack,
    },
    receiver: config.receiver,
    groundSelection: null,
    geometry: {
      frameCount: mpdb.frameCount,
      txPosition_m: mpdb.linkFrames.txPosition_m,
      rxPosition_m: mpdb.linkFrames.rxPosition_m,
    },
    rayTracing: mpdb.rayTracing,
    diagnostics: {
      warnings: [...config.diagnostics.warnings, ...frequency.warnings],
      assumptions: config.diagnostics.assumptions,
    },
  });
  scenario.groundCandidates = groundCandidates;
  scenario.linkFrames = mpdb.linkFrames;

  const issues = validateScenario(scenario);
  if (issues.length > 0) {
    throw new DomainValidationError(
      'MPDB_SCENARIO_INVALID',
      'Assembled MPDB scenario is invalid',
      issues,
    );
  }
  return scenario;
}
