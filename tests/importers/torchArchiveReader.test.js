import JSZip from 'jszip';
import { describe, expect, it } from 'vitest';
import { readTorchArchive } from '../../src/importers/mpdb/torchArchiveReader.js';
import { buildMpdbFixture } from '../helpers/buildMpdbFixture.js';

describe('PyTorch archive reader', () => {
  it('reads metadata and exposes bounded storage access', async () => {
    const archive = await readTorchArchive(await buildMpdbFixture());

    expect(archive.byteorder).toBe('little');
    expect(archive.version).toBe('3');
    expect(archive.root.meta.route_link.transmitter.id).toBe('47641');
    expect((await archive.readStorage('0')).byteLength).toBe(24);
  });

  it('rejects a missing required archive member', async () => {
    const source = await JSZip.loadAsync(await buildMpdbFixture());
    source.remove('archive/data.pkl');
    const broken = await source.generateAsync({ type: 'uint8array', compression: 'STORE' });

    await expect(readTorchArchive(broken)).rejects.toMatchObject({
      code: 'TORCH_ARCHIVE_MEMBER_MISSING',
    });
  });

  it('enforces per-storage byte limits', async () => {
    const archive = await readTorchArchive(await buildMpdbFixture(), {
      maxStorageBytes: 8,
    });

    await expect(archive.readStorage('0')).rejects.toMatchObject({
      code: 'TORCH_STORAGE_SIZE_LIMIT',
    });
  });
});
