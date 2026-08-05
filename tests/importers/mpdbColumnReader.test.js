import { describe, expect, it } from 'vitest';
import { readTorchArchive } from '../../src/importers/mpdb/torchArchiveReader.js';
import { readMpdbColumns } from '../../src/importers/mpdb/mpdbColumnReader.js';
import { buildMpdbFixture } from '../helpers/buildMpdbFixture.js';

describe('MPDB column reader', () => {
  it('decodes typed columns, complex H, and frame offsets', async () => {
    const result = await readMpdbColumns(
      await readTorchArchive(await buildMpdbFixture()),
    );

    expect(result.frameCount).toBe(2);
    expect(result.rayCount).toBe(3);
    expect(result.rayTracing.linkId).toBeInstanceOf(Int32Array);
    expect(result.rayTracing.channelType).toBeInstanceOf(Int16Array);
    expect(result.rayTracing.delay_s).toBeInstanceOf(Float32Array);
    expect(result.rayTracing.hReal).toEqual(new Float32Array([1, 0.5, 0.25]));
    expect(result.rayTracing.hImag).toEqual(new Float32Array([0, -0.5, 0.75]));
    expect(result.rayTracing.frameOffsets).toEqual(new Uint32Array([0, 2, 3]));
    expect(result.linkFrames.frequency_Hz).toEqual(new Float64Array([
      24_950_000_000,
      24_950_000_000,
    ]));
    expect(result.linkFrames.txPosition_m).toHaveLength(6);
  });

  it('rejects missing required channel columns', async () => {
    const archive = await readTorchArchive(await buildMpdbFixture({ omitColumn: 'DELAY' }));

    await expect(readMpdbColumns(archive)).rejects.toMatchObject({
      code: 'MPDB_COLUMN_MISSING',
    });
  });

  it('rejects storage byte lengths inconsistent with tensor metadata', async () => {
    const archive = await readTorchArchive(await buildMpdbFixture({ corruptStorageKey: '2' }));

    await expect(readMpdbColumns(archive)).rejects.toMatchObject({
      code: 'TORCH_STORAGE_LENGTH_MISMATCH',
    });
  });

  it('rejects non-monotonic channel link IDs', async () => {
    const archive = await readTorchArchive(await buildMpdbFixture({ linkIds: [0, 1, 0] }));

    await expect(readMpdbColumns(archive)).rejects.toMatchObject({
      code: 'MPDB_LINK_ID_NOT_MONOTONIC',
    });
  });
});
