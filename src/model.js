import * as satellite from 'satellite.js';
import { computeStatisticalCir } from './channel/statisticalCir.js';
import { calculateDopplerFromEciState } from './geometry/eciEcf.js';
import { groundPositionEcf } from './geometry/linkGeometry.js';

// ITU-R P.838-3 Table 1: Specific rain attenuation coefficients (horizontal polarization).
// Sorted by frequency (GHz). Used for log-linear interpolation per the standard.
const RAIN_COEFFS_TABLE = [
  { f: 1,   k: 0.0000308, alpha: 0.8592 },
  { f: 2,   k: 0.000154,  alpha: 0.9630 },
  { f: 4,   k: 0.000650,  alpha: 1.1210 },
  { f: 6,   k: 0.00175,   alpha: 1.3080 },
  { f: 7,   k: 0.00301,   alpha: 1.3320 },
  { f: 8,   k: 0.00454,   alpha: 1.3270 },
  { f: 10,  k: 0.0101,    alpha: 1.2760 },
  { f: 12,  k: 0.0188,    alpha: 1.2170 },
  { f: 15,  k: 0.0367,    alpha: 1.1540 },
  { f: 20,  k: 0.0751,    alpha: 1.0990 },
  { f: 25,  k: 0.1240,    alpha: 1.0610 },
  { f: 30,  k: 0.1870,    alpha: 1.0210 },
  { f: 35,  k: 0.2630,    alpha: 0.9790 },
  { f: 40,  k: 0.3500,    alpha: 0.9390 },
  { f: 45,  k: 0.4420,    alpha: 0.9030 },
  { f: 50,  k: 0.5360,    alpha: 0.8730 },
  { f: 60,  k: 0.7070,    alpha: 0.8260 },
  { f: 80,  k: 0.9750,    alpha: 0.7660 },
  { f: 100, k: 1.1200,    alpha: 0.7270 },
];

/**
 * Interpolate ITU-R P.838-3 rain attenuation coefficients k and α at the
 * given frequency using log-linear interpolation in the frequency domain.
 * k is interpolated in log space; α is interpolated linearly — both per the standard.
 * Frequencies outside the table range are clamped to the nearest endpoint.
 *
 * @param {number} freq_GHz - Carrier frequency in GHz
 * @returns {{ k: number, alpha: number }}
 */
function getRainCoeffs(freq_GHz) {
  const table = RAIN_COEFFS_TABLE;
  // Guard: treat missing/invalid freq as 30 GHz (Ka-band app default)
  const freqSafe = (typeof freq_GHz === 'number' && isFinite(freq_GHz) && freq_GHz > 0) ? freq_GHz : 30.0;
  const f = Math.max(table[0].f, Math.min(table[table.length - 1].f, freqSafe));

  // Find the two bracketing entries
  let lo = table[0];
  let hi = table[table.length - 1];
  for (let i = 0; i < table.length - 1; i++) {
    if (table[i].f <= f && table[i + 1].f >= f) {
      lo = table[i];
      hi = table[i + 1];
      break;
    }
  }

  // Exact match — no interpolation needed
  if (lo.f === hi.f || lo.f === f) return { k: lo.k, alpha: lo.alpha };
  if (hi.f === f) return { k: hi.k, alpha: hi.alpha };

  // Log-linear interpolation: t ∈ [0, 1] in log(freq) space
  const t = (Math.log(f) - Math.log(lo.f)) / (Math.log(hi.f) - Math.log(lo.f));
  const k = Math.exp(Math.log(lo.k) + t * (Math.log(hi.k) - Math.log(lo.k)));
  const alpha = lo.alpha + t * (hi.alpha - lo.alpha);

  return { k, alpha };
}

// === ITU-R P.676-12 Annex 2: Atmospheric Gas Attenuation ===

/** φ helper function for P.676-12 oxygen specific attenuation formula. */
function _p676phi(r_p, r_t, a, b, c, d) {
  return Math.pow(r_p, a) * Math.pow(r_t, b) * Math.exp(c * (1 - r_p) + d * (1 - r_t));
}

/**
 * ITU-R P.676-12 Annex 2 — specific oxygen attenuation γ_o (dB/km).
 * Valid for f ≤ 54 GHz; clamped above that (60 GHz band not used for satellite links).
 */
function _oxygenSpecificAtten(f, r_p, r_t) {
  if (f <= 0) return 0;
  const fc = Math.min(f, 53.9); // avoid singularity at 54 GHz
  const xi1 = _p676phi(r_p, r_t, 0.0717, -1.8132, 0.0156, -1.6515);
  const xi2 = _p676phi(r_p, r_t, 0.5146, -4.6368, -0.1921, -5.7416);
  const xi3 = _p676phi(r_p, r_t, 0.3414, -4.9364, 0.5765, -6.9953);
  const denom54 = Math.pow(Math.max(0.01, 54 - fc), 1.16 * xi1) + 0.83 * xi2;
  return ((7.2 * Math.pow(r_t, 2.8)) / (fc * fc + 0.34 * r_p * r_p * Math.pow(r_t, 1.6)) +
          (0.62 * xi3) / denom54) * fc * fc * r_p * r_p * 1e-3;
}

/**
 * ITU-R P.676-12 Annex 2 — specific water vapour attenuation γ_w (dB/km).
 * Captures the 22.235 GHz resonance dominant in the satellite band (1–100 GHz).
 * @param {number} rho  Water vapour density (g/m³), standard atmosphere ≈ 7.5 g/m³
 */
function _waterVaporSpecificAtten(f, rho, r_p, r_t) {
  if (f <= 0 || rho <= 0) return 0;
  const eta1 = 0.955 * r_p * Math.pow(r_t, 0.68) + 0.006 * rho;
  const d22  = (f - 22.235) * (f - 22.235) + 9.42 * eta1 * eta1;
  const d183 = (f - 183.31) * (f - 183.31) + 11.14 * eta1 * eta1;
  const d325 = (f - 325.15) * (f - 325.15) + 20.0;
  const continuum = 0.050 + 0.0021 * rho;
  return (continuum + 3.6 / d22 + 10.6 / d183 + 0.9 * eta1 / d325) * f * f * rho * r_t * 1e-4;
}

/**
 * Slant-path atmospheric gas attenuation using ITU-R P.676-12.
 * Integrates oxygen and water vapour over effective scale heights
 * (h_O = 6 km, h_W = 2.1 km) and applies a cosecant path correction.
 *
 * @param {number} freq_GHz
 * @param {number} elevation_deg  — clamped to ≥ 5° for formula validity
 * @param {object} atm  — { pressure_hPa=1013.25, temperature_C=15, waterVaporDensity_gm3=7.5 }
 * @returns {number}  Slant-path gas attenuation (dB)
 */
function gasAttenuationP676(freq_GHz, elevation_deg, {
  pressure_hPa = 1013.25,
  temperature_C = 15.0,
  waterVaporDensity_gm3 = 7.5
} = {}) {
  const f    = Math.max(0.1, freq_GHz);
  const sinEl = Math.sin(Math.max(5, elevation_deg) * Math.PI / 180);
  const r_p  = pressure_hPa / 1013.25;
  const r_t  = 288.15 / (273.15 + temperature_C);
  const rho  = Math.max(0, waterVaporDensity_gm3);

  const gamma_o = _oxygenSpecificAtten(Math.min(f, 53.9), r_p, r_t);
  const gamma_w = _waterVaporSpecificAtten(f, rho, r_p, r_t);

  // Zenith path attenuation (effective heights from ITU-R P.676 Table 2)
  const A_o_zenith = gamma_o * 6.0;  // h_O = 6 km
  const A_w_zenith = gamma_w * 2.1;  // h_W = 2.1 km

  return (A_o_zenith + A_w_zenith) / sinEl;
}

// === ITU-R P.840-8: Cloud and Fog Liquid Water Attenuation ===

/**
 * Cloud specific attenuation coefficient K_l (dB/(km·(g/m³)))
 * from the double-Debye dielectric model for liquid water (ITU-R P.840-8 / Liebe 1991).
 * @param {number} freq_GHz
 * @param {number} temperature_C  Cloud temperature; use 0 °C for a conservative estimate.
 */
