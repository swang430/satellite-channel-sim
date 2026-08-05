import JSZip from 'jszip';
import { DomainValidationError } from '../../domain/validation.js';
import { DEFAULT_MPDB_LIMITS } from './mpdbLimits.js';
import { readSafePickle } from './safePickleReader.js';
import { normalizeRedundantZip64ForJsZip } from './zipCompatibility.js';

const REQUIRED_MEMBERS = [
  'archive/data.pkl',
  'archive/byteorder',
  'archive/version',
];

function entrySize(entry) {
  return entry?._data?.uncompressedSize ?? null;
}

export async function readTorchArchive(input, requestedLimits = {}) {
  const limits = { ...DEFAULT_MPDB_LIMITS, ...requestedLimits };
  let zip;
  try {
    zip = await JSZip.loadAsync(normalizeRedundantZip64ForJsZip(input));
  } catch (error) {
    throw new DomainValidationError(
      'TORCH_ARCHIVE_INVALID',
      `Invalid PyTorch ZIP archive: ${error.message}`,
    );
  }

  const entries = Object.values(zip.files).filter((entry) => !entry.dir);
  if (entries.length > limits.maxArchiveEntries) {
    throw new DomainValidationError(
      'TORCH_ARCHIVE_ENTRY_LIMIT',
      'PyTorch archive contains too many entries',
    );
  }
  for (const member of REQUIRED_MEMBERS) {
    if (!zip.file(member)) {
      throw new DomainValidationError(
        'TORCH_ARCHIVE_MEMBER_MISSING',
        `Required PyTorch archive member ${member} is missing`,
      );
    }
  }

  const dataPickleEntry = zip.file('archive/data.pkl');
  if ((entrySize(dataPickleEntry) ?? 0) > limits.maxDataPickleBytes) {
    throw new DomainValidationError(
      'TORCH_PICKLE_SIZE_LIMIT',
      'PyTorch data.pkl exceeds the configured size limit',
    );
  }
  const dataPickle = await dataPickleEntry.async('uint8array');
  if (dataPickle.byteLength > limits.maxDataPickleBytes) {
    throw new DomainValidationError(
      'TORCH_PICKLE_SIZE_LIMIT',
      'PyTorch data.pkl exceeds the configured size limit',
    );
  }

  const [byteorderText, versionText] = await Promise.all([
    zip.file('archive/byteorder').async('string'),
    zip.file('archive/version').async('string'),
  ]);
  const byteorder = byteorderText.trim();
  if (!['little', 'big'].includes(byteorder)) {
    throw new DomainValidationError(
      'TORCH_BYTEORDER_NOT_SUPPORTED',
      `Unsupported PyTorch byteorder ${byteorder}`,
    );
  }

  const root = readSafePickle(dataPickle, requestedLimits.pickle ?? {});
  const storageCache = new Map();
  let totalStorageBytes = 0;

  async function readStorage(key) {
    const normalizedKey = String(key);
    if (storageCache.has(normalizedKey)) return storageCache.get(normalizedKey);
    const entry = zip.file(`archive/data/${normalizedKey}`);
    if (!entry) {
      throw new DomainValidationError(
        'TORCH_STORAGE_MISSING',
        `PyTorch storage ${normalizedKey} is missing`,
      );
    }
    if ((entrySize(entry) ?? 0) > limits.maxStorageBytes) {
      throw new DomainValidationError(
        'TORCH_STORAGE_SIZE_LIMIT',
        `PyTorch storage ${normalizedKey} exceeds the configured size limit`,
      );
    }
    const bytes = await entry.async('uint8array');
    if (bytes.byteLength > limits.maxStorageBytes) {
      throw new DomainValidationError(
        'TORCH_STORAGE_SIZE_LIMIT',
        `PyTorch storage ${normalizedKey} exceeds the configured size limit`,
      );
    }
    totalStorageBytes += bytes.byteLength;
    if (totalStorageBytes > limits.maxTotalStorageBytes) {
      throw new DomainValidationError(
        'TORCH_TOTAL_STORAGE_SIZE_LIMIT',
        'Total decoded PyTorch storage exceeds the configured size limit',
      );
    }
    storageCache.set(normalizedKey, bytes);
    return bytes;
  }

  return {
    root,
    byteorder,
    version: versionText.trim(),
    limits,
    readStorage,
  };
}
