import { describe, expect, it } from 'vitest';
import {
  comparePdpMetrics,
  summarizeRtPathStatistics,
} from '../../src/comparison/comparisonMetrics.js';

describe('comparison alignment and metrics', () => {
  it('computes hand-checkable PDP divergence and weighted delay distance', () => {
    const first = {
      binWidth_s: 10e-9,
      bins: [
        { binIndex: 0, excessDelay_s: 0, coherentPower_linear: 1 },
        { binIndex: 1, excessDelay_s: 10e-9, coherentPower_linear: 0 },
      ],
    };
    const second = {
      binWidth_s: 10e-9,
      bins: [
        { binIndex: 0, excessDelay_s: 0, coherentPower_linear: 0 },
        { binIndex: 1, excessDelay_s: 10e-9, coherentPower_linear: 1 },
      ],
    };
    const metrics = comparePdpMetrics(first, second);

    expect(metrics.jsDivergence_bits).toBeCloseTo(1, 12);
    expect(metrics.weightedDelayDistance_s).toBeCloseTo(10e-9, 12);
  });

  it('power-weights angle and Doppler statistics without inventing channel labels', () => {
    const statistics = summarizeRtPathStatistics({
      hReal: new Float32Array([1, 1]),
      hImag: new Float32Array([0, 0]),
      aoa_deg: new Float32Array([0, 90]),
      aod_deg: new Float32Array([10, 30]),
      doppler_Hz: new Float32Array([100, 300]),
      channelType: new Int16Array([7, 99]),
    });

    expect(statistics.meanAoa_deg).toBeCloseTo(45, 10);
    expect(statistics.meanAod_deg).toBeCloseTo(20, 10);
    expect(statistics.meanDoppler_Hz).toBe(200);
    expect(statistics.rawChannelTypes).toEqual([7, 99]);
    expect(statistics).not.toHaveProperty('channelTypeLabels');
  });
});
