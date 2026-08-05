import { describe, expect, it } from 'vitest';
import { importMpdbBundle } from '../../src/importers/mpdb/importMpdbBundle.js';
import { buildLauraycsConfigFixtures } from '../fixtures/lauraycsConfigs.js';
import { buildOuterMpdbFixture } from '../helpers/buildMpdbFixture.js';

async function arbitraryNamedFiles(mpdbOptions = {}) {
  const { transmitterConfig, receiverConfig } = buildLauraycsConfigFixtures({ frameCount: 2 });
  return [
    { name: 'not-a-config-name.data', data: new TextEncoder().encode(JSON.stringify(receiverConfig)) },
    { name: 'also-renamed.bin', data: await buildOuterMpdbFixture(mpdbOptions) },
    { name: 'third-file.txt', data: new TextEncoder().encode(JSON.stringify(transmitterConfig)) },
  ];
}

describe('content-addressed MPDB bundle import', () => {
  it('imports three arbitrarily renamed files without filename fallback', async () => {
    const scenario = await importMpdbBundle(await arbitraryNamedFiles());

    expect(scenario.source.format).toBe('lauraycs-mpdb');
    expect(scenario.source.files.map((file) => file.role).sort()).toEqual([
      'mpdb',
      'receiver-config',
      'transmitter-config',
    ]);
    expect(scenario.scenarioId).toMatch(/^sha256:[a-f0-9]{64}$/);
    expect(scenario.time.frameCount).toBe(2);
    expect(scenario.rayTracing.delay_s).toBeInstanceOf(Float32Array);
  });

  it('produces the same scenario ID after filenames change', async () => {
    const first = await importMpdbBundle(await arbitraryNamedFiles());
    const renamed = (await arbitraryNamedFiles()).map((file, index) => ({
      ...file,
      name: `renamed-${index}`,
    }));
    const second = await importMpdbBundle(renamed);

    expect(second.scenarioId).toBe(first.scenarioId);
  });

  it('rejects mismatched node IDs instead of falling back to equal frame counts', async () => {
    await expect(importMpdbBundle(await arbitraryNamedFiles({
      receiverId: 'wrong-but-two-frames',
    }))).rejects.toMatchObject({ code: 'MPDB_LINK_ENTITY_MISMATCH' });
  });

  it('accepts the redundant ZIP64 footer emitted by PyTorch archives', async () => {
    const scenario = await importMpdbBundle(await arbitraryNamedFiles({ torchZip64: true }));

    expect(scenario.time.frameCount).toBe(2);
    expect(scenario.rayTracing.delay_s).toHaveLength(3);
  });

  it('reads entity IDs from Lauraycs platform metadata version 1', async () => {
    const scenario = await importMpdbBundle(await arbitraryNamedFiles({
      platformMetadata: true,
    }));

    expect(scenario.link).toMatchObject({
      transmitterId: '47641',
      receiverId: 'terminal-route-1785827004804',
    });
  });
});
