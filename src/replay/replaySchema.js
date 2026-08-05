export const REPLAY_SCHEMA_VERSION = 'satellite-channel-sim/replay-v1';

function finiteMetric(value, path) {
  if (value == null) return undefined;
  const number = typeof value === 'number' ? value : Number(value);
  if (!Number.isFinite(number)) throw new TypeError(`${path} must be finite`);
  return number;
}

function normalizeTimestamp(value, path) {
  if (typeof value !== 'string' || Number.isNaN(Date.parse(value))) {
    throw new TypeError(`${path} timestamp must be valid ISO-8601`);
  }
  return new Date(value).toISOString();
}

function compact(object) {
  return Object.fromEntries(Object.entries(object).filter(([, value]) => value !== undefined));
}

function normalizeFrame(raw, index, diagnostics) {
  if (!raw || typeof raw !== 'object') throw new TypeError(`frames[${index}] must be an object`);
  const frameId = raw.frameId ?? index;
  if (!Number.isInteger(frameId) || frameId < 0) throw new TypeError(`frames[${index}].frameId must be non-negative integer`);
  const timestampUtc = normalizeTimestamp(raw.timestampUtc ?? raw.timestamp ?? raw.time, `frames[${index}]`);
  const rawObservation = raw.observation ?? raw.metrics?.observation ?? {};
  const rawDerived = raw.derived ?? raw.metrics?.derived ?? {};
  const observation = compact({
    rainRate_mmph: finiteMetric(
      rawObservation.rainRate_mmph ?? raw.rainRate_mmph ?? raw.rainRate,
      `frames[${index}].rainRate_mmph`,
    ),
    source: 'observed-input',
    provider: rawObservation.provider,
  });
  const derived = compact({
    rainAttenuation_dB: finiteMetric(
      rawDerived.rainAttenuation_dB ?? raw.attenuation_dB ?? raw.measuredLoss,
      `frames[${index}].rainAttenuation_dB`,
    ),
    source: 'synthetic-derived',
    model: rawDerived.model,
  });
  if (raw.measuredLoss != null) {
    diagnostics.push({
      code: 'LEGACY_LOSS_ASSUMED_DERIVED',
      severity: 'warning',
      path: `frames[${index}].measuredLoss`,
      message: 'Legacy measuredLoss has no measurement provenance and was classified as model-derived.',
    });
  }
  if (observation.rainRate_mmph == null && derived.rainAttenuation_dB == null) {
    throw new TypeError(`frames[${index}] must include a supported finite metric`);
  }
  return {
    frameId,
    timestampUtc,
    metrics: { observation, derived },
    provenance: {
      source: 'replay-file',
      channelFrameCompatibility: 'identity-metrics-provenance',
    },
  };
}

export function parseReplayJson(input) {
  let value = input;
  if (typeof input === 'string') {
    try {
      value = JSON.parse(input);
    } catch (error) {
      throw new TypeError(`replay JSON is invalid: ${error.message}`);
    }
  }
  const rawFrames = Array.isArray(value) ? value : value?.frames;
  if (!Array.isArray(rawFrames) || rawFrames.length === 0) {
    throw new TypeError('replay JSON must contain a non-empty frames array');
  }
  const diagnostics = [];
  return {
    schemaVersion: REPLAY_SCHEMA_VERSION,
    frames: rawFrames.map((frame, index) => normalizeFrame(frame, index, diagnostics)),
    diagnostics,
  };
}
