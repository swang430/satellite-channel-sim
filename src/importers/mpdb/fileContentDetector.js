import JSZip from 'jszip';
import { DomainValidationError } from '../../domain/validation.js';
import { classifyLauraycsConfig } from './configClassifier.js';
import { normalizeRedundantZip64ForJsZip } from './zipCompatibility.js';

const textDecoder = new TextDecoder('utf-8', { fatal: true });
const DEFAULT_MAX_NESTING_DEPTH = 3;
const DEFAULT_MAX_NESTED_ENTRIES = 100;

function asUint8Array(data) {
  if (data instanceof Uint8Array) return data;
  if (data instanceof ArrayBuffer) return new Uint8Array(data);
  if (ArrayBuffer.isView(data)) {
    return new Uint8Array(data.buffer, data.byteOffset, data.byteLength);
  }
  throw new DomainValidationError('IMPORT_FILE_DATA_INVALID', 'Import file data must be binary');
}

function tryClassifyConfig(data) {
  let text;
  try {
    text = textDecoder.decode(data);
  } catch {
    return null;
  }
  const trimmed = text.replace(/^\uFEFF/, '').trim();
  if (!trimmed.startsWith('{')) return null;

  let config;
  try {
    config = JSON.parse(trimmed);
  } catch {
    return null;
  }
  try {
    const { role } = classifyLauraycsConfig(config);
    return { role, config };
  } catch {
    return null;
  }
}

async function findTorchArchive(data, depth, limits) {
  if (depth > limits.maxNestingDepth) return null;

  let zip;
  try {
    zip = await JSZip.loadAsync(normalizeRedundantZip64ForJsZip(data));
  } catch {
    return null;
  }

  if (zip.file('archive/data.pkl')) return data;

  const entries = Object.values(zip.files).filter((entry) => !entry.dir);
  if (entries.length > limits.maxNestedEntries) {
    throw new DomainValidationError(
      'MPDB_NESTED_ENTRY_LIMIT',
      'Nested MPDB container contains too many entries',
    );
  }
  for (const entry of entries) {
    const nestedData = await entry.async('uint8array');
    const found = await findTorchArchive(nestedData, depth + 1, limits);
    if (found) return found;
  }
  return null;
}

export async function detectMpdbBundleFile(file, requestedLimits = {}) {
  const data = asUint8Array(file?.data);
  const config = tryClassifyConfig(data);
  if (config) return { ...config, originalName: file.name ?? null, data };

  const limits = {
    maxNestingDepth: requestedLimits.maxNestingDepth ?? DEFAULT_MAX_NESTING_DEPTH,
    maxNestedEntries: requestedLimits.maxNestedEntries ?? DEFAULT_MAX_NESTED_ENTRIES,
  };
  const torchArchiveBytes = await findTorchArchive(data, 0, limits);
  if (torchArchiveBytes) {
    return {
      role: 'mpdb',
      originalName: file.name ?? null,
      data,
      torchArchiveBytes,
    };
  }

  throw new DomainValidationError(
    'IMPORT_FILE_CONTENT_NOT_RECOGNIZED',
    `File ${file?.name ?? '(unnamed)'} is neither a Lauraycs config nor an MPDB archive`,
  );
}
