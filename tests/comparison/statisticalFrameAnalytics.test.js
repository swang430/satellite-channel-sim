import { describe, expect, it } from 'vitest';
import { calculateLinkBudget } from '../../src/model.js';
import { buildStatisticalFrameAnalytics } from '../../src/comparison/statisticalFrameAnalytics.js';

const CARRIER = { frequency_Hz: 25e9, bandwidth_Hz: 100e6 };
const GEOMETRY = { elevation_deg: 30, slantRange_m: 700_000 };

function build(overrides = {}) {
  return buildStatisticalFrameAnalytics({
    carrier: CARRIER,
    geometry: GEOMETRY,
    linkParameters: {
      freq: 99,
      bandwidth: 1,
      elevation: 80,
      slantRange: 1,
      eirp: 60,
      gRx: 42,
      tRx: 150,
      rainRate: 5,
      env: 'suburban',
      tec: 50,
      isPhasedArray: true,
      hpbw: 2,
      disableFastFading: true,
    },
    statisticalResult: {
      metricSummary: {
        rmsDelaySpread_s: { median: 80e-9, p5: 70e-9, p95: 90e-9 },
        coherenceBandwidth_Hz: { median: 2.5e6, p5: 2e6, p95: 3e6 },
      },
    },
    ...overrides,
  });
}

function numericLeaves(value) {
  if (typeof value === 'number') return [value];
  if (Array.isArray(value)) return value.flatMap(numericLeaves);
  if (value && typeof value === 'object') {
    return Object.values(value).flatMap(numericLeaves);
  }
  return [];
}

describe('statistical frame analytics', () => {
  it('builds the exact propagation-loss sum from FSPL and nine named components', () => {
    const result = build();

    expect(result.loss).toMatchObject({
      method: 'statistical-link-budget/v1',
      fspl_dB: expect.any(Number),
      components_dB: {
        rain: expect.any(Number),
        gas: expect.any(Number),
        cloud: expect.any(Number),
        shadow: expect.any(Number),
        faraday: expect.any(Number),
        pointing: expect.any(Number),
        scan: expect.any(Number),
        multipath: expect.any(Number),
        scintillation: expect.any(Number),
      },
      totalPropagationLoss_dB: expect.any(Number),
    });
    expect(Object.keys(result.loss.components_dB)).toEqual([
      'rain', 'gas', 'cloud', 'shadow', 'faraday',
      'pointing', 'scan', 'multipath', 'scintillation',
    ]);
    expect(result.loss.totalPropagationLoss_dB).toBeCloseTo(
      result.loss.fspl_dB
        + Object.values(result.loss.components_dB).reduce((sum, value) => sum + value, 0),
      10,
    );
  });

  it('treats scenario carrier and frame geometry as authoritative over link defaults', () => {
    const result = build();
    const expectedBudget = calculateLinkBudget({
      freq: CARRIER.frequency_Hz / 1e9,
      bandwidth: CARRIER.bandwidth_Hz / 1e6,
      elevation: GEOMETRY.elevation_deg,
      slantRange: GEOMETRY.slantRange_m / 1e3,
      eirp: 60,
      gRx: 42,
      tRx: 150,
      rainRate: 5,
      env: 'suburban',
      tec: 50,
      isPhasedArray: true,
      hpbw: 2,
      disableFastFading: true,
    });
    const expectedFspl = 20 * Math.log10(700) + 20 * Math.log10(25) + 92.45;

    expect(result.loss.fspl_dB).toBeCloseTo(expectedFspl, 12);
    expect(result.loss.components_dB.rain).toBeCloseTo(expectedBudget.attRain, 12);
    expect(result.loss.components_dB.scan).toBeCloseTo(expectedBudget.scanLoss, 12);
    expect(result.link.bandwidth_Hz).toBe(100e6);
    expect(result.sources).toMatchObject({
      carrierFrequency: 'scenario-carrier',
      bandwidth: 'scenario-carrier',
      geometry: 'frame-geometry',
    });
  });

  it('keeps EIRP and antenna gain out of propagation loss while using them for Rx power', () => {
    const baseline = build();
    const boosted = build({
      linkParameters: {
        freq: 99,
        bandwidth: 1,
        elevation: 80,
        slantRange: 1,
        eirp: 70,
        gRx: 47,
        tRx: 150,
        rainRate: 5,
        env: 'suburban',
        tec: 50,
        isPhasedArray: true,
        hpbw: 2,
        disableFastFading: true,
      },
    });

    expect(boosted.loss.totalPropagationLoss_dB)
      .toBeCloseTo(baseline.loss.totalPropagationLoss_dB, 12);
    expect(boosted.link.rxPower_dBm - baseline.link.rxPower_dBm).toBeCloseTo(15, 12);
  });

  it('returns link, delay, capacity, and per-field method/source metadata', () => {
    const result = build();

    expect(result).toMatchObject({
      link: {
        method: 'statistical-link-budget/v1',
        rxPower_dBm: expect.any(Number),
        noisePower_dBm: expect.any(Number),
        snr_dB: expect.any(Number),
        xpd_dB: expect.any(Number),
        capacity_bpsHz: {
          rank1: expect.any(Number),
          rank2: expect.any(Number),
        },
        fieldSources: {
          rxPower_dBm: expect.any(String),
          noisePower_dBm: expect.any(String),
          snr_dB: expect.any(String),
          capacity_bpsHz: expect.any(String),
        },
      },
      delay: {
        method: 'statistical-cir/v1',
        firstArrival_s: expect.any(Number),
        ionosphericGroupDelay_s: expect.any(Number),
        ionosphericDispersion_s: expect.any(Number),
        rmsDelaySpread_s: 80e-9,
        coherenceBandwidth_Hz: 2.5e6,
        fieldSources: {
          firstArrival_s: expect.any(String),
          rmsDelaySpread_s: expect.any(String),
        },
      },
    });
  });

  it('rejects non-finite authoritative input and never leaks non-finite optional metrics', () => {
    expect(() => build({
      carrier: { frequency_Hz: Number.NaN, bandwidth_Hz: 100e6 },
    })).toThrowError(expect.objectContaining({
      name: 'DomainValidationError',
      code: 'STATISTICAL_FRAME_ANALYTICS_INPUT_INVALID',
    }));

    const result = build({
      statisticalResult: {
        metricSummary: {
          rmsDelaySpread_s: { median: Number.NaN },
          coherenceBandwidth_Hz: { median: Number.POSITIVE_INFINITY },
        },
      },
    });
    expect(result.delay.rmsDelaySpread_s).toBeNull();
    expect(result.delay.coherenceBandwidth_Hz).toBeNull();
    expect(numericLeaves(result).every(Number.isFinite)).toBe(true);
  });
});
