import { DomainValidationError } from '../../domain/validation.js';

const ALLOWED_TRANSITIONS = Object.freeze({
  idle: new Set(['START']),
  parsing: new Set(['PROGRESS', 'VALIDATE', 'FAIL']),
  validating: new Set(['PROGRESS', 'READY', 'FAIL']),
  ready: new Set(['START', 'RESET']),
  error: new Set(['START', 'RESET']),
});

export function createImportState() {
  return {
    status: 'idle',
    progress: 0,
    scenario: null,
    error: null,
  };
}

function assertProgress(previous, next) {
  if (!Number.isFinite(next) || next < previous || next < 0 || next > 1) {
    throw new DomainValidationError(
      'MPDB_IMPORT_PROGRESS_INVALID',
      `Import progress ${next} must be between ${previous} and 1`,
    );
  }
}

export function transitionImportState(state, event) {
  if (!ALLOWED_TRANSITIONS[state?.status]?.has(event?.type)) {
    throw new DomainValidationError(
      'MPDB_IMPORT_STATE_TRANSITION_INVALID',
      `Cannot apply ${event?.type} while import is ${state?.status}`,
    );
  }

  switch (event.type) {
    case 'START':
      return { status: 'parsing', progress: 0, scenario: null, error: null };
    case 'PROGRESS':
      assertProgress(state.progress, event.progress);
      return { ...state, progress: event.progress };
    case 'VALIDATE':
      return { ...state, status: 'validating', progress: Math.max(state.progress, 0.9) };
    case 'READY':
      return { status: 'ready', progress: 1, scenario: event.scenario, error: null };
    case 'FAIL':
      return { ...state, status: 'error', error: event.error ?? null };
    case 'RESET':
      return createImportState();
    default:
      throw new DomainValidationError(
        'MPDB_IMPORT_STATE_TRANSITION_INVALID',
        `Unknown import event ${event.type}`,
      );
  }
}