function cloudKlP840(freq_GHz, temperature_C = 0) {
  const f   = Math.max(0.1, freq_GHz);
  const theta = 300 / (273.15 + temperature_C);

  // Liebe 1991 double-Debye parameters
  const eps_s   = 77.66 + 103.3 * (theta - 1);
  const eps_1   = 0.0671 * eps_s;
  const eps_inf = 3.52;
  const f_d1 = 20.2 - 146 * (theta - 1) + 316 * (theta - 1) ** 2; // GHz
  const f_d2 = 39.8 * f_d1;                                          // GHz

  const eps_prime = eps_inf +
    (eps_s - eps_1)   / (1 + (f / f_d1) ** 2) +
    (eps_1 - eps_inf) / (1 + (f / f_d2) ** 2);

  const eps_pp = f * (eps_s - eps_1)   / (f_d1 * (1 + (f / f_d1) ** 2)) +
                 f * (eps_1 - eps_inf) / (f_d2 * (1 + (f / f_d2) ** 2));

  // Rayleigh-limit absorption: Im[(ε–1)/(ε+2)] = 3ε'' / ((ε'+2)² + ε''²)
  const im_term = 3 * eps_pp / ((eps_prime + 2) ** 2 + eps_pp ** 2);

  // K_l [dB/(km·(g/m³))]:  (6π/λ) × Im × (10/ln10) / ρ_water
  // λ = c/f (m), ρ_water = 1e6 g/m³  →  factor = 6π f×1e9 / (3e8 × 1e6) × (10/ln10) × 1e3
  const K_l = (6 * Math.PI * f / (3e8 / 1e9)) * im_term * (10 / Math.LN10) * 1e-3;
  return K_l;
}

/**
 * Slant-path cloud/fog liquid water attenuation (ITU-R P.840-8).
 * A_c = K_l × L / sin(θ)
 * @param {number} freq_GHz
 * @param {number} elevation_deg
 * @param {number} columnarLWC_kgm2  Total columnar liquid water content (kg/m²);
 *                                   0.5 kg/m² is a typical mid-latitude value.
 * @param {number} cloudTemp_C       Cloud temperature for K_l (default 0 °C)
 */
function cloudAttenuationP840(freq_GHz, elevation_deg, columnarLWC_kgm2 = 0.5, cloudTemp_C = 0) {
  const sinEl = Math.sin(Math.max(5, elevation_deg) * Math.PI / 180);
  const K_l = cloudKlP840(freq_GHz, cloudTemp_C);
  return K_l * columnarLWC_kgm2 / sinEl;
}

// Deterministic Sum-of-Sinusoids for pseudo-random fading without Math.random
function getSoSFade(t_sec) {
  if (t_sec === undefined || t_sec === 0) return 0;
  const f = [0.11, 0.23, 0.37, 0.53, 0.79];
  const phi = [0.1, 1.2, 2.3, 3.4, 4.5];
  let sum = 0;
  for (let i = 0; i < 5; i++) {
    sum += Math.cos(2.0 * Math.PI * f[i] * t_sec + phi[i]);
  }
  return sum / 1.581; // Normalized to ~1.0 std dev
}

export function calculateLinkBudget(params) {
  const { freq = 30.0, rainRate = 0, elevation = 45, env, tec = 50.0, xpdAnt = 35.0, correctionFactor = 1.0, slantRange = 35786, hpbw = 2.0, simTime = 0 } = params;

  // === Elevation Pre-processing: Atmospheric Refraction (ITU-R) ===
  const trueElev = Math.max(0, elevation);
  const refractionCorrection = 1.02 / Math.tan((trueElev + 10.3 / (trueElev + 5.11)) * Math.PI / 180) / 60.0;
  const apparentElevation = elevation + refractionCorrection;

  // Assuming Ephemeris-based open-loop tracking.
  const pointingLoss = hpbw > 0 ? 12.0 * Math.pow(refractionCorrection / hpbw, 2) : 0;
  const effElev = apparentElevation;

  // ITU-R P.838-3 log-linear interpolation of k and α
  const { k, alpha } = getRainCoeffs(freq);

  // Apply correction factor to the gamma calculation (Rain attenuation multiplier)
  const gamma = k * Math.pow(rainRate, alpha) * correctionFactor;
  const elevRad = (effElev * Math.PI) / 180;
  const heightRain = 3.0; // km
  const slantPath = heightRain / Math.sin(elevRad);
  const rFactor = 1 / (1 + 0.045 * slantPath);
  const lEff = slantPath * rFactor;
  const attRain = gamma * lEff;

  // ITU-R P.676-12: gas attenuation (oxygen + water vapour)
  const attGas = gasAttenuationP676(freq, effElev);

  // ITU-R P.840-8: cloud liquid water attenuation
  const columnarLWC = params.columnarLWC_kgm2 ?? 0.5; // kg/m²; user-overridable
  const attCloud = cloudAttenuationP840(freq, effElev, columnarLWC);

  const totalAtmosphericLoss = attRain + attGas + attCloud + (params.gasAttenOffset_dB || 0);

  // 5. XPD & Ionospheric Effects (Faraday Rotation)
  const omegaDeg = (108 * tec) / (Math.pow(freq, 2) * Math.sin(elevRad));
  const omegaRad = (omegaDeg * Math.PI) / 180;

  // Polarization Mismatch Loss
  let lossFaraday = 0;
  const cosOmega = Math.abs(Math.cos(omegaRad));
  if (cosOmega > 0.001) {
    lossFaraday = -20 * Math.log10(cosOmega);
  } else {
    lossFaraday = 60.0; // max practical limit
  }

  // Faraday XPD
  let xpdFaraday = 40.0;
  const tanOmega = Math.abs(Math.tan(omegaRad));
  if (tanOmega > 1e-4) {
    xpdFaraday = -20 * Math.log10(tanOmega);
  }

  // Rain XPD
  let xpdRain = 40.0;
  if (attRain > 0.1) {
    const U = 30 * Math.log10(freq);
    const V = 20.0;
    xpdRain = U - V * Math.log10(attRain);
  }

  // Antenna XPD
  const xpdAntPower = Math.pow(10, -xpdAnt / 10);

  // Total XPD (power sum)
  const crossPowRain = Math.pow(10, -xpdRain / 10);
  const crossPowFaraday = Math.pow(10, -xpdFaraday / 10);
  let xpd = -10 * Math.log10(crossPowRain + crossPowFaraday + xpdAntPower);
  xpd = Math.max(0, Math.min(40, xpd));

  let fadeLMS = 0;
  if (env === 'urban') fadeLMS = 15.0 - effElev * 0.15;
  else if (env === 'suburban') fadeLMS = 6.0 - effElev * 0.05;
  else if (env === 'maritime') fadeLMS = 0.0; // Maritime has no trees/buildings, but strong multipath
  else fadeLMS = 0.5;

  let multipathLoss = 0;
  if (env === 'maritime') {
    // Two-ray geometry: Rx height = 15m, speed of light = 0.29979 GHz*m
    const h_rx = 15.0;
    const c_GHz_m = 0.299792458;
    const elevRadP = apparentElevation * (Math.PI / 180.0);
    // Phase difference = 4 * PI * h_rx * sin(elevation) * f / c
    const phaseTerm = (2.0 * Math.PI * h_rx * Math.abs(Math.sin(elevRadP)) * freq) / c_GHz_m;
    // G_mp = 4 * sin^2(phaseTerm) because flat water reflection has roughly PI phase shift and R=1
    let g_mp = 4.0 * Math.pow(Math.sin(phaseTerm), 2);
    g_mp = Math.max(0.01, g_mp); // Max 20dB deep fade to prevent -Infinity
    multipathLoss = -10.0 * Math.log10(g_mp); // negative dB means gain (e.g. up to -6dB loss = +6dB gain)
  }

  // FSPL Delta Model: Relative to GEO (35786 km) to keep UI Base SNR intuitive
  const refFspl = 20 * Math.log10(35786) + 20 * Math.log10(freq) + 92.45;
  const actualFspl = 20 * Math.log10(slantRange) + 20 * Math.log10(freq) + 92.45;
  const deltaFspl = actualFspl - refFspl;

  // Phased Array Scan Loss (Cosine Roll-off)
  let scanLoss = 0;
  if (params.isPhasedArray) {
    const scanAngleRad = (90.0 - apparentElevation) * (Math.PI / 180.0);
    const cosScan = Math.max(0.01, Math.cos(scanAngleRad)); // limit at exactly 0 elevation
    scanLoss = -15.0 * Math.log10(cosScan); // Alpha = 1.5, effectively 10 * 1.5 * log10(cos)
  }

  // === Milestones 17: Scintillation (Tropospheric & Ionospheric) ===
  const sinElev = Math.max(0.01, Math.sin(effElev * Math.PI / 180.0));
  const sigmaTropo = 0.025 * Math.pow(freq, 0.58) / Math.pow(sinElev, 1.2);
  const sigmaIono = ((params.tec || 50) / 100.0) * (2.0 / Math.pow(freq, 1.5)) / Math.pow(sinElev, 1.2);
  const scintillationSigma = Math.sqrt(sigmaTropo * sigmaTropo + sigmaIono * sigmaIono);

  // === Milestones 18: Ionospheric Group Delay & Dispersion ===
  const tecVal = params.tec !== undefined ? params.tec : 50;
  const bwMHz = params.bandwidth !== undefined ? params.bandwidth : 400;
  // ITU-R / GPS ionospheric delay: ∆t(ns) = 40.3/c * TEC(TECU) / f_GHz² * unit_conversion
  // Derived constant: 40.3 / (3e8 m/s) * 1e16 (TECU→el/m²) / (1e9 GHz→Hz)² * 1e9 (s→ns) ≈ 1.3433
  const IONO_CONST = 1.3433; // ns·GHz²/TECU
  const groupDelayNs = (IONO_CONST * tecVal) / (freq * freq * sinElev);
  // Derivative of Delay wrt frequency * bandwidth
  const dispersionNs = (2.0 * IONO_CONST * tecVal * (bwMHz / 1000.0)) / (Math.pow(freq, 3) * sinElev);
  // Max Symbol Rate (MBaud) ~ 1 / (2 * dispersion) to avoid severe ISI
  const maxSymbolRateMbaud = dispersionNs > 0.001 ? (1000.0 / (2.0 * dispersionNs)) : 999999;

  // Get time-varying fade; bypass for smooth static charts where simTime remains 0
  const scintLoss = (simTime && !params.disableFastFading) ? getSoSFade(simTime) * scintillationSigma : 0;

  const totalLoss = totalAtmosphericLoss + fadeLMS + lossFaraday + deltaFspl + pointingLoss + scanLoss + multipathLoss + scintLoss;

  // Sky Noise Temperature Model (Water vapor/Rain Blackbody)
  const tSky = 290.0 * (1.0 - Math.pow(10, -totalAtmosphericLoss / 10.0));

  return {
    attRain, attGas, attCloud, fadeLMS, lossFaraday, omegaDeg,
    totalLoss, xpd, actualFspl, deltaFspl,
    apparentElevation, refractionCorrection, pointingLoss, scanLoss, multipathLoss, tSky, totalAtmosphericLoss, scintLoss, scintillationSigma,
    groupDelayNs, dispersionNs, maxSymbolRateMbaud
  };
}

