import { describe, expect, it } from 'vitest';
import {
  applyCalibration,
  calibrateModel,
  createDefaultCalibration,
  getCalibParamDefs,
} from '../../src/model.js';

describe('legacy model calibration facade', () => {
  it('delegates to the versioned calibration contract', () => {
    const empty = createDefaultCalibration();
    expect(empty.schemaVersion).toBe('satellite-channel-sim/calibration-v1');
    expect(getCalibParamDefs()[0]).toHaveProperty('defaultVal');

    const profile = calibrateModel([
      { elevation: 45, slantRange: 700, measuredRSSI_dBm: -100 },
      { elevation: 50, slantRange: 650, measuredRSSI_dBm: -98 },
    ], {
      freq: 12,
      eirp: 45,
      gRx: 38,
      tRx: 160,
      bandwidth: 100,
      tec: 0,
    });
    expect(profile.schemaVersion).toBe(empty.schemaVersion);
    expect(profile.residualRMS).toBe(profile.residualRms);
  });

  it('preserves explicit zero-valued calibrated offsets', () => {
    const applied = applyCalibration({ eirp: 45, tRx: 160 }, {
      calibrated: true,
      params: {
        correctionFactor: 0,
        gasAttenOffset_dB: 0,
        scatterPowerOffset_dB: 0,
        eirpOffset_dB: 0,
        systemNoiseOffset_K: 0,
      },
    });

    expect(applied).toMatchObject({
      correctionFactor: 0,
      gasAttenOffset_dB: 0,
      scatterPowerOffset_dB: 0,
      eirp: 45,
      tRx: 160,
    });
  });
});
