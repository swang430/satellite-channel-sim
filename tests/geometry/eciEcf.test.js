import { describe, expect, it } from 'vitest';
import {
  EARTH_ROTATION_RATE_radps,
  calculateDopplerFromEciState,
  eciStateToEcf,
} from '../../src/geometry/eciEcf.js';

function distance(left, right) {
  return Math.hypot(left.x - right.x, left.y - right.y, left.z - right.z);
}

describe('ECI to ECEF state conversion', () => {
  it('subtracts earth rotation cross position from rotated ECI velocity', () => {
    const state = eciStateToEcf({
      positionEci_km: { x: 7_000, y: 0, z: 0 },
      velocityEci_kmps: { x: 0, y: 7.5, z: 0 },
      gmst_rad: 0,
    });

    expect(state.positionEcf_km).toEqual({ x: 7_000, y: 0, z: 0 });
    expect(state.velocityEcf_kmps.x).toBeCloseTo(0, 12);
    expect(state.velocityEcf_kmps.y).toBeCloseTo(
      7.5 - EARTH_ROTATION_RATE_radps * 7_000,
      12,
    );
  });

  it('matches a finite-difference ECEF range derivative at 30 GHz', () => {
    const positionEci_km = { x: 7_000, y: 1_000, z: 500 };
    const velocityEci_kmps = { x: -1, y: 7.2, z: 0.5 };
    const observerPositionEcf_km = { x: 6_378.137, y: 0, z: 0 };
    const gmst_rad = 0.3;
    const direct = calculateDopplerFromEciState({
      positionEci_km,
      velocityEci_kmps,
      observerPositionEcf_km,
      gmst_rad,
      frequency_Hz: 30e9,
    });
    const dt_s = 0.001;
    const rangeAt = (offset_s) => {
      const state = eciStateToEcf({
        positionEci_km: {
          x: positionEci_km.x + velocityEci_kmps.x * offset_s,
          y: positionEci_km.y + velocityEci_kmps.y * offset_s,
          z: positionEci_km.z + velocityEci_kmps.z * offset_s,
        },
        velocityEci_kmps,
        gmst_rad: gmst_rad + EARTH_ROTATION_RATE_radps * offset_s,
      });
      return distance(state.positionEcf_km, observerPositionEcf_km);
    };
    const finiteDifferenceRangeRate_kmps = (
      rangeAt(dt_s) - rangeAt(-dt_s)
    ) / (2 * dt_s);
    const finiteDifferenceDoppler_Hz = -30e9
      * finiteDifferenceRangeRate_kmps * 1_000 / 299_792_458;

    expect(direct.rangeRate_kmps).toBeCloseTo(finiteDifferenceRangeRate_kmps, 6);
    expect(direct.doppler_Hz).toBeCloseTo(finiteDifferenceDoppler_Hz, 1);
  });
});

