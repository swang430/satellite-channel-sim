import {
  MPDB_IMPORT_REQUEST,
  runMpdbImportRequest,
  serializeImportError,
} from './mpdbImportProtocol.js';

self.addEventListener('message', async ({ data }) => {
  if (data?.type !== MPDB_IMPORT_REQUEST) return;
  const emit = (message, transferables = []) => self.postMessage(message, transferables);
  try {
    await runMpdbImportRequest(data, emit);
  } catch (error) {
    emit({
      type: 'FAIL',
      requestId: data.requestId,
      error: serializeImportError(error),
    });
  }
});

