import * as satelliteModule from 'satellite.js';
const satellite = satelliteModule.degreesToRadians ? satelliteModule : satelliteModule.default;
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
const C_M_S = 299792458; // 光速 (m/s)

export function computeCIR(params) {
  const { freq, elevation, slantRange, env, tec = 50, rainRate = 0, correctionFactor = 1.0, hpbw = 2.0, simTime = 0 } = params;


  const elevRad = Math.max(0.1, elevation) * Math.PI / 180;
  const sinElev = Math.sin(elevRad);

  // --- Tap 0: LOS 直射路径 ---
  const losDelay_ns = (slantRange * 1e3 / C_M_S) * 1e9;
  // 绝对 FSPL (dB)
  const absoluteFspl = 20 * Math.log10(slantRange) + 20 * Math.log10(freq) + 92.45;

  // 大气总衰减 (复用 calculateLinkBudget 中的逻辑)
  let k_coeff = 0.018, alpha_coeff = 1.15;
  let minDiff = 100;
  for (const [f, c] of Object.entries(RAIN_COEFFS)) {
    const diff = Math.abs(parseFloat(f) - freq);
    if (diff < minDiff) { minDiff = diff; k_coeff = c.k; alpha_coeff = c.alpha; }
  }
  const gamma = k_coeff * Math.pow(rainRate, alpha_coeff) * correctionFactor;
  const heightRain = 3.0;
  const slantPath = heightRain / sinElev;
  const rFactor = 1 / (1 + 0.045 * slantPath);
  const attRain = gamma * slantPath * rFactor;

  let attZenithGas = 0.05;
  if (freq < 10) attZenithGas = 0.05;
  else if (freq < 20) attZenithGas = 0.2;
  else if (freq < 35) attZenithGas = 0.3;
  else if (freq < 50) attZenithGas = 0.8;
  else attZenithGas = 4.0;
  const attGas = attZenithGas / sinElev;

  const K_l = 0.0002 * Math.pow(freq, 1.95);
  const L_content = 0.5;
  const attCloud = (L_content * K_l) / sinElev;

  const totalAtmLoss = attRain + attGas + attCloud;

  // LOS tap 幅度 (线性): 10^(-(FSPL + AtmLoss) / 20)
  const losAmplitude = Math.pow(10, -(absoluteFspl + totalAtmLoss) / 20);
  const losAmplitude_dB = -(absoluteFspl + totalAtmLoss);

  const taps = [{
    index: 0,
    label: 'LOS (直射)',
    delay_ns: losDelay_ns,
    excessDelay_ns: 0,
    amplitude_linear: losAmplitude,
    amplitude_dB: losAmplitude_dB,
    phase_rad: 0
  }];

  // --- Tap 1: 地面/海面反射 (仅 maritime 环境) ---
  if (env === 'maritime') {
    const h_rx = 15.0; // 天线高度 (m)
    const pathDiff_m = 2 * h_rx * sinElev;
    const excessDelay_ns = (pathDiff_m / C_M_S) * 1e9;
    const reflCoeff = -0.85; // 海面菲涅尔反射系数 (近似)
    const reflAmplitude = losAmplitude * Math.abs(reflCoeff);
    const reflPhase = Math.PI; // 海面反射相位反转

    taps.push({
      index: 1,
      label: '海面反射',
      delay_ns: losDelay_ns + excessDelay_ns,
      excessDelay_ns,
      amplitude_linear: reflAmplitude,
      amplitude_dB: 20 * Math.log10(reflAmplitude),
      phase_rad: reflPhase
    });
  }

  // --- Tap 2~3: 建筑/植被散射 (urban/suburban) ---
  if (env === 'urban' || env === 'suburban') {
    // Lutz-LMS 散射多径分量
    const scatterParams = env === 'urban'
      ? [{ delay: 100, power: -15, label: '建筑散射-近' }, { delay: 300, power: -22, label: '建筑散射-远' }]
      : [{ delay: 80, power: -18, label: '植被散射-近' }, { delay: 200, power: -25, label: '植被散射-远' }];

    // 散射功率随仰角递减（高仰角时遮蔽少）
    const elevFactor = Math.max(0.1, 1.0 - elevation / 90.0);

    scatterParams.forEach((sp, i) => {
      const scatterPower_dB = losAmplitude_dB + sp.power * elevFactor;
      const scatterAmplitude = Math.pow(10, scatterPower_dB / 20);
      // 散射相位随时间准确定性变化 (SoS)
      const phase = simTime > 0 ? getSoSFade(simTime + i * 7.3) * Math.PI : (i + 1) * 1.7;

      taps.push({
        index: taps.length,
        label: sp.label,
        delay_ns: losDelay_ns + sp.delay,
        excessDelay_ns: sp.delay,
        amplitude_linear: scatterAmplitude,
        amplitude_dB: scatterPower_dB,
        phase_rad: phase
      });
    });
  }

  // --- Tap N: 电离层色散分量 ---
  const tecVal = tec || 50;
  const dispersionNs = (2.0 * 134.0 * tecVal * 0.4) / (Math.pow(freq, 3) * sinElev);
  if (dispersionNs > 0.01) {
    const ionoPower_dB = losAmplitude_dB - 30 - 10 * Math.log10(freq); // 电离层散射功率随频率递减
    const ionoAmplitude = Math.pow(10, ionoPower_dB / 20);
    taps.push({
      index: taps.length,
      label: '电离层色散',
      delay_ns: losDelay_ns + dispersionNs,
      excessDelay_ns: dispersionNs,
      amplitude_linear: ionoAmplitude,
      amplitude_dB: ionoPower_dB,
      phase_rad: simTime > 0 ? getSoSFade(simTime * 0.3) * Math.PI * 0.5 : 0.5
    });
  }


  // --- 统计量计算 ---
  // RMS 时延扩展 (ns)
  const totalPower = taps.reduce((s, t) => s + t.amplitude_linear * t.amplitude_linear, 0);
  const meanDelay = taps.reduce((s, t) => s + t.excessDelay_ns * t.amplitude_linear * t.amplitude_linear, 0) / totalPower;
  const meanDelaySq = taps.reduce((s, t) => s + t.excessDelay_ns * t.excessDelay_ns * t.amplitude_linear * t.amplitude_linear, 0) / totalPower;
  const rmsDelaySpread_ns = Math.sqrt(Math.max(0, meanDelaySq - meanDelay * meanDelay));

  // 相干带宽 (MHz): Bc ≈ 1 / (5 * σ_τ)
  const coherenceBandwidth_MHz = rmsDelaySpread_ns > 0.001 ? 1000.0 / (5.0 * rmsDelaySpread_ns) : 99999;

  return {
    taps,
    rmsDelaySpread_ns,
    coherenceBandwidth_MHz,
    absoluteFspl,
    totalAtmLoss
  };
}

// === 信道传播时间序列生成器 ===
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

    const k_boltzmann = 1.380649e-23;
    const timeline = [];
    let frameIndex = 0;

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
      });

      timeline.push({
        time: date,
        timeLabel: date.toLocaleTimeString(),
        frameIndex,
        // 几何
        elevation: elev,
        azimuth: az,
        slantRange: range,
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
        cir
      });

      frameIndex++;
    }
    return timeline;
  } catch (e) {
    console.error('Channel TimeSeries Generation Error:', e);
    return [];
  }
}
