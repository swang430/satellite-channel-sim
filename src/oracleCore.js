/**
 * oracleCore.js — Link State Prediction Oracle
 * 
 * Wraps the existing Satellite-Channel-Sim computational engine (model.js)
 * to produce standardized link state predictions for external consumption.
 * 
 * Three prediction modes:
 *   1. NOW  — instantaneous snapshot at current time
 *   2. WINDOW — all future passes within a lookahead window
 *   3. PASS — detailed time-series for a single pass
 *
 * Uncertainty quantification via A/B comparison between statistical
 * and deterministic RT models when RT CIR data is available.
 */

import { 
  predictPasses,
  generateChannelTimeSeries,
  calculateMIMOCapacity,
  computeCIR
} from './model.js';

// ─── Default Link Parameters (Ka-band LEO typical) ─────────────────────
const DEFAULT_LINK_PARAMS = {
  freq: 30.0,          // GHz (Ka-band downlink)
  rainRate: 5.0,       // mm/h (moderate rain)
  env: 'urban',        // suburban | urban | maritime | rural
  tec: 50.0,           // TECU (moderate solar activity)
  xpdAnt: 35.0,        // dB (dual-pol antenna XPD)
  correctionFactor: 1.0,
  hpbw: 2.0,           // deg (antenna half-power beamwidth)
  eirp: 60.0,          // dBm
  gRx: 42.0,           // dBi
  tRx: 150.0,          // K (receiver noise temperature)
  bandwidth: 400.0,    // MHz
  disableFastFading: true  // deterministic output for API
};

// ─── MODCOD Table (DVB-S2X, simplified — 32-ary APSK levels omitted) ──
const MODCOD_TABLE = [
  { minSnr: -2.85, modcod: 'QPSK 1/4',   efficiency: 0.49,  spectralEfficiency: 0.49 },
  { minSnr: -1.25, modcod: 'QPSK 1/3',   efficiency: 0.66,  spectralEfficiency: 0.66 },
  { minSnr:  0.25, modcod: 'QPSK 2/5',   efficiency: 0.79,  spectralEfficiency: 0.79 },
  { minSnr:  1.05, modcod: 'QPSK 1/2',   efficiency: 0.99,  spectralEfficiency: 0.99 },
  { minSnr:  2.25, modcod: 'QPSK 3/5',   efficiency: 1.19,  spectralEfficiency: 1.19 },
  { minSnr:  3.15, modcod: 'QPSK 2/3',   efficiency: 1.32,  spectralEfficiency: 1.32 },
  { minSnr:  4.05, modcod: 'QPSK 3/4',   efficiency: 1.49,  spectralEfficiency: 1.49 },
  { minSnr:  4.75, modcod: 'QPSK 4/5',   efficiency: 1.59,  spectralEfficiency: 1.59 },
  { minSnr:  5.55, modcod: 'QPSK 5/6',   efficiency: 1.65,  spectralEfficiency: 1.65 },
  { minSnr:  6.50, modcod: 'QPSK 8/9',   efficiency: 1.77,  spectralEfficiency: 1.77 },
  { minSnr:  7.50, modcod: 'QPSK 9/10',  efficiency: 1.79,  spectralEfficiency: 1.79 },
  { minSnr:  5.55, modcod: '8PSK 3/5',   efficiency: 1.78,  spectralEfficiency: 1.78 },
  { minSnr:  6.65, modcod: '8PSK 2/3',   efficiency: 1.98,  spectralEfficiency: 1.98 },
  { minSnr:  7.50, modcod: '8PSK 3/4',   efficiency: 2.23,  spectralEfficiency: 2.23 },
  { minSnr:  9.35, modcod: '8PSK 5/6',   efficiency: 2.48,  spectralEfficiency: 2.48 },
  { minSnr: 10.25, modcod: '8PSK 8/9',   efficiency: 2.65,  spectralEfficiency: 2.65 },
  { minSnr: 11.05, modcod: '8PSK 9/10',  efficiency: 2.68,  spectralEfficiency: 2.68 },
  { minSnr:  9.00, modcod: '16APSK 2/3', efficiency: 2.64,  spectralEfficiency: 2.64 },
  { minSnr: 10.25, modcod: '16APSK 3/4', efficiency: 2.97,  spectralEfficiency: 2.97 },
  { minSnr: 11.60, modcod: '16APSK 4/5', efficiency: 3.17,  spectralEfficiency: 3.17 },
  { minSnr: 12.50, modcod: '16APSK 5/6', efficiency: 3.30,  spectralEfficiency: 3.30 },
  { minSnr: 13.25, modcod: '16APSK 8/9', efficiency: 3.53,  spectralEfficiency: 3.53 },
  { minSnr: 14.25, modcod: '16APSK 9/10', efficiency: 3.57,  spectralEfficiency: 3.57 },
  { minSnr: 11.65, modcod: '32APSK 3/4', efficiency: 3.70,  spectralEfficiency: 3.70 },
  { minSnr: 12.85, modcod: '32APSK 4/5', efficiency: 3.95,  spectralEfficiency: 3.95 },
  { minSnr: 13.65, modcod: '32APSK 5/6', efficiency: 4.12,  spectralEfficiency: 4.12 },
  { minSnr: 14.85, modcod: '32APSK 8/9', efficiency: 4.40,  spectralEfficiency: 4.40 },
  { minSnr: 15.95, modcod: '32APSK 9/10', efficiency: 4.45,  spectralEfficiency: 4.45 },
];

