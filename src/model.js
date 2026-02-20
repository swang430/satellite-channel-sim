import * as satelliteModule from 'satellite.js';
const satellite = satelliteModule.default || satelliteModule;
import { create, all } from 'mathjs';
const math = create(all);

const RAIN_COEFFS = {
  2.2: { k: 0.0002, alpha: 0.95 },
  12.0: { k: 0.018, alpha: 1.15 },
  30.0: { k: 0.187, alpha: 1.021 }, // Ka-band vertical
  40.0: { k: 0.35, alpha: 0.93 },
  50.0: { k: 0.55, alpha: 0.88 }
};

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
  const { freq, rainRate, elevation, env, tec = 50.0, xpdAnt = 35.0, correctionFactor = 1.0, slantRange = 35786, hpbw = 2.0, simTime = 0 } = params;

  // === Elevation Pre-processing: Atmospheric Refraction (ITU-R) ===
  const trueElev = Math.max(0, elevation);
  const refractionCorrection = 1.02 / Math.tan((trueElev + 10.3 / (trueElev + 5.11)) * Math.PI / 180) / 60.0;
  const apparentElevation = elevation + refractionCorrection;

  // Assuming Ephemeris-based open-loop tracking.
  const pointingLoss = hpbw > 0 ? 12.0 * Math.pow(refractionCorrection / hpbw, 2) : 0;
  const effElev = apparentElevation;

  let k = 0.018, alpha = 1.15;
  let minDiff = 100;
  for (const [f, c] of Object.entries(RAIN_COEFFS)) {
    const diff = Math.abs(parseFloat(f) - freq);
    if (diff < minDiff) {
      minDiff = diff;
      k = c.k;
      alpha = c.alpha;
    }
  }

  // Apply correction factor to the gamma calculation (Rain attenuation multiplier)
  const gamma = k * Math.pow(rainRate, alpha) * correctionFactor;
  const elevRad = (effElev * Math.PI) / 180;
  const heightRain = 3.0; // km
  const slantPath = heightRain / Math.sin(elevRad);
  const rFactor = 1 / (1 + 0.045 * slantPath);
  const lEff = slantPath * rFactor;
  const attRain = gamma * lEff;

  let attZenithGas = 0.05;
  if (freq < 10) attZenithGas = 0.05;
  else if (freq < 20) attZenithGas = 0.2;
  else if (freq < 35) attZenithGas = 0.3;
  else if (freq < 50) attZenithGas = 0.8;
  else attZenithGas = 4.0;
  const attGas = attZenithGas / Math.sin(elevRad);

  const K_l = 0.0002 * Math.pow(freq, 1.95);
  const L_content = 0.5; // mm
  const attCloud = (L_content * K_l) / Math.sin(elevRad);

  const totalAtmosphericLoss = attRain + attGas + attCloud;

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
  const groupDelayNs = (134.0 * tecVal) / (freq * freq * sinElev);
  // Derivative of Delay wrt frequency * bandwidth
  const dispersionNs = (2.0 * 134.0 * tecVal * (bwMHz / 1000.0)) / (Math.pow(freq, 3) * sinElev);
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
export function fitModelToData(realData, currentParams) {
  if (!realData || realData.length === 0) return 1.0;

  let bestFactor = 1.0;
  let minError = Infinity;

  // Sweep correction factor from 0.5 to 2.5
  for (let factor = 0.5; factor <= 2.5; factor += 0.05) {
    let errorSum = 0;
    for (const point of realData) {
      if (point.rainRate == null || point.measuredLoss == null) continue;

      const testParams = { ...currentParams, rainRate: point.rainRate, correctionFactor: factor };
      const theoretical = calculateLinkBudget(testParams).totalLoss;
      // Mean Square Error
      errorSum += Math.pow(theoretical - point.measuredLoss, 2);
    }

    if (errorSum < minError) {
      minError = errorSum;
      bestFactor = factor;
    }
  }

  return bestFactor;
}
