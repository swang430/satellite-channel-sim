/**
 * ntnAdapter.js — 3GPP NTN Channel Model Adapter
 *
 * Maps Oracle Core link state predictions into 3GPP TR 38.811 / TR 38.821
 * NTN channel model parameters for integration with:
 *   - 5G NTN system-level simulators
 *   - NTN channel emulators (Keysight Propsim, ROHDE CMX/CMW)
 *   - 3GPP-compliant NTN gNB protocol stacks
 *
 * References:
 *   - 3GPP TR 38.811 v16.4.0 (NTN channel model)
 *   - 3GPP TR 38.821 v16.2.0 (Solutions for NR to support NTN)
 *   - ITU-R P.618, P.681, P.531 (propagation models)
 */

// ─── NTN Channel Model Types (TR 38.811 Table 6.1.1-1) ─────────────────
const NTN_CHANNEL_TYPES = {
  NTN_TDL_A: {
    name: 'NTN-TDL-A',
    description: 'LOS + very low delay spread (< 10 ns)',
    delaySpread_ns: 10,
    kFactor_dB: 15,
    applicability: 'LEO high elevation, rural/open'
  },
  NTN_TDL_B: {
    name: 'NTN-TDL-B',
    description: 'LOS + moderate delay spread (10-100 ns)',
    delaySpread_ns: 50,
    kFactor_dB: 10,
    applicability: 'LEO medium elevation, suburban'
  },
  NTN_TDL_C: {
    name: 'NTN-TDL-C',
    description: 'NLOS possible, high delay spread (> 100 ns)',
    delaySpread_ns: 200,
    kFactor_dB: 3,
    applicability: 'LEO low elevation, urban'
  },
  NTN_TDL_D: {
    name: 'NTN-TDL-D',
    description: 'Strong multipath, low K-factor',
    delaySpread_ns: 300,
    kFactor_dB: 0,
    applicability: 'GEO/MEO severe multipath'
  }
};

// ─── CDL model types for NTN (TR 38.811 Annex A) ───────────────────────
function classifyNTNChannel(delaySpread_ns, kFactor_dB) {
  if (delaySpread_ns < 10) return 'NTN-TDL-A';
  if (delaySpread_ns < 100 && kFactor_dB > 5) return 'NTN-TDL-B';
  if (delaySpread_ns < 200) return 'NTN-TDL-C';
  return 'NTN-TDL-D';
}

// ─── Core Mapping Functions ─────────────────────────────────────────────

/**
 * linkStateToNTNParams
 * Converts a single link state snapshot into 3GPP NTN channel parameters.
 *
 * @param {Object} linkState - from oracleCore.formatLinkState
 * @returns {Object} 3GPP NTN-compliant channel parameters
 */
export function linkStateToNTNParams(linkState) {
  const delaySpread = linkState.channel?.rmsDelaySpread_ns ?? 0;
  const kFactor = computeNTNKFactor(linkState);
  const channelType = classifyNTNChannel(delaySpread, kFactor, linkState.elevation_deg);
  
  return {
    modelStatus: 'heuristic-not-standard-compliant',
    // ── TR 38.811 Section 6.1: Large-scale parameters ──
    largeScaleParams: {
      pathLoss: Number.isFinite(linkState.pathLoss_dB)
        ? { status: 'available', value_dB: linkState.pathLoss_dB }
        : { status: 'unavailable', reason: 'PATH_LOSS_NOT_PROVIDED' },
      shadowFadingStd_dB: 4.0,  // LEO typical
      kFactor_dB: kFactor,
      delaySpread_ns: delaySpread,
      angleSpread_deg: {
        azimuthArrival: estimateAngularSpread(linkState.elevation_deg),
        azimuthDeparture: 2.0,
        zenithArrival: 5.0,
        zenithDeparture: 3.0
      },
      crossPolarizationRatio_dB: linkState.channel?.xpd_dB || 20
    },
    
    // ── TR 38.811 Section 6.2: Doppler & mobility ──
    dopplerParams: {
      dopplerShift_Hz: linkState.doppler?.hz || 0,
      dopplerSpread_Hz: Math.max(10, Math.abs(linkState.doppler?.hz || 0) * 0.01),
      satelliteVelocity_kms: estimateSatelliteVelocity(linkState.doppler?.hz || 0),
      ephemerisUpdateInterval_ms: 1000 // 1s for LEO
    },
    
    // ── TR 38.811 Section 6.3: Atmospheric ──
    atmosphericParams: {
      troposphericDelay_ns: linkState.atmospheric?.totalAtmosphericLoss_dB * 0.3 || 0,
      ionosphericDelay_ns: estimateIonosphericDelay(linkState.atmospheric?.totalAtmosphericLoss_dB || 0),
      rainAttenuation_dB: linkState.atmospheric?.rainAttenuation_dB || 0,
      gasAttenuation_dB: linkState.atmospheric?.gasAttenuation_dB || 0,
      scintillationStd_dB: linkState.atmospheric?.scintillationLoss_dB * 0.5 || 0
    },
    
    // ── Channel model classification ──
    channelModel: channelType,
    channelModelDescription: NTN_CHANNEL_TYPES[channelType]?.description || '',
    
    // ── Link adaptation hints ──
    linkAdaptation: {
      snr_dB: linkState.snr?.db ?? null,
      recommendedRank: linkState.channel?.predictedRank || 1,
      mimoCapacity_bpsHz: linkState.channel?.capacityRank2_bpsHz || 0,
      elevation_deg: linkState.elevation_deg,
      coherenceBandwidth_MHz: linkState.channel?.coherenceBandwidth_MHz || 10,
      coherentTime_ms: estimateCoherentTime(linkState.doppler?.hz || 0)
    }
  };
}

