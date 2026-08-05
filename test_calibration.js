import { calibrateModel } from './src/model.js';

const mockData = [
  { elevation_deg: 40, slantRange_km: 800, rainRate_mmph: 5, attenuation_dB: 10.2 },
  { elevation_deg: 40, slantRange_km: 800, rainRate_mmph: 10, attenuation_dB: 16.5 },
  { elevation_deg: 40, slantRange_km: 800, rainRate_mmph: 20, attenuation_dB: 29.8 },
  { elevation_deg: 40, slantRange_km: 800, rainRate_mmph: 30, attenuation_dB: 45.1 },
  { elevation_deg: 40, slantRange_km: 800, rainRate_mmph: 40, attenuation_dB: 62.0 },
  { elevation_deg: 40, slantRange_km: 800, rainRate_mmph: 50, attenuation_dB: 78.5 }
];

const params = {
  freq: 30.0,
  eirp: 50,
  gRx: 42,
  tRx: 150,
  bandwidth: 100,
  tec: 0,
  env: 'suburban'
};

const profile = calibrateModel(mockData, params);
console.log(JSON.stringify({
  schemaVersion: profile.schemaVersion,
  calibrated: profile.calibrated,
  residualRms: profile.residualRms,
  params: profile.params,
  parameterStatus: profile.parameterStatus,
  diagnostics: profile.diagnostics,
}, null, 2));
