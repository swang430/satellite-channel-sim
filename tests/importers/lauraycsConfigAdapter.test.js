import { describe, expect, it } from 'vitest';
import { adaptLauraycsConfigs } from '../../src/importers/mpdb/lauraycsConfigAdapter.js';
import { buildLauraycsConfigFixtures } from '../fixtures/lauraycsConfigs.js';

describe('Lauraycs config adapter', () => {
  it('normalizes link entities, time, antenna, power, and bandwidth', () => {
    const { transmitterConfig, receiverConfig } = buildLauraycsConfigFixtures();
    const result = adaptLauraycsConfigs([receiverConfig, transmitterConfig]);

    expect(result.link).toEqual({
      direction: 'downlink',
      transmitterId: '47641',
      receiverId: 'terminal-route-1785827004804',
    });
    expect(result.time.frameCount).toBe(179);
    expect(result.time.sampleInterval_s).toBe(1);
    expect(result.timestampsUtc).toHaveLength(179);
    expect(result.timestampsUtc[1]).toBe('2026-08-03T17:36:51.000Z');
    expect(result.carrier.bandwidth_Hz).toBe(100_000_000);
    expect(result.transmitter.txPower_dBm).toBe(23);
    expect(result.transmitter.txAntenna.gain_dBi).toBeCloseTo(24.9017);
    expect(result.transmitter.txAntenna.polarization).toBe('vertical');
    expect(result.transmitter.txAntenna.beamwidth_deg).toBe(66);
    expect(result.coordinateReference.projectedEpsg).toBe(32649);
    expect(result.satelliteTrack).toHaveLength(179);
    expect(result.diagnostics.assumptions).toContainEqual(expect.objectContaining({
      code: 'INFERRED_POWER_UNIT',
      path: 'transmitter.txPower_dBm',
    }));
  });

  it('preserves all frequency candidates without choosing an MPDB frequency', () => {
    const fixtures = buildLauraycsConfigFixtures();
    const result = adaptLauraycsConfigs(Object.values(fixtures));

    expect(result.carrier.frequency_Hz).toBeNull();
    expect(result.carrier.frequencyCandidates).toEqual(expect.arrayContaining([
      expect.objectContaining({ source: 'transmitter.tx.centerFrequency', frequency_Hz: 25_000_000_000 }),
      expect.objectContaining({ source: 'receiver.rx.centerFrequency', frequency_Hz: 2_500_000_000 }),
      expect.objectContaining({ source: 'simulation.globalParams.downlinkCenterFrequency', frequency_Hz: 2_600_000_000 }),
    ]));
  });

  it('rejects mismatched simulation windows before frame association', () => {
    const { transmitterConfig, receiverConfig } = buildLauraycsConfigFixtures();
    receiverConfig.simulation.simulationWindow.endTime += 1_000;

    expect(() => adaptLauraycsConfigs([transmitterConfig, receiverConfig])).toThrowError(
      expect.objectContaining({ code: 'CONFIG_SIMULATION_WINDOW_MISMATCH' }),
    );
  });
});
