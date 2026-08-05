import { describe, expect, it } from 'vitest';
import {
  assertDynamicComparisonReport,
  assertExpectedMpdbSample,
  buildMismatchedConfigFiles,
  renameSampleFiles,
} from '../../scripts/mpdbSampleVerification.js';

const encoder = new TextEncoder();
const decoder = new TextDecoder();

function config(nodeGroup, endTime = 2000) {
  return {
    name: `${nodeGroup}.json`,
    data: encoder.encode(JSON.stringify({
      nodeGroup,
      simulation: { simulationWindow: { startTime: 1000, endTime } },
    })),
  };
}

function dynamicComparisonFrames(frameCount = 179) {
  return Array.from({ length: frameCount }, (_, frameId) => ({
    frameId,
    metrics: {
      jsDivergence_bits: 0.1,
      weightedDelayDistance_s: 2e-9,
      rmsDelaySpreadDifference_s: -3e-9,
    },
  }));
}

describe('MPDB sample acceptance helpers', () => {
  it('renames every file without changing its bytes', () => {
    const files = [{ name: 'sample.zip', data: new Uint8Array([1, 2]) }, config('baseStation'), config('terminal')];
    const renamed = renameSampleFiles(files);
    expect(renamed.map((file) => file.name)).toEqual(['renamed-result.bin', 'renamed-config-a.json', 'renamed-config-b.json']);
    expect([...renamed[0].data]).toEqual([1, 2]);
  });

  it('creates a receiver config with a mismatched simulation window', () => {
    const mismatched = buildMismatchedConfigFiles([
      { name: 'sample.zip', data: new Uint8Array([1]) },
      config('baseStation'),
      config('terminal'),
    ]);
    const receiver = mismatched.find((file) => file.name.includes('mismatched'));
    expect(JSON.parse(decoder.decode(receiver.data)).simulation.simulationWindow.endTime).toBe(3000);
  });

  it('asserts the approved real-sample invariants', () => {
    expect(() => assertExpectedMpdbSample({
      time: { frameCount: 179 },
      rayTracing: { delay_s: { length: 465_512 } },
      carrier: { frequency_Hz: 24_950_000_000 },
      coordinateReference: { alignmentRmsResidual_m: 0.01 },
    })).not.toThrow();
    expect(() => assertExpectedMpdbSample({
      time: { frameCount: 178 },
      rayTracing: { delay_s: { length: 465_512 } },
      carrier: { frequency_Hz: 24_950_000_000 },
      coordinateReference: { alignmentRmsResidual_m: 0.01 },
    })).toThrow(/frameCount/);
  });

  it('accepts a complete dynamic comparison report with finite fit metrics', () => {
    expect(() => assertDynamicComparisonReport({
      frames: dynamicComparisonFrames(),
    }, 179)).not.toThrow();
  });

  it('rejects the wrong dynamic comparison frame count', () => {
    expect(() => assertDynamicComparisonReport({
      frames: dynamicComparisonFrames(178),
    }, 179)).toThrow(/frames\.length=178, expected 179/);
  });

  it('rejects a discontinuous dynamic comparison frame ID', () => {
    const frames = dynamicComparisonFrames();
    frames[4].frameId = 5;

    expect(() => assertDynamicComparisonReport({ frames }, 179))
      .toThrow(/frame\[4\]\.frameId=5, expected 4/);
  });

  it.each([
    ['jsDivergence_bits', Number.NaN],
    ['weightedDelayDistance_s', Number.POSITIVE_INFINITY],
    ['rmsDelaySpreadDifference_s', Number.NEGATIVE_INFINITY],
  ])('rejects a non-finite %s metric', (metricName, value) => {
    const frames = dynamicComparisonFrames();
    frames[4].metrics[metricName] = value;

    expect(() => assertDynamicComparisonReport({ frames }, 179))
      .toThrow(new RegExp(`frame\\[4\\]\\.metrics\\.${metricName}`));
  });
});