/**
 * passToNTNProfile
 * Generates a complete NTN channel profile for a full pass.
 *
 * @param {Object} prediction - single pass entry from predictLinkStateWindow
 * @returns {Object} NTN pass-level channel profile
 */
export function passToNTNProfile(prediction) {
  if (!prediction || !prediction.linkStates || prediction.linkStates.length === 0) {
    return null;
  }
  
  const states = prediction.linkStates;
  
  // Aggregate across the pass
  const delaySpreads = states
    .map(s => s.channel?.rmsDelaySpread_ns || 0)
    .filter(d => d > 0);
  const avgDelay = delaySpreads.length 
    ? delaySpreads.reduce((a,b) => a+b) / delaySpreads.length 
    : 0;
  const maxDelay = delaySpreads.length ? Math.max(...delaySpreads) : 0;
  
  const dopplers = states.map(s => Math.abs(s.doppler?.hz || 0));
  const maxDoppler = Math.max(...dopplers);
  const dopplerRate = dopplers.length > 1
    ? (dopplers[dopplers.length-1] - dopplers[0]) / (states.length * (prediction.stepSec || 1))
    : 0;
  
  const snrs = states.filter(s => s.elevation_deg > 0).map(s => s.snr?.db ?? -30);
  const pathLosses = states.map((state) => state.pathLoss_dB).filter(Number.isFinite);
  
  return {
    modelStatus: 'heuristic-not-standard-compliant',
    // ── Pass metadata ──
    pass: prediction.pass,
    
    // ── NTN channel profile ──
    ntnProfile: {
      channelModel: classifyNTNChannel(avgDelay, computeNTNKFactor(states[Math.floor(states.length/2)]), prediction.pass.maxElevation),
      delaySpread_ns: {
        mean: +avgDelay.toFixed(2),
        max: +maxDelay.toFixed(2),
        rms: +Math.sqrt(states.reduce((s, state) => s + (state.channel?.rmsDelaySpread_ns || 0)**2, 0) / states.length).toFixed(2)
      },
      doppler: {
        maxShift_Hz: +maxDoppler.toFixed(1),
        maxRate_HzPerSec: +dopplerRate.toFixed(2),
        signChangeCount: countDopplerSignChanges(states)
      },
      elevation: {
        min_deg: +(prediction.pass.maxElevation > 90 ? 0 : Math.min(...states.map(s => s.elevation_deg))).toFixed(1),
        max_deg: +(prediction.pass.maxElevation || Math.max(...states.map(s => s.elevation_deg))).toFixed(1)
      },
      snr: {
        peak_dB: snrs.length ? +Math.max(...snrs).toFixed(2) : -30,
        mean_dB: snrs.length ? +(snrs.reduce((a,b) => a+b, 0) / snrs.length).toFixed(2) : -30,
        linkMargin_dB: +(snrs.length ? (snrs.reduce((a,b) => a+b, 0) / snrs.length - 1.0) : -30).toFixed(2)
      },
      capacity: {
        rank2Fraction: (states.filter(s => s.channel?.predictedRank === 2).length / states.length).toFixed(2),
        peakMIMO_bpsHz: +Math.max(...states.map(s => s.channel?.capacityRank2_bpsHz || 0)).toFixed(3)
      },
      
      // ── 3GPP-compliant parameter set ──
      gppParams: {
        channelModelType: classifyNTNChannel(avgDelay, computeNTNKFactor(states[Math.floor(states.length/2)]), prediction.pass.maxElevation),
        rmsDelaySpread_ns: +avgDelay.toFixed(2),
        kFactor_dB: +computeNTNKFactor(states[Math.floor(states.length/2)]).toFixed(1),
        dopplerShiftRange_Hz: [-(maxDoppler), maxDoppler].map(v => +v.toFixed(1)),
        dopplerRateRange_HzPerSec: [-(Math.abs(dopplerRate)), Math.abs(dopplerRate)].map(v => +v.toFixed(3)),
        elevationRange_deg: [+prediction.pass.maxElevation > 90 ? 0 : Math.min(...states.map(s => s.elevation_deg)), +(prediction.pass.maxElevation || 90)].map(v => +v.toFixed(1)),
        pathLossRange: pathLosses.length === states.length
          ? { status: 'available', values_dB: [Math.min(...pathLosses), Math.max(...pathLosses)].map(v => +v.toFixed(1)) }
          : { status: 'unavailable', reason: 'PATH_LOSS_NOT_PROVIDED' },
        xpdRange_dB: [Math.min(...states.map(s => s.channel?.xpd_dB || 35)), Math.max(...states.map(s => s.channel?.xpd_dB || 35))].map(v => +v.toFixed(1))
      }
    },
    
    // ── Detailed timeline for channel emulator playback ──
    timeline: states.map(state => ({
      time: state.time,
      elevation_deg: state.elevation_deg,
      snr_dB: state.snr?.db,
      doppler_Hz: state.doppler?.hz,
      delaySpread_ns: state.channel?.rmsDelaySpread_ns,
      kFactor_dB: computeNTNKFactor(state),
      channelModel: classifyNTNChannel(
        state.channel?.rmsDelaySpread_ns || 0,
        computeNTNKFactor(state),
        state.elevation_deg
      )
    })).filter(s => s.elevation_deg > 0)
  };
}

