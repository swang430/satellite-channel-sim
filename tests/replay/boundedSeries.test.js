import { describe, expect, it } from 'vitest';
import { appendBounded } from '../../src/replay/boundedSeries.js';

describe('bounded series', () => {
  it('drops the oldest values after reaching its limit', () => {
    expect(appendBounded([1, 2, 3], 4, 3)).toEqual([2, 3, 4]);
  });

  it('rejects a non-positive limit', () => {
    expect(() => appendBounded([], 1, 0)).toThrow(/limit/i);
  });
});
