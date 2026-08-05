import { describe, expect, it } from 'vitest';
import { summarizeModcodTimeline } from '../../src/panels/apiDashboardModel.js';

describe('API dashboard model', () => {
  it('returns an explicit empty state for an empty MODCOD timeline', () => {
    expect(summarizeModcodTimeline([])).toEqual({ status: 'empty', best: null });
  });

  it('ignores outage samples when selecting the best MODCOD', () => {
    expect(summarizeModcodTimeline([
      { status: 'outage', spectralEfficiency_bpsHz: null },
      { status: 'available', spectralEfficiency_bpsHz: 1.2 },
    ])).toEqual({
      status: 'available',
      best: { status: 'available', spectralEfficiency_bpsHz: 1.2 },
    });
  });
});
