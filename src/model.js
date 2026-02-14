// Core Satellite Channel Model (JS Implementation)
// Based on ITU-R P.838, P.618, P.676, P.840 and Loo's LMS Model

import { create, all } from 'mathjs';
const math = create(all);

// --- Constants ---
const FREQ_BANDS = {
  'S': 2.2,
  'Ku': 12.0,
  'Ka': 30.0,
  'Q': 40.0,
  'V': 50.0
};

// ITU-R P.838 Coefficients (Simplified Interpolation)
const RAIN_COEFFS = {
  2.2: { k: 0.0002, alpha: 0.95 },
  12.0: { k: 0.018, alpha: 1.15 },
  30.0: { k: 0.187, alpha: 1.021 }, // Ka-band vertical
  40.0: { k: 0.35, alpha: 0.93 },
  50.0: { k: 0.55, alpha: 0.88 }
};

// --- Atmospheric Models ---

export function calculateLinkBudget(params) {
  const { freq, rainRate, elevation, env } = params;
  
  // 1. Rain Attenuation (ITU-R P.838)
  // Interpolate k, alpha if needed (simplified: pick nearest)
  let k = 0.018, alpha = 1.15; // default Ku
  let minDiff = 100;
  for (const [f, c] of Object.entries(RAIN_COEFFS)) {
    const diff = Math.abs(parseFloat(f) - freq);
    if (diff < minDiff) {
      minDiff = diff;
      k = c.k;
      alpha = c.alpha;
    }
  }
  
  const gamma = k * Math.pow(rainRate, alpha);
  const elevRad = (elevation * Math.PI) / 180;
  const heightRain = 3.0; // km
  const slantPath = heightRain / Math.sin(elevRad);
  const rFactor = 1 / (1 + 0.045 * slantPath);
  const lEff = slantPath * rFactor;
  const attRain = gamma * lEff;

  // 2. Gas Attenuation (ITU-R P.676 Simplified)
  let attZenithGas = 0.05;
  if (freq < 10) attZenithGas = 0.05;
  else if (freq < 20) attZenithGas = 0.2;
  else if (freq < 35) attZenithGas = 0.3;
  else if (freq < 50) attZenithGas = 0.8;
  else attZenithGas = 4.0;
  const attGas = attZenithGas / Math.sin(elevRad);

  // 3. Cloud Attenuation (ITU-R P.840 Simplified)
  const K_l = 0.0002 * Math.pow(freq, 1.95);
  const L_content = 0.5; // mm
  const attCloud = (L_content * K_l) / Math.sin(elevRad);

  // 4. Total Atmospheric Loss
  const totalAtmosphericLoss = attRain + attGas + attCloud;

  // 5. XPD (Cross-Polarization Discrimination) ITU-R P.618
  // XPD = U - V * log10(A_rain)
  let xpd = 40.0;
  if (attRain > 0.1) {
    const U = 30 * Math.log10(freq);
    const V = 20.0;
    xpd = U - V * Math.log10(attRain);
    xpd = Math.max(0, Math.min(40, xpd));
  }

  // 6. Near-Ground Fading (Loo Model / LMS)
  // Mean fading based on environment
  let fadeLMS = 0;
  if (env === 'urban') fadeLMS = 15.0; // Heavy shadowing
  else if (env === 'suburban') fadeLMS = 5.0; // Moderate
  else fadeLMS = 0.5; // Open

  // Total Link Loss (Atmospheric + Ground)
  const totalLoss = totalAtmosphericLoss + fadeLMS;

  return {
    attRain,
    attGas,
    attCloud,
    fadeLMS,
    totalLoss,
    xpd
  };
}

// --- MIMO Capacity Calculation ---
export function calculateMIMOCapacity(snrDb, xpdDb) {
  const snr = Math.pow(10, snrDb / 10);
  const crosstalkPower = Math.pow(10, -xpdDb / 10);
  
  // Rank 2 (Dual Stream)
  // H = [[1, alpha], [alpha, 1]]
  // Capacity approx: 2 * log2(1 + SINR)
  // SINR = (SNR/2) / (1 + (SNR/2)*crosstalk)
  const pSig = snr / 2;
  const sinrSimple = pSig / (1 + pSig * crosstalkPower);
  const capRank2 = 2 * Math.log2(1 + sinrSimple);
  
  // Rank 1 (Single Stream)
  // Capacity = log2(1 + SNR)
  const capRank1 = Math.log2(1 + snr);
  
  return { capRank2, capRank1 };
}
