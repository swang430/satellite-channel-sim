import { describe, expect, it } from 'vitest';
import {
  collectScenarioTransferables,
  createImportState,
  runMpdbImportRequest,
  transitionImportState,
} from '../../src/workers/mpdbImportProtocol.js';
import { buildLauraycsConfigFixtures } from '../fixtures/lauraycsConfigs.js';
import { buildOuterMpdbFixture } from '../helpers/buildMpdbFixture.js';

describe('MPDB import worker protocol', () => {
  it('allows only the documented state transitions', () => {
    const parsing = transitionImportState(createImportState(), { type: 'START' });
    const validating = transitionImportState(parsing, { type: 'VALIDATE' });
    const ready = transitionImportState(validating, { type: 'READY', scenario: { scenarioId: 'x' } });

    expect([parsing.status, validating.status, ready.status]).toEqual([
      'parsing',
      'validating',
      'ready',
    ]);
    expect(() => transitionImportState(createImportState(), { type: 'READY' }))
      .toThrowError(expect.objectContaining({ code: 'MPDB_IMPORT_STATE_TRANSITION_INVALID' }));
  });

  it('requires progress to be monotonic and between zero and one', () => {
    const parsing = transitionImportState(createImportState(), { type: 'START' });
    const progressed = transitionImportState(parsing, { type: 'PROGRESS', progress: 0.4 });

    expect(progressed.progress).toBe(0.4);
    expect(() => transitionImportState(progressed, { type: 'PROGRESS', progress: 0.3 }))
      .toThrowError(expect.objectContaining({ code: 'MPDB_IMPORT_PROGRESS_INVALID' }));
    expect(() => transitionImportState(progressed, { type: 'PROGRESS', progress: 1.1 }))
      .toThrowError(expect.objectContaining({ code: 'MPDB_IMPORT_PROGRESS_INVALID' }));
  });

  it('collects unique typed-array buffers for zero-copy worker transfer', () => {
    const shared = new ArrayBuffer(32);
    const scenario = {
      rayTracing: {
        delay_s: new Float32Array(shared, 0, 4),
        hReal: new Float32Array(shared, 16, 4),
      },
      linkFrames: { frameId: new Int32Array([0, 1]) },
    };

    const transferables = collectScenarioTransferables(scenario);

    expect(transferables).toHaveLength(2);
    expect(transferables).toContain(shared);
    expect(transferables).toContain(scenario.linkFrames.frameId.buffer);
  });

  it('runs the production importer and emits parsing, validating, and ready events', async () => {
    const { transmitterConfig, receiverConfig } = buildLauraycsConfigFixtures({ frameCount: 2 });
    const encoder = new TextEncoder();
    const events = [];
    await runMpdbImportRequest({
      requestId: 'request-1',
      files: [
        { name: 'a', data: encoder.encode(JSON.stringify(transmitterConfig)).buffer },
        { name: 'b', data: encoder.encode(JSON.stringify(receiverConfig)).buffer },
        { name: 'c', data: (await buildOuterMpdbFixture()).buffer },
      ],
    }, (message, transferables = []) => events.push({ message, transferables }));

    expect(events.map(({ message }) => message.type)).toEqual([
      'PROGRESS',
      'VALIDATE',
      'READY',
    ]);
    expect(events[2].message.requestId).toBe('request-1');
    expect(events[2].message.scenario.time.frameCount).toBe(2);
    expect(events[2].transferables.length).toBeGreaterThan(0);
  });
});
