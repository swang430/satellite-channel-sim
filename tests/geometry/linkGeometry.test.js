import { describe, expect, it } from 'vitest';
import {
  groundPositionEcf,
} from '../../src/geometry/linkGeometry.js';
import { scenarioFrameGeometry } from '../../src/geometry/scenarioGeometry.js';
import { predictLinkStateNow } from '../../src/oracleCore.js';

describe('shared link geometry', () => {
  it('converts ground altitude from metres to satellite.js kilometres exactly once', () => {
    const position = groundPositionEcf({
      latitude_deg: 0,
      longitude_deg: 0,
      altitude_m: 1_000,
    });

    expect(position.x).toBeCloseTo(6_379.137, 3);
    expect(position.y).toBeCloseTo(0, 9);
    expect(position.z).toBeCloseTo(0, 9);
  });

  it('uses scenario coordinates and the user-selected static point without SGP4', () => {
    const scenario = {
      time: { frameCount: 2 },
      transmitter: {
        track: [
          { timestampUtc: '2026-08-05T00:00:00.000Z', projectedPosition_m: { x: 0, y: 0, z: 1_000 } },
          { timestampUtc: '2026-08-05T00:00:01.000Z', projectedPosition_m: { x: 1_000, y: 0, z: 1_000 } },
        ],
      },
      groundSelection: {
        selectedFrameId: 0,
        selectedBy: 'user',
        projectedPosition_m: { x: 0, y: 0, z: 0 },
      },
    };

    const geometry = scenarioFrameGeometry(scenario, 1);
    expect(geometry).toMatchObject({
      frameId: 1,
      timestampUtc: '2026-08-05T00:00:01.000Z',
      source: 'scenario-coordinates',
      slantRange_m: Math.hypot(1_000, 1_000),
      azimuth_deg: 90,
      transmitterPosition_m: { x: 1_000, y: 0, z: 1_000 },
      receiverPosition_m: { x: 0, y: 0, z: 0 },
    });
    expect(geometry.elevation_deg).toBeCloseTo(45, 12);
  });

  it('returns no current contact when the nearest frame is at or below the horizon', () => {
    const now = new Date('2026-08-05T00:00:00.000Z');
    let providerCalled = false;
    const result = predictLinkStateNow(
      { tleLine1: 'unused', tleLine2: 'unused' },
      0,
      0,
      0,
      {},
      {
        now,
        timelineProvider: () => {
          providerCalled = true;
          return [{ time: now, elevation: 0 }];
        },
      },
    );

    expect(providerCalled).toBe(true);
    expect(result).toBeNull();
  });
});
