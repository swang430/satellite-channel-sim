import { calculateLinkBudget } from './src/model.js';
import assert from 'assert';

console.log("=== Mathematical Unit Tests (model.js) ===");

// 1.1 大气折射定位错位 (Refraction)
let r1 = calculateLinkBudget({ elevation: 5.0, hpbw: 2.0 });
console.log(`[1.1] Refraction at 5°: Apparent ${r1.apparentElevation.toFixed(3)}°, Pointing Loss ${r1.pointingLoss.toFixed(3)} dB`);
assert(r1.apparentElevation > 5.0 && r1.apparentElevation < 5.3, "Refraction should be around 5.15");
assert(r1.pointingLoss > 0.05 && r1.pointingLoss < 1.0, "Pointing loss should be small but measurable");

// 1.2 辐射热底噪飙升 (Sky Noise)
let r2a = calculateLinkBudget({ elevation: 90, rainRate: 0, env: 'suburban' });
console.log(`[1.2a] Sky Noise (Clear): ${r2a.tSky.toFixed(1)} K`);
assert(r2a.tSky < 50, "Clear sky noise >50K is abnormal for Ku+ bands");

let r2b = calculateLinkBudget({ elevation: 90, rainRate: 50, env: 'suburban' });
console.log(`[1.2b] Sky Noise (Heavy Rain): ${r2b.tSky.toFixed(1)} K (Atm loss: ${r2b.totalAtmosphericLoss.toFixed(1)}dB)`);
assert(r2b.tSky > 100, "Heavy rain sky noise should drastically approach 290K threshold");

// 1.3 相控阵扫描崩溃 (Scan Loss)
let r3a = calculateLinkBudget({ elevation: 0.0, isPhasedArray: true });
console.log(`[1.3a] Scan Loss (0° Elev limit): ${r3a.scanLoss.toFixed(2)} dB`);
assert(!isNaN(r3a.scanLoss), "Scan loss must not evaluate to NaN/Infinity at 0° limit");

let r3b = calculateLinkBudget({ elevation: 30.0, isPhasedArray: true });
console.log(`[1.3b] Scan Loss (30° Elev): ${r3b.scanLoss.toFixed(2)} dB`);
assert(Math.abs(r3b.scanLoss - 4.51) < 0.2, "Cosine roll-off at 30deg (60deg scan) must be ~4.51 dB");

// 1.4 电离层几何拉伸 (Group Delay)
let r4 = calculateLinkBudget({ tec: 50, freq: 1.5, elevation: 90 });
console.log(`[1.4] Group Delay (1.5 GHz L-Band, TEC=50): ${r4.groupDelayNs.toFixed(2)} ns`);
assert(Math.abs(r4.groupDelayNs - 29.77) < 0.5, "L-Band L1 ~30 ns is canonical ground truth");

// 1.5 脉冲色散宽带墙 (Dispersion)
let r5 = calculateLinkBudget({ freq: 1.0, bandwidth: 100, tec: 100, elevation: 90 });
console.log(`[1.5] Dispersion (1.0 GHz, 100MHz BW, TEC=100): ${r5.dispersionNs.toFixed(2)} ns. Max ISI Baud: ${r5.maxSymbolRateMbaud.toFixed(2)} MBaud`);
assert(Math.abs(r5.dispersionNs - 26.8) < 0.5, "Expected dispersion 26.8 ns per spec derived equations");
assert(Math.abs(r5.maxSymbolRateMbaud - 18.6) < 0.5, "Expected 18.6 MBaud Nyquist ISI physical wall");

console.log("\n=== Boundary & Extreme Tests ===");

let b1 = calculateLinkBudget({ elevation: -10, isPhasedArray: true });
console.log(`[B1] Horizon Defense (-10° Elev): Apparent ${b1.apparentElevation.toFixed(2)}°. Loss: ${b1.totalLoss.toFixed(2)}dB`);
assert(!isNaN(b1.totalLoss), "Mathematical total loss shouldn't break under earth tangent geometries");

let b2 = calculateLinkBudget({ freq: 0.0001, bandwidth: 400, tec: 100 });
console.log(`[B2] DC Filter Defense (0.0001 GHz): Dispersion ${b2.dispersionNs.toExponential(2)} ns. Limiter kicks in at: ${b2.maxSymbolRateMbaud.toFixed(8)} MBaud`);
assert(b2.maxSymbolRateMbaud < 1, "Extrusion limits must prevent 0 baud or NaNs safely.");

let b3 = calculateLinkBudget({ tec: 0, rainRate: 0, env: 'suburban', isPhasedArray: false, freq: 30, elevation: 90, hpbw: 0 });
console.log(`[B3] Vacuum Baseline (No Rain, TEC=0): Rain Att ${b3.attRain}dB, Faraday ${b3.lossFaraday}dB, GD ${b3.groupDelayNs}ns`);
assert(b3.attRain === 0 && b3.lossFaraday === 0 && b3.groupDelayNs === 0, "Vacuum test must force multi physics mods strictly to exactly 0");

console.log("\n✅ [ALL MATHEMATICAL UNIT TESTS & BOUNDARIES PASSED SYSTEM ARCHITECTURE BOUNDS]");
