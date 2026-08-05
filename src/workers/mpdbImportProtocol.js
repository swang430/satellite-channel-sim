export {
  createImportState,
  transitionImportState,
} from '../features/mpdb-import/importState.js';

export const MPDB_IMPORT_REQUEST = 'IMPORT_MPDB_BUNDLE';

export function collectScenarioTransferables(value) {
  const buffers = new Set();
  const visited = new WeakSet();

  function visit(child) {
    if (child === null || typeof child !== 'object') return;
    if (child instanceof ArrayBuffer) {
      buffers.add(child);
      return;
    }
    if (ArrayBuffer.isView(child)) {
      buffers.add(child.buffer);
      return;
    }
    if (visited.has(child)) return;
    visited.add(child);
    for (const nested of Object.values(child)) visit(nested);
  }

  visit(value);
  return [...buffers];
}

export function serializeImportError(error) {
  return {
    name: error?.name ?? 'Error',
    code: error?.code ?? 'MPDB_IMPORT_FAILED',
    message: error?.message ?? String(error),
    issues: Array.isArray(error?.issues) ? error.issues : [],
  };
}

export async function runMpdbImportRequest(request, emit) {
  emit({ type: 'PROGRESS', requestId: request.requestId, progress: 0.1 });
  const scenario = await importMpdbBundle(request.files);
  emit({ type: 'VALIDATE', requestId: request.requestId, progress: 0.9 });
  emit(
    { type: 'READY', requestId: request.requestId, scenario },
    collectScenarioTransferables(scenario),
  );
}

import { importMpdbBundle } from '../importers/mpdb/importMpdbBundle.js';

