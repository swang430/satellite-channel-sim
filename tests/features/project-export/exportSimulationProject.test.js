import { describe, expect, it } from 'vitest';
import { buildGoldenTrajectoryCsv } from '../../../src/features/project-export/exportSimulationProject.js';

describe('Golden RT trajectory export', () => {
  it('uses effective altitude when requested and keeps physical altitude as an explicit option', () => {
    const points = [{
      time: '2026-08-05T00:00:00.000Z',
      satLat: 10,
      satLon: 20,
      satAlt: 550,
      azimuth: 90,
      elevation: 30,
      range: 1_000,
      feature: 'TCA',
      description: 'peak',
    }];

    expect(buildGoldenTrajectoryCsv(points, true)).toContain(',500.000,90.00,30.00,1000.00,500.000,"TCA","peak"');
    expect(buildGoldenTrajectoryCsv(points, false)).toContain(',550.000,90.00,30.00,1000.00,500.000,"TCA","peak"');
  });
});