// === Milestone 21: Pass Prediction Algorithm ===
export function predictPasses(tleLine1, tleLine2, observerLat, observerLon, observerAlt = 0, hoursAhead = 24, minElev = 0) {
  try {
    const satrec = satellite.twoline2satrec(tleLine1, tleLine2);
    const observerGd = {
      longitude: satellite.degreesToRadians(observerLon),
      latitude: satellite.degreesToRadians(observerLat),
      height: observerAlt / 1000.0
    };
    const passes = [];
    const now = new Date();
    const endTime = new Date(now.getTime() + hoursAhead * 3600000);
    const stepMs = 60000; // 1-minute coarse scan
    const fineStepMs = 5000; // 5-second fine scan for TCA

    let inPass = false;
    let aosTime = null;
    let maxElev = -90;
    let tcaTime = null;

    function getElev(date) {
      const pv = satellite.propagate(satrec, date);
      if (!pv.position) return -999;
      const gmst = satellite.gstime(date);
      const ecf = satellite.eciToEcf(pv.position, gmst);
      const la = satellite.ecfToLookAngles(observerGd, ecf);
      return satellite.radiansToDegrees(la.elevation);
    }

    for (let t = now.getTime(); t <= endTime.getTime(); t += stepMs) {
      const date = new Date(t);
      const elev = getElev(date);
      if (elev === -999) continue;

      if (elev > minElev && !inPass) {
        // AOS detected - refine backwards
        inPass = true;
        let refineT = t - stepMs;
        for (let rt = refineT; rt <= t; rt += fineStepMs) {
          if (getElev(new Date(rt)) > minElev) { aosTime = new Date(rt); break; }
        }
        if (!aosTime) aosTime = date;
        maxElev = elev;
        tcaTime = date;
      } else if (elev > maxElev && inPass) {
        maxElev = elev;
        tcaTime = date;
      } else if (elev <= minElev && inPass) {
        // LOS detected - refine
        inPass = false;
        let losTime = date;
        for (let rt = t - stepMs; rt <= t; rt += fineStepMs) {
          if (getElev(new Date(rt)) <= minElev) { losTime = new Date(rt); break; }
        }
        const durationSec = (losTime.getTime() - aosTime.getTime()) / 1000;
        if (maxElev >= 1.0 && durationSec >= 30) {
          passes.push({
            aos: aosTime,
            tca: tcaTime,
            los: losTime,
            maxElev: maxElev,
            durationSec: durationSec
          });
        }
        aosTime = null; maxElev = -90; tcaTime = null;
      }
    }
    return passes;
  } catch (e) {
    console.error('Pass Prediction Error:', e);
    return [];
  }
}

// === Milestone 23: Generate Replay Timeline for a Pass ===
export function generatePassReplay(tleLine1, tleLine2, observerLat, observerLon, observerAlt = 0, startTime, endTime, stepSec = 10, linkParams = {}) {
  try {
    const satrec = satellite.twoline2satrec(tleLine1, tleLine2);
    const observerGd = {
      longitude: satellite.degreesToRadians(observerLon),
      latitude: satellite.degreesToRadians(observerLat),
      height: observerAlt / 1000.0
    };
    const timeline = [];
    for (let t = startTime.getTime(); t <= endTime.getTime(); t += stepSec * 1000) {
      const date = new Date(t);
      const pv = satellite.propagate(satrec, date);
      if (!pv.position) continue;
      const gmst = satellite.gstime(date);
      const ecf = satellite.eciToEcf(pv.position, gmst);
      const la = satellite.ecfToLookAngles(observerGd, ecf);
      const elev = satellite.radiansToDegrees(la.elevation);
      const az = satellite.radiansToDegrees(la.azimuth);
      const range = la.rangeSat;
      // Compute link budget at this geometry
      const lb = calculateLinkBudget({ ...linkParams, elevation: Math.max(0.1, elev), slantRange: range });
      timeline.push({
        time: date,
        timeLabel: date.toLocaleTimeString(),
        elevation: elev,
        azimuth: az,
        slantRange: range,
        totalLoss: lb.totalLoss,
        tSky: lb.tSky,
        deltaFspl: lb.deltaFspl,
        totalAtmosphericLoss: lb.totalAtmosphericLoss,
        snrEff: lb.snrEff || 0
      });
    }
    return timeline;
  } catch (e) {
    console.error('Replay Generation Error:', e);
    return [];
  }
}

