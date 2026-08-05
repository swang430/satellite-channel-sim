import { DomainValidationError } from '../domain/validation.js';

export function parseTleEpoch(tleLine1) {
  if (typeof tleLine1 !== 'string' || tleLine1.length < 32 || !tleLine1.startsWith('1 ')) {
    throw new DomainValidationError('TLE_LINE_1_INVALID', 'TLE line 1 is malformed');
  }
  const shortYear = Number(tleLine1.slice(18, 20));
  const dayOfYear = Number(tleLine1.slice(20, 32));
  if (!Number.isInteger(shortYear) || !Number.isFinite(dayOfYear) || dayOfYear < 1) {
    throw new DomainValidationError('TLE_EPOCH_INVALID', 'TLE epoch is malformed');
  }
  const year = shortYear < 57 ? 2_000 + shortYear : 1_900 + shortYear;
  const startOfYearMs = Date.UTC(year, 0, 1);
  const epochMs = startOfYearMs + Math.round((dayOfYear - 1) * 86_400_000);
  const epoch = new Date(epochMs);
  if (epoch.getUTCFullYear() !== year) {
    throw new DomainValidationError('TLE_EPOCH_INVALID', 'TLE day-of-year is outside its year');
  }
  return epoch;
}

export function diagnoseTleAge(tle, now = new Date(), { maxAgeDays = 14 } = {}) {
  const epoch = parseTleEpoch(tle?.tleLine1);
  const ageDays = (now.getTime() - epoch.getTime()) / 86_400_000;
  const warnings = [];
  let status = 'fresh';
  if (ageDays > maxAgeDays) {
    status = 'stale';
    warnings.push({
      code: 'TLE_STALE',
      severity: 'warning',
      message: `TLE epoch is ${ageDays.toFixed(1)} days old; real-time accuracy is not claimed`,
    });
  } else if (ageDays < -1) {
    status = 'future';
    warnings.push({
      code: 'TLE_EPOCH_IN_FUTURE',
      severity: 'warning',
      message: `TLE epoch is ${Math.abs(ageDays).toFixed(1)} days in the future`,
    });
  }
  return {
    epochUtc: epoch.toISOString(),
    ageDays,
    maxAgeDays,
    status,
    realTimeAccuracy: status === 'fresh' ? 'nominal' : 'not-claimed',
    warnings,
  };
}

export function withTleDiagnostics(payload, tle, now = new Date(), options = {}) {
  return {
    ...payload,
    tleDiagnostics: diagnoseTleAge(tle, now, options),
  };
}
