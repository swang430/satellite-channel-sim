import { describe, expect, it } from 'vitest';
import {
  buildComparisonRequestKey,
  currentComparisonReport,
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
    ...overrides,
  };
}

describe('comparison report request state', () => {
  it('accepts only the report for the current scenario and request key', () => {
    const report = { scenarioId: 'a', requestKey: 'request-a' };

    expect(currentComparisonReport(report, 'a', 'request-a')).toBe(report);
    expect(currentComparisonReport(report, 'a', 'request-b')).toBeNull();
    expect(currentComparisonReport(report, 'b', 'request-a')).toBeNull();
    expect(currentComparisonReport(null, 'a', 'request-a')).toBeNull();
  });

  it('builds a stable key independent of request and parameter property order', () => {
    const first = comparisonRequest();
    const reordered = {
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
