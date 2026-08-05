import { describe, expect, it, vi } from 'vitest';
import { createReplayController } from '../../src/features/replay/useChannelReplay.js';

function fakeTimers() {
  let callback = null;
  return {
    setIntervalFn: vi.fn((next) => { callback = next; return 7; }),
    clearIntervalFn: vi.fn(() => { callback = null; }),
    tick: () => callback?.(),
  };
}

describe('replay controller lifecycle', () => {
  it('loads replay data and never creates duplicate timers', () => {
    const timers = fakeTimers();
    const emitted = [];
    const controller = createReplayController({
      ...timers,
      onFrame: (frame) => emitted.push(frame),
    });
    controller.load([{ frameId: 0 }, { frameId: 1 }]);
    controller.start(1000);
    controller.start(1000);
    timers.tick();

    expect(timers.setIntervalFn).toHaveBeenCalledTimes(1);
    expect(emitted).toEqual([{ frameId: 0 }]);
  });

  it('clears the timer on stop, completion, and dispose', () => {
    const timers = fakeTimers();
    const controller = createReplayController({ ...timers });
    controller.load([{ frameId: 0 }]);
    controller.start(1000);
    timers.tick();
    timers.tick();
    controller.stop();
    controller.dispose();

    expect(timers.clearIntervalFn).toHaveBeenCalled();
    expect(controller.getState().status).toBe('disposed');
  });
});
