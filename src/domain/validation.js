export class DomainValidationError extends Error {
  constructor(code, message, issues = []) {
    super(message);
    this.name = 'DomainValidationError';
    this.code = code;
    this.issues = issues;
  }
}

export function validationIssue(code, path, message, {
  severity = 'error',
  source = 'domain',
} = {}) {
  return { code, severity, path, message, source };
}

export function isFiniteNumber(value) {
  return typeof value === 'number' && Number.isFinite(value);
}

export function assertUtcTimestamp(value, path) {
  if (typeof value !== 'string' || Number.isNaN(Date.parse(value))) {
    throw new DomainValidationError(
      'INVALID_UTC_TIMESTAMP',
      `${path} must be an ISO-8601 timestamp`,
      [validationIssue('INVALID_UTC_TIMESTAMP', path, 'Expected an ISO-8601 timestamp')],
    );
  }
}
