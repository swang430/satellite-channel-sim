import { describe, expect, it } from 'vitest';
import {
  canCompareScenario,
  selectGroundFrame,
  suggestGroundFrames,
} from '../../src/features/mpdb-import/groundSelection.js';

function scenarioFixture() {
  return {
    time: { frameCount: 3 },
    groundSelection: null,
    comparisonRevision: 0,
    groundCandidates: [
      {
        frameId: 0,
        timestampUtc: '2026-08-05T00:00:00.000Z',
        longitude_deg: 109,
        latitude_deg: 34,
        altitude_m: 390,
        projectedPosition_m: { x: 1, y: 2, z: 3 },
      },
      {
        frameId: 1,
        timestampUtc: '2026-08-05T00:00:01.000Z',
        longitude_deg: 109.0001,
        latitude_deg: 34.0001,
        altitude_m: 390,
        projectedPosition_m: { x: 1.03, y: 2.04, z: 3 },
      },
      {
        frameId: 2,
        timestampUtc: '2026-08-05T00:00:02.000Z',
        longitude_deg: 109.01,
        latitude_deg: 34.01,
        altitude_m: 390,
        projectedPosition_m: { x: 11, y: 12, z: 3 },
      },
    ],
  };
}

describe('explicit MPDB ground-frame selection', () => {
  it('does not allow comparison before the user confirms a frame', () => {
    expect(canCompareScenario(scenarioFixture())).toBe(false);
  });

  it('accepts frame zero and calculates mismatch against every frame', () => {
    const selected = selectGroundFrame(scenarioFixture(), 0, {
      selectedAtUtc: '2026-08-05T01:00:00.000Z',
      matchTolerance_m: 0.1,
    });

    expect(selected.groundSelection).toMatchObject({
      selectedFrameId: 0,
      selectedBy: 'user',
      groundPosition: {
        longitude_deg: 109,
        latitude_deg: 34,
        altitude_m: 390,
      },
      exactMatchFrameCount: 2,
    });
    const mismatches = selected.groundCandidates.map(
      (candidate) => candidate.groundPositionMismatch_m,
    );
    expect(mismatches[0]).toBe(0);
    expect(mismatches[1]).toBeCloseTo(0.05);
    expect(mismatches[2]).toBeCloseTo(Math.hypot(10, 10));
    expect(selected.comparisonRevision).toBe(1);
    expect(canCompareScenario(selected)).toBe(true);
  });

  it('increments comparison revision only when the selected frame changes', () => {
    const first = selectGroundFrame(scenarioFixture(), 0);
    const unchanged = selectGroundFrame(first, 0);
    const changed = selectGroundFrame(unchanged, 2);

    expect(unchanged.comparisonRevision).toBe(1);
    expect(changed.comparisonRevision).toBe(2);
  });

  it('returns stable-frame suggestions without selecting one', () => {
    const scenario = scenarioFixture();
    const suggestions = suggestGroundFrames(scenario, { stabilityRadius_m: 0.1 });

    expect(suggestions[0]).toMatchObject({ frameId: 0, nearbyFrameCount: 2 });
    expect(scenario.groundSelection).toBeNull();
  });
});