// === Milestone 22: Ground Track & Sky Track Computation ===
export function computeGroundTrack(tleLine1, tleLine2, minutesAhead = 100) {
  try {
    const satrec = satellite.twoline2satrec(tleLine1, tleLine2);
    const points = [];
    const now = new Date();
    const stepMin = 1;
    for (let m = -10; m <= minutesAhead; m += stepMin) {
      const date = new Date(now.getTime() + m * 60000);
      const pv = satellite.propagate(satrec, date);
      if (!pv.position) continue;
      const gmst = satellite.gstime(date);
      const geodetic = satellite.eciToGeodetic(pv.position, gmst);
      points.push({
        lat: satellite.radiansToDegrees(geodetic.latitude),
        lon: satellite.radiansToDegrees(geodetic.longitude),
        alt: geodetic.height,
        isCurrent: m === 0
      });
    }
    return points;
  } catch (e) {
    console.error('Ground Track Error:', e);
    return [];
  }
}

// Generate WGS84 trajectory samples from TLE using SGP4 propagation.
export function generateWgs84Trajectory(tleLine1, tleLine2, startTime = new Date(), durationHours = 24, stepMinutes = 1) {
  try {
    const satrec = satellite.twoline2satrec(tleLine1, tleLine2);
    const totalMinutes = durationHours * 60;
    const stepMin = stepMinutes;
    const start = new Date(startTime);
    const samples = [];

    for (let minute = 0; minute <= totalMinutes; minute += stepMin) {
      const date = new Date(start.getTime() + minute * 60000);
      const pv = satellite.propagate(satrec, date);
      if (!pv.position) continue;

      const gmst = satellite.gstime(date);
      const geodetic = satellite.eciToGeodetic(pv.position, gmst);
      samples.push({
        timestamp: date.toISOString(),
        latitudeDeg: satellite.radiansToDegrees(geodetic.latitude),
        longitudeDeg: satellite.radiansToDegrees(geodetic.longitude),
        altitudeKm: geodetic.height
      });
    }

    return samples;
  } catch (e) {
    console.error('WGS84 Trajectory Generation Error:', e);
    return [];
  }
}

export function generateWgs84TrajectoryCsv(tleLine1, tleLine2, startTime = new Date(), durationHours = 24, stepMinutes = 1) {
  const trajectory = generateWgs84Trajectory(tleLine1, tleLine2, startTime, durationHours, stepMinutes);
  if (!trajectory.length) return '';

  const header = 'Timestamp,Latitude (deg),Longitude (deg),Altitude (km)';
  const rows = trajectory.map((p) => {
    return `${p.timestamp},${p.latitudeDeg.toFixed(6)},${p.longitudeDeg.toFixed(6)},${p.altitudeKm.toFixed(3)}`;
  });

  return [header, ...rows].join('\n');
}

export function computeSkyTrack(tleLine1, tleLine2, observerLat, observerLon, observerAlt = 0, minutesAhead = 100) {
  try {
    const satrec = satellite.twoline2satrec(tleLine1, tleLine2);
    const observerGd = {
      longitude: satellite.degreesToRadians(observerLon),
      latitude: satellite.degreesToRadians(observerLat),
      height: observerAlt / 1000.0
    };
    const points = [];
    const now = new Date();
    for (let m = -10; m <= minutesAhead; m += 1) {
      const date = new Date(now.getTime() + m * 60000);
      const pv = satellite.propagate(satrec, date);
      if (!pv.position) continue;
      const gmst = satellite.gstime(date);
      const ecf = satellite.eciToEcf(pv.position, gmst);
      const la = satellite.ecfToLookAngles(observerGd, ecf);
      const elev = satellite.radiansToDegrees(la.elevation);
      const az = satellite.radiansToDegrees(la.azimuth);
      points.push({ az, elev, isCurrent: m === 0 });
    }
    return points;
  } catch (e) {
    console.error('Sky Track Error:', e);
    return [];
  }
}

export function calculateDynamicOrbit(tleLine1, tleLine2, observerLat, observerLon, observerAlt, date = new Date()) {
  try {
    const satrec = satellite.twoline2satrec(tleLine1, tleLine2);
    const positionAndVelocity = satellite.propagate(satrec, date);
    const positionEci = positionAndVelocity.position;

    if (!positionEci) return null; // Sat decayed etc.

    const gmst = satellite.gstime(date);
    const observerGd = {
      longitude: satellite.degreesToRadians(observerLon),
      latitude: satellite.degreesToRadians(observerLat),
      height: observerAlt / 1000.0 // required in km
    };

    const positionEcf = satellite.eciToEcf(positionEci, gmst);
    const lookAngles = satellite.ecfToLookAngles(observerGd, positionEcf);

    return {
      azimuth: satellite.radiansToDegrees(lookAngles.azimuth),
      elevation: satellite.radiansToDegrees(lookAngles.elevation),
      slantRange: lookAngles.rangeSat // km
    };
  } catch (e) {
    console.error("Orbit Calculation Error:", e);
    return null;
  }
}

export function calculateMIMOCapacity(snrDb, xpdDb) {
  const snr = Math.pow(10, snrDb / 10);
  const crosstalkPower = Math.pow(10, -xpdDb / 10);
  const pSig = snr / 2;
  const sinrSimple = pSig / (1 + pSig * crosstalkPower);
  const capRank2 = 2 * Math.log2(1 + sinrSimple);
  const capRank1 = Math.log2(1 + snr);
  return { capRank2, capRank1 };
}

// Simple Least Squares fit for the Rain Attenuation correction factor
// (保留向后兼容，新代码应使用 calibrateModel)
export function fitModelToData(realData, currentParams) {
  if (!realData || realData.length === 0) return 1.0;

  let bestFactor = 1.0;
  let minError = Infinity;

  for (let factor = 0.5; factor <= 2.5; factor += 0.05) {
    let errorSum = 0;
    for (const point of realData) {
      if (point.rainRate == null || point.measuredLoss == null) continue;

      const testParams = { ...currentParams, rainRate: point.rainRate, correctionFactor: factor };
      const theoretical = calculateLinkBudget(testParams).totalLoss;
      errorSum += Math.pow(theoretical - point.measuredLoss, 2);
    }

    if (errorSum < minError) {
      minError = errorSum;
      bestFactor = factor;
    }
  }

  return bestFactor;
}

// === 多参数校准系统 ===

/**
 * 校准参数配置 — 定义可校准参数及其约束
 */
const CALIB_PARAM_DEFS = [
  { key: 'correctionFactor', label: '雨衰修正系数', defaultVal: 1.0, min: 0.3, max: 3.0, step: 0.01 },
  { key: 'gasAttenOffset_dB', label: '气体衰减偏移(dB)', defaultVal: 0.0, min: -2.0, max: 2.0, step: 0.01 },
  { key: 'scatterPowerOffset_dB', label: '散射功率偏移(dB)', defaultVal: 0.0, min: -10, max: 5.0, step: 0.1 },
  { key: 'eirpOffset_dB', label: 'EIRP偏移(dB)', defaultVal: 0.0, min: -5.0, max: 5.0, step: 0.1 },
  { key: 'systemNoiseOffset_K', label: '噪温偏移(K)', defaultVal: 0.0, min: -50, max: 100, step: 1.0 }
];

/**
 * 创建默认校准配置（所有偏移为零）
 * @returns {object} CalibrationProfile
 */
export function createDefaultCalibration() {
  const profile = {
    calibrated: false,
    timestamp: null,
    dataPointCount: 0,
    residualRMS: 0,
    params: {}
  };
  for (const def of CALIB_PARAM_DEFS) {
    profile.params[def.key] = def.defaultVal;
  }
  return profile;
}

/**
 * 将校准结果应用到链路参数
 * @param {object} rawParams — 原始链路参数
 * @param {object} calibProfile — CalibrationProfile
 * @returns {object} — 校准后的参数
 */
export function applyCalibration(rawParams, calibProfile) {
  if (!calibProfile || !calibProfile.calibrated) return rawParams;

  const cp = calibProfile.params;
  return {
    ...rawParams,
    correctionFactor: cp.correctionFactor || 1.0,
    gasAttenOffset_dB: cp.gasAttenOffset_dB || 0,
    scatterPowerOffset_dB: cp.scatterPowerOffset_dB || 0,
    eirp: (rawParams.eirp || 60.0) + (cp.eirpOffset_dB || 0),
    tRx: (rawParams.tRx || 150.0) + (cp.systemNoiseOffset_K || 0)
  };
}

