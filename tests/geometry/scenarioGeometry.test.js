import { describe, expect, it } from 'vitest';
import { scenarioFrameGeometry } from '../../src/geometry/scenarioGeometry.js';

function scenarioFixtureWithTracks() {
  return {
    time: { frameCount: 2 },
    transmitter: {
      track: [
        {
          frameId: 0,
          timestampUtc: '2026-08-05T00:00:00.000Z',
          projectedPosition_m: { x: 0, y: 0, z: 1_000 },
        },
        {
          frameId: 1,
          timestampUtc: '2026-08-05T00:00:01.000Z',
          projectedPosition_m: { x: 1_010, y: 0, z: 1_000 },
        },
      ],
    },
    receiver: {
      track: [
        {
          frameId: 0,
          projectedPosition_m: { x: 0, y: 0, z: 0 },
        },
        {
          frameId: 1,
          projectedPosition_m: { x: 10, y: 0, z: 0 },
        },
      ],
    },
  };
}

describe('scenario frame geometry', () => {
  it('uses the transmitter and receiver positions from the same MPDB frame', () => {
    const scenario = scenarioFixtureWithTracks();
    const first = scenarioFrameGeometry(scenario, 0);
    const second = scenarioFrameGeometry(scenario, 1);

    expect(first.receiverPosition_m).toEqual({ x: 0, y: 0, z: 0 });
    expect(second).toMatchObject({
      frameId: 1,
      timestampUtc: '2026-08-05T00:00:01.000Z',
      transmitterPosition_m: { x: 1_010, y: 0, z: 1_000 },
      receiverPosition_m: { x: 10, y: 0, z: 0 },
      slantRange_m: Math.hypot(1_000, 1_000),
      azimuth_deg: 90,
    });
    expect(second.elevation_deg).toBeCloseTo(45, 12);
  });

  it.each([
    ['missing', undefined],
    ['misaligned', { frameId: 7, projectedPosition_m: { x: 10, y: 0, z: 0 } }],
  ])('rejects a %s receiver point for the requested frame', (_label, receiverPoint) => {
    const scenario = scenarioFixtureWithTracks();
    scenario.receiver.track[1] = receiverPoint;

    expect(() => scenarioFrameGeometry(scenario, 1)).toThrowError(
      expect.objectContaining({ code: 'RECEIVER_TRACK_FRAME_MISSING' }),
    );
  });
});
