export class InputValidationError extends Error {
  constructor(code, message, path = null) {
    super(message);
    this.name = 'InputValidationError';
    this.code = code;
    this.path = path;
  }
}

export const WS_MAX_REQUEST_BYTES = 16 * 1024;
export const WS_MIN_REQUEST_INTERVAL_MS = 1000;

function finiteNumber(value, path, { min = -Infinity, max = Infinity } = {}) {
  const number = typeof value === 'number' ? value : Number(value);
  if (!Number.isFinite(number) || number < min || number > max) {
    throw new InputValidationError('INVALID_NUMBER', `${path} must be finite and within [${min}, ${max}]`, path);
  }
  return number;
}

export function parseGroundStation(value = '31.23,121.47,0') {
  if (typeof value !== 'string') {
    throw new InputValidationError('INVALID_GROUND_STATION', 'gs must be a comma-separated string', 'gs');
  }
  const parts = value.split(',');
  if (parts.length < 2 || parts.length > 3 || parts.some((part) => part.trim() === '')) {
    throw new InputValidationError('INVALID_GROUND_STATION', 'gs must contain lat,lon[,alt]', 'gs');
  }
  return {
    lat: finiteNumber(parts[0], 'gs.lat', { min: -90, max: 90 }),
    lon: finiteNumber(parts[1], 'gs.lon', { min: -180, max: 180 }),
    alt: finiteNumber(parts[2] ?? 0, 'gs.alt', { min: -500, max: 1_000_000 }),
  };
}

export function parseHours(value, defaultValue = 24) {
  if (value == null || value === '') return defaultValue;
  const hours = finiteNumber(value, 'hours', { min: 1, max: 72 });
  if (!Number.isInteger(hours)) {
    throw new InputValidationError('INVALID_HOURS', 'hours must be an integer', 'hours');
  }
  return hours;
}

export function validateTle(tleLine1, tleLine2) {
  if (typeof tleLine1 !== 'string' || typeof tleLine2 !== 'string'
    || !/^1 \d{5}[A-Z ]/.test(tleLine1) || !/^2 \d{5} /.test(tleLine2)) {
    throw new InputValidationError('INVALID_TLE', 'TLE must contain structurally valid line 1 and line 2', 'tle');
  }
  if (tleLine1.slice(2, 7) !== tleLine2.slice(2, 7)) {
    throw new InputValidationError('TLE_ID_MISMATCH', 'TLE line satellite identifiers do not match', 'tle');
  }
  if (tleLine1.length > 80 || tleLine2.length > 80) {
    throw new InputValidationError('INVALID_TLE', 'TLE lines exceed the supported length', 'tle');
  }
  return { tleLine1, tleLine2 };
}

const LINK_PARAM_RULES = Object.freeze({
  freq: { min: 0.001, max: 1000 },
  rainRate: { min: 0, max: 1000 },
  tec: { min: 0, max: 100_000 },
  xpdAnt: { min: 0, max: 100 },
  correctionFactor: { min: 0, max: 10 },
  hpbw: { min: 0.001, max: 180 },
  eirp: { min: -200, max: 200 },
  gRx: { min: -200, max: 200 },
  tRx: { min: 0.001, max: 100_000 },
  bandwidth: { min: 0.000001, max: 1_000_000 },
});

export function parseLinkParams(input = {}) {
  if (!input || typeof input !== 'object' || Array.isArray(input)) {
    throw new InputValidationError('INVALID_LINK_PARAMS', 'linkParams must be an object', 'linkParams');
  }
  const result = {};
  for (const [key, value] of Object.entries(input)) {
    const rule = LINK_PARAM_RULES[key];
    if (!rule) throw new InputValidationError('UNKNOWN_LINK_PARAMETER', `unknown link parameter: ${key}`, key);
    result[key] = finiteNumber(value, `linkParams.${key}`, rule);
  }
  return result;
}

export function extractLinkParams(query) {
  return parseLinkParams(Object.fromEntries(
    Object.keys(LINK_PARAM_RULES)
      .filter((key) => query[key] != null)
      .map((key) => [key, query[key]]),
  ));
}

export function resolveServerHost(environment = process.env) {
  const host = environment.HOST ?? '127.0.0.1';
  if (!['127.0.0.1', 'localhost', '::1', '0.0.0.0', '::'].includes(host)) {
    throw new InputValidationError('INVALID_HOST', 'HOST must be a supported explicit bind address', 'HOST');
  }
  return host;
}

export function parseWsRequest(data) {
  const text = typeof data === 'string' ? data : data.toString('utf8');
  if (new TextEncoder().encode(text).byteLength > WS_MAX_REQUEST_BYTES) {
    throw new InputValidationError('WS_PAYLOAD_TOO_LARGE', 'WebSocket request exceeds size limit');
  }
  let message;
  try {
    message = JSON.parse(text);
  } catch {
    throw new InputValidationError('INVALID_JSON', 'WebSocket request must be valid JSON');
  }
  if (!message || typeof message !== 'object' || Array.isArray(message)) {
    throw new InputValidationError('INVALID_WS_REQUEST', 'WebSocket request must be an object');
  }
  const sat = message.sat ?? 'ISS';
  if (typeof sat !== 'string' || sat.length < 1 || sat.length > 80) {
    throw new InputValidationError('INVALID_SATELLITE', 'sat must be a non-empty string of at most 80 characters');
  }
  return {
    sat,
    groundStation: parseGroundStation(message.gs),
    hours: parseHours(message.hours),
    linkParams: parseLinkParams(message.linkParams ?? {}),
  };
}

export function assertWsRequestAllowed(lastRequestAt, now = Date.now()) {
  if (lastRequestAt != null && now - lastRequestAt < WS_MIN_REQUEST_INTERVAL_MS) {
    throw new InputValidationError('WS_RATE_LIMITED', 'WebSocket requests are limited to one per second');
  }
  return true;
}
