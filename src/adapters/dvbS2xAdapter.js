/**
 * dvbS2xAdapter.js — DVB-S2X ACM MODCOD Adapter
 *
 * Converts Oracle Core link state predictions into DVB-S2X MODCOD
 * recommendations suitable for integration with ACM controllers
 * (Newtec MxMA, Comtech, iDirect, or generic REST-based controllers).
 *
 * Reference: ETSI EN 302 307-2 (DVB-S2X)
 */

// ─── Full DVB-S2X MODCOD table with guard intervals ────────────────────
const DVB_S2X_TABLE = [
  { modcodId: 1,  name: 'QPSK 1/4',   minEsN0: -2.85, spectralEfficiency: 0.490,  modulation: 'QPSK',  codeRate: '1/4' },
  { modcodId: 2,  name: 'QPSK 1/3',   minEsN0: -1.25, spectralEfficiency: 0.656,  modulation: 'QPSK',  codeRate: '1/3' },
  { modcodId: 3,  name: 'QPSK 2/5',   minEsN0:  0.25, spectralEfficiency: 0.789,  modulation: 'QPSK',  codeRate: '2/5' },
  { modcodId: 4,  name: 'QPSK 1/2',   minEsN0:  1.05, spectralEfficiency: 0.989,  modulation: 'QPSK',  codeRate: '1/2' },
  { modcodId: 5,  name: 'QPSK 3/5',   minEsN0:  2.25, spectralEfficiency: 1.188,  modulation: 'QPSK',  codeRate: '3/5' },
  { modcodId: 6,  name: 'QPSK 2/3',   minEsN0:  3.15, spectralEfficiency: 1.322,  modulation: 'QPSK',  codeRate: '2/3' },
  { modcodId: 7,  name: 'QPSK 3/4',   minEsN0:  4.05, spectralEfficiency: 1.487,  modulation: 'QPSK',  codeRate: '3/4' },
  { modcodId: 8,  name: 'QPSK 4/5',   minEsN0:  4.75, spectralEfficiency: 1.587,  modulation: 'QPSK',  codeRate: '4/5' },
  { modcodId: 9,  name: 'QPSK 5/6',   minEsN0:  5.55, spectralEfficiency: 1.655,  modulation: 'QPSK',  codeRate: '5/6' },
  { modcodId: 10, name: 'QPSK 8/9',   minEsN0:  6.50, spectralEfficiency: 1.766,  modulation: 'QPSK',  codeRate: '8/9' },
  { modcodId: 11, name: 'QPSK 9/10',  minEsN0:  7.50, spectralEfficiency: 1.788,  modulation: 'QPSK',  codeRate: '9/10' },
  { modcodId: 12, name: '8PSK 3/5',   minEsN0:  5.55, spectralEfficiency: 1.780,  modulation: '8PSK',  codeRate: '3/5' },
  { modcodId: 13, name: '8PSK 2/3',   minEsN0:  6.65, spectralEfficiency: 1.981,  modulation: '8PSK',  codeRate: '2/3' },
  { modcodId: 14, name: '8PSK 3/4',   minEsN0:  7.50, spectralEfficiency: 2.228,  modulation: '8PSK',  codeRate: '3/4' },
  { modcodId: 15, name: '8PSK 5/6',   minEsN0:  9.35, spectralEfficiency: 2.479,  modulation: '8PSK',  codeRate: '5/6' },
  { modcodId: 16, name: '8PSK 8/9',   minEsN0: 10.25, spectralEfficiency: 2.646,  modulation: '8PSK',  codeRate: '8/9' },
  { modcodId: 17, name: '8PSK 9/10',  minEsN0: 11.05, spectralEfficiency: 2.679,  modulation: '8PSK',  codeRate: '9/10' },
  { modcodId: 18, name: '16APSK 2/3', minEsN0:  9.00, spectralEfficiency: 2.637,  modulation: '16APSK', codeRate: '2/3' },
  { modcodId: 19, name: '16APSK 3/4', minEsN0: 10.25, spectralEfficiency: 2.967,  modulation: '16APSK', codeRate: '3/4' },
  { modcodId: 20, name: '16APSK 4/5', minEsN0: 11.60, spectralEfficiency: 3.166,  modulation: '16APSK', codeRate: '4/5' },
  { modcodId: 21, name: '16APSK 5/6', minEsN0: 12.50, spectralEfficiency: 3.300,  modulation: '16APSK', codeRate: '5/6' },
  { modcodId: 22, name: '16APSK 8/9', minEsN0: 13.25, spectralEfficiency: 3.523,  modulation: '16APSK', codeRate: '8/9' },
  { modcodId: 23, name: '16APSK 9/10',minEsN0: 14.25, spectralEfficiency: 3.567,  modulation: '16APSK', codeRate: '9/10' },
  { modcodId: 24, name: '32APSK 3/4', minEsN0: 11.65, spectralEfficiency: 3.703,  modulation: '32APSK', codeRate: '3/4' },
  { modcodId: 25, name: '32APSK 4/5', minEsN0: 12.85, spectralEfficiency: 3.952,  modulation: '32APSK', codeRate: '4/5' },
  { modcodId: 26, name: '32APSK 5/6', minEsN0: 13.65, spectralEfficiency: 4.120,  modulation: '32APSK', codeRate: '5/6' },
  { modcodId: 27, name: '32APSK 8/9', minEsN0: 14.85, spectralEfficiency: 4.398,  modulation: '32APSK', codeRate: '8/9' },
  { modcodId: 28, name: '32APSK 9/10',minEsN0: 15.95, spectralEfficiency: 4.453,  modulation: '32APSK', codeRate: '9/10' },
];