// ─── 3GPP NTN Channel Model Mapping (TR 38.811) ────────────────────────
function mapToNTNParams(timeline) {
  if (!timeline || timeline.length === 0) return null;
  
  // Aggregate statistics over the pass
  const delays = timeline.map(t => {
    const cir = t.cir || {};
    return cir.rmsDelaySpread_ns || 0;
  }).filter(d => d > 0);
  
  const dopplers = timeline.map(t => t.dopplerHz || 0);
  const snrs = timeline.map(t => t.snrDb || -30);
  
  const avgDelay = delays.length > 0 
    ? delays.reduce((a,b) => a+b, 0) / delays.length 
    : 0;
  const maxDelay = delays.length > 0 ? Math.max(...delays) : 0;
  const maxDoppler = Math.max(...dopplers.map(Math.abs));
  const dopplerRate = dopplers.length > 1 
    ? (dopplers[dopplers.length-1] - dopplers[0]) / (timeline.length * 1.0) 
    : 0;

  return {
    channelModel: 'NTN-TDL-A',  // Tapped Delay Line for NTN
    delaySpread_ns: avgDelay,
    maxExcessDelay_ns: maxDelay,
    maxDopplerShift_Hz: maxDoppler,
    dopplerRate_HzPerSample: dopplerRate,
    kFactor_dB: computeKFactor(timeline),
    numClusters: delays.length > 3 ? 4 : delays.length,
    pathLoss_dB: snrs.length > 0 ? -Math.min(...snrs) : 0,  // worst-case
    fadingModel: 'Rician',  // LOS + scattering
    elevationRange_deg: [
      Math.min(...timeline.map(t => t.elevation || 0)),
      Math.max(...timeline.map(t => t.elevation || 0))
    ]
  };
}

function computeKFactor(timeline) {
  // Rician K-factor from CIR taps: LOS power / scattered power
  if (!timeline || timeline.length === 0) return 10;
  const midPoint = timeline[Math.floor(timeline.length / 2)];
  const cir = midPoint.cir;
  if (!cir || !cir.taps) return 10;
  
  const losPower = (cir.taps[0]?.amplitude_linear || 0) ** 2;
  const scatterPower = cir.taps.slice(1).reduce(
    (sum, t) => sum + (t.amplitude_linear || 0) ** 2, 0
  );
  if (scatterPower === 0) return 30;  // pure LOS
  return 10 * Math.log10(losPower / scatterPower);
}

// ─── Core Prediction Functions ──────────────────────────────────────────

/**
 * predictLinkStateNow
 * Returns the current instantaneous link state for a given satellite and
 * ground station.
 * 
 * @param {Object} tle - { tleLine1, tleLine2 }
 * @param {number} gsLat - ground station latitude (deg)
 * @param {number} gsLon - ground station longitude (deg)
 * @param {number} gsAlt - ground station altitude (m)
 * @param {Object} linkParams - optional link budget overrides
 * @returns {Object|null} link state snapshot
 */
export function predictLinkStateNow(
  tle,
  gsLat,
  gsLon,
  gsAlt = 0,
  linkParams = {},
  runtime = {},
) {
  const params = { ...DEFAULT_LINK_PARAMS, ...linkParams };
  const now = runtime.now ?? new Date();
  const timelineProvider = runtime.timelineProvider ?? generateChannelTimeSeries;
  
  // Generate a 10-second window around now
  const start = new Date(now.getTime() - 5000);
  const end = new Date(now.getTime() + 5000);
  
  const timeline = timelineProvider(
    tle.tleLine1, tle.tleLine2, gsLat, gsLon, gsAlt,
    start, end, 1, params
  );
  
  if (!timeline || timeline.length === 0) return null;
  
  // Find the closest frame to now
  let best = timeline[0];
  let bestDiff = Math.abs(best.time.getTime() - now.getTime());
  for (const frame of timeline) {
    const diff = Math.abs(frame.time.getTime() - now.getTime());
    if (diff < bestDiff) { best = frame; bestDiff = diff; }
  }
  if (!Number.isFinite(best.elevation) || best.elevation <= 0) return null;
  return formatLinkState(best, 'now');
}

