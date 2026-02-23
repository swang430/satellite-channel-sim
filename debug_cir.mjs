/**
 * 调试脚本：直接调用 computeCIR 验证 tap 生成逻辑
 * 测试不同环境和参数下的 tap 数量
 */

// 内联 computeCIR 逻辑（不依赖 satellite.js 的 ES module import）
const C_M_S = 299792458;

function getSoSFade(t_sec) {
    let val = 0;
    const N = 8;
    for (let n = 0; n < N; n++) {
        const fn = 0.1 + n * 0.05;
        const phi = (n * 2.0 * Math.PI) / N;
        val += Math.cos(2 * Math.PI * fn * t_sec + phi);
    }
    return val / N;
}

function computeCIR(params) {
    const { freq, elevation, slantRange, env, tec = 50, rainRate = 0, correctionFactor = 1.0, hpbw = 2.0, simTime = 0 } = params;

    console.log('--- computeCIR 输入参数 ---');
    console.log('  env =', JSON.stringify(env));
    console.log('  freq =', freq, 'GHz');
    console.log('  elevation =', elevation, '°');
    console.log('  slantRange =', slantRange, 'km');
    console.log('  tec =', tec, 'TECU');
    console.log('  rainRate =', rainRate, 'mm/h');
    console.log('  simTime =', simTime, 's');

    const elevRad = Math.max(0.1, elevation) * Math.PI / 180;
    const sinElev = Math.sin(elevRad);
    console.log('  sinElev =', sinElev.toFixed(6));

    const losDelay_ns = (slantRange * 1e3 / C_M_S) * 1e9;
    const absoluteFspl = 20 * Math.log10(slantRange) + 20 * Math.log10(freq) + 92.45;

    // 简化大气衰减计算
    const RAIN_COEFFS = {
        2.2: { k: 0.0002, alpha: 0.95 },
        12.0: { k: 0.018, alpha: 1.15 },
        30.0: { k: 0.187, alpha: 1.021 },
        40.0: { k: 0.35, alpha: 0.93 },
        50.0: { k: 0.55, alpha: 0.88 }
    };

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

    console.log('\n--- Tap 生成过程 ---');
    console.log('  ✅ Tap 0: LOS (直射) | amplitude_dB =', losAmplitude_dB.toFixed(2));

    // --- Tap 1: 海面反射 ---
    if (env === 'maritime') {
        const h_rx = 15.0;
        const pathDiff_m = 2 * h_rx * sinElev;
        const excessDelay_ns = (pathDiff_m / C_M_S) * 1e9;
        const reflCoeff = -0.85;
        const reflAmplitude = losAmplitude * Math.abs(reflCoeff);
        const reflPhase = Math.PI;
        taps.push({
            index: 1,
            label: '海面反射',
            delay_ns: losDelay_ns + excessDelay_ns,
            excessDelay_ns,
            amplitude_linear: reflAmplitude,
            amplitude_dB: 20 * Math.log10(reflAmplitude),
            phase_rad: reflPhase
        });
        console.log('  ✅ Tap 1: 海面反射 (maritime)');
    } else {
        console.log('  ❌ 跳过海面反射 (env !== "maritime", env =', JSON.stringify(env) + ')');
    }

    // --- Tap 2~3: 散射 ---
    if (env === 'urban' || env === 'suburban') {
        const scatterParams = env === 'urban'
            ? [{ delay: 100, power: -15, label: '建筑散射-近' }, { delay: 300, power: -22, label: '建筑散射-远' }]
            : [{ delay: 80, power: -18, label: '植被散射-近' }, { delay: 200, power: -25, label: '植被散射-远' }];

        const elevFactor = Math.max(0.1, 1.0 - elevation / 90.0);
        console.log('  elevFactor =', elevFactor.toFixed(4));

        scatterParams.forEach((sp, i) => {
            const scatterPower_dB = losAmplitude_dB + sp.power * elevFactor;
            const scatterAmplitude = Math.pow(10, scatterPower_dB / 20);
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
            console.log('  ✅ Tap', taps.length - 1 + ':', sp.label, '| power_dB =', scatterPower_dB.toFixed(2));
        });
    } else {
        console.log('  ❌ 跳过散射 taps (env 不是 urban/suburban, env =', JSON.stringify(env) + ')');
    }

    // --- Tap N: 电离层色散 ---
    const tecVal = tec || 50;
    const dispersionNs = (2.0 * 134.0 * tecVal * 0.4) / (Math.pow(freq, 3) * sinElev);
    console.log('\n  dispersionNs =', dispersionNs.toFixed(6), 'ns (阈值: > 0.01)');
    if (dispersionNs > 0.01) {
        const ionoPower_dB = losAmplitude_dB - 30 - 10 * Math.log10(freq);
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
        console.log('  ✅ Tap', taps.length - 1 + ': 电离层色散 | power_dB =', ionoPower_dB.toFixed(2));
    } else {
        console.log('  ❌ 跳过电离层色散 tap (dispersionNs <= 0.01)');
    }

    console.log('\n=== 结果: 总共', taps.length, '个 taps ===');
    taps.forEach(t => {
        console.log('  [' + t.index + '] ' + t.label + ' | delay=' + t.excessDelay_ns.toFixed(2) + 'ns | amp=' + t.amplitude_dB.toFixed(2) + 'dB');
    });

    return { taps, totalTaps: taps.length };
}

// === 测试用例 ===
console.log('\n' + '='.repeat(70));
console.log('测试 1: suburban 环境 (默认参数, freq=12GHz, elev=30°)');
console.log('='.repeat(70));
computeCIR({
    freq: 12.0,
    elevation: 30,
    slantRange: 3000,
    env: 'suburban',
    tec: 50,
    rainRate: 5
});

console.log('\n' + '='.repeat(70));
console.log('测试 2: suburban 环境 (freq=30GHz, elev=30°)');
console.log('='.repeat(70));
computeCIR({
    freq: 30.0,
    elevation: 30,
    slantRange: 3000,
    env: 'suburban',
    tec: 50,
    rainRate: 5
});

console.log('\n' + '='.repeat(70));
console.log('测试 3: suburban 环境 (freq=12GHz, elev=5° - 低仰角)');
console.log('='.repeat(70));
computeCIR({
    freq: 12.0,
    elevation: 5,
    slantRange: 10000,
    env: 'suburban',
    tec: 50,
    rainRate: 5
});

console.log('\n' + '='.repeat(70));
console.log('测试 4: rural 环境 (freq=12GHz, elev=30°)');
console.log('='.repeat(70));
computeCIR({
    freq: 12.0,
    elevation: 30,
    slantRange: 3000,
    env: 'rural',
    tec: 50,
    rainRate: 5
});

console.log('\n' + '='.repeat(70));
console.log('测试 5: maritime 环境 (freq=12GHz, elev=30°)');
console.log('='.repeat(70));
computeCIR({
    freq: 12.0,
    elevation: 30,
    slantRange: 3000,
    env: 'maritime',
    tec: 50,
    rainRate: 5
});

console.log('\n' + '='.repeat(70));
console.log('测试 6: urban 环境 (freq=12GHz, elev=30°)');
console.log('='.repeat(70));
computeCIR({
    freq: 12.0,
    elevation: 30,
    slantRange: 3000,
    env: 'urban',
    tec: 50,
    rainRate: 5
});

console.log('\n' + '='.repeat(70));
console.log('测试 7: env=undefined (模拟参数丢失)');
console.log('='.repeat(70));
computeCIR({
    freq: 12.0,
    elevation: 30,
    slantRange: 3000,
    tec: 50,
    rainRate: 5
});