// ─── Default margins for different operation modes ──────────────────────
const DEFAULT_MARGINS = {
  clearSky: 0.5,      // dB
  rainMargin: 2.0,    // dB
  predictive: 1.0,    // dB (our standard — prediction-aware, lower margin)
  conservative: 3.0,  // dB
};

/**
 * selectMODCOD
 * @param {number} esn0Db - predicted Es/N0 in dB
 * @param {string} marginMode - 'predictive' | 'clearSky' | 'rainMargin' | 'conservative'
 * @returns {Object} MODCOD recommendation
 */
export function selectMODCOD(esn0Db, marginMode = 'predictive') {
  const margin = DEFAULT_MARGINS[marginMode] || DEFAULT_MARGINS.predictive;
  const safeEsN0 = esn0Db - margin;
  
  let best = DVB_S2X_TABLE[0];
  let safe = DVB_S2X_TABLE[0];
  
  for (const entry of DVB_S2X_TABLE) {
    if (esn0Db >= entry.minEsN0 && entry.minEsN0 >= best.minEsN0) {
      best = entry;
    }
    if (safeEsN0 >= entry.minEsN0 && entry.minEsN0 >= safe.minEsN0) {
      safe = entry;
    }
  }
  
  return {
    timestamp: new Date().toISOString(),
    predictedMODCOD: {
      id: best.modcodId,
      name: best.name,
      modulation: best.modulation,
      codeRate: best.codeRate,
      spectralEfficiency_bpsHz: best.spectralEfficiency,
      requiredEsN0_dB: best.minEsN0
    },
    safeRecommendation: {
      id: safe.modcodId,
      name: safe.name,
      modulation: safe.modulation,
      codeRate: safe.codeRate,
      spectralEfficiency_bpsHz: safe.spectralEfficiency,
      requiredEsN0_dB: safe.minEsN0
    },
    linkBudget: {
      predictedEsN0_dB: +esn0Db.toFixed(2),
      safeEsN0_dB: +safeEsN0.toFixed(2),
      margin_dB: margin,
      marginMode
    }
  };
}

/**
 * generateMODCOTimeline
 * Converts a full pass linkState array into a MODCOD switching schedule.
 * 
 * @param {Array} linkStates - from oracleCore.predictLinkStateWindow
 * @param {string} marginMode
 * @param {number} minSwitchIntervalSec - minimum time between MODCOD changes (hysteresis)
 * @returns {Array} MODCOD switching schedule
 */
export function generateMODCOTimeline(linkStates, marginMode = 'predictive', minSwitchIntervalSec = 5) {
  const schedule = [];
  let lastModcod = null;
  let lastSwitchTime = null;
  
  for (const state of linkStates) {
    const modcod = selectMODCOD(state.snr.db, marginMode);
    const currentTime = new Date(state.time);
    
    // Apply hysteresis: only switch if enough time has passed and MODCOD changed
    const canSwitch = !lastSwitchTime || 
      (currentTime - lastSwitchTime) >= minSwitchIntervalSec * 1000;
    
    if (canSwitch && modcod.safeRecommendation.id !== lastModcod) {
      schedule.push({
        time: state.time,
        elevation_deg: state.elevation_deg,
        snr_dB: state.snr.db,
        modcodId: modcod.safeRecommendation.id,
        modcodName: modcod.safeRecommendation.name,
        spectralEfficiency_bpsHz: modcod.safeRecommendation.spectralEfficiency_bpsHz
      });
      lastModcod = modcod.safeRecommendation.id;
      lastSwitchTime = currentTime;
    }
  }
  
  return schedule;
}

/**
 * toACMControllerFormat
 * Converts to a format compatible with common ACM controller APIs.
 * 
 * Supported targets: 'newtec', 'comtech', 'generic'
 */
export function toACMControllerFormat(modcodSchedule, target = 'generic') {
  switch (target) {
    case 'newtec':
      // Newtec MxMA REST API format
      return modcodSchedule.map(entry => ({
        timestamp: entry.time,
        modcod: entry.modcodId,
        // Newtec uses integer MODCOD IDs
        parameters: {
          modulation: entry.modcodName.split(' ')[0],
          coding: entry.modcodName.split(' ')[1]
        }
      }));
    
    case 'comtech':
      // Comtech-style format
      return modcodSchedule.map(entry => ({
        time: entry.time,
        modulation: entry.modcodName.split(' ')[0],
        fecRate: entry.modcodName.split(' ')[1],
        dataRate: entry.spectralEfficiency_bpsHz
      }));
    
    case 'generic':
    default:
      // Generic REST JSON format
      return modcodSchedule.map(entry => ({
        time: entry.time,
        modcod: entry.modcodName,
        modcodId: entry.modcodId,
        elevation: entry.elevation_deg,
        snr: entry.snr_dB
      }));
  }
}

export { DVB_S2X_TABLE, DEFAULT_MARGINS };
