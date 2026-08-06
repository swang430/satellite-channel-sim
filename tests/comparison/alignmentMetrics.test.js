import { describe, expect, it } from 'vitest';
import { calculateChannelMetrics } from '../../src/channel/channelMetrics.js';
import { buildPdp } from '../../src/channel/pdp.js';
import {
  comparePdpMetrics,
  summarizeRtPathStatistics,
  summarizeRtWindowRelativeGain,
} from '../../src/comparison/comparisonMetrics.js';

function rtPdpFrame(paths) {
  const pdp = buildPdp(paths, { bandwidth_Hz: 100e6 });
  return { pdp, metrics: calculateChannelMetrics(pdp) };
}

function singlePathFrame(amplitude) {
  return rtPdpFrame([{
    absoluteDelay_s: 0,
    complexAmplitude: { real: amplitude, imag: 0 },
  }]);
}

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

  it('summarizes terminal-effective RT Doppler without collapsing its spread', () => {
    const result = summarizeRtPathStatistics({
      hReal: new Float32Array([1, 2]),
      hImag: new Float32Array([0, 0]),
      doppler_Hz: new Float32Array([100, 300]),
      aoa_deg: new Float32Array([0, 90]),
      aod_deg: new Float32Array([10, 30]),
      channelType: new Int16Array([1, 2]),
    });

    expect(result.dopplerCentroid_Hz).toBe(260);
    expect(result.dopplerRmsSpread_Hz).toBe(80);
    expect(result.dominantPathDoppler_Hz).toBe(300);
    expect(result.dominantPathPowerShare).toBe(0.8);
    expect(result.dopplerMin_Hz).toBe(100);
    expect(result.dopplerMax_Hz).toBe(300);
    expect(result.dopplerMethod).toBe('noncoherent-path-power-weighted');
  });

  it('computes RT gain relative to the window peak and first frame', () => {
    const result = summarizeRtWindowRelativeGain([
      singlePathFrame(1),
      singlePathFrame(2),
      singlePathFrame(0.5),
    ]);

    expect(result).toEqual([
      {
        status: 'available',
        totalPower_linear: 1,
        relativeToWindowPeak_dB: expect.closeTo(-10 * Math.log10(4), 12),
        relativeToFirstFrame_dB: 0,
      },
      {
        status: 'available',
        totalPower_linear: 4,
        relativeToWindowPeak_dB: 0,
        relativeToFirstFrame_dB: expect.closeTo(10 * Math.log10(4), 12),
      },
      {
        status: 'available',
        totalPower_linear: 0.25,
        relativeToWindowPeak_dB: expect.closeTo(10 * Math.log10(0.25 / 4), 12),
        relativeToFirstFrame_dB: expect.closeTo(10 * Math.log10(0.25), 12),
      },
    ]);
  });

  it('uses coherent power within delay bins and sums power across bins', () => {
    const combinedFrame = rtPdpFrame([
      { absoluteDelay_s: 0, complexAmplitude: { real: 1, imag: 0 } },
      { absoluteDelay_s: 4e-9, complexAmplitude: { real: -1, imag: 0 } },
      { absoluteDelay_s: 20e-9, complexAmplitude: { real: 2, imag: 0 } },
    ]);

    const result = summarizeRtWindowRelativeGain([
      combinedFrame,
      singlePathFrame(1),
    ]);

    expect(combinedFrame.pdp.bins).toEqual([
      expect.objectContaining({
        pathCount: 2,
        coherentPower_linear: 0,
        noncoherentPower_linear: 2,
      }),
      expect.objectContaining({
        pathCount: 1,
        coherentPower_linear: 4,
        noncoherentPower_linear: 4,
      }),
    ]);
    expect(result[0]).toMatchObject({
      totalPower_linear: 4,
      relativeToWindowPeak_dB: 0,
      relativeToFirstFrame_dB: 0,
    });
    expect(result[1]).toMatchObject({
      totalPower_linear: 1,
      relativeToWindowPeak_dB: expect.closeTo(-10 * Math.log10(4), 12),
      relativeToFirstFrame_dB: expect.closeTo(-10 * Math.log10(4), 12),
    });
  });

  it('rejects RT frame metrics that do not match coherent PDP power', () => {
    const frame = singlePathFrame(1);
    frame.metrics = { ...frame.metrics, totalPower_linear: 2 };

    expect(() => summarizeRtWindowRelativeGain([frame])).toThrowError(
      expect.objectContaining({ code: 'RT_WINDOW_METRICS_MISMATCH' }),
    );
  });

  it('marks zero RT power as unavailable without non-finite values', () => {
    const pathStatistics = summarizeRtPathStatistics({
      hReal: new Float32Array([0, 0]),
      hImag: new Float32Array([0, 0]),
      doppler_Hz: new Float32Array([100, 300]),
      aoa_deg: new Float32Array([0, 90]),
      aod_deg: new Float32Array([10, 30]),
      channelType: new Int16Array([1, 2]),
    });
    const relativeGain = summarizeRtWindowRelativeGain([
      singlePathFrame(0),
      singlePathFrame(0),
    ]);

    expect(pathStatistics).toMatchObject({
      status: 'unavailable',
      reason: 'ZERO_TOTAL_PATH_POWER',
      meanAoa_deg: null,
      meanAod_deg: null,
      meanDoppler_Hz: null,
      dopplerCentroid_Hz: null,
      dopplerRmsSpread_Hz: null,
      dominantPathDoppler_Hz: null,
      dominantPathPowerShare: null,
      dopplerMin_Hz: null,
      dopplerMax_Hz: null,
    });
    expect(relativeGain).toEqual([
      {
        status: 'unavailable',
        reason: 'ZERO_TOTAL_POWER',
        totalPower_linear: 0,
      },
      {
        status: 'unavailable',
        reason: 'ZERO_TOTAL_POWER',
        totalPower_linear: 0,
      },
    ]);
    const numericValues = [pathStatistics, ...relativeGain]
      .flatMap((value) => Object.values(value))
      .filter((value) => typeof value === 'number');
    expect(numericValues.every(Number.isFinite)).toBe(true);
  });

  it('uses the first finite positive RT frame as the relative gain reference', () => {
    const result = summarizeRtWindowRelativeGain([
      singlePathFrame(0),
      singlePathFrame(1),
      singlePathFrame(2),
    ]);

    expect(result).toEqual([
      {
        status: 'unavailable',
        reason: 'ZERO_TOTAL_POWER',
        totalPower_linear: 0,
      },
      {
        status: 'available',
        totalPower_linear: 1,
        relativeToWindowPeak_dB: expect.closeTo(-10 * Math.log10(4), 12),
        relativeToFirstFrame_dB: 0,
      },
      {
        status: 'available',
        totalPower_linear: 4,
        relativeToWindowPeak_dB: 0,
        relativeToFirstFrame_dB: expect.closeTo(10 * Math.log10(4), 12),
      },
    ]);
  });

  it('marks finite amplitude overflow and non-finite window power unavailable', () => {
    const pathStatistics = summarizeRtPathStatistics({
      hReal: [Number.MAX_VALUE],
      hImag: [0],
      doppler_Hz: [100],
      aoa_deg: [0],
      aod_deg: [10],
      channelType: [1],
    });
    const invalidPdp = {
      binWidth_s: 10e-9,
      aggregation: 'coherent-complex-sum',
      bins: [{
        binIndex: 0,
        excessDelay_s: 0,
        coherentPower_linear: Number.POSITIVE_INFINITY,
      }],
    };
    const relativeGain = summarizeRtWindowRelativeGain([{
      pdp: invalidPdp,
      metrics: calculateChannelMetrics(invalidPdp),
    }]);

    expect(pathStatistics).toMatchObject({
      status: 'unavailable',
      reason: 'NON_FINITE_PATH_POWER',
      dopplerCentroid_Hz: null,
      dopplerRmsSpread_Hz: null,
    });
    expect(relativeGain).toEqual([{
      status: 'unavailable',
      reason: 'INVALID_TOTAL_POWER',
      totalPower_linear: null,
    }]);
    const numericValues = Object.values(pathStatistics)
      .filter((value) => typeof value === 'number');
    expect(numericValues.every(Number.isFinite)).toBe(true);
  });

  it('rejects empty or inconsistent RT ray arrays', () => {
    expect(() => summarizeRtPathStatistics({
      hReal: new Float32Array([]),
      hImag: new Float32Array([]),
      doppler_Hz: new Float32Array([]),
      aoa_deg: new Float32Array([]),
      aod_deg: new Float32Array([]),
      channelType: new Int16Array([]),
    })).toThrowError(expect.objectContaining({ code: 'RT_PATH_STATISTICS_EMPTY' }));

    expect(() => summarizeRtPathStatistics({
      hReal: new Float32Array([1, 2]),
      hImag: new Float32Array([0]),
      doppler_Hz: new Float32Array([100, 300]),
      aoa_deg: new Float32Array([0, 90]),
      aod_deg: new Float32Array([10, 30]),
      channelType: new Int16Array([1, 2]),
    })).toThrowError(expect.objectContaining({ code: 'RT_PATH_ARRAY_LENGTH_MISMATCH' }));
  });
});
