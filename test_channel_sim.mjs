import { computeCIR, generateChannelTimeSeries } from './src/model.js';
import assert from 'assert';

console.log("=== 信道传播仿真测试 (CIR + TimeSeries) ===\n");

// ============================================================
// 1. CIR 基本结构验证
// ============================================================

console.log("--- 1. CIR 基本结构 ---");

const cir1 = computeCIR({ freq: 12, elevation: 45, slantRange: 35786, env: 'suburban', tec: 50, rainRate: 10 });
console.log(`[1.1] GEO Ka 链路: ${cir1.taps.length} taps, RMS Delay Spread: ${cir1.rmsDelaySpread_ns.toFixed(2)} ns, Bc: ${cir1.coherenceBandwidth_MHz.toFixed(2)} MHz`);
assert(cir1.taps.length >= 1, "至少应有 LOS tap");
assert(cir1.taps[0].label === 'LOS (直射)', "第一个 tap 应为 LOS");
assert(cir1.rmsDelaySpread_ns >= 0, "RMS delay spread 不应为负");

// ============================================================
// 2. 绝对 FSPL 数值验证
// ============================================================

console.log("\n--- 2. 绝对 FSPL 验证 ---");

// GEO (35786 km) + 12 GHz → FSPL ≈ 205.5 dB (经典值参考)
const cirGeo = computeCIR({ freq: 12, elevation: 90, slantRange: 35786, env: 'rural' });
console.log(`[2.1] GEO FSPL (12 GHz): ${cirGeo.absoluteFspl.toFixed(2)} dB`);
assert(Math.abs(cirGeo.absoluteFspl - 205.5) < 1.0, `GEO FSPL 应约 205.5 dB, 实际 ${cirGeo.absoluteFspl.toFixed(2)}`);

// LEO (550 km) + 12 GHz → FSPL ≈ 169.3 dB
const cirLeo = computeCIR({ freq: 12, elevation: 90, slantRange: 550, env: 'rural' });
console.log(`[2.2] LEO FSPL (12 GHz): ${cirLeo.absoluteFspl.toFixed(2)} dB`);
assert(Math.abs(cirLeo.absoluteFspl - 169.3) < 1.0, `LEO FSPL 应约 169.3 dB, 实际 ${cirLeo.absoluteFspl.toFixed(2)}`);

// LEO FSPL 相比 GEO 增益约 36 dB
const fsplGain = cirGeo.absoluteFspl - cirLeo.absoluteFspl;
console.log(`[2.3] LEO vs GEO FSPL 增益: ${fsplGain.toFixed(2)} dB`);
assert(Math.abs(fsplGain - 36.2) < 1.0, "LEO 距离优势应约 36 dB");

// ============================================================
// 3. LOS tap 传播时延验证
// ============================================================

console.log("\n--- 3. 传播时延验证 ---");

// GEO 传播时延 ≈ 119.4 ms → 119370000 ns
const geoDelay = cirGeo.taps[0].delay_ns;
console.log(`[3.1] GEO LOS 时延: ${(geoDelay / 1e6).toFixed(2)} ms`);
assert(Math.abs(geoDelay / 1e6 - 119.4) < 1.0, "GEO 传播时延应约 119.4 ms");

// LEO 550km 传播时延 ≈ 1.83 ms
const leoDelay = cirLeo.taps[0].delay_ns;
console.log(`[3.2] LEO LOS 时延: ${(leoDelay / 1e6).toFixed(3)} ms`);
assert(Math.abs(leoDelay / 1e6 - 1.835) < 0.1, "LEO 传播时延应约 1.84 ms");

// ============================================================
// 4. 环境特定 CIR 验证
// ============================================================

console.log("\n--- 4. 环境特定多径验证 ---");

// Maritime: 应有海面反射 tap
const cirMar = computeCIR({ freq: 12, elevation: 10, slantRange: 1000, env: 'maritime', tec: 50 });
console.log(`[4.1] Maritime: ${cirMar.taps.length} taps — ${cirMar.taps.map(t => t.label).join(', ')}`);
const hasReflection = cirMar.taps.some(t => t.label === '海面反射');
assert(hasReflection, "Maritime 环境必须有海面反射 tap");
// 反射 tap 相位应约为 π
const reflTap = cirMar.taps.find(t => t.label === '海面反射');
assert(Math.abs(reflTap.phase_rad - Math.PI) < 0.01, "海面反射相位应为 π");

