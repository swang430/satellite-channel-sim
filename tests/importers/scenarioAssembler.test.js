import { describe, expect, it } from 'vitest';
import {
  assembleMpdbScenario,
  resolveAuthoritativeFrequency,
} from '../../src/importers/mpdb/scenarioAssembler.js';
import { readMpdbColumns } from '../../src/importers/mpdb/mpdbColumnReader.js';
import { readTorchArchive } from '../../src/importers/mpdb/torchArchiveReader.js';
import { adaptLauraycsConfigs } from '../../src/importers/mpdb/lauraycsConfigAdapter.js';
import { buildLauraycsConfigFixtures } from '../fixtures/lauraycsConfigs.js';
import { buildMpdbFixture } from '../helpers/buildMpdbFixture.js';

async function inputs() {
  const config = adaptLauraycsConfigs(Object.values(
    buildLauraycsConfigFixtures({ frameCount: 2 }),
  ));
  const mpdb = await readMpdbColumns(await readTorchArchive(await buildMpdbFixture()));
  return { config, mpdb };
}

describe('MPDB scenario assembler', () => {
  it('links entity IDs, frames, coordinates, and authoritative MPDB frequency', async () => {
    const { config, mpdb } = await inputs();
    const scenario = assembleMpdbScenario({ config, mpdb, sourceFiles: [] });

    expect(scenario.link.transmitterId).toBe('47641');
    expect(scenario.time.frameCount).toBe(2);
    expect(scenario.carrier.frequency_Hz).toBe(24_950_000_000);
    expect(scenario.coordinateReference.localOrigin_m).toEqual({
      x: 360_000,
      y: 3_980_000,
      z: 0,
    });
    expect(scenario.coordinateReference.alignmentRmsResidual_m).toBeLessThan(1e-6);
    expect(scenario.receiver.track).toHaveLength(2);
    expect(scenario.receiver.track[0]).toEqual(expect.objectContaining({
      frameId: 0,
      projectedPosition_m: expect.objectContaining({
        x: expect.any(Number),
        y: expect.any(Number),
        z: expect.any(Number),
      }),
    }));
    expect(scenario).not.toHaveProperty('groundSelection');
    expect(scenario).not.toHaveProperty('groundCandidates');
    expect(scenario.diagnostics.warnings).toEqual(expect.arrayContaining([
      expect.objectContaining({ code: 'CONFIG_FREQUENCY_CONFLICT' }),
    ]));
  });

  it('rejects an MPDB transmitter or receiver that does not match config content', async () => {
    const config = adaptLauraycsConfigs(Object.values(
      buildLauraycsConfigFixtures({ frameCount: 2 }),
    ));
    const mpdb = await readMpdbColumns(await readTorchArchive(await buildMpdbFixture({
      receiverId: 'different-terminal',
    })));

    expect(() => assembleMpdbScenario({ config, mpdb, sourceFiles: [] })).toThrowError(
      expect.objectContaining({ code: 'MPDB_LINK_ENTITY_MISMATCH' }),
    );
  });

  it('rejects inconsistent MPDB frame frequencies', async () => {
    const { config } = await inputs();
    const mpdb = await readMpdbColumns(await readTorchArchive(await buildMpdbFixture({
      frequencies_Hz: [24_950_000_000, 25_000_000_000],
    })));

    expect(() => assembleMpdbScenario({ config, mpdb, sourceFiles: [] })).toThrowError(
      expect.objectContaining({ code: 'MPDB_FRAME_FREQUENCY_MISMATCH' }),
    );
  });

  it('refuses to choose among conflicting config frequencies when MPDB has none', () => {
    expect(() => resolveAuthoritativeFrequency(null, [
      { source: 'a', frequency_Hz: 25_000_000_000 },
      { source: 'b', frequency_Hz: 2_500_000_000 },
    ])).toThrowError(expect.objectContaining({ code: 'CONFIG_FREQUENCY_AMBIGUOUS' }));
  });

  it('rejects coordinate alignment residuals above the configured tolerance', async () => {
    const { config, mpdb } = await inputs();
    mpdb.linkFrames.txPosition_m[3] += 1;

    expect(() => assembleMpdbScenario({
      config,
      mpdb,
      sourceFiles: [],
      alignmentTolerance_m: 0.1,
    })).toThrowError(expect.objectContaining({ code: 'MPDB_COORDINATE_ALIGNMENT_FAILED' }));
  });
});