// ─── Helper Functions ───────────────────────────────────────────────────

function computeNTNKFactor(state) {
  // K-factor from CIR: LOS power / scattered power
  // For states without full CIR, estimate from elevation
  const delaySpread = state.channel?.rmsDelaySpread_ns || 0;
  if (delaySpread < 5) return 15;   // very clean LOS
  if (delaySpread < 20) return 10;  // moderate
  if (delaySpread < 100) return 5;  // suburban
  return 2;                          // urban low elevation
}

function estimateAngularSpread(elevation_deg) {
  if (elevation_deg > 45) return 2;   // high elevation, narrow spread
  if (elevation_deg > 20) return 5;   // medium
  return 10;                           // low elevation, wide spread
}

function estimateSatelliteVelocity(dopplerHz) {
  // Approximate: v = doppler * c / f (for Ka-band ~30 GHz)
  const c = 299792458;
  const f = 30e9;
  return +((dopplerHz * c / f) / 1000).toFixed(2); // km/s
}

function estimateIonosphericDelay(totalAtmLoss) {
  // Rough split: ionosphere ≈ 10-20% of total atmospheric at Ka-band
  return totalAtmLoss * 0.15;
}

function estimateCoherentTime(dopplerHz) {
  // Tc ≈ 0.423 / fd_max
  const fd = Math.max(1, Math.abs(dopplerHz));
  return +(0.423 / fd * 1000).toFixed(2); // ms
}

function countDopplerSignChanges(states) {
  let count = 0;
  for (let i = 1; i < states.length; i++) {
    if (Math.sign(states[i-1].doppler?.hz || 0) !== Math.sign(states[i].doppler?.hz || 0)) {
      count++;
    }
  }
  return count;
}

// ─── Export ─────────────────────────────────────────────────────────────

export { NTN_CHANNEL_TYPES, classifyNTNChannel, computeNTNKFactor };