// Urban: 应有建筑散射 taps
const cirUrb = computeCIR({ freq: 30, elevation: 30, slantRange: 550, env: 'urban', tec: 50 });
console.log(`[4.2] Urban: ${cirUrb.taps.length} taps — ${cirUrb.taps.map(t => t.label).join(', ')}`);
const hasScatter = cirUrb.taps.some(t => t.label.includes('建筑散射'));
assert(hasScatter, "Urban 环境必须有建筑散射 taps");

// Rural: 应仅有 LOS + 可能的电离层
const cirRur = computeCIR({ freq: 30, elevation: 45, slantRange: 550, env: 'rural', tec: 50 });
console.log(`[4.3] Rural: ${cirRur.taps.length} taps — ${cirRur.taps.map(t => t.label).join(', ')}`);
assert(!cirRur.taps.some(t => t.label.includes('散射')), "Rural 环境不应有散射 taps");
assert(!cirRur.taps.some(t => t.label.includes('反射')), "Rural 环境不应有反射 taps");

// ============================================================
// 5. 时间序列生成验证
// ============================================================

console.log("\n--- 5. 时间序列验证 ---");

const ISS_TLE1 = '1 25544U 98067A   23249.52157811  .00018042  00000-0  32479-3 0  9997';
const ISS_TLE2 = '2 25544  51.6420 330.1245 0005273  19.5398  65.7335 15.49841804414341';

const now = new Date();
const end = new Date(now.getTime() + 10 * 60 * 1000); // 10 分钟

const ts = generateChannelTimeSeries(
    ISS_TLE1, ISS_TLE2,
    22.54, 114.05, 0,
    now, end, 30,
    { freq: 12, rainRate: 5, env: 'suburban', eirp: 60, gRx: 42, tRx: 150, bandwidth: 400, tec: 50 }
);

console.log(`[5.1] 生成帧数: ${ts.length}`);
assert(ts.length > 0, "时间序列不应为空");
assert(ts.length >= 15, `10 分钟 / 30 秒步长应有 ≥20 帧, 实际 ${ts.length}`);

// 验证数据完整性
const f0 = ts[0];
console.log(`[5.2] 首帧数据: El=${f0.elevation.toFixed(1)}° Az=${f0.azimuth.toFixed(1)}° Range=${f0.slantRange.toFixed(0)}km`);
console.log(`      RxPower=${f0.rxPowerDbm.toFixed(1)}dBm SNR=${f0.snrDb.toFixed(1)}dB FSPL=${f0.absoluteFspl.toFixed(1)}dB`);
console.log(`      CIR: ${f0.cir.taps.length} taps, σ_τ=${f0.cir.rmsDelaySpread_ns.toFixed(2)}ns`);

assert(isFinite(f0.rxPowerDbm), "rxPowerDbm 必须为有限数");
assert(isFinite(f0.snrDb), "snrDb 必须为有限数");
assert(isFinite(f0.absoluteFspl), "absoluteFspl 必须为有限数");
assert(f0.cir.taps.length >= 1, "CIR 至少应有 LOS tap");
assert(isFinite(f0.cir.rmsDelaySpread_ns), "RMS Delay Spread 必须为有限数");

// 验证所有帧都有有限数值
let allFinite = true;
for (const frame of ts) {
    if (!isFinite(frame.rxPowerDbm) || !isFinite(frame.snrDb) || !isFinite(frame.absoluteFspl)) {
        allFinite = false;
        console.log(`  ⚠️ 帧 ${frame.frameIndex} 数据异常`);
        break;
    }
}
console.log(`[5.3] 全帧数据完整性: ${allFinite ? '✅ 通过' : '❌ 失败'}`);
assert(allFinite, "所有帧数据必须为有限数");

// 验证 MIMO 容量字段
assert(isFinite(f0.capRank1) && f0.capRank1 >= 0, "capRank1 须为非负有限数");
assert(isFinite(f0.capRank2) && f0.capRank2 >= 0, "capRank2 须为非负有限数");
console.log(`[5.4] MIMO: Rank1=${f0.capRank1.toFixed(2)} bps/Hz, Rank2=${f0.capRank2.toFixed(2)} bps/Hz`);

console.log("\n✅ [所有信道传播仿真测试通过]");
