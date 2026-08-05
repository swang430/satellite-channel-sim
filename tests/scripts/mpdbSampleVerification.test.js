import { describe, expect, it } from 'vitest';
import {
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
});
