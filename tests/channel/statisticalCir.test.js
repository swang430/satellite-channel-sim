import { describe, expect, it } from 'vitest';
import { computeCIR } from '../../src/model.js';
import { computeStatisticalCir } from '../../src/channel/statisticalCir.js';

describe('statistical CIR physical contract', () => {
  it('preserves an explicit GEO slant range in the legacy adapter', () => {
    const cir = computeCIR({
      freq: 12,
      elevation: 90,
      slantRange: 35_786,
      satAlt: 550,
      env: 'rural',
      tec: 0,
    });

    expect(cir.absoluteFspl).toBeCloseTo(205.1, 0);
    expect(cir.taps[0].delay_ns / 1e6).toBeCloseTo(119.37, 1);
  });

  it('derives slant range from satellite altitude only when range is absent', () => {
    const cir = computeStatisticalCir({
      frequency_Hz: 12e9,
      elevation_deg: 90,
      satelliteAltitude_m: 550_000,
      environment: 'rural',
      tec_TECU: 0,
    });

    expect(cir.slantRange_m).toBeCloseTo(550_000, 3);
    expect(cir.absoluteFspl_dB).toBeCloseTo(168.84, 1);
  });

  it('does not create an ionospheric tap when TEC is explicitly zero', () => {
    const cir = computeStatisticalCir({
      frequency_Hz: 2e9,
      elevation_deg: 10,
      slantRange_m: 1_000_000,
      environment: 'rural',
      tec_TECU: 0,
    });

    expect(cir.taps.some((tap) => tap.kind === 'ionosphere')).toBe(false);
  });

  it('applies scatterPowerOffset_dB exactly to scattering tap power', () => {
    const baseline = computeStatisticalCir({
      frequency_Hz: 25e9,
      elevation_deg: 30,
      slantRange_m: 700_000,
      environment: 'urban',
      tec_TECU: 0,
      scatterPowerOffset_dB: 0,
    });
    const shifted = computeStatisticalCir({
      frequency_Hz: 25e9,
      elevation_deg: 30,
      slantRange_m: 700_000,
      environment: 'urban',
      tec_TECU: 0,
      scatterPowerOffset_dB: -4.5,
    });

    const baselineScatter = baseline.taps.find((tap) => tap.kind === 'scatter');
    const shiftedScatter = shifted.taps.find((tap) => tap.kind === 'scatter');
    expect(shiftedScatter.power_dB - baselineScatter.power_dB).toBeCloseTo(-4.5, 10);
  });

  it('reduces urban scattering relative to LOS as elevation rises', () => {
    const make = (elevation_deg) => computeStatisticalCir({
      frequency_Hz: 25e9,
      elevation_deg,
      slantRange_m: 700_000,
      environment: 'urban',
      tec_TECU: 0,
    });
    const low = make(10);
    const high = make(80);
    const relative = (cir) => (
      cir.taps.find((tap) => tap.kind === 'scatter').power_dB
      - cir.taps.find((tap) => tap.kind === 'los').power_dB
    );

    expect(relative(high)).toBeLessThan(relative(low));
  });

  it('gives every tap explicit absolute/excess delay, complex amplitude, and power', () => {
    const cir = computeStatisticalCir({
      frequency_Hz: 25e9,
      elevation_deg: 30,
      slantRange_m: 700_000,
      environment: 'urban',
      tec_TECU: 20,
    });

    for (const tap of cir.taps) {
      expect(tap).toEqual(expect.objectContaining({
        absoluteDelay_s: expect.any(Number),
        excessDelay_s: expect.any(Number),
        complexAmplitude: {
          real: expect.any(Number),
          imag: expect.any(Number),
        },
        power_linear: expect.any(Number),
        power_dB: expect.any(Number),
      }));
    }
  });
});

