/**
 * 已知卫星参考库 — 用于地面测量校准
 *
 * 利用已知卫星的发射参数（EIRP、频率、极化、调制方式）作为参考基准，
 * 与地面实测数据对比，校正仿真模型中的衰减、噪声等参数偏差。
 */

export const KNOWN_SATELLITES = {
    CSS_TIANHE: {
        name: '中国空间站 (天和核心舱)',
        type: 'LEO',
        orbit: '~390 km, 41.5° inclination',
        bands: {
            S: {
                freq: 2.2,          // GHz — 测控链路
                eirp: 30.0,         // dBW
                polarization: 'RHCP',
                modulation: 'QPSK',
                bandwidth: 10.0     // MHz
            }
        },
        antennaPattern: 'omnidirectional',
        notes: 'LEO, 快速过境，适合动态仰角校准'
    },

    INTELSAT_906: {
        name: 'Intelsat 906 (64.0°E)',
        type: 'GEO',
        orbit: '35786 km, 64.0°E',
        bands: {
            C: {
                freq: 3.95,         // GHz — 下行 C 频段信标
                eirp: 38.0,         // dBW
                polarization: 'Linear-H',
                modulation: 'CW',   // 连续波信标
                bandwidth: 0.001    // MHz — 窄带信标
            },
            Ku: {
                freq: 11.7,         // GHz — 下行 Ku 频段信标
                eirp: 50.0,         // dBW
                polarization: 'Linear-H',
                modulation: 'CW',
                bandwidth: 0.001
            }
        },
        antennaPattern: 'shaped_beam',
        notes: 'GEO 信标，固定仰角，适合长时间雨衰校准'
    },

    SES_ASTRA_2E: {
        name: 'SES Astra 2E (28.2°E)',
        type: 'GEO',
        orbit: '35786 km, 28.2°E',
        bands: {
            Ku: {
                freq: 11.45,        // GHz — Ku 信标
                eirp: 52.0,         // dBW
                polarization: 'Linear-V',
                modulation: 'CW',
                bandwidth: 0.001
            },
            Ka: {
                freq: 20.2,         // GHz — Ka 信标
                eirp: 55.0,         // dBW
                polarization: 'Linear-V',
                modulation: 'CW',
                bandwidth: 0.001
            }
        },
        antennaPattern: 'spot_beam',
        notes: 'Ka 频段信标，对雨衰极为灵敏，是纯衰减校准的理想源'
    },

    MUOS_5: {
        name: 'MUOS-5 (UHF Sat, 72°E)',
        type: 'GEO',
        orbit: '35786 km, 72°E',
        bands: {
            UHF: {
                freq: 0.36,         // GHz — UHF 下行
                eirp: 20.0,         // dBW
                polarization: 'LHCP',
                modulation: 'WCDMA',
                bandwidth: 5.0
            }
        },
        antennaPattern: 'phased_array',
        notes: 'UHF 频段，电离层效应显著，适合 TEC/Faraday 旋转校准'
    },

    APSTAR_6D: {
        name: 'APStar-6D (134.5°E)',
        type: 'GEO',
        orbit: '35786 km, 134.5°E',
        bands: {
            Ku: {
                freq: 12.25,        // GHz
                eirp: 53.0,         // dBW
                polarization: 'Linear-H',
                modulation: 'DVB-S2',
                bandwidth: 36.0
            },
            Ka: {
                freq: 19.7,         // GHz
                eirp: 56.0,         // dBW
                polarization: 'RHCP',
                modulation: 'DVB-S2X',
                bandwidth: 500.0
            }
        },
        antennaPattern: 'multi_spot_beam',
        notes: '亚太覆盖，Ka HTS，高吞吐量卫星校准源'
    },

    BEIDOU_3_MEO: {
        name: '北斗三号 MEO (B3I 信号)',
        type: 'MEO',
        orbit: '~21528 km, 55° inclination',
        bands: {
            L: {
                freq: 1.268,        // GHz — B3I 频点
                eirp: 25.0,         // dBW
                polarization: 'RHCP',
                modulation: 'BPSK(10)',
                bandwidth: 20.46
            }
        },
        antennaPattern: 'earth_coverage',
        notes: '导航信号，L 频段，电离层延迟校准参考'
    }
};

/**
 * 获取卫星列表（用于 UI 下拉选择）
 * @returns {Array<{id: string, name: string, bands: string[]}>}
 */
export function getSatelliteList() {
    return Object.entries(KNOWN_SATELLITES).map(([id, sat]) => ({
        id,
        name: sat.name,
        type: sat.type,
        bands: Object.keys(sat.bands)
    }));
}

/**
 * 获取指定卫星和频段的链路参数
 * @param {string} satId — 卫星 ID (如 "CSS_TIANHE")
 * @param {string} bandKey — 频段 key (如 "S", "Ku", "Ka")
 * @returns {object|null} — { freq, eirp, polarization, modulation, bandwidth, ... }
 */
export function getSatelliteBandParams(satId, bandKey) {
    const sat = KNOWN_SATELLITES[satId];
    if (!sat || !sat.bands[bandKey]) return null;

    const band = sat.bands[bandKey];
    return {
        satName: sat.name,
        satType: sat.type,
        antennaPattern: sat.antennaPattern,
        ...band
    };
}
