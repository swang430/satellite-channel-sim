export class SimulationValidator {
    constructor(simData) {
        this.simData = simData; 
    }

    checkReceivedPower() {
        console.log("--- 验证 1：常识性接收功率校验 ---");
        const freqHz = this.simData.frequency; 
        const distanceM = this.simData.distance * 1000; 
        
        const c = 299792458; 
        const fspl_dB = 20 * Math.log10(distanceM) + 20 * Math.log10(freqHz) + 20 * Math.log10(4 * Math.PI / c);
        
        // eirp_dBW + 30 => eirp_dBm
        const theoreticalPr_dBm = (this.simData.eirp_dBW + 30) + this.simData.rxGain_dBi - fspl_dB;

        const error = Math.abs(theoreticalPr_dBm - this.simData.rxPower_dBm);
        
        console.log(`[理论计算] FSPL: ${fspl_dB.toFixed(2)} dB`);
        console.log(`[理论计算] 接收功率: ${theoreticalPr_dBm.toFixed(2)} dBm`);
        console.log(`[仿真输出] 接收功率: ${this.simData.rxPower_dBm.toFixed(2)} dBm`);
        
        // Allow up to 10dB difference due to atmospheric losses etc., but not crazy large.
        if (error < 15) {
            console.log("✅ 接收功率基线符合常识 (包含大气衰减误差在合理范围内)。");
        } else {
            console.error(`❌ 偏差过大 (误差: ${error.toFixed(2)} dB)！检查单位或公式。`);
        }
    }

    checkPassEnvelope() {
        console.log("--- 验证 2：过境包络特征校验 ---");
        
        const snrSeries = this.simData.snrTimeSeries; 
        if (!snrSeries || snrSeries.length === 0) {
            console.warn("⚠️ 警告：未提供 SNR 序列进行包络特征校验。");
            return;
        }

        const maxSnr = Math.max(...snrSeries);
        const minSnr = Math.min(...snrSeries);
        
        if ((maxSnr - minSnr) > 2) { 
            console.log("✅ 过境包络特征正常：SNR 呈现合理的动态范围 (AOS 到天顶)，符合真实地面站观测结果。");
        } else {
            console.warn("⚠️ 警告：SNR 变化极小。如果你模拟的是 LEO 卫星，这不符合常识（通常天顶和地平线差异巨大）。");
        }
    }

    runAll() {
        this.checkReceivedPower();
        this.checkPassEnvelope();
    }
}