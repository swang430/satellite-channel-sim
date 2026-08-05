import { describe, expect, it } from 'vitest';
import { parseReplayJson } from '../../src/replay/replaySchema.js';

describe('replay schema', () => {
  it('normalizes metric frames with ChannelFrame-compatible identity and provenance', () => {
    const result = parseReplayJson(JSON.stringify({
      frames: [{
        frameId: 0,
        timestampUtc: '2026-08-05T00:00:00.000Z',
        observation: { rainRate_mmph: 2.5 },
        derived: { rainAttenuation_dB: 0.4 },
      }],
    }));

    expect(result.frames[0]).toMatchObject({
      frameId: 0,
      timestampUtc: '2026-08-05T00:00:00.000Z',
      metrics: {
        observation: { rainRate_mmph: 2.5, source: 'observed-input' },
        derived: { rainAttenuation_dB: 0.4, source: 'synthetic-derived' },
      },
      provenance: { source: 'replay-file' },
    });
  });

  it('rejects invalid timestamps and non-finite metrics', () => {
    expect(() => parseReplayJson(JSON.stringify({ frames: [{
      timestampUtc: 'bad', observation: { rainRate_mmph: 1 },
    }] }))).toThrow(/timestamp/i);
    expect(() => parseReplayJson(JSON.stringify({ frames: [{
      timestampUtc: '2026-08-05T00:00:00Z', observation: { rainRate_mmph: 'NaN' },
    }] }))).toThrow(/rainRate_mmph/i);
  });

  it('marks legacy measuredLoss as derived instead of measurement', () => {
    const result = parseReplayJson(JSON.stringify([{
      timestamp: '2026-08-05T00:00:00Z',
      rainRate: 3,
      measuredLoss: 0.8,
    }]));
    expect(result.frames[0].metrics.derived).toMatchObject({
      rainAttenuation_dB: 0.8,
      source: 'synthetic-derived',
    });
    expect(result.diagnostics).toContainEqual(expect.objectContaining({
      code: 'LEGACY_LOSS_ASSUMED_DERIVED',
    }));
  });
});
