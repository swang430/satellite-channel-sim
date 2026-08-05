export const DEFAULT_MPDB_LIMITS = Object.freeze({
  maxArchiveEntries: 20_000,
  maxDataPickleBytes: 128 * 1024 * 1024,
  maxStorageBytes: 512 * 1024 * 1024,
  maxTotalStorageBytes: 1024 * 1024 * 1024,
  maxFrames: 1_000_000,
  maxRays: 20_000_000,
});
