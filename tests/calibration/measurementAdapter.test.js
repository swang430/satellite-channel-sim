import { describe, expect, it } from 'vitest';
import {
  groundStationDistanceKm,
  parseCalibrationDataset,
} from '../../src/calibration/measurementAdapter.js';

describe('calibration measurement adapter', () => {
  it('normalizes C/N0 as dB-Hz and preserves explicit zero values', () => {
    const parsed = parseCalibrationDataset({
      metadata: { tec_TECU: 0 },
      measurements: [{
        timestamp: '2026-08-05T00:00:00.000Z',
        frameId: 0,
        elevation_deg: 0,
        slantRange_km: 700,
        rainRate_mmph: 0,
        cn0_dBHz: 71.25,
      }],
    });

    expect(parsed.metadata.tec_TECU).toBe(0);
    expect(parsed.measurements[0]).toMatchObject({
      frameId: 0,
      elevation_deg: 0,
      slantRange_km: 700,
      rainRate_mmph: 0,
      cn0_dBHz: 71.25,
    });
  });

  it('adapts legacy measuredCN0_dB with an explicit unit assumption', () => {
    const parsed = parseCalibrationDataset([
      { elevation: 35, measuredCN0_dB: 68 },
    ]);

    expect(parsed.measurements[0].cn0_dBHz).toBe(68);
    expect(parsed.diagnostics).toContainEqual(expect.objectContaining({
      code: 'LEGACY_CN0_ASSUMED_DBHZ',
    }));
  });

  it('rejects a measurement that has no typed metric', () => {
    expect(() => parseCalibrationDataset([{ elevation_deg: 25 }]))
      .toThrow(/typed calibration metric/i);
  });

  it('computes calibration-site distance against the pre-existing station', () => {
    const current = { lat: 31, lon: 121, alt: 15 };
    const calibration = { lat: 32, lon: 121, alt: 15 };

    expect(groundStationDistanceKm(calibration, current)).toBeCloseTo(111.2, 0);
    expect(current).toEqual({ lat: 31, lon: 121, alt: 15 });
  });
});
