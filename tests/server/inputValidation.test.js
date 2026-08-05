import { describe, expect, it } from 'vitest';
import {
  WS_MAX_REQUEST_BYTES,
  WS_MIN_REQUEST_INTERVAL_MS,
  assertWsRequestAllowed,
  parseGroundStation,
  parseHours,
  parseLinkParams,
  parseWsRequest,
  resolveServerHost,
  validateTle,
} from '../../server/inputValidation.js';

describe('API input validation', () => {
  it('validates latitude, longitude, and altitude bounds', () => {
    expect(parseGroundStation('31.2,121.4,15')).toEqual({ lat: 31.2, lon: 121.4, alt: 15 });
    for (const invalid of ['NaN,0,0', '91,0,0', '0,181,0', '0,0,Infinity', '0,0,1000001']) {
      expect(() => parseGroundStation(invalid)).toThrow();
    }
  });

  it('rejects invalid lookahead hours rather than clamping or defaulting them', () => {
    expect(parseHours(undefined)).toBe(24);
    expect(parseHours('6')).toBe(6);
    for (const invalid of ['0', '73', 'NaN', '1.5', 'Infinity']) {
      expect(() => parseHours(invalid)).toThrow();
    }
  });

  it('validates TLE line identity and structure', () => {
    const tle = validateTle(
      '1 25544U 98067A   24138.54847222  .00017261  00000-0  31516-3 0  9992',
      '2 25544  51.6420 148.9032 0003403 249.7827 110.2962 15.49904425451604',
    );
    expect(tle.tleLine1.startsWith('1 25544')).toBe(true);
    expect(() => validateTle('bad', 'also bad')).toThrow();
    expect(() => validateTle(tle.tleLine1, tle.tleLine2.replace('25544', '99999'))).toThrow();
  });

  it('rejects NaN, Infinity, unknown, and out-of-range link parameters', () => {
    expect(parseLinkParams({ freq: '30', bandwidth: '400', tec: '0' }))
      .toEqual({ freq: 30, bandwidth: 400, tec: 0 });
    for (const invalid of [
      { freq: 'NaN' },
      { bandwidth: 'Infinity' },
      { rainRate: '-1' },
      { unknown: '1' },
    ]) expect(() => parseLinkParams(invalid)).toThrow();
  });

  it('defaults to loopback and only exposes all interfaces explicitly', () => {
    expect(resolveServerHost({})).toBe('127.0.0.1');
    expect(resolveServerHost({ HOST: '0.0.0.0' })).toBe('0.0.0.0');
  });

  it('bounds WebSocket payload size, window, and request rate', () => {
    expect(parseWsRequest(JSON.stringify({ sat: 'ISS', gs: '31,121,0', hours: 6 })))
      .toMatchObject({ hours: 6 });
    expect(() => parseWsRequest('x'.repeat(WS_MAX_REQUEST_BYTES + 1))).toThrow();
    expect(() => parseWsRequest(JSON.stringify({ hours: 100 }))).toThrow();
    expect(() => assertWsRequestAllowed(1000, 1000 + WS_MIN_REQUEST_INTERVAL_MS - 1)).toThrow();
    expect(assertWsRequestAllowed(1000, 1000 + WS_MIN_REQUEST_INTERVAL_MS)).toBe(true);
  });
});
