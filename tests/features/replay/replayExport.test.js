import { describe, expect, it } from 'vitest';
import { buildReplayCsv } from '../../../src/features/replay/replayExport.js';

describe('replay CSV export', () => {
  it('serializes the replay channel fields in a stable schema', () => {
    const csv = buildReplayCsv([{
      timeLabel: '2026-08-05 12:00:00',
      elevation: 10,
      azimuth: 20,
      slantRange: 1_234.56,
      totalLoss: 140.123,
      deltaFspl: 2.345,
      totalAtmosphericLoss: 1.234,
      tSky: 98.76,
    }]);

    expect(csv).toBe([
      'Time,Elevation,Azimuth,SlantRange_km,TotalLoss_dB,DeltaFSPL_dB,AtmLoss_dB,SkyNoise_K',
      '2026-08-05 12:00:00,10.00,20.0,1234.6,140.12,2.35,1.23,98.8',
    ].join('\n'));
  });
});
