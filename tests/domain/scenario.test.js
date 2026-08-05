import { describe, expect, it } from 'vitest';
import {
  assertScenarioReadyForComparison,
  createScenarioDraft,
  normalizeGroundSelection,
  validateScenario,
} from '../../src/domain/scenario.js';
import { SCENARIO_SCHEMA_VERSION } from '../../src/domain/schemaVersion.js';

function validScenario(overrides = {}) {
  return createScenarioDraft({
    scenarioId: 'sha256:test',
    source: { format: 'lauraycs-mpdb', files: [] },
    link: {
      direction: 'downlink',
      transmitterId: '47641',
      receiverId: 'terminal-1',
    },
    time: {
      startTimeUtc: '2026-08-03T17:36:50.000Z',
      sampleInterval_s: 1,
      frameCount: 179,
    },
    carrier: {
      frequency_Hz: 24_950_000_000,
      bandwidth_Hz: 100_000_000,
    },
    ...overrides,
  });
}

describe('UnifiedScenario v3', () => {
  it('creates a versioned draft without inventing a ground selection', () => {
    const scenario = validScenario();

    expect(scenario.schemaVersion).toBe(SCENARIO_SCHEMA_VERSION);
    expect(scenario.groundSelection).toBeNull();
    expect(validateScenario(scenario)).toEqual([]);
  });

  it('requires explicit ground selection before comparison', () => {
    expect(() => assertScenarioReadyForComparison(validScenario())).toThrowError(
      expect.objectContaining({ code: 'SCENARIO_NOT_READY' }),
    );
  });

  it('preserves frame zero as an explicit user selection', () => {
    const selection = normalizeGroundSelection({
      selectedFrameId: 0,
      selectedBy: 'user',
      selectedAtUtc: '2026-08-05T11:00:00.000Z',
      matchTolerance_m: 0.1,
    }, 179);
    const scenario = validScenario({ groundSelection: selection });

    expect(scenario.groundSelection.selectedFrameId).toBe(0);
    expect(() => assertScenarioReadyForComparison(scenario)).not.toThrow();
  });

  it.each([
    ['carrier.frequency_Hz', { carrier: { frequency_Hz: 0, bandwidth_Hz: 100_000_000 } }],
    ['carrier.bandwidth_Hz', { carrier: { frequency_Hz: 24_950_000_000, bandwidth_Hz: 0 } }],
    ['time.sampleInterval_s', { time: { startTimeUtc: '2026-08-03T17:36:50.000Z', sampleInterval_s: 0, frameCount: 179 } }],
  ])('reports invalid physical range for %s', (path, overrides) => {
    const issues = validateScenario(validScenario(overrides));

    expect(issues).toEqual(expect.arrayContaining([
      expect.objectContaining({ code: 'INVALID_PHYSICAL_RANGE', path }),
    ]));
  });

  it('rejects unitless physical fields at the domain boundary', () => {
    const scenario = validScenario();
    scenario.carrier.freq = 24.95;
    scenario.transmitter = { power: 23 };
    scenario.receiver = { alt: 349 };

    const issues = validateScenario(scenario);

    expect(issues.filter((item) => item.code === 'UNITLESS_PHYSICAL_FIELD')).toHaveLength(3);
  });

  it('rejects a selected frame outside the imported frame range', () => {
    expect(() => normalizeGroundSelection({
      selectedFrameId: 179,
      selectedBy: 'user',
      selectedAtUtc: '2026-08-05T11:00:00.000Z',
      matchTolerance_m: 0.1,
    }, 179)).toThrowError(expect.objectContaining({ code: 'GROUND_FRAME_OUT_OF_RANGE' }));
  });
});
