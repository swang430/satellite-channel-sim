function requireFinite(value, path, { min = -Infinity } = {}) {
  if (typeof value !== 'number' || !Number.isFinite(value) || value < min) {
    throw new TypeError(`${path} must be finite and >= ${min}`);
  }
  return value;
}

export function deriveOpenMeteoSample({ timestampUtc, precipitation_mmph }) {
  if (typeof timestampUtc !== 'string' || Number.isNaN(Date.parse(timestampUtc))) {
    throw new TypeError('timestampUtc must be valid ISO-8601');
  }
  const rainRate_mmph = requireFinite(precipitation_mmph, 'precipitation_mmph', { min: 0 });
  const rainAttenuation_dB = 0.018 * rainRate_mmph ** 1.15 * 5;
  return {
    frameId: Math.abs(Math.trunc(Date.parse(timestampUtc))) % Number.MAX_SAFE_INTEGER,
    timestampUtc: new Date(timestampUtc).toISOString(),
    metrics: {
      observation: {
        rainRate_mmph,
        source: 'observed-input',
        provider: 'open-meteo',
      },
      derived: {
        rainAttenuation_dB,
        source: 'synthetic-derived',
        model: 'legacy-ku-rain-attenuation-heuristic',
      },
    },
    provenance: {
      source: 'open-meteo-plus-local-model',
    },
  };
}
