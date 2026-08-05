import { describe, expect, it } from 'vitest';
import { createChannelFrame } from '../../src/domain/channelFrame.js';

describe('ChannelFrame contract', () => {
  it('creates a frame with explicit geometry, CIR, PDP, and provenance', () => {
    const frame = createChannelFrame({
      frameId: 0,
      timestampUtc: '2026-08-03T17:36:50.000Z',
      geometry: {
        slantRange_m: 948_170.625,
        elevation_deg: 14.385,
        azimuth_deg: 258.485,
        geometryMatch: 'exact',
        groundPositionMismatch_m: 0,
      },
      cir: { taps: [], delayReference: 'earliest-path', delayResolution_s: 1e-8 },
      pdp: { bins: [], normalization: 'peak-0-dB' },
      provenance: { source: 'ray-tracing', scenarioId: 'sha256:test' },
    });

    expect(frame.frameId).toBe(0);
    expect(frame.geometry.groundPositionMismatch_m).toBe(0);
    expect(frame.provenance.source).toBe('ray-tracing');
  });

  it('rejects missing or unitless geometry fields', () => {
    expect(() => createChannelFrame({
      frameId: 1,
      timestampUtc: '2026-08-03T17:36:51.000Z',
      geometry: { slantRange: 948 },
      cir: { taps: [], delayReference: 'earliest-path', delayResolution_s: 1e-8 },
      pdp: { bins: [], normalization: 'peak-0-dB' },
      provenance: { source: 'statistical', scenarioId: 'sha256:test' },
    })).toThrowError(expect.objectContaining({ code: 'INVALID_CHANNEL_FRAME' }));
  });
});