/**
 * predictLinkStateWindow
 * Returns a full prediction timeline for all upcoming passes within
 * the lookahead window.
 *
 * @param {Object} tle - { tleLine1, tleLine2 }
 * @param {number} gsLat - ground station latitude (deg)
 * @param {number} gsLon - ground station longitude (deg)
 * @param {number} gsAlt - ground station altitude (m)
 * @param {number} hoursAhead - lookahead window in hours (default 24)
 * @param {Object} linkParams - optional link budget overrides
 * @returns {Array} array of { pass, linkStates[] } per pass
 */
export function predictLinkStateWindow(tle, gsLat, gsLon, gsAlt = 0, hoursAhead = 24, linkParams = {}) {
  const params = { ...DEFAULT_LINK_PARAMS, ...linkParams };
  
  // 1. Find all upcoming passes
  const passes = predictPasses(
    tle.tleLine1, tle.tleLine2, gsLat, gsLon, gsAlt,
    hoursAhead, 0
  );
  
  if (!passes || passes.length === 0) return [];
  
  // 2. For each pass, generate the full channel time series
  const predictions = [];
  for (const pass of passes) {
    // Resample with sparse timestamps: one point every ~10 seconds
    const stepSec = Math.max(10, Math.floor(pass.durationSec / 120));
    
    const timeline = generateChannelTimeSeries(
      tle.tleLine1, tle.tleLine2, gsLat, gsLon, gsAlt,
      pass.aos, pass.los, stepSec, params
    );
    
    if (!timeline || timeline.length === 0) continue;
    
    const linkStates = timeline
      .filter((frame) => frame.elevation > 0)
      .map((frame) => formatLinkState(frame, 'window'));
    if (linkStates.length === 0) continue;
    const summary = summarizePass(linkStates);
    const ntnParams = mapToNTNParams(timeline);
    
    predictions.push({
      pass: {
        aos: pass.aos.toISOString(),
        tca: pass.tca?.toISOString(),
        los: pass.los.toISOString(),
        maxElevation: pass.maxElev?.toFixed(1),
        durationSec: pass.durationSec
      },
      summary,
      ntnParams,
      linkStates,
      sampleCount: linkStates.length,
      stepSec
    });
  }
  
  return predictions;
}

/**
 * predictLinkStatePass
 * Detailed prediction for a single pass.
 */
export function predictLinkStatePass(tle, gsLat, gsLon, gsAlt, startTime, endTime, stepSec = 1, linkParams = {}) {
  const params = { ...DEFAULT_LINK_PARAMS, ...linkParams };
  
  const timeline = generateChannelTimeSeries(
    tle.tleLine1, tle.tleLine2, gsLat, gsLon, gsAlt,
    new Date(startTime), new Date(endTime), stepSec, params
  );
  
  if (!timeline || timeline.length === 0) return [];
  
  return timeline
    .filter((frame) => frame.elevation > 0)
    .map((frame) => formatLinkState(frame, 'pass'));
}

// ─── Formatting ─────────────────────────────────────────────────────────

function formatLinkState(frame, mode) {
  return {
    frameId: frame.frameIndex,
    time: frame.time instanceof Date ? frame.time.toISOString() : frame.time,
    elevation_deg: +(frame.elevation || 0).toFixed(2),
    azimuth_deg: +(frame.azimuth || 0).toFixed(2),
    slantRange_km: +(frame.slantRange || 0).toFixed(2),
    snr: {
      db: +(frame.snrDb || -30).toFixed(2),
      linear: +Math.pow(10, (frame.snrDb || -30) / 10).toFixed(6)
    },
    rxPower_dBm: +(frame.rxPowerDbm || 0).toFixed(2),
    noiseFloor_dBm: +(frame.noiseFloorDbm || 0).toFixed(2),
    doppler: {
      hz: +(frame.dopplerHz || 0).toFixed(1),
      normalized: +((frame.dopplerHz || 0) / ((DEFAULT_LINK_PARAMS.freq || 30) * 1e9)).toExponential(3)
    },
    channel: {
      predictedRank: frame.capRank2 > frame.capRank1 ? 2 : 1,
      capacityRank1_bpsHz: +(frame.capRank1 || 0).toFixed(3),
      capacityRank2_bpsHz: +(frame.capRank2 || 0).toFixed(3),
      xpd_dB: +(frame.xpd || 0).toFixed(2),
      rmsDelaySpread_ns: +(frame.cir?.rmsDelaySpread_ns || 0).toFixed(3),
      coherenceBandwidth_MHz: +(frame.cir?.coherenceBandwidth_MHz || 99999).toFixed(1)
    },
    atmospheric: {
      rainAttenuation_dB: +(frame.attRain || 0).toFixed(3),
      gasAttenuation_dB: +(frame.attGas || 0).toFixed(3),
      cloudAttenuation_dB: +(frame.attCloud || 0).toFixed(3),
      totalAtmosphericLoss_dB: +(frame.totalAtmosphericLoss || 0).toFixed(2),
      scintillationLoss_dB: +(frame.scintLoss || 0).toFixed(3),
      skyTemp_K: +(frame.tSky || 0).toFixed(1)
    },
    confidence: 'statistical',
    mode
  };
}

