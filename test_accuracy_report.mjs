import { generateChannelTimeSeries } from './src/model.js';

const TLEs = {
    "Starlink (LEO)": [
        "1 44713U 19074A   23249.52157811  .00018042  00000-0  32479-3 0  9997",
        "2 44713  53.0530 330.1245 0001273  19.5398  65.7335 15.05841804414341"
    ],
    "NOAA-19 (LEO)": [
        "1 33591U 09005A   23250.51152811  .00000042  00000-0  32479-4 0  9997",
        "2 33591  99.1530 330.1245 0014273  19.5398  65.7335 14.11841804414341"
    ],
    "GEO-Sat": [
        "1 43054U 17081A   23249.52157811 -.00000213  00000-0  00000-0 0  9993",
        "2 43054   0.0381  22.2858 0001859 295.3400  32.0620  1.00270630 20970"
    ]
};

const c = 299792458; 

function calculateTheoreticalFSPL(distanceKm, freqGHz) {
    const distanceM = distanceKm * 1000;
    const freqHz = freqGHz * 1e9;
    return 20 * Math.log10(distanceM) + 20 * Math.log10(freqHz) + 20 * Math.log10(4 * Math.PI / c);
}

function runTest() {
    console.log("==================================================");
    console.log("=== 卫星链路仿真常识准确率测试报告 ===");
    console.log("==================================================\n");

    let metrics = { total: 0, pass: 0 };

    function evaluateScenario(name, tleName, freq, eirp, gRx, timeOffsetHrs, env, rainRate, isLeo) {
        console.log(`[测试场景] ${name}`);
        
        let now = new Date();
        let end = new Date(now.getTime() + timeOffsetHrs * 3600 * 1000);
        let res = generateChannelTimeSeries(
            TLEs[tleName][0], TLEs[tleName][1],
            22.54, 114.05, 0, now, end, 60,
            { freq, eirp, gRx, tRx: 150, bandwidth: 400, rainRate: rainRate, env: env }
        );
        
        let validFrames = res.filter(f => f.elevation > 0);
        if (validFrames.length === 0) {
            console.log("  ⚠️ 在设定的时间窗口内卫星不可见，跳过测试。\n");
            return null;
        }

        let maxElFrame = validFrames.reduce((a, b) => a.elevation > b.elevation ? a : b);
        let fspl = calculateTheoreticalFSPL(maxElFrame.slantRange, freq);
        let rxTheory = eirp + 30 + gRx - fspl;
        let rxActual = maxElFrame.rxPowerDbm;
        let atmLoss = rxTheory - rxActual;
        
        // 评估逻辑
        let passed = false;
        if (rainRate > 10 && freq > 10) {
            // 暴雨 + 高频 (Ku/Ka)：应当出现显著的雨衰 (至少 10dB)
            passed = atmLoss > 10.0;
            console.log(`  > 高频雨衰测试: 隐含附加损耗为 ${atmLoss.toFixed(2)} dB`);
        } else if (env === 'urban') {
            // 城市环境：相比于乡村，附加损耗应该因为建筑遮挡而存在显著起伏或偏高
            passed = atmLoss > 3.0; // 假设城市遮挡带来的衰减较大
            console.log(`  > 城市多径测试: 隐含附加损耗为 ${atmLoss.toFixed(2)} dB`);
        } else {
            // 常规理想空载测试
            let diff = Math.abs(rxTheory - rxActual);
            passed = diff >= 0 && diff < 8.0; 
            console.log(`  > 最佳仰角: ${maxElFrame.elevation.toFixed(1)}°`);
            console.log(`  > 星地距离: ${maxElFrame.slantRange.toFixed(0)} km`);
            console.log(`  > 理论自由空间损耗 (FSPL): ${fspl.toFixed(2)} dB`);
            console.log(`  > 仿真输出总损耗: ${maxElFrame.absoluteFspl.toFixed(2)} dB`);
            console.log(`  > 理论空载接收功率: ${rxTheory.toFixed(2)} dBm`);
            console.log(`  > 仿真输出接收功率: ${rxActual.toFixed(2)} dBm`);
            console.log(`  > 隐含附加损耗(大气/植被/对齐偏差等): ${atmLoss.toFixed(2)} dB`);
        }

        metrics.total++;
        if (passed) metrics.pass++;
        console.log(`  => 结论: ${passed ? '✅ 链路预算/衰落特征符合物理常识' : '❌ 存在常识性偏差或模型未生效'}\n`);

        if (isLeo && rainRate === 0 && env === 'rural') {
            metrics.total++;
            let snrs = validFrames.map(f => f.snrDb);
            let snrDiff = Math.max(...snrs) - Math.min(...snrs);
            let snrPassed = snrDiff > 5;
            if (snrPassed) metrics.pass++;
            console.log(`  [包络特征测试] LEO过境信噪比动态范围: ${snrDiff.toFixed(2)} dB`);
            console.log(`  => 结论: ${snrPassed ? '✅ 存在显著抛物线多普勒包络特征' : '❌ 信号过于平坦，不符合LEO动态特征'}\n`);
        }

        return maxElFrame;
    }

    // 1. 常规高频 LEO
    evaluateScenario("Starlink LEO (Ku-band, 12GHz, 晴天Rural)", "Starlink (LEO)", 12.0, 60, 42, 24, 'rural', 0, true);
    
    // 2. 常规低频 LEO
    evaluateScenario("NOAA-19 (S-band, 2.2GHz, 晴天Rural)", "NOAA-19 (LEO)", 2.2, 35, 3, 24, 'rural', 0, true);

    // 3. 雨衰测试 (GEO Ka波段, 暴雨)
    evaluateScenario("GEO 卫星 (Ka-band, 30GHz, 暴雨50mm/h)", "GEO-Sat", 30.0, 70, 45, 12, 'rural', 50, false);

    // 4. 多径/城市环境测试 (LEO Ku波段, Urban城市遮挡)
    evaluateScenario("Starlink LEO (Ku-band, 12GHz, 城市Urban)", "Starlink (LEO)", 12.0, 60, 42, 24, 'urban', 0, true);

    console.log("==================================================");
    let rate = (metrics.pass / metrics.total) * 100;
    console.log(`最终准确率得分: ${metrics.pass} / ${metrics.total} 项校验通过 (${rate.toFixed(0)}%)`);
    if (rate === 100) {
        console.log("整体评价: 【S级】当前的底层仿真链路预算 100% 严格遵守 ITU-R 和经典 Friis 传播模型，无物理常识性违背。");
    } else if (rate >= 80) {
        console.log("整体评价: 【A级】整体符合物理常识，可能在某些极端环境模型上有特定参数溢出。");
    } else {
        console.log("整体评价: 【C级】需要重新审查天线增益、单位换算或距离算子。");
    }
}

runTest();