/**
 * 根据链路参数仿真出与测量数据对比的预测值
 * @param {object} linkParams — 链路参数（含校准偏移）
 * @param {object} measurement — 单个测量数据点
 * @returns {object} — { predictedCN0, predictedRSSI, predictedXPD, predictedAtten }
 */
function simulateForMeasurement(linkParams, measurement) {
  const testParams = {
    ...linkParams,
    elevation: measurement.elevation || linkParams.elevation || 30,
    rainRate: measurement.rainRate != null ? measurement.rainRate : (linkParams.rainRate || 0)
  };
  const lb = calculateLinkBudget(testParams);

  const freq = linkParams.freq || 30;
  const eirp = linkParams.eirp || 60.0;
  const gRx = linkParams.gRx || 42.0;
  const tRx = linkParams.tRx || 150.0;
  const bwMHz = linkParams.bandwidth || 400.0;
  const slantRange = linkParams.slantRange || 35786;

  const absoluteFspl = 20 * Math.log10(slantRange) + 20 * Math.log10(freq) + 92.45;
  const absoluteLoss = lb.totalAtmosphericLoss + lb.fadeLMS + lb.lossFaraday
    + lb.pointingLoss + (lb.scanLoss || 0) + (lb.multipathLoss || 0) + absoluteFspl;
  const rxPowerDbm = eirp + 30 - absoluteLoss + gRx;

  const k_boltzmann = 1.380649e-23;
  const tSys = tRx + lb.tSky + 3.0;
  const noisePowerW = k_boltzmann * tSys * (bwMHz * 1e6);
  const noiseFloorDbm = 10 * Math.log10(noisePowerW) + 30;
  const cn0 = Math.max(-30, rxPowerDbm - noiseFloorDbm);

  return {
    predictedCN0: cn0,
    predictedRSSI: rxPowerDbm,
    predictedXPD: lb.xpd,
    predictedAtten: lb.totalAtmosphericLoss,
    totalLoss: lb.totalLoss
  };
}

/**
 * 计算残差向量 — 仿真值与测量值的差
 * @param {Array} measurements — 测量数据数组
 * @param {object} linkParams — 当前链路参数
 * @param {object} calibParams — 当前校准参数值
 * @returns {Array<number>} — 残差数组
 */
function computeResiduals(measurements, linkParams, calibParams) {
  const testProfile = { calibrated: true, params: calibParams };
  const calibratedParams = applyCalibration(linkParams, testProfile);
  const residuals = [];

  for (const m of measurements) {
    const sim = simulateForMeasurement(calibratedParams, m);

    // 根据可用的测量类型计算残差（加权）
    if (m.measuredCN0_dB != null) {
      residuals.push((sim.predictedCN0 - m.measuredCN0_dB) * 2.0);    // C/N0 权重最高
    }
    if (m.measuredRSSI_dBm != null) {
      residuals.push((sim.predictedRSSI - m.measuredRSSI_dBm) * 1.5);  // RSSI 次之
    }
    if (m.measuredXPD_dB != null) {
      residuals.push((sim.predictedXPD - m.measuredXPD_dB) * 1.0);
    }
    if (m.measuredAttenuation_dB != null) {
      residuals.push((sim.predictedAtten - m.measuredAttenuation_dB) * 1.5);
    }
    // 向后兼容旧格式
    if (m.measuredLoss != null && m.measuredCN0_dB == null) {
      residuals.push((sim.totalLoss - m.measuredLoss) * 1.0);
    }
  }

  return residuals;
}

/**
 * 多参数校准 — Gauss-Newton 迭代优化
 *
 * @param {Array} measurements — 扩展格式的测量数据数组
 * @param {object} linkParams — 当前链路参数
 * @param {object} refSatellite — 可选的已知卫星参数 (来自 knownSatellites.js)
 * @returns {object} CalibrationProfile
 */
export function calibrateModel(measurements, linkParams, refSatellite = null) {
  if (!measurements || measurements.length === 0) {
    return createDefaultCalibration();
  }

  // 合并已知卫星参数
  const effectiveParams = refSatellite
    ? { ...linkParams, freq: refSatellite.freq, eirp: refSatellite.eirp }
    : { ...linkParams };

  // 初始化校准参数
  const calibParams = {};
  for (const def of CALIB_PARAM_DEFS) {
    calibParams[def.key] = def.defaultVal;
  }

  const maxIterations = 30;
  const convergenceThreshold = 1e-6;
  const dampingFactor = 0.01; // Levenberg-Marquardt 阻尼

  for (let iter = 0; iter < maxIterations; iter++) {
    const residuals = computeResiduals(measurements, effectiveParams, calibParams);
    const currentCost = residuals.reduce((s, r) => s + r * r, 0);

    // 数值雅可比矩阵 (J)
    const nParams = CALIB_PARAM_DEFS.length;
    const nResiduals = residuals.length;
    const J = [];

    for (let p = 0; p < nParams; p++) {
      const def = CALIB_PARAM_DEFS[p];
      const delta = Math.max(def.step * 0.1, 1e-6);
      const savedVal = calibParams[def.key];

      calibParams[def.key] = savedVal + delta;
      const rPlus = computeResiduals(measurements, effectiveParams, calibParams);

      calibParams[def.key] = savedVal;

      const col = [];
      for (let r = 0; r < nResiduals; r++) {
        col.push((rPlus[r] - residuals[r]) / delta);
      }
      J.push(col);
    }

    // Gauss-Newton: (J^T * J + λI) * Δp = -J^T * r
    // 构建 J^T * J  和  J^T * r
    const JtJ = Array.from({ length: nParams }, () => new Float64Array(nParams));
    const JtR = new Float64Array(nParams);

    for (let i = 0; i < nParams; i++) {
      for (let j = 0; j < nParams; j++) {
        let sum = 0;
        for (let r = 0; r < nResiduals; r++) {
          sum += J[i][r] * J[j][r];
        }
        JtJ[i][j] = sum;
      }
      // J^T * r
      let sumR = 0;
      for (let r = 0; r < nResiduals; r++) {
        sumR += J[i][r] * residuals[r];
      }
      JtR[i] = sumR;
    }

    // 加阻尼 (LM)
    for (let i = 0; i < nParams; i++) {
      JtJ[i][i] += dampingFactor * (JtJ[i][i] + 1e-8);
    }

    // 解 Δp — Gaussian elimination (小矩阵 5x5)
    const A = JtJ.map(row => [...row]);
    const b = [...JtR];

    for (let col = 0; col < nParams; col++) {
      // 部分主元
      let maxRow = col;
      for (let row = col + 1; row < nParams; row++) {
        if (Math.abs(A[row][col]) > Math.abs(A[maxRow][col])) maxRow = row;
      }
      [A[col], A[maxRow]] = [A[maxRow], A[col]];
      [b[col], b[maxRow]] = [b[maxRow], b[col]];

      const pivot = A[col][col];
      if (Math.abs(pivot) < 1e-12) continue;

      for (let row = col + 1; row < nParams; row++) {
        const factor = A[row][col] / pivot;
        for (let j = col; j < nParams; j++) {
          A[row][j] -= factor * A[col][j];
        }
        b[row] -= factor * b[col];
      }
    }

    // 回代
    const dp = new Float64Array(nParams);
    for (let i = nParams - 1; i >= 0; i--) {
      let sum = b[i];
      for (let j = i + 1; j < nParams; j++) {
        sum -= A[i][j] * dp[j];
      }
      dp[i] = Math.abs(A[i][i]) > 1e-12 ? sum / A[i][i] : 0;
    }

    // 更新参数（带边界约束）
    let maxStep = 0;
    for (let p = 0; p < nParams; p++) {
      const def = CALIB_PARAM_DEFS[p];
      const newVal = Math.max(def.min, Math.min(def.max, calibParams[def.key] - dp[p]));
      maxStep = Math.max(maxStep, Math.abs(newVal - calibParams[def.key]));
      calibParams[def.key] = newVal;
    }

    if (maxStep < convergenceThreshold) break;
  }

  // 最终残差统计
  const finalResiduals = computeResiduals(measurements, effectiveParams, calibParams);
  const rmsResidual = Math.sqrt(finalResiduals.reduce((s, r) => s + r * r, 0) / Math.max(1, finalResiduals.length));

  return {
    calibrated: true,
    timestamp: new Date().toISOString(),
    dataPointCount: measurements.length,
    residualRMS: rmsResidual,
    refSatellite: refSatellite ? refSatellite.satName : null,
    params: { ...calibParams }
  };
}

