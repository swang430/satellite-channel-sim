import { describe, expect, it } from 'vitest';
import {
  receiverMotionAt,
  summarizeReceiverTrack,
} from '../../src/features/mpdb-import/receiverTrack.js';

function receiverTrack() {
  return [
    { frameId: 0, projectedPosition_m: { x: 0, y: 0, z: 0 } },
    { frameId: 1, projectedPosition_m: { x: 1, y: 0, z: 0 } },
    { frameId: 2, projectedPosition_m: { x: 1.05, y: 0, z: 0 } },
  ];
}

function twoPointTrack(startX_m, endX_m) {
  return [
    { frameId: 0, projectedPosition_m: { x: startX_m, y: 0, z: 0 } },
    { frameId: 1, projectedPosition_m: { x: endX_m, y: 0, z: 0 } },
  ];
}

describe('MPDB receiver track motion', () => {
  it('classifies initial, moving, and stationary frames', () => {
    const track = receiverTrack();

    expect(receiverMotionAt(track, 0)).toEqual({
      state: 'initial',
      displacement_m: 0,
    });
    expect(receiverMotionAt(track, 1)).toEqual({
      state: 'moving',
      displacement_m: 1,
    });
    expect(receiverMotionAt(track, 2)).toEqual({
      state: 'stationary',
      displacement_m: expect.closeTo(0.05),
    });
  });

  it('summarizes transitions without counting the initial frame', () => {
    expect(summarizeReceiverTrack(receiverTrack())).toMatchObject({
      frameCount: 3,
      movingFrameCount: 1,
      stationaryFrameCount: 1,
      totalDistance_m: expect.closeTo(1.05),
      start: receiverTrack()[0],
      end: receiverTrack()[2],
    });
  });

  it('treats displacement equal to the threshold as stationary', () => {
    expect(receiverMotionAt(receiverTrack(), 1, { stationaryThreshold_m: 1 })).toEqual({
      state: 'stationary',
      displacement_m: 1,
    });
  });

  it.each([
    ['small coordinates', 1, 1.1],
    ['large projected coordinates', 1_000_000, 1_000_000.1],
  ])('stabilizes the 0.1 m threshold at %s', (_label, startX_m, endX_m) => {
    const track = twoPointTrack(startX_m, endX_m);

    expect(receiverMotionAt(track, 1)).toMatchObject({
      state: 'stationary',
      displacement_m: expect.closeTo(0.1),
    });
    expect(summarizeReceiverTrack(track)).toMatchObject({
      movingFrameCount: 0,
      stationaryFrameCount: 1,
    });
  });

  it.each([1, 1_000_000])(
    'does not hide a 0.1001 m displacement from coordinate origin %s',
    (startX_m) => {
      expect(receiverMotionAt(twoPointTrack(startX_m, startX_m + 0.1001), 1)).toMatchObject({
        state: 'moving',
        displacement_m: expect.closeTo(0.1001),
      });
    },
  );

  it('does not hide real movement when the threshold is zero', () => {
    expect(receiverMotionAt(twoPointTrack(1, 1 + 1e-9), 1, {
      stationaryThreshold_m: 0,
    })).toMatchObject({
      state: 'moving',
      displacement_m: expect.closeTo(1e-9),
    });
  });

  it.each([
    [null, 0],
    [[], 0],
    [Array(1), 0],
    [[{ frameId: 1, projectedPosition_m: { x: 0, y: 0, z: 0 } }], 0],
    [[{ frameId: 0, projectedPosition_m: { x: Number.NaN, y: 0, z: 0 } }], 0],
    [[{ frameId: 0, projectedPosition_m: { x: 0, y: 0 } }], 0],
    [receiverTrack(), -1],
    [receiverTrack(), 3],
    [receiverTrack(), 0.5],
  ])('rejects an invalid track or frame index', (track, frameIndex) => {
    expect(() => receiverMotionAt(track, frameIndex)).toThrowError(
      expect.objectContaining({ code: 'RECEIVER_TRACK_INVALID' }),
    );
  });

  it.each([Number.NaN, Number.POSITIVE_INFINITY, -0.1])(
    'rejects invalid stationary threshold %s',
    (stationaryThreshold_m) => {
      expect(() => summarizeReceiverTrack(receiverTrack(), {
        stationaryThreshold_m,
      })).toThrowError(expect.objectContaining({ code: 'RECEIVER_TRACK_INVALID' }));
    },
  );
});