// ─── Pass Summary ───────────────────────────────────────────────────────

function summarizePass(linkStates) {
  if (!linkStates || linkStates.length === 0) return null;
  
  const snrs = linkStates.map(s => s.snr.db);
  const visible = linkStates.filter(s => s.elevation_deg > 0);
  
  const peakIdx = snrs.indexOf(Math.max(...snrs));
  const peak = linkStates[peakIdx];
  
  // Detect SNR degradation onset (when SNR drops > 1dB/sample)
  const degradationEvents = [];
  for (let i = 1; i < linkStates.length; i++) {
    const delta = linkStates[i-1].snr.db - linkStates[i].snr.db;
    if (delta > 1.0) {
      degradationEvents.push({
        time: linkStates[i].time,
        snrDrop_dB: +delta.toFixed(2),
        snrAfter_dB: linkStates[i].snr.db
      });
    }
  }
  
  return {
    peakSNR_dB: +Math.max(...snrs).toFixed(2),
    meanSNR_dB: +(snrs.reduce((a,b) => a+b, 0) / snrs.length).toFixed(2),
    minSNR_dB: +Math.min(...snrs).toFixed(2),
    peakTime: peak?.time || null,
    peakElevation_deg: peak?.elevation_deg || 0,
    visibleDuration_sec: visible.length > 0 
      ? Math.round((new Date(visible[visible.length-1].time) - new Date(visible[0].time)) / 1000) 
      : 0,
    rank2Feasible: linkStates.filter(s => s.channel.predictedRank === 2).length >= linkStates.length * 0.3,
    degradationEvents: degradationEvents.slice(0, 3),  // top 3 only
  };
}

// ─── Uncertainty Quantification ─────────────────────────────────────────

/**
 * markConfidence
 * Annotates link states from the relative-PDP comparison report. RT SNR is
 * intentionally absent because MPDB H has no defined absolute normalization.
 */
export function markConfidence(linkStates, comparisonReport = null) {
  if (!comparisonReport?.frames) {
    return linkStates.map(s => ({ ...s, confidence: 'statistical' }));
  }
  const byFrameId = new Map(comparisonReport.frames.map((frame) => [frame.frameId, frame]));
  return linkStates.map(s => {
    const frameId = s.frameId ?? s.frameIndex;
    const comparison = byFrameId.get(frameId);
    if (!comparison) return { ...s, confidence: 'statistical' };
    return {
      ...s,
      confidence: 'rt-relative-pdp',
      comparison: comparison.metrics,
    };
  });
}

// ─── MODCOD Recommendation ──────────────────────────────────────────────

/**
 * recommendMODCOD
 * Maps a predicted SNR to a DVB-S2X MODCOD recommendation.
 */
export function recommendMODCOD(snrDb) {
  let best = MODCOD_TABLE[0];
  for (const entry of MODCOD_TABLE) {
    if (snrDb >= entry.minSnr && entry.minSnr >= best.minSnr) {
      best = entry;
    }
  }
  // Add margin for prediction uncertainty
  const marginDb = 1.0;
  const safeSnr = snrDb - marginDb;
  let safe = MODCOD_TABLE[0];
  for (const entry of MODCOD_TABLE) {
    if (safeSnr >= entry.minSnr && entry.minSnr >= safe.minSnr) {
      safe = entry;
    }
  }
  
  return {
    predicted: best.modcod,
    safeRecommendation: safe.modcod,
    spectralEfficiency_bpsHz: best.spectralEfficiency,
    safeSpectralEfficiency_bpsHz: safe.spectralEfficiency,
    margin_dB: marginDb,
    snr_dB: snrDb
  };
}

// ─── Export Helpers ─────────────────────────────────────────────────────

export { MODCOD_TABLE, mapToNTNParams, computeKFactor };