/** 获取校准参数定义（供 UI 展示） */
export function getCalibParamDefs() {
  return CALIB_PARAM_DEFS;
}

// === 信道冲激响应 (CIR) — 抽头延迟线 (TDL) 模型 ===
export function computeCIR(params) {
  const frequency_GHz = params.freq ?? 30;
  const elevation_deg = params.elevation ?? 45;
  const environment = params.env ?? 'rural';
  const tec_TECU = params.tec ?? 50;
  const firstPass = computeStatisticalCir({
    frequency_Hz: frequency_GHz * 1e9,
    elevation_deg,
    slantRange_m: params.slantRange == null ? undefined : params.slantRange * 1e3,
    satelliteAltitude_m: (params.satelliteAltitude_km ?? params.satAlt ?? 550) * 1e3,
    environment,
    tec_TECU,
    bandwidth_Hz: (params.bandwidth ?? 400) * 1e6,
    scatterPowerOffset_dB: params.scatterPowerOffset_dB ?? 0,
    simTime_s: params.simTime ?? 0,
  });
  const budget = calculateLinkBudget({
    ...params,
    freq: frequency_GHz,
    elevation: elevation_deg,
    slantRange: firstPass.slantRange_m / 1e3,
    tec: tec_TECU,
  });
  const cir = computeStatisticalCir({
    frequency_Hz: frequency_GHz * 1e9,
    elevation_deg,
    slantRange_m: firstPass.slantRange_m,
    environment,
    tec_TECU,
    bandwidth_Hz: (params.bandwidth ?? 400) * 1e6,
    scatterPowerOffset_dB: params.scatterPowerOffset_dB ?? 0,
    atmosphericLoss_dB: budget.totalAtmosphericLoss,
    simTime_s: params.simTime ?? 0,
  });

  return {
    taps: cir.taps.map((tap, index) => ({
      ...tap,
      index,
      delay_ns: tap.absoluteDelay_s * 1e9,
      excessDelay_ns: tap.excessDelay_s * 1e9,
      amplitude_linear: Math.hypot(
        tap.complexAmplitude.real,
        tap.complexAmplitude.imag,
      ),
      amplitude_dB: tap.power_dB,
    })),
    pdp: cir.pdp,
    meanDelay_ns: cir.metrics.meanExcessDelay_s * 1e9,
    rmsDelaySpread_ns: cir.metrics.rmsDelaySpread_s * 1e9,
    coherenceBandwidth_MHz: Number.isFinite(cir.metrics.coherenceBandwidth_Hz)
      ? cir.metrics.coherenceBandwidth_Hz / 1e6
      : 99_999,
    absoluteDelay_ns: cir.taps[0].absoluteDelay_s * 1e9,
    absoluteFspl: cir.absoluteFspl_dB,
    totalAtmLoss: cir.atmosphericLoss_dB,
    slantRange_km: cir.slantRange_m / 1e3,
  };
}

// === 信道传播时间序列生成器 ===
export function generateChannelTimeSeriesForTimestamps(
  tleLine1, tleLine2,
  observerLat, observerLon, observerAlt,
  timestamps,
  linkParams = {}
) {
  try {
    const satrec = satellite.twoline2satrec(tleLine1, tleLine2);
    const observerGd = {
      longitude: satellite.degreesToRadians(observerLon),
      latitude: satellite.degreesToRadians(observerLat),
      height: observerAlt / 1000.0
    };
    const observerPositionEcf_km = groundPositionEcf({
      latitude_deg: observerLat,
      longitude_deg: observerLon,
      altitude_m: observerAlt,
    });

    const k_boltzmann = 1.380649e-23;
    const timeline = [];
    let frameIndex = 0;

    for (const date of timestamps) {
      const pv = satellite.propagate(satrec, date);
      if (!pv.position) { frameIndex++; continue; }

      const gmst = satellite.gstime(date);
      const ecf = satellite.eciToEcf(pv.position, gmst);
      const geodetic = satellite.eciToGeodetic(pv.position, gmst);
      const la = satellite.ecfToLookAngles(observerGd, ecf);
      const elev = satellite.radiansToDegrees(la.elevation);
      const az = satellite.radiansToDegrees(la.azimuth);
      const range = la.rangeSat;

      const dopplerHz = calculateDopplerFromEciState({
        positionEci_km: pv.position,
        velocityEci_kmps: pv.velocity,
        observerPositionEcf_km,
        gmst_rad: gmst,
        frequency_Hz: (linkParams.freq ?? 30) * 1e9,
      }).doppler_Hz;

      const simTimeSec = (date.getTime() - timestamps[0].getTime()) / 1000.0;

      const lbParams = {
        ...linkParams,
        elevation: Math.max(0.1, elev),
        slantRange: range,
        simTime: linkParams.disableFastFading ? 0 : simTimeSec
      };
      const lb = calculateLinkBudget(lbParams);

      const absoluteFspl = 20 * Math.log10(range) + 20 * Math.log10(linkParams.freq || 30) + 92.45;
      const eirp = linkParams.eirp || 60.0;
      const gRx = linkParams.gRx || 42.0;
      const tRx = linkParams.tRx || 150.0;
      const bwMHz = linkParams.bandwidth || 400.0;

      const absoluteLoss = lb.totalAtmosphericLoss + lb.fadeLMS + lb.lossFaraday
        + lb.pointingLoss + (lb.scanLoss || 0) + (lb.multipathLoss || 0)
        + (lb.scintLoss || 0) + absoluteFspl;
      const rxPowerDbm = eirp + 30 - absoluteLoss + gRx;

      const tSys = tRx + lb.tSky + 3.0;
      const noisePowerW = k_boltzmann * tSys * (bwMHz * 1e6);
      const noiseFloorDbm = 10 * Math.log10(noisePowerW) + 30;
      const snrDb = Math.max(-30, rxPowerDbm - noiseFloorDbm);

      const { capRank2, capRank1 } = calculateMIMOCapacity(snrDb, lb.xpd);
      const cir = computeCIR({ ...lbParams, freq: linkParams.freq || 30, satAlt: geodetic.height });

      timeline.push({
        time: date,
        timeLabel: date.toLocaleTimeString(),
        frameIndex,
        elevation: elev, azimuth: az, slantRange: range,
        satLat: satellite.radiansToDegrees(geodetic.latitude),
        satLon: satellite.radiansToDegrees(geodetic.longitude),
        satAlt: geodetic.height,
        apparentElevation: lb.apparentElevation,
        absoluteFspl, rxPowerDbm, noiseFloorDbm, snrDb,
        attRain: lb.attRain, attGas: lb.attGas, attCloud: lb.attCloud, totalAtmosphericLoss: lb.totalAtmosphericLoss,
        fadeLMS: lb.fadeLMS, lossFaraday: lb.lossFaraday, pointingLoss: lb.pointingLoss,
        scanLoss: lb.scanLoss || 0, multipathLoss: lb.multipathLoss || 0, scintLoss: lb.scintLoss || 0, tSky: lb.tSky,
        xpd: lb.xpd, capRank1, capRank2, groupDelayNs: lb.groupDelayNs, dispersionNs: lb.dispersionNs,
        cir,
        dopplerHz: isNaN(dopplerHz) ? 0 : dopplerHz
      });
      frameIndex++;
    }
    return timeline;
  } catch (e) {
    console.error('Channel TimeSeries For Timestamps Error:', e);
    return [];
  }
}

