import { describe, expect, it } from 'vitest';
import {
  calibrateModel,
  simulateCalibrationMeasurement,
} from '../../src/calibration/calibrationEngine.js';

const baseLink = {
  frequency_GHz: 12,
  eirp_dBW: 45,
  rxGain_dBi: 38,
  systemNoiseTemperature_K: 160,
  bandwidth_Hz: 100e6,
  tec_TECU: 0,
  environment: 'rural',
};

describe('calibration engine', () => {
  it('keeps C/N0 in dB-Hz and names the bandwidth-integrated value C/N', () => {
    const narrow = simulateCalibrationMeasurement(baseLink, {
      elevation_deg: 50,
      slantRange_km: 700,
      rainRate_mmph: 0,
    });
    const wide = simulateCalibrationMeasurement({ ...baseLink, bandwidth_Hz: 400e6 }, {
      elevation_deg: 50,
      slantRange_km: 700,
      rainRate_mmph: 0,
    });

    expect(wide.predictedCn0_dBHz).toBeCloseTo(narrow.predictedCn0_dBHz, 10);
    expect(narrow.predictedCn_dB - wide.predictedCn_dB).toBeCloseTo(6.0206, 3);
    expect(narrow).not.toHaveProperty('predictedCN0');
  });

  it('uses each measurement slant range instead of a GEO fallback', () => {
    const leo = simulateCalibrationMeasurement(baseLink, {
      elevation_deg: 60,
      slantRange_km: 650,
      rainRate_mmph: 0,
    });
    const farther = simulateCalibrationMeasurement(baseLink, {
      elevation_deg: 60,
      slantRange_km: 1300,
      rainRate_mmph: 0,
    });

    expect(leo.predictedRssi_dBm - farther.predictedRssi_dBm).toBeCloseTo(6.0206, 2);
    expect(() => simulateCalibrationMeasurement(baseLink, {
      elevation_deg: 60,
      rainRate_mmph: 0,
    })).toThrow(/slantRange_km/i);
  });

  it('applies scatter offset to the simulated residual', () => {
    const measurement = {
      elevation_deg: 40,
      slantRange_km: 800,
      rainRate_mmph: 0,
      scatterPower_dB: -18,
    };
    const atZero = simulateCalibrationMeasurement(baseLink, measurement, {
      scatterPowerOffset_dB: 0,
    });
    const shifted = simulateCalibrationMeasurement(baseLink, measurement, {
      scatterPowerOffset_dB: 3,
    });

    expect(shifted.predictedScatterPower_dB - atZero.predictedScatterPower_dB).toBeCloseTo(3, 10);
  });

  it('freezes parameters that the measurement types cannot identify', () => {
    const profile = calibrateModel({
      linkParams: baseLink,
      measurements: [{
        elevation_deg: 45,
        slantRange_km: 700,
        rainRate_mmph: 0,
        xpd_dB: 30,
      }],
    });

    expect(profile.calibrated).toBe(false);
    expect(profile.diagnostics).toContainEqual(expect.objectContaining({
      code: 'UNIDENTIFIABLE_PARAMETER',
      parameter: 'eirpOffset_dB',
    }));
    expect(Object.values(profile.parameterStatus).every((value) => value === 'frozen')).toBe(true);
  });

  it('identifies only scatter offset from scatter-power observations', () => {
    const measurements = [-20, -19, -21].map((scatterPower_dB, index) => ({
      frameId: index,
      elevation_deg: 45,
      slantRange_km: 700,
      rainRate_mmph: 0,
      scatterPower_dB,
    }));
    const profile = calibrateModel({ linkParams: baseLink, measurements });

    expect(profile.parameterStatus.scatterPowerOffset_dB).toBe('estimated');
    expect(profile.parameterStatus.eirpOffset_dB).toBe('frozen');
    expect(profile.diagnostics).toContainEqual(expect.objectContaining({
      code: 'UNIDENTIFIABLE_PARAMETER',
      parameter: 'eirpOffset_dB',
    }));
  });
});
