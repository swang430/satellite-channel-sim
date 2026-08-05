import { describe, expect, it } from 'vitest';
import { buildComparisonPlotData } from '../../src/features/channel-comparison/comparisonViewModel.js';

describe('comparison panel data', () => {
  it('builds RT and statistical percentile overlay series in relative dB', () => {
    const data = buildComparisonPlotData({
      rt: { pdp: { bins: [{ excessDelay_s: 0, relativePower_dB: 0 }] } },
      statistical: {
        excessDelay_s: [0, 10e-9],
        summary: { median: [1, 0.1], p5: [0.5, 0.05], p95: [1, 0.2] },
      },
    });

    expect(data.rt).toEqual([{ x: 0, y: 0 }]);
    expect(data.statisticalMedian).toEqual([{ x: 0, y: 0 }, { x: 10, y: -10 }]);
    expect(data.statisticalP5[0].y).toBeCloseTo(-3.0103, 3);
    expect(data.statisticalP95[1].y).toBeCloseTo(-6.9897, 3);
  });
});

