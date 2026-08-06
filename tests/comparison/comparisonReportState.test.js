import { describe, expect, it } from 'vitest';
import {
  buildComparisonRequestKey,
  currentComparisonReport,
  deriveComparisonRequest,
  normalizeComparisonEnvironment,
} from '../../src/features/channel-comparison/comparisonReportState.js';

function comparisonRequest(overrides = {}) {
  return {
    scenarioId: 'sha256:scenario-a',
    realizationCount: 32,
    statisticalParameters: {
      environment: 'urban',
      tec_TECU: 20,
      scatterPowerOffset_dB: -2,
    },
    linkBudgetParameters: {
      eirp: 60,
      gRx: 42,
      tRx: 150,
      rainRate: 5,
      disableFastFading: true,
      correctionFactor: 1,
      gasAttenOffset_dB: 0,
    },
    ...overrides,
  };
}

describe('comparison report request state', () => {
  it.each(['rural', 'suburban', 'urban', 'maritime'])('preserves supported environment %s', (environment) => {
    expect(normalizeComparisonEnvironment(environment)).toBe(environment);
  });

  it('maps the UI open environment to the statistical rural model', () => {
    const request = deriveComparisonRequest({
      scenarioId: 'sha256:scenario-a',
      environment: 'open',
      tec_TECU: 20,
    });

    expect(request.error).toBeNull();
    expect(request.statisticalParameters).toEqual({
      environment: 'rural',
      tec_TECU: 20,
      scatterPowerOffset_dB: 0,
    });
    expect(request.requestKey).toBe(buildComparisonRequestKey({
      scenarioId: 'sha256:scenario-a',
      realizationCount: 32,
      statisticalParameters: request.statisticalParameters,
      linkBudgetParameters: request.linkBudgetParameters,
    }));
  });

  it.each([
    ['invalid TEC', { environment: 'open', tec_TECU: Number.NaN }, 'STATISTICAL_CIR_INPUT_INVALID'],
    ['unknown environment', { environment: 'forest', tec_TECU: 20 }, 'COMPARISON_ENVIRONMENT_INVALID'],
  ])('returns a safe structured error for %s without throwing', (_label, input, code) => {
    expect(() => deriveComparisonRequest({
      scenarioId: 'sha256:scenario-a',
      ...input,
    })).not.toThrow();
    expect(deriveComparisonRequest({
      scenarioId: 'sha256:scenario-a',
      ...input,
    })).toMatchObject({
      requestKey: null,
      statisticalParameters: null,
      error: { code },
    });
  });

  it('does not report parameter errors before a scenario exists', () => {
    expect(deriveComparisonRequest({
      scenarioId: null,
      environment: 'forest',
      tec_TECU: Number.NaN,
    })).toEqual({
      requestKey: null,
      statisticalParameters: null,
      error: null,
    });
  });

  it('uses only a finite calibrated scatter offset and ignores unrelated profile fields', () => {
    expect(deriveComparisonRequest({
      scenarioId: 'sha256:scenario-a',
      environment: 'open',
      tec_TECU: 20,
      useCalibration: true,
      calibrationProfile: {
        calibrated: true,
        environment: 'forest',
        params: { scatterPowerOffset_dB: -3 },
      },
    }).statisticalParameters).toMatchObject({
      environment: 'rural',
      scatterPowerOffset_dB: -3,
    });
    expect(deriveComparisonRequest({
      scenarioId: 'sha256:scenario-a',
      environment: 'urban',
      tec_TECU: 20,
      useCalibration: true,
      calibrationProfile: {
        calibrated: true,
        params: { scatterPowerOffset_dB: Number.NaN },
      },
    }).statisticalParameters.scatterPowerOffset_dB).toBe(0);
  });

  it('accepts only the report for the current scenario and request key', () => {
    const report = { scenarioId: 'a', requestKey: 'request-a' };

    expect(currentComparisonReport(report, 'a', 'request-a')).toBe(report);
    expect(currentComparisonReport(report, 'a', 'request-b')).toBeNull();
    expect(currentComparisonReport(report, 'b', 'request-a')).toBeNull();
    expect(currentComparisonReport(null, 'a', 'request-a')).toBeNull();
  });

  it.each([
    [null, 'request-a'],
    ['', 'request-a'],
    ['a', null],
    ['a', ''],
  ])('fails closed when the current scenario or request key is missing', (scenarioId, requestKey) => {
    const report = { scenarioId, requestKey };

    expect(currentComparisonReport(report, scenarioId, requestKey)).toBeNull();
  });

  it('hides an otherwise matching old report after the request changes', () => {
    const firstRequestKey = buildComparisonRequestKey(comparisonRequest());
    const report = { scenarioId: 'sha256:scenario-a', requestKey: firstRequestKey };
    const nextRequestKey = buildComparisonRequestKey(comparisonRequest({
      statisticalParameters: {
        environment: 'urban',
        tec_TECU: 21,
        scatterPowerOffset_dB: -2,
      },
    }));

    expect(currentComparisonReport(report, 'sha256:scenario-a', firstRequestKey)).toBe(report);
    expect(currentComparisonReport(report, 'sha256:scenario-a', nextRequestKey)).toBeNull();
  });

  it('builds a stable key independent of request and parameter property order', () => {
    const first = comparisonRequest();
    const reordered = {
      linkBudgetParameters: {
        gasAttenOffset_dB: 0,
        correctionFactor: 1,
        disableFastFading: true,
        rainRate: 5,
        tRx: 150,
        gRx: 42,
        eirp: 60,
      },
      statisticalParameters: {
        scatterPowerOffset_dB: -2,
        tec_TECU: 20,
        environment: 'urban',
      },
      realizationCount: 32,
      scenarioId: 'sha256:scenario-a',
    };

    expect(buildComparisonRequestKey(first)).toBe(buildComparisonRequestKey(reordered));
  });

  it.each([
    ['scenario', { scenarioId: 'sha256:scenario-b' }],
    ['environment', { statisticalParameters: { environment: 'rural', tec_TECU: 20, scatterPowerOffset_dB: -2 } }],
    ['TEC', { statisticalParameters: { environment: 'urban', tec_TECU: 21, scatterPowerOffset_dB: -2 } }],
    ['scatter offset', { statisticalParameters: { environment: 'urban', tec_TECU: 20, scatterPowerOffset_dB: -1 } }],
    ['realization count', { realizationCount: 33 }],
    ['EIRP', { linkBudgetParameters: { eirp: 61 } }],
    ['receiver gain', { linkBudgetParameters: { gRx: 43 } }],
    ['noise temperature', { linkBudgetParameters: { tRx: 151 } }],
    ['rain rate', { linkBudgetParameters: { rainRate: 6 } }],
    ['fast fading switch', { linkBudgetParameters: { disableFastFading: false } }],
    ['rain calibration', { linkBudgetParameters: { correctionFactor: 1.1 } }],
    ['gas calibration', { linkBudgetParameters: { gasAttenOffset_dB: 0.2 } }],
  ])('changes the key when %s changes', (_label, overrides) => {
    expect(buildComparisonRequestKey(comparisonRequest(overrides)))
      .not.toBe(buildComparisonRequestKey(comparisonRequest()));
  });

  it('cannot collide when scenario IDs contain delimiter-like text', () => {
    const left = comparisonRequest({
      scenarioId: 'scenario|urban',
      statisticalParameters: {
        environment: 'rural',
        tec_TECU: 20,
        scatterPowerOffset_dB: -2,
      },
    });
    const right = comparisonRequest({
      scenarioId: 'scenario',
      statisticalParameters: {
        environment: 'urban',
        tec_TECU: 20,
        scatterPowerOffset_dB: -2,
      },
    });

    expect(buildComparisonRequestKey(left)).not.toBe(buildComparisonRequestKey(right));
  });

  it('normalizes omitted statistical defaults exactly like comparison execution', () => {
    expect(buildComparisonRequestKey({ scenarioId: 'a' })).toBe(buildComparisonRequestKey({
      scenarioId: 'a',
      realizationCount: 32,
      statisticalParameters: {
        environment: 'suburban',
        tec_TECU: 50,
        scatterPowerOffset_dB: 0,
      },
    }));
  });

  it.each([
    [{ scenarioId: '' }, 'COMPARISON_REQUEST_INVALID'],
    [{ scenarioId: 'a', realizationCount: 0 }, 'STATISTICAL_CIR_INPUT_INVALID'],
    [{ scenarioId: 'a', statisticalParameters: { environment: 'forest' } }, 'STATISTICAL_CIR_INPUT_INVALID'],
    [{ scenarioId: 'a', statisticalParameters: { tec_TECU: NaN } }, 'STATISTICAL_CIR_INPUT_INVALID'],
  ])('rejects invalid request values with a structured error', (request, code) => {
    expect(() => buildComparisonRequestKey(request))
      .toThrowError(expect.objectContaining({ code }));
  });
});