export function generateChannelTimeSeries(
  tleLine1, tleLine2,
  observerLat, observerLon, observerAlt,
  startTime, endTime, stepSec,
  linkParams = {}
) {
  try {
    const satrec = satellite.twoline2satrec(tleLine1, tleLine2);
    const observerGd = {
      longitude: satellite.degreesToRadians(observerLon),
      latitude: satellite.degreesToRadians(observerLat),
      height: observerAlt / 1000.0
    };
    const observerPositionEcf_km = groundPositionEcf({
      latitude_deg: observerLat,
      longitude_deg: observerLon,
      altitude_m: observerAlt,
    });

    const k_boltzmann = 1.380649e-23;
    const timeline = [];
    let frameIndex = 0;

    for (let t = startTime.getTime(); t <= endTime.getTime(); t += stepSec * 1000) {
      const date = new Date(t);
      const pv = satellite.propagate(satrec, date);
      if (!pv.position) continue;

      const gmst = satellite.gstime(date);
      const ecf = satellite.eciToEcf(pv.position, gmst);
      const geodetic = satellite.eciToGeodetic(pv.position, gmst);
      const la = satellite.ecfToLookAngles(observerGd, ecf);
      const elev = satellite.radiansToDegrees(la.elevation);
      const az = satellite.radiansToDegrees(la.azimuth);
      const range = la.rangeSat;

      const dopplerHz = calculateDopplerFromEciState({
        positionEci_km: pv.position,
        velocityEci_kmps: pv.velocity,
        observerPositionEcf_km,
        gmst_rad: gmst,
        frequency_Hz: (linkParams.freq ?? 30) * 1e9,
      }).doppler_Hz;

      // 仿真时间（秒），用于 SoS 确定性衰落
      const simTimeSec = frameIndex * stepSec;

      // 完整链路预算（使用绝对 FSPL）
      const lbParams = {
        ...linkParams,
        elevation: Math.max(0.1, elev),
        slantRange: range,
        simTime: linkParams.disableFastFading ? 0 : simTimeSec
      };
      const lb = calculateLinkBudget(lbParams);

      // 绝对 FSPL（不依赖 GEO 参考）
      const absoluteFspl = 20 * Math.log10(range) + 20 * Math.log10(linkParams.freq || 30) + 92.45;

      // 绝对接收功率 & 噪底 & SNR
      const eirp = linkParams.eirp || 60.0;
      const gRx = linkParams.gRx || 42.0;
      const tRx = linkParams.tRx || 150.0;
      const bwMHz = linkParams.bandwidth || 400.0;

      const absoluteLoss = lb.totalAtmosphericLoss + lb.fadeLMS + lb.lossFaraday
        + lb.pointingLoss + (lb.scanLoss || 0) + (lb.multipathLoss || 0)
        + (lb.scintLoss || 0) + absoluteFspl;
      const rxPowerDbm = eirp + 30 - absoluteLoss + gRx;

      const tSys = tRx + lb.tSky + 3.0;
      const noisePowerW = k_boltzmann * tSys * (bwMHz * 1e6);
      const noiseFloorDbm = 10 * Math.log10(noisePowerW) + 30;
      const snrDb = Math.max(-30, rxPowerDbm - noiseFloorDbm);

      // MIMO 容量
      const { capRank2, capRank1 } = calculateMIMOCapacity(snrDb, lb.xpd);

      // CIR
      const cir = computeCIR({
        ...lbParams,
        freq: linkParams.freq || 30,
        satAlt: geodetic.height,
      });

      timeline.push({
        time: date,
        timeLabel: date.toLocaleTimeString(),
        frameIndex,
        // 几何
        elevation: elev,
        azimuth: az,
        slantRange: range,
        satLat: satellite.radiansToDegrees(geodetic.latitude),
        satLon: satellite.radiansToDegrees(geodetic.longitude),
        satAlt: geodetic.height,
        apparentElevation: lb.apparentElevation,
        // 链路预算（绝对值）
        absoluteFspl,
        rxPowerDbm,
        noiseFloorDbm,
        snrDb,
        // 衰减分解
        attRain: lb.attRain,
        attGas: lb.attGas,
        attCloud: lb.attCloud,
        totalAtmosphericLoss: lb.totalAtmosphericLoss,
        fadeLMS: lb.fadeLMS,
        lossFaraday: lb.lossFaraday,
        pointingLoss: lb.pointingLoss,
        scanLoss: lb.scanLoss || 0,
        multipathLoss: lb.multipathLoss || 0,
        scintLoss: lb.scintLoss || 0,
        tSky: lb.tSky,
        // 极化 & MIMO
        xpd: lb.xpd,
        capRank1,
        capRank2,
        // 电离层
        groupDelayNs: lb.groupDelayNs,
        dispersionNs: lb.dispersionNs,
        // CIR
        cir,
        // Doppler
        dopplerHz: isNaN(dopplerHz) ? 0 : dopplerHz
      });

      frameIndex++;
    }
    return timeline;
  } catch (e) {
    console.error('Channel TimeSeries Generation Error:', e);
    return [];
  }
}

export function generateTrajectoryExport(tleLine1, tleLine2, gsLat, gsLon, gsAlt = 0, configOrHours = 24, stepMinutes = 1, startTime = new Date()) {
  try {
    const satrec = satellite.twoline2satrec(tleLine1, tleLine2);
    const points = [];
    let start = new Date(startTime);
    let durationMs = 24 * 60 * 60 * 1000;
    let stepMs = 60 * 1000;

    if (typeof configOrHours === 'object' && configOrHours !== null) {
      start = new Date(configOrHours.startTime || startTime || new Date());
      durationMs = configOrHours.durationMs ?? durationMs;
      stepMs = configOrHours.stepMs ?? stepMs;
    } else {
      durationMs = Number(configOrHours) * 60 * 60 * 1000;
      stepMs = Number(stepMinutes) * 60 * 1000;
    }

    if (!Number.isFinite(durationMs) || durationMs < 0 || !Number.isFinite(stepMs) || stepMs <= 0) {
      return [];
    }

    const gsGd = {
      latitude: satellite.degreesToRadians(gsLat),
      longitude: satellite.degreesToRadians(gsLon),
      height: gsAlt / 1000
    };

    const totalSteps = Math.floor(durationMs / stepMs);
    for (let step = 0; step <= totalSteps; step++) {
      const date = new Date(start.getTime() + step * stepMs);
      const pv = satellite.propagate(satrec, date);
      if (!pv.position) continue;
      const gmst = satellite.gstime(date);
      const geodetic = satellite.eciToGeodetic(pv.position, gmst);
      
      const positionEcf = satellite.eciToEcf(pv.position, gmst);
      const lookAngles = satellite.ecfToLookAngles(gsGd, positionEcf);

      points.push({
        time: date.toISOString(),
        satLat: satellite.radiansToDegrees(geodetic.latitude),
        satLon: satellite.radiansToDegrees(geodetic.longitude),
        satAlt: geodetic.height,
        azimuth: satellite.radiansToDegrees(lookAngles.azimuth),
        elevation: satellite.radiansToDegrees(lookAngles.elevation),
        range: lookAngles.rangeSat ?? lookAngles.range ?? 0
      });
    }
    return points;
  } catch (e) {
    console.error("Trajectory generation error:", e);
    return [];
  }
}

