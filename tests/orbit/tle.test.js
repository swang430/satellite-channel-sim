import { describe, expect, it } from 'vitest';
import { ORBIT_SATELLITES, getOrbitSatellite } from '../../src/knownSatellites.js';
import {
  diagnoseTleAge,
  parseTleEpoch,
  withTleDiagnostics,
} from '../../src/orbit/tle.js';

const ISS_LINE_1 = '1 25544U 98067A   24138.54847222  .00017261  00000-0  31516-3 0  9992';

describe('TLE epoch policy', () => {
  it('parses the two-digit year and fractional day-of-year epoch', () => {
    expect(parseTleEpoch(ISS_LINE_1).toISOString()).toBe('2024-05-17T13:09:48.000Z');
  });

  it('marks an old TLE as stale instead of presenting it as real-time accurate', () => {
    const diagnostics = diagnoseTleAge(
      { tleLine1: ISS_LINE_1 },
      new Date('2026-08-05T00:00:00.000Z'),
      { maxAgeDays: 14 },
    );

    expect(diagnostics.status).toBe('stale');
    expect(diagnostics.realTimeAccuracy).toBe('not-claimed');
    expect(diagnostics.warnings).toEqual([
      expect.objectContaining({ code: 'TLE_STALE' }),
    ]);
  });

  it('exposes the same orbit registry through the shared frontend/server accessor', () => {
    expect(getOrbitSatellite('iss')).toBe(ORBIT_SATELLITES.ISS);
    expect(getOrbitSatellite('CSS-TIANHE')).toBe(ORBIT_SATELLITES['CSS-TIANHE']);
  });

  it('attaches stale-age diagnostics to no-contact API payloads', () => {
    const payload = withTleDiagnostics(
      { status: 'no_contact' },
      { tleLine1: ISS_LINE_1 },
      new Date('2026-08-05T00:00:00.000Z'),
    );

    expect(payload).toMatchObject({
      status: 'no_contact',
      tleDiagnostics: {
        status: 'stale',
        realTimeAccuracy: 'not-claimed',
      },
    });
  });
});
