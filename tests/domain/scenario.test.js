import { describe, expect, it } from 'vitest';
import {
  assertScenarioReadyForComparison,
  createScenarioDraft,
  validateScenario,
} from '../../src/domain/scenario.js';
import { SCENARIO_SCHEMA_VERSION } from '../../src/domain/schemaVersion.js';

function receiverTrack(frameCount = 179) {
  return Array.from({ length: frameCount }, (_, frameId) => ({
    frameId,
    longitude_deg: 116.3 + frameId * 1e-6,
    latitude_deg: 39.9 + frameId * 1e-6,
    height_m: 50,
    projectedPosition_m: {
      x: 360_000 + frameId,
      y: 3_980_000 + frameId,
      z: 50,
    },
  }));
}

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
    receiver: {
      id: 'terminal-1',
      track: receiverTrack(),
    },
    ...overrides,
  });
}

describe('UnifiedScenario v3', () => {
  it('creates a valid versioned draft with a complete receiver track', () => {
    const scenario = validScenario();

    expect(scenario.schemaVersion).toBe(SCENARIO_SCHEMA_VERSION);
    expect(scenario).not.toHaveProperty('groundSelection');
    expect(validateScenario(scenario)).toEqual([]);
    expect(() => assertScenarioReadyForComparison(scenario)).not.toThrow();
  });

  it('requires receiver.track to be an array', () => {
    const scenario = validScenario({
      receiver: { id: 'terminal-1', track: null },
    });

    expect(validateScenario(scenario)).toEqual(expect.arrayContaining([
      expect.objectContaining({
        code: 'RECEIVER_TRACK_FRAME_COUNT_MISMATCH',
        path: 'receiver.track',
      }),
    ]));
  });

  it('requires receiver.track to contain exactly one point per frame', () => {
    const scenario = validScenario({
      receiver: { id: 'terminal-1', track: receiverTrack(178) },
    });

    expect(validateScenario(scenario)).toEqual(expect.arrayContaining([
      expect.objectContaining({
        code: 'RECEIVER_TRACK_FRAME_COUNT_MISMATCH',
        path: 'receiver.track',
      }),
    ]));
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

  it('requires each receiver track point frameId to match its array position', () => {
    const track = receiverTrack();
    track[1].frameId = 7;

    expect(validateScenario(validScenario({
      receiver: { id: 'terminal-1', track },
    }))).toEqual(expect.arrayContaining([
      expect.objectContaining({
        code: 'RECEIVER_TRACK_FRAME_ID_MISMATCH',
        path: 'receiver.track[1].frameId',
      }),
    ]));
  });

  it.each([
    ['longitude_deg', Number.NaN, 'receiver.track[0].longitude_deg'],
    ['latitude_deg', Number.POSITIVE_INFINITY, 'receiver.track[0].latitude_deg'],
    ['height_m', undefined, 'receiver.track[0].height_m'],
    ['projectedPosition_m.x', Number.NaN, 'receiver.track[0].projectedPosition_m.x'],
    ['projectedPosition_m.y', Number.POSITIVE_INFINITY, 'receiver.track[0].projectedPosition_m.y'],
    ['projectedPosition_m.z', undefined, 'receiver.track[0].projectedPosition_m.z'],
  ])('requires finite receiver track coordinate %s', (field, value, path) => {
    const track = receiverTrack();
    if (field.startsWith('projectedPosition_m.')) {
      track[0].projectedPosition_m[field.split('.')[1]] = value;
    } else {
      track[0][field] = value;
    }

    expect(validateScenario(validScenario({
      receiver: { id: 'terminal-1', track },
    }))).toEqual(expect.arrayContaining([
      expect.objectContaining({ code: 'INVALID_RECEIVER_TRACK_COORDINATE', path }),
    ]));
  });
});
