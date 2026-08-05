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

  it.each([
    ['missing', undefined],
    ['misaligned', {
      frameId: 7,
      timestampUtc: '2026-08-05T00:00:01.000Z',
      projectedPosition_m: { x: 1_010, y: 0, z: 1_000 },
    }],
  ])('rejects a %s transmitter point for the requested frame', (_label, transmitterPoint) => {
    const scenario = scenarioFixtureWithTracks();
    scenario.transmitter.track[1] = transmitterPoint;

    expect(() => scenarioFrameGeometry(scenario, 1)).toThrowError(
      expect.objectContaining({ code: 'TRANSMITTER_TRACK_FRAME_MISSING' }),
    );
  });

  it.each([
    ['transmitter', 'TRANSMITTER_TRACK_POSITION_INVALID', (scenario) => {
      scenario.transmitter.track[1].projectedPosition_m.x = Number.NaN;
    }],
    ['receiver', 'RECEIVER_TRACK_POSITION_INVALID', (scenario) => {
      scenario.receiver.track[1].projectedPosition_m.z = undefined;
    }],
  ])('rejects non-finite %s projected coordinates', (_label, code, corrupt) => {
    const scenario = scenarioFixtureWithTracks();
    corrupt(scenario);

    expect(() => scenarioFrameGeometry(scenario, 1)).toThrowError(
      expect.objectContaining({ code }),
    );
  });

  it('returns position snapshots that cannot mutate the scenario tracks', () => {
    const scenario = scenarioFixtureWithTracks();
    const geometry = scenarioFrameGeometry(scenario, 1);

    expect(geometry.transmitterPosition_m).not.toBe(
      scenario.transmitter.track[1].projectedPosition_m,
    );
    expect(geometry.receiverPosition_m).not.toBe(
      scenario.receiver.track[1].projectedPosition_m,
    );
    geometry.transmitterPosition_m.x = -1;
    geometry.receiverPosition_m.x = -2;

    expect(scenario.transmitter.track[1].projectedPosition_m.x).toBe(1_010);
    expect(scenario.receiver.track[1].projectedPosition_m.x).toBe(10);
  });
});