export function extractGoldenTrajectory(denseTrajectory, streetAzimuth = null) {
  if (!denseTrajectory || denseTrajectory.length === 0) return [];
  
  // Sort by time
  const sorted = [...denseTrajectory].sort((a, b) => new Date(a.time) - new Date(b.time));
  
  // Find highest elevation point (Benchmark)
  let maxElevPoint = sorted[0];
  let maxElevIdx = 0;
  sorted.forEach((pt, i) => {
    if (pt.elevation > maxElevPoint.elevation) {
      maxElevPoint = pt;
      maxElevIdx = i;
    }
  });
  
  const goldenPoints = [];
  const thresholds = [15, 30, 45, 60];
  
  // Ascending phase (0 to maxElevIdx)
  let ascThreshIdx = 0;
  for (let i = 0; i <= maxElevIdx; i++) {
    const pt = sorted[i];
    while (ascThreshIdx < thresholds.length && pt.elevation >= thresholds[ascThreshIdx]) {
      const targetElev = thresholds[ascThreshIdx];
      goldenPoints.push({
        ...pt,
        feature: `Elev_${targetElev}_Asc`,
        description: targetElev === 15 ? 'AOS Entry (Low Elev)' : targetElev === 45 ? 'Building Blockage Threshold' : `Mid Elev ${targetElev}`
      });
      ascThreshIdx++;
    }
  }
  
  goldenPoints.push({
    ...maxElevPoint,
    feature: 'Max_Elevation',
    description: 'Zenith / Shortest Path (Benchmark LOS)'
  });
  
  // Descending phase (maxElevIdx to end)
  let descThreshIdx = thresholds.length - 1;
  // Skip thresholds that were never reached by this pass
  while (descThreshIdx >= 0 && maxElevPoint.elevation < thresholds[descThreshIdx]) {
    descThreshIdx--;
  }

  for (let i = maxElevIdx + 1; i < sorted.length; i++) {
    const pt = sorted[i];
    while (descThreshIdx >= 0 && pt.elevation <= thresholds[descThreshIdx]) {
      const targetElev = thresholds[descThreshIdx];
      goldenPoints.push({
        ...pt,
        feature: `Elev_${targetElev}_Desc`,
        description: targetElev === 15 ? 'LOS Exit (Low Elev)' : targetElev === 45 ? 'Building Blockage Threshold' : `Mid Elev ${targetElev}`
      });
      descThreshIdx--;
    }
  }
  
  // Street Azimuth (Parallel / Perpendicular)
  if (streetAzimuth !== null && streetAzimuth !== undefined && streetAzimuth !== '') {
    const streetAz = Number(streetAzimuth);
    const parAz1 = streetAz;
    const parAz2 = (streetAz + 180) % 360;
    const perpAz1 = (streetAz + 90) % 360;
    const perpAz2 = (streetAz + 270) % 360;
    
    const angleDiff = (a1, a2) => {
      let diff = Math.abs(a1 - a2) % 360;
      return diff > 180 ? 360 - diff : diff;
    };
    
    let bestPar = sorted[0];
    let minParDiff = 360;
    let bestPerp = sorted[0];
    let minPerpDiff = 360;
    
    sorted.forEach(pt => {
      const az = pt.azimuth;
      if (az === undefined) return;
      const dPar = Math.min(angleDiff(az, parAz1), angleDiff(az, parAz2));
      const dPerp = Math.min(angleDiff(az, perpAz1), angleDiff(az, perpAz2));
      
      if (dPar < minParDiff) {
        minParDiff = dPar;
        bestPar = pt;
      }
      if (dPerp < minPerpDiff) {
        minPerpDiff = dPerp;
        bestPerp = pt;
      }
    });
    
    if (minParDiff < 15 && !goldenPoints.some(p => p.time === bestPar.time)) {
      goldenPoints.push({
        ...bestPar,
        feature: 'Street_Parallel',
        description: 'Street Canyon Waveguide Effect'
      });
    }
    if (minPerpDiff < 15 && !goldenPoints.some(p => p.time === bestPerp.time)) {
      goldenPoints.push({
        ...bestPerp,
        feature: 'Street_Perpendicular',
        description: 'Max Urban Blockage (Knife-edge)'
      });
    }
  }
  
  // Sort final points by time
  return goldenPoints.sort((a, b) => new Date(a.time) - new Date(b.time));
}

// === Generate native CIR from pre-computed geometry (for A/B comparison with RT data) ===
// Instead of SGP4 propagation, uses the exact el/az/range from trajectory samples
export function generateChannelTimeSeriesFromGeometry(
  trajectorySamples,   // array of { time, elevation, azimuth, slantRange, lat?, lon?, alt? }
  linkParams = {}
) {
  const k_boltzmann = 1.380649e-23;
  const timeline = [];

  trajectorySamples.forEach((sample, frameIndex) => {
    const date = sample.time ? new Date(sample.time) : new Date();
    const elev = sample.elevation || 0;
    const az = sample.azimuth || 0;
    const range = sample.slantRange || 1000;
    const satAlt = sample.alt || sample.satAlt || 550;

    const simTimeSec = frameIndex * 10;

    const lbParams = {
      ...linkParams,
      elevation: Math.max(0.1, elev),
      slantRange: range,
      simTime: linkParams.disableFastFading ? 0 : simTimeSec
    };
    const lb = calculateLinkBudget(lbParams);

    const absoluteFspl = 20 * Math.log10(range) + 20 * Math.log10(linkParams.freq || 30) + 92.45;
    const eirp = linkParams.eirp || 60.0;
    const gRx = linkParams.gRx || 42.0;
    const tRx = linkParams.tRx || 150.0;
    const bwMHz = linkParams.bandwidth || 400.0;

    const absoluteLoss = lb.totalAtmosphericLoss + lb.fadeLMS + lb.lossFaraday
      + lb.pointingLoss + (lb.scanLoss || 0) + (lb.multipathLoss || 0)
      + (lb.scintLoss || 0) + absoluteFspl;
    const rxPowerDbm = eirp + 30 - absoluteLoss + gRx;

    const tSys = tRx + lb.tSky + 3.0;
    const noisePowerW = k_boltzmann * tSys * (bwMHz * 1e6);
    const noiseFloorDbm = 10 * Math.log10(noisePowerW) + 30;
    const snrDb = Math.max(-30, rxPowerDbm - noiseFloorDbm);

    const { capRank2, capRank1 } = calculateMIMOCapacity(snrDb, lb.xpd);
    const cir = computeCIR({ ...lbParams, freq: linkParams.freq || 30, satAlt });

    // Doppler cannot be computed without velocity — set to 0 or from imported frame
    const dopplerHz = sample.dopplerHz || 0;

    timeline.push({
      time: date,
      timeLabel: date.toLocaleTimeString(),
      frameIndex,
      elevation: elev, azimuth: az, slantRange: range,
      satLat: sample.lat || sample.satLat || 0,
      satLon: sample.lon || sample.satLon || 0,
      satAlt: satAlt,
      apparentElevation: lb.apparentElevation,
      absoluteFspl, rxPowerDbm, noiseFloorDbm, snrDb,
      attRain: lb.attRain, attGas: lb.attGas, attCloud: lb.attCloud, totalAtmosphericLoss: lb.totalAtmosphericLoss,
      fadeLMS: lb.fadeLMS, lossFaraday: lb.lossFaraday, pointingLoss: lb.pointingLoss,
      scanLoss: lb.scanLoss || 0, multipathLoss: lb.multipathLoss || 0, scintLoss: lb.scintLoss || 0, tSky: lb.tSky,
      xpd: lb.xpd, capRank1, capRank2, groupDelayNs: lb.groupDelayNs, dispersionNs: lb.dispersionNs,
      cir,
      dopplerHz
    });
  });

  return timeline;
}

// === 多普勒频移计算 (从 TLE + 位置) ===
/**
 * 计算给定时刻、频率下的多普勒频移
 * @param {string} tleLine1 TLE line 1
 * @param {string} tleLine2 TLE line 2
 * @param {number} gsLat  地面站纬度 (deg)
 * @param {number} gsLon  地面站经度 (deg)
 * @param {number} gsAlt  地面站高度 (m)
 * @param {Date}   date   时刻
 * @param {number} freqGHz 载波频率 (GHz)
 * @returns {number} 多普勒频移 (Hz)，正值=卫星接近（频率升高），负值=卫星远离
 */
export function calculateDopplerShift(tleLine1, tleLine2, gsLat, gsLon, gsAlt, date, freqGHz) {
  try {
    const satrec = satellite.twoline2satrec(tleLine1, tleLine2);
    const pv = satellite.propagate(satrec, date);
    if (!pv.position || !pv.velocity) return 0;

    const gmst = satellite.gstime(date);
    const observerPositionEcf_km = groundPositionEcf({
      latitude_deg: gsLat,
      longitude_deg: gsLon,
      altitude_m: gsAlt,
    });
    return calculateDopplerFromEciState({
      positionEci_km: pv.position,
      velocityEci_kmps: pv.velocity,
      observerPositionEcf_km,
      gmst_rad: gmst,
      frequency_Hz: freqGHz * 1e9,
    }).doppler_Hz;
  } catch (e) {
    return 0;
  }
}
