import {
    lazy, Suspense, useState, useRef, useEffect, useCallback, useMemo,
} from 'react';
import { Line, Bar } from 'react-chartjs-2';
import { generateChannelTimeSeries, predictPasses, calibrateModel, applyCalibration, createDefaultCalibration, getCalibParamDefs } from './model.js';
import { getSatelliteList, getSatelliteBandParams } from './knownSatellites.js';
import { SimulationValidator } from './ValidationModule.js';
import {
    groundStationDistanceKm,
    parseCalibrationDataset,
} from './calibration/measurementAdapter.js';
import {
    loadCalibrationProfile,
    saveCalibrationProfile,
} from './calibration/storage.js';
import PdpComparisonPlayer from './features/channel-comparison/PdpComparisonPlayer.jsx';
import { buildStatisticalPlaybackReport } from './features/channel-comparison/statisticalPlaybackReport.js';
import {
    currentComparisonReport,
    deriveComparisonRequest,
} from './features/channel-comparison/comparisonReportState.js';

const MpdbImportPanel = lazy(() => import('./features/mpdb-import/MpdbImportPanel.jsx'));
const ChannelComparisonPanel = lazy(() => import('./features/channel-comparison/ChannelComparisonPanel.jsx'));

function buildMpdbTrajectorySamples(scenario, report = null) {
    return (scenario?.transmitter?.track ?? []).map((point, index) => {
        const geometry = report?.frames?.[index]?.geometry;
        return {
            index,
            lat: Number.isFinite(point.latitude_deg) ? point.latitude_deg : 0,
            lon: Number.isFinite(point.longitude_deg) ? point.longitude_deg : 0,
            alt: Number.isFinite(point.projectedPosition_m?.z)
                ? point.projectedPosition_m.z / 1_000
                : 0,
            azimuth: Number.isFinite(geometry?.azimuth_deg) ? geometry.azimuth_deg : 0,
            elevation: Number.isFinite(geometry?.elevation_deg) ? geometry.elevation_deg : 0,
            slantRange: Number.isFinite(geometry?.slantRange_m)
                ? geometry.slantRange_m / 1_000
                : 0,
            time: point.timestampUtc,
            timeLabel: point.timestampUtc,
        };
    });
}

/**
 * Channel Propagation Simulator Panel
 *
 * Input: Satellite TLE + Ground Station + Time Window + Link Params
 * Output: Rx Power / SNR / CIR time series + CSV/JSON export
 */
export default function ChannelSimPanel({
    tleLine1,
    tleLine2,
    satName,
    globalParams,
    groundStation,
    onGroundStationChange,
    onLinkParamsChange,
    requestedCirIndex,
    onCirSyncStateChange
}) {
    // === Ground Station Config ===
    const gsLat = groundStation?.lat ?? 31.062718;
    const gsLon = groundStation?.lon ?? 121.244818;
    const gsAlt = groundStation?.alt ?? 15;

    // === Time Config ===
    const [durationMin, setDurationMin] = useState(30);
    const [stepSec, setStepSec] = useState(10);

    // === Link Params: 从 globalParams 读取，移除本地独立输入框 ===
    const freq = globalParams?.freq ?? 12.0;
    const eirp = globalParams?.eirp ?? 60.0;
    const gRx = globalParams?.gRx ?? 42.0;
    const tRx = globalParams?.tRx ?? 150.0;
    const bandwidth = globalParams?.bandwidth ?? 400.0;
    const tec = globalParams?.tec ?? 50.0;
    const rainRate = globalParams?.rainRate ?? 5.0;
    const env = globalParams?.env ?? 'suburban';
    const [disableFastFading, setDisableFastFading] = useState(true);

    // === Calibration State ===
    const [calibProfile, setCalibProfile] = useState(() => {
        try {
            const stored = loadCalibrationProfile();
            return stored
                ? { ...stored, residualRMS: stored.residualRms, timestamp: stored.createdAt }
                : createDefaultCalibration();
        } catch {
            return createDefaultCalibration();
        }
    });
    const [useCalibration, setUseCalibration] = useState(false);
    const [calibMeasurements, setCalibMeasurements] = useState([]);
    const [calibSatId, setCalibSatId] = useState('');
    const [calibBandKey, setCalibBandKey] = useState('');
    const [calibStatus, setCalibStatus] = useState('');
    const [showCalibPanel, setShowCalibPanel] = useState(false);
    const [calibMetadata, setCalibMetadata] = useState(null);

    useEffect(() => {
        if (!calibProfile.calibrated) return;
        try {
            saveCalibrationProfile(calibProfile);
        } catch (error) {
            console.warn('Calibration profile persistence failed:', error);
        }
    }, [calibProfile]);

    // === Output State ===
    const [generatedTimeline, setGeneratedTimeline] = useState([]);
    const [statisticalPlaybackReport, setStatisticalPlaybackReport] = useState(null);
    const [mpdbScenario, setMpdbScenario] = useState(null);
    const [comparisonReport, setComparisonReport] = useState(null);
    const [showMpdbTools, setShowMpdbTools] = useState(false);
    const timeline = generatedTimeline;
    const comparisonLinkBudgetParameters = useMemo(() => {
        const parameters = {
            eirp, gRx, tRx, rainRate, disableFastFading,
            isPhasedArray: Boolean(globalParams?.isPhasedArray),
            hpbw: globalParams?.hpbw ?? 2,
            xpdAnt: globalParams?.xpdAnt ?? 35,
            columnarLWC_kgm2: globalParams?.columnarLWC_kgm2 ?? 0.5,
        };
        return useCalibration && calibProfile.calibrated
            ? applyCalibration(parameters, calibProfile)
            : parameters;
    }, [calibProfile, disableFastFading, eirp, gRx, globalParams, rainRate, tRx, useCalibration]);
    const comparisonRequest = useMemo(() => deriveComparisonRequest({
        scenarioId: mpdbScenario?.scenarioId,
        environment: env,
        tec_TECU: tec,
        useCalibration,
        calibrationProfile: calibProfile,
        linkBudgetParameters: comparisonLinkBudgetParameters,
    }), [calibProfile, comparisonLinkBudgetParameters, env, mpdbScenario?.scenarioId, tec, useCalibration]);
    const comparisonStatisticalParameters = comparisonRequest.statisticalParameters;
    const standaloneStatisticalParameters = useMemo(() => ({
        environment: env === 'open' ? 'rural' : env,
        tec_TECU: tec,
        scatterPowerOffset_dB: useCalibration
            && calibProfile.calibrated
            && Number.isFinite(calibProfile.params?.scatterPowerOffset_dB)
            ? calibProfile.params.scatterPowerOffset_dB
            : 0,
    }), [calibProfile, env, tec, useCalibration]);
    const comparisonRequestKey = comparisonRequest.requestKey;
    const activeComparisonReport = currentComparisonReport(
        comparisonReport,
        mpdbScenario?.scenarioId,
        comparisonRequestKey,
    );
    const comparisonPreviewReport = comparisonReport?.scenarioId === mpdbScenario?.scenarioId
        ? comparisonReport
        : null;
    const displayedComparisonReport = activeComparisonReport ?? comparisonPreviewReport;
    const displayedPlaybackReport = displayedComparisonReport ?? statisticalPlaybackReport;
    const isComparisonRefreshing = Boolean(
        comparisonPreviewReport
        && !activeComparisonReport
        && comparisonRequestKey
        && !comparisonRequest.error,
    );
    
    const [generatedTrajectorySamples, setGeneratedTrajectorySamples] = useState([]);
    const [computing, setComputing] = useState(false);
    const [cirIdx, setCirIdx] = useState(0);
    const [statusMsg, setStatusMsg] = useState('');
    const handleComparisonReportChange = useCallback((nextReport) => {
        setComparisonReport(nextReport);
        if (nextReport) {
            setGeneratedTrajectorySamples(buildMpdbTrajectorySamples(mpdbScenario, nextReport));
        }
    }, [mpdbScenario]);
    const handlePlaybackPositionChange = useCallback(({ position }) => {
        setCirIdx(position);
    }, []);

    // === Pass Search State ===
    const [selectedPassKey, setSelectedPassKey] = useState(null);
    const [passSearchRevision, setPassSearchRevision] = useState(0);
    const passes = useMemo(() => {
        void passSearchRevision;
        if (!tleLine1 || !tleLine2) return [];
        try {
            return predictPasses(tleLine1, tleLine2, gsLat, gsLon, gsAlt, 24, 0);
        } catch {
            return [];
        }
    }, [gsAlt, gsLat, gsLon, passSearchRevision, tleLine1, tleLine2]);
    const passKey = useCallback((pass) => JSON.stringify([
        tleLine1, tleLine2, gsLat, gsLon, gsAlt,
        pass.aos.toISOString(), pass.los.toISOString(),
    ]), [gsAlt, gsLat, gsLon, tleLine1, tleLine2]);
    const selectedPass = useMemo(() => (
        passes.find((pass) => passKey(pass) === selectedPassKey) ?? null
    ), [passKey, passes, selectedPassKey]);

    // === Find Next Pass ===
    function handleFindPass() {
        if (!tleLine1 || !tleLine2) {
            setStatusMsg('\u26a0\ufe0f Please load satellite TLE first');
            return;
        }
        setSelectedPassKey(null);
        setPassSearchRevision((revision) => revision + 1);
        setStatusMsg(passes.length > 0
            ? `\u2705 Found ${passes.length} passes. 请选择一个过顶窗口。`
            : '\u26a0\ufe0f No visible passes in next 24h. Try another satellite.');
    }

    // === Generate Timeline ===
    const handleGenerate = useCallback((overridePass) => {
        if (!tleLine1 || !tleLine2) {
            setStatusMsg('\u26a0\ufe0f Please load satellite TLE first');
            return;
        }
        const targetPass = overridePass?.aos instanceof Date ? overridePass : selectedPass;
        if (!targetPass) {
            setStatusMsg('\u26a0\ufe0f 请先选择一个过顶窗口。');
            return;
        }
        setComputing(true);
        setStatusMsg('\u23f3 正在生成已选窗口的统计 PDP 时间序列...');

        setTimeout(() => {
            try {
                let linkParams = { freq, eirp, gRx, tRx, bandwidth, tec, env, rainRate, disableFastFading };
                if (useCalibration && calibProfile.calibrated) {
                    linkParams = applyCalibration(linkParams, calibProfile);
                }
                const result = generateChannelTimeSeries(
                    tleLine1, tleLine2,
                    gsLat, gsLon, gsAlt,
                    targetPass.aos, targetPass.los, stepSec,
                    linkParams
                );
                const windowId = JSON.stringify([
                    'selected-pass/v1', tleLine1, tleLine2,
                    gsLat, gsLon, gsAlt,
                    targetPass.aos.toISOString(), targetPass.los.toISOString(), stepSec,
                ]);
                const nextPlaybackReport = buildStatisticalPlaybackReport({
                    timeline: result,
                    windowId,
                    satelliteName: satName,
                    receiver: {
                        latitude_deg: gsLat,
                        longitude_deg: gsLon,
                        altitude_m: gsAlt,
                    },
                    carrier: {
                        frequency_Hz: freq * 1e9,
                        bandwidth_Hz: bandwidth * 1e6,
                    },
                    statisticalParameters: standaloneStatisticalParameters,
                });
                const trajectorySamples = result.map((frame, index) => ({
                    index,
                    lat: Number.isFinite(frame.satLat) ? frame.satLat : 0,
                    lon: Number.isFinite(frame.satLon) ? frame.satLon : 0,
                    alt: Number.isFinite(frame.satAlt) ? frame.satAlt : 0,
                    azimuth: Number.isFinite(frame.azimuth) ? frame.azimuth : 0,
                    elevation: Number.isFinite(frame.elevation) ? frame.elevation : 0,
                    slantRange: Number.isFinite(frame.slantRange) ? frame.slantRange : 0,
                    time: frame.time instanceof Date ? frame.time.toISOString() : frame.time,
                    timeLabel: frame.timeLabel || `Frame ${index + 1}`,
                }));
                setGeneratedTimeline(result);
                setStatisticalPlaybackReport(nextPlaybackReport);
                setGeneratedTrajectorySamples(trajectorySamples);
                const visibleFrames = result.filter(f => f.elevation > 0);
                const maxElFrame = visibleFrames.reduce((a, b) => a.elevation > b.elevation ? a : b);
                setStatusMsg('\u2705 统计 PDP· ' + result.length + ' frames | Max Elev: ' + maxElFrame.elevation.toFixed(1) + '\u00b0 @ ' + maxElFrame.timeLabel);

                try {
                    const validator = new SimulationValidator({
                        frequency: freq * 1e9,
                        distance: maxElFrame.slantRange,
                        eirp_dBW: eirp,
                        rxGain_dBi: gRx,
                        rxPower_dBm: maxElFrame.rxPowerDbm,
                        snrTimeSeries: visibleFrames.map(f => f.snrDb)
                    });
                    validator.runAll();
                } catch(e) {
                    console.error("Simulation Validation Error:", e);
                }
            } catch (error) {
                setStatusMsg(`\u26a0\ufe0f 统计 PDP 生成失败：${error.message}`);
            } finally {
                setComputing(false);
            }
        }, 50);
    }, [
        bandwidth, calibProfile, disableFastFading, eirp, env, freq, gRx,
        gsAlt, gsLat, gsLon, rainRate, satName, selectedPass, standaloneStatisticalParameters,
        stepSec, tRx, tec, tleLine1, tleLine2, useCalibration,
    ]);

    useEffect(() => {
        if (!selectedPass) return;
        handleGenerate(selectedPass);
    }, [handleGenerate, selectedPass]);

    function safeNum(x, fallback = 0) {
        if (typeof x === 'number' && Number.isFinite(x)) return x;
        if (typeof x === 'bigint') return Number(x);
        return fallback;
    }

    function updateGroundStation(nextGroundStation) {
        onGroundStationChange?.(nextGroundStation);
    }

    function updateGsLat(value) {
        const next = { lat: Number.isFinite(value) ? value : gsLat, lon: gsLon, alt: gsAlt };
        updateGroundStation(next);
    }

    function updateGsLon(value) {
        const next = { lat: gsLat, lon: Number.isFinite(value) ? value : gsLon, alt: gsAlt };
        updateGroundStation(next);
    }

    function updateGsAlt(value) {
        const next = { lat: gsLat, lon: gsLon, alt: Number.isFinite(value) ? value : gsAlt };
        updateGroundStation(next);
    }

    const handleMpdbScenarioChange = useCallback((scenario) => {
        setMpdbScenario(scenario);
        setComparisonReport(null);
        setCirIdx(0);
        if (scenario) {
            setGeneratedTrajectorySamples(buildMpdbTrajectorySamples(scenario));
        }
    }, []);

    const prevRequestedIdxRef = useRef(requestedCirIndex);
    useEffect(() => {
        if (!Number.isInteger(requestedCirIndex)) return;
        if (requestedCirIndex < 0 || requestedCirIndex >= timeline.length) return;
        if (prevRequestedIdxRef.current !== requestedCirIndex) {
            prevRequestedIdxRef.current = requestedCirIndex;
            const timer = setTimeout(() => {
                setCirIdx(requestedCirIndex);
            }, 0);
            return () => clearTimeout(timer);
        }
        return undefined;
    }, [requestedCirIndex, timeline.length]);

    useEffect(() => {
        const playbackFrameCount = displayedPlaybackReport?.frames?.length ?? 0;
        onCirSyncStateChange?.({
            isStandaloneMode: false,
            activeIndex: playbackFrameCount > 0
                ? Math.min(cirIdx, playbackFrameCount - 1)
                : 0,
            samplePoints: generatedTrajectorySamples,
            handshake: null,
            importInfo: mpdbScenario ? {
                format: mpdbScenario.source.format,
                scenarioId: mpdbScenario.scenarioId,
                receiverGeometryMode: 'mpdb-track'
            } : null,
            tleLine1,
            tleLine2,
            groundStation: { lat: gsLat, lon: gsLon, alt: gsAlt }
        });
    }, [
        cirIdx,
        displayedPlaybackReport,
        generatedTrajectorySamples,
        mpdbScenario,
        tleLine1,
        tleLine2,
        gsLat,
        gsLon,
        gsAlt,
        onCirSyncStateChange
    ]);

    // === CSV Export ===
    function exportCSV() {
        if (timeline.length === 0) return;
        // 找出所有帧中最大 tap 数量
        const maxTaps = Math.max(...timeline.map(f => f.cir.taps.length));
        // 基础列头
        let headers = 'Time,Elevation_deg,Azimuth_deg,SlantRange_km,AbsFSPL_dB,RxPower_dBm,NoiseFloor_dBm,SNR_dB,Doppler_Hz,AttRain_dB,AttGas_dB,AttCloud_dB,AtmTotal_dB,FadeLMS_dB,Faraday_dB,Pointing_dB,Scint_dB,TSky_K,XPD_dB,CapRank1_bpsHz,CapRank2_bpsHz,GroupDelay_ns,Dispersion_ns,CIR_NumTaps,CIR_RMSDelaySpread_ns,CIR_CoherenceBW_MHz';
        // 为每个 tap 添加详细列头
        for (let i = 0; i < maxTaps; i++) {
            headers += `,Tap${i}_Label,Tap${i}_ExcessDelay_ns,Tap${i}_Amplitude_dB,Tap${i}_Phase_rad`;
        }
        const rows = timeline.map(f => {
            const base = [
                f.timeLabel,
                safeNum(f.elevation).toFixed(2),
                safeNum(f.azimuth).toFixed(1),
                safeNum(f.slantRange).toFixed(1),
                safeNum(f.absoluteFspl).toFixed(2),
                safeNum(f.rxPowerDbm).toFixed(2),
                safeNum(f.noiseFloorDbm).toFixed(2),
                safeNum(f.snrDb).toFixed(2),
                safeNum(f.dopplerHz ?? 0).toFixed(1),
                safeNum(f.attRain).toFixed(3),
                safeNum(f.attGas).toFixed(3),
                safeNum(f.attCloud).toFixed(3),
                safeNum(f.totalAtmosphericLoss).toFixed(3),
                safeNum(f.fadeLMS).toFixed(2),
                safeNum(f.lossFaraday).toFixed(3),
                safeNum(f.pointingLoss).toFixed(3),
                safeNum(f.scintLoss).toFixed(3),
                safeNum(f.tSky).toFixed(1),
                safeNum(f.xpd).toFixed(2),
                safeNum(f.capRank1).toFixed(3),
                safeNum(f.capRank2).toFixed(3),
                safeNum(f.groupDelayNs).toFixed(3),
                safeNum(f.dispersionNs).toFixed(3),
                f.cir.taps.length,
                safeNum(f.cir.rmsDelaySpread_ns).toFixed(3),
                safeNum(f.cir.coherenceBandwidth_MHz).toFixed(3)
            ];
            // 逐 tap 输出详细数据
            for (let i = 0; i < maxTaps; i++) {
                const tap = f.cir.taps[i];
                if (tap) {
                    base.push(tap.label, safeNum(tap.excessDelay_ns).toFixed(3), safeNum(tap.amplitude_dB).toFixed(3), safeNum(tap.phase_rad).toFixed(4));
                } else {
                    base.push('', '', '', '');
                }
            }
            return base.join(',');
        });
        const csv = headers + '\n' + rows.join('\n');
        downloadFile(csv, 'channel_sim_' + (satName || 'sat') + '_' + new Date().toISOString().slice(0, 16) + '.csv', 'text/csv');
    }

    // === JSON Export ===
    function exportJSON() {
        if (timeline.length === 0) return;
        const json = JSON.stringify({
            metadata: {
                satellite: satName || 'Unknown',
                groundStation: { lat: gsLat, lon: gsLon, alt: gsAlt },
                linkConfig: { freq, eirp, gRx, tRx, bandwidth, tec, env, rainRate },
                generatedAt: new Date().toISOString(),
                totalFrames: timeline.length,
                stepSec
            },
            frames: timeline.map(f => ({
                time: f.time ? f.time.toISOString() : f.timeLabel,
                geometry: { elevation: safeNum(f.elevation), azimuth: safeNum(f.azimuth), slantRange: safeNum(f.slantRange), apparentElevation: safeNum(f.apparentElevation) },
                linkBudget: { absoluteFspl: safeNum(f.absoluteFspl), rxPowerDbm: safeNum(f.rxPowerDbm), noiseFloorDbm: safeNum(f.noiseFloorDbm), snrDb: safeNum(f.snrDb) },
                attenuation: { rain: safeNum(f.attRain), gas: safeNum(f.attGas), cloud: safeNum(f.attCloud), atmospheric: safeNum(f.totalAtmosphericLoss), fadeLMS: safeNum(f.fadeLMS), faraday: safeNum(f.lossFaraday), pointing: safeNum(f.pointingLoss), scintillation: safeNum(f.scintLoss) },
                noise: { tSky: safeNum(f.tSky) },
                polarization: { xpd: safeNum(f.xpd) },
                mimo: { capRank1: safeNum(f.capRank1), capRank2: safeNum(f.capRank2) },
                ionosphere: { groupDelayNs: safeNum(f.groupDelayNs), dispersionNs: safeNum(f.dispersionNs) },
                cir: f.cir
            }))
        }, null, 2);
        downloadFile(json, 'channel_sim_' + (satName || 'sat') + '_' + new Date().toISOString().slice(0, 16) + '.json', 'application/json');
    }

    function downloadFile(content, filename, type) {
        const blob = new Blob([content], { type });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = filename;
        a.click();
        URL.revokeObjectURL(url);
    }

    // === Chart Data ===
    const hasChannelOutput = Boolean(displayedPlaybackReport);
    const showAnalyticsPanels = timeline.length > 0 && !displayedComparisonReport;
    const chartLabels = useMemo(() => timeline.map(f => f.timeLabel), [timeline]);

    const rxSnrChartData = useMemo(() => ({
        labels: chartLabels,
        datasets: [
            {
                label: 'Rx Power (dBm)',
                data: timeline.map(f => f.elevation > 0 ? f.rxPowerDbm : null),
                borderColor: '#ff3333',
                backgroundColor: 'rgba(255, 51, 51, 0.1)',
                yAxisID: 'y1',
                tension: 0.3,
                pointRadius: 0,
                fill: true,
                spanGaps: false
            },
            {
                label: 'SNR (dB)',
                data: timeline.map(f => f.elevation > 0 ? f.snrDb : null),
                borderColor: '#00e5ff',
                backgroundColor: 'rgba(0, 229, 255, 0.1)',
                yAxisID: 'y1',
                tension: 0.3,
                pointRadius: 0,
                spanGaps: false
            },
            {
                label: 'Elevation (\u00b0)',
                data: timeline.map(f => f.elevation),
                borderColor: '#00ff66',
                backgroundColor: 'rgba(0, 255, 102, 0.05)',
                yAxisID: 'y2',
                tension: 0.3,
                pointRadius: 0,
                borderDash: [4, 2],
                fill: true
            }
        ]
    }), [timeline, chartLabels]);

    const rxSnrChartOpts = {
        responsive: true,
        interaction: { mode: 'index', intersect: false },
        plugins: {
            legend: { position: 'top', labels: { color: '#ccc', font: { size: 11 } } },
            title: { display: true, text: 'Channel Propagation \u2014 Rx Power / SNR / Elevation vs Time', color: '#fff', font: { size: 13 } }
        },
        scales: {
            x: { display: true, ticks: { maxTicksLimit: 12, color: '#aaa' }, grid: { color: 'rgba(255,255,255,0.05)' } },
            y1: { type: 'linear', position: 'left', title: { display: true, text: 'dBm / dB', color: '#ccc' }, grid: { color: 'rgba(255,255,255,0.08)' }, ticks: { color: '#aaa' } },
            y2: { type: 'linear', position: 'right', title: { display: true, text: 'Elevation (\u00b0)', color: '#ccc' }, grid: { drawOnChartArea: false }, ticks: { color: '#aaa' } }
        }
    };

    const currentFrame = timeline[cirIdx];
    const attBreakdownData = currentFrame ? {
        labels: ['FSPL', 'Rain', 'Gas', 'Cloud', 'Shadow', 'Faraday', 'Pointing', 'Scint'],
        datasets: [{
            label: 'Loss (dB)',
            data: [
                currentFrame.absoluteFspl,
                currentFrame.attRain,
                currentFrame.attGas,
                currentFrame.attCloud,
                currentFrame.fadeLMS,
                currentFrame.lossFaraday,
                currentFrame.pointingLoss,
                Math.abs(currentFrame.scintLoss)
            ],
            backgroundColor: [
                '#ff6b6b', '#f39c12', '#e74c3c', '#9b59b6',
                '#3498db', '#1abc9c', '#e67e22', '#2ecc71'
            ]
        }]
    } : null;

    // === Styles ===
    const panelStyle = {
        padding: '20px',
        border: '2px solid #4ecdc4',
        borderRadius: '8px',
        marginBottom: '20px',
        background: 'linear-gradient(135deg, #0a0a2e 0%, #1a1a3e 100%)',
        color: '#eee',
        textAlign: 'left'
    };

    const inputGroupStyle = {
        display: 'flex',
        gap: '10px',
        alignItems: 'center',
        flexWrap: 'wrap',
        marginBottom: '8px'
    };

    const inputStyle = { width: '75px', fontFamily: 'monospace', padding: '3px 6px', borderRadius: '3px', border: '1px solid #555', background: '#1a1a2e', color: '#eee' };
    const selectStyle = { ...inputStyle, width: 'auto', minWidth: '100px' };
    const labelStyle = { fontSize: '0.85em', whiteSpace: 'nowrap' };

    const btnPrimary = {
        padding: '8px 20px',
        background: 'linear-gradient(135deg, #4ecdc4, #44a08d)',
        color: '#fff',
        border: 'none',
        borderRadius: '6px',
        fontWeight: 'bold',
        cursor: computing ? 'wait' : 'pointer',
        fontSize: '0.95em',
        boxShadow: '0 2px 8px rgba(78, 205, 196, 0.3)'
    };

    const btnExport = {
        padding: '5px 14px',
        background: '#2c3e50',
        color: '#eee',
        border: '1px solid #4ecdc4',
        borderRadius: '4px',
        fontWeight: 'bold',
        cursor: 'pointer',
        fontSize: '0.85em'
    };

    return (
        <div style={panelStyle}>
            <h3 style={{ margin: '0 0 15px 0', fontSize: '1.2em' }}>
                {'\ud83d\udce1'} Channel Propagation Simulator <span style={{ fontSize: '0.7em', color: '#4ecdc4', fontWeight: 'normal' }}>with CIR</span>
                {useCalibration && calibProfile.calibrated && (
                    <span style={{ fontSize: '0.6em', color: '#00ff88', fontWeight: 'normal', marginLeft: '10px', padding: '2px 8px', background: 'rgba(0,255,136,0.1)', borderRadius: '3px', border: '1px solid rgba(0,255,136,0.3)' }}>
                        {'\u2705'} 已校准
                    </span>
                )}
            </h3>

            {/* === Input Config === */}
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '15px', marginBottom: '15px' }}>
                <div>
                    <div style={{ ...inputGroupStyle, padding: '8px', background: 'rgba(78,205,196,0.1)', borderRadius: '5px', border: '1px solid rgba(78,205,196,0.3)' }}>
                        <strong style={{ fontSize: '0.9em' }}>{'\ud83d\udccd'} Ground Station</strong>
                        <label style={labelStyle}>Lat:
                            <input type="number" step="0.01" value={gsLat} onChange={e => updateGsLat(parseFloat(e.target.value))} style={inputStyle} />
                        </label>
                        <label style={labelStyle}>Lon:
                            <input type="number" step="0.01" value={gsLon} onChange={e => updateGsLon(parseFloat(e.target.value))} style={inputStyle} />
                        </label>
                        <label style={labelStyle}>Alt(m):
                            <input type="number" step="1" value={gsAlt} onChange={e => updateGsAlt(parseFloat(e.target.value) || 0)} style={{ ...inputStyle, width: '60px' }} />
                        </label>
                    </div>
                    <div style={{ ...inputGroupStyle, marginTop: '8px' }}>
                        <strong style={{ fontSize: '0.9em' }}>{'\u23f1\ufe0f'} Time</strong>
                        <label style={labelStyle}>Duration(min):
                            <input type="number" min="5" max="180" value={durationMin} onChange={e => setDurationMin(parseInt(e.target.value) || 30)} style={{ ...inputStyle, width: '55px' }} />
                        </label>
                        <label style={labelStyle}>Step(s):
                            <input type="number" min="1" max="60" value={stepSec} onChange={e => setStepSec(parseInt(e.target.value) || 10)} style={{ ...inputStyle, width: '55px' }} />
                        </label>
                    </div>
                </div>

                <div>
                    <div style={inputGroupStyle}>
                        <strong style={{ fontSize: '0.9em' }} title="Based on 3GPP TR 38.811 & ITU-R Models">{'\u2699\ufe0f'} Channel Engine <span style={{ fontSize: '0.8em', color: '#888', fontWeight: 'normal' }}>(3GPP TR 38.811 / ITU-R)</span></strong>
                        <label style={labelStyle}>Env:
                            <select value={env} onChange={e => onLinkParamsChange?.({ env: e.target.value })} style={selectStyle}>
                                <option value="open">open (rural)</option>
                                <option value="suburban">suburban</option>
                                <option value="urban">urban</option>
                                <option value="rural">rural</option>
                                <option value="maritime">maritime</option>
                            </select>
                        </label>
                        <label style={{ ...labelStyle, display: 'flex', alignItems: 'center', gap: '4px', cursor: 'pointer' }}>
                            <input type="checkbox" checked={disableFastFading} onChange={e => setDisableFastFading(e.target.checked)} />
                            <span>Smooth (no fast fading)</span>
                        </label>
                        <span style={{ fontSize: '0.75em', color: '#888' }}>
                            ℹ️ Freq={freq}GHz, EIRP={eirp}dBW, Rx={gRx}dBi, Rain={rainRate}mm/h, TEC={tec} — 在“📡 Link Parameters”卡片修改
                        </span>
                    </div>
                </div>
            </div>

            {/* === Action Buttons === */}
            <div style={{ display: 'flex', gap: '10px', alignItems: 'center', marginBottom: '10px', flexWrap: 'wrap' }}>
                <button onClick={handleFindPass} style={{ ...btnPrimary, background: 'linear-gradient(135deg, #f39c12, #e67e22)' }}>
                    {'\ud83d\udd0d Refresh Passes'}
                </button>
                <button onClick={handleGenerate} disabled={computing || !selectedPass} style={btnPrimary}>
                    {computing ? '\u23f3 Computing...' : '\ud83d\ude80 Recompute Selected Window'}
                </button>
                {timeline.length > 0 && (
                    <>
                        <button onClick={exportCSV} style={btnExport}>{'\ud83d\udce5'} CSV</button>
                        <button onClick={exportJSON} style={btnExport}>{'\ud83d\udce5'} JSON</button>
                    </>
                )}
            </div>

            {/* === Calibration Panel === */}
            <div style={{ marginBottom: '10px' }}>
                <div style={{ display: 'flex', gap: '10px', alignItems: 'center', flexWrap: 'wrap' }}>
                    <button
                        onClick={() => setShowCalibPanel(!showCalibPanel)}
                        style={{ ...btnExport, background: showCalibPanel ? '#2c3e50' : 'rgba(78,205,196,0.15)', border: '1px solid #4ecdc4', color: '#4ecdc4' }}
                    >
                        {'\ud83d\udee0\ufe0f'} {showCalibPanel ? '收起校准面板' : '展开校准面板'}
                    </button>
                    {calibProfile.calibrated && (
                        <label style={{
                            display: 'flex', alignItems: 'center', gap: '6px', cursor: 'pointer', padding: '5px 12px', borderRadius: '5px',
                            background: useCalibration ? 'rgba(0,255,136,0.15)' : 'rgba(255,100,100,0.1)',
                            border: useCalibration ? '1px solid #00ff88' : '1px solid rgba(255,100,100,0.3)',
                            transition: 'all 0.3s'
                        }}>
                            <input type="checkbox" checked={useCalibration} onChange={e => setUseCalibration(e.target.checked)}
                                style={{ width: '16px', height: '16px', accentColor: '#00ff88' }} />
                            <span style={{ fontSize: '0.85em', fontWeight: 'bold', color: useCalibration ? '#00ff88' : '#ff6b6b' }}>
                                {useCalibration ? '\u2705 已启用校准修正' : '\u274c 未启用校准'}
                            </span>
                        </label>
                    )}
                </div>

                {showCalibPanel && (
                    <div style={{ marginTop: '10px', padding: '12px', background: 'rgba(78,205,196,0.08)', borderRadius: '8px', border: '1px solid rgba(78,205,196,0.25)' }}>
                        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '12px' }}>
                            {/* 左列：数据导入 */}
                            <div>
                                <strong style={{ fontSize: '0.85em', color: '#4ecdc4' }}>{'\ud83d\udcc2'} 测量数据导入</strong>
                                <div style={{ marginTop: '6px' }}>
                                    <input
                                        type="file"
                                        accept=".json"
                                        onChange={e => {
                                            const file = e.target.files[0];
                                            if (!file) return;
                                            const reader = new FileReader();
                                            reader.onload = ev => {
                                                try {
                                                    const json = JSON.parse(ev.target.result);
                                                    const parsed = parseCalibrationDataset(json);
                                                    const data = parsed.measurements;
                                                    setCalibMeasurements(data);
                                                    setCalibMetadata(parsed.metadata);

                                                    const statusParts = [`✅ 已加载 ${data.length} 个测量数据点`];
                                                    statusParts.push(...parsed.diagnostics.map(diagnostic => `⚠️ ${diagnostic.message}`));

                                                    const meta = parsed.metadata;
                                                    if (meta) {
                                                        // 卫星参数
                                                        if (meta.satellite) {
                                                            if (typeof meta.satellite === 'string') {
                                                                // 已知卫星 ID
                                                                const satList = getSatelliteList();
                                                                const found = satList.find(s => s.id === meta.satellite);
                                                                if (found) {
                                                                    setCalibSatId(meta.satellite);
                                                                    if (meta.band) {
                                                                        setCalibBandKey(meta.band);
                                                                        const bp = getSatelliteBandParams(meta.satellite, meta.band);
                                                                        if (bp) {
                                                                            onLinkParamsChange?.({ freq: bp.freq, eirp: bp.eirp });
                                                                            statusParts.push(`🛰️ ${found.name} / ${meta.band}频段`);
                                                                        }
                                                                    } else {
                                                                        statusParts.push(`🛰️ ${found.name}（请选择频段）`);
                                                                    }
                                                                } else {
                                                                    statusParts.push(`⚠️ 未知卫星ID "${meta.satellite}"，使用当前参数`);
                                                                }
                                                            } else if (typeof meta.satellite === 'object') {
                                                                // 自定义卫星：{ name, freq, eirp, polarization, bandwidth, ... }
                                                                const sat = meta.satellite;
                                                                setCalibSatId('');
                                                                const satFrequency = sat.frequency_GHz ?? sat.freq;
                                                                const satEirp = sat.eirp_dBW ?? sat.eirp;
                                                                const satBandwidth = sat.bandwidth_Hz != null ? sat.bandwidth_Hz / 1e6 : sat.bandwidth;
                                                                const nextParams = {};
                                                                if (satFrequency != null) nextParams.freq = satFrequency;
                                                                if (satEirp != null) nextParams.eirp = satEirp;
                                                                if (satBandwidth != null) nextParams.bandwidth = satBandwidth;
                                                                if (Object.keys(nextParams).length > 0) onLinkParamsChange?.(nextParams);
                                                                // 必填字段校验
                                                                const missing = [];
                                                                if (satFrequency == null) missing.push('frequency_GHz(频率)');
                                                                if (satEirp == null) missing.push('eirp_dBW(发射功率)');
                                                                if (!sat.polarization) missing.push('polarization(极化)');
                                                                if (satBandwidth == null) missing.push('bandwidth_Hz(带宽)');
                                                                if (missing.length > 0) {
                                                                    statusParts.push(`⛔ 自定义卫星缺少必填字段: ${missing.join(', ')} — 无法校准!`);
                                                                } else {
                                                                    statusParts.push(`🛰️ 自定义卫星 "${sat.name || '未命名'}" (${satFrequency}GHz, ${satEirp}dBW, ${sat.polarization}, BW=${satBandwidth}MHz)`);
                                                                }
                                                            }
                                                        }
                                                        // 地面站只做来源一致性检查，不隐式覆盖当前仿真位置
                                                        if (meta.groundStation) {
                                                            const gs = meta.groundStation;
                                                            if (gs.lat != null && gs.lon != null) {
                                                                const distanceKm = groundStationDistanceKm(gs, { lat: gsLat, lon: gsLon, alt: gsAlt });
                                                                statusParts.push(`📍 校准站 (${gs.lat}, ${gs.lon})，距当前站 ${distanceKm.toFixed(2)} km`);
                                                            } else {
                                                                statusParts.push('⚠️ 地面站缺少 lat/lon — 无法验证地理一致性');
                                                            }
                                                        } else {
                                                            statusParts.push('⚠️ 未提供地面站信息 — 无法验证地理一致性');
                                                        }
                                                        // 接收机参数
                                                        if (meta.receiver) {
                                                            const rx = meta.receiver;
                                                            const receiverParams = {};
                                                            if ((rx.rxGain_dBi ?? rx.gRx) != null) receiverParams.gRx = rx.rxGain_dBi ?? rx.gRx;
                                                            if ((rx.systemNoiseTemperature_K ?? rx.tRx) != null) receiverParams.tRx = rx.systemNoiseTemperature_K ?? rx.tRx;
                                                            if (rx.bandwidth_Hz != null || rx.bandwidth != null) {
                                                                receiverParams.bandwidth = rx.bandwidth_Hz != null ? rx.bandwidth_Hz / 1e6 : rx.bandwidth;
                                                            }
                                                            if (Object.keys(receiverParams).length > 0) onLinkParamsChange?.(receiverParams);
                                                        }

                                                        // 测量点数据质量校验
                                                        const noElevCount = data.filter(m => m.elevation_deg == null).length;
                                                        const noMetricCount = data.filter(m =>
                                                            m.cn0_dBHz == null && m.cn_dB == null && m.snr_dB == null &&
                                                            m.rssi_dBm == null && m.xpd_dB == null &&
                                                            m.attenuation_dB == null && m.scatterPower_dB == null
                                                        ).length;
                                                        if (noElevCount > 0) {
                                                            statusParts.push(`⚠️ ${noElevCount}个点缺少 elevation(仰角)，将使用默认值`);
                                                        }
                                                        if (noMetricCount > 0) {
                                                            statusParts.push(`⛔ ${noMetricCount}个点无任何测量指标，将被忽略`);
                                                        }
                                                        // 环境
                                                        if (meta.environment) onLinkParamsChange?.({ env: meta.environment });
                                                        if (meta.tec_TECU != null) onLinkParamsChange?.({ tec: meta.tec_TECU });
                                                        if (meta.description) statusParts.push(`📝 ${meta.description}`);
                                                    }

                                                    setCalibStatus(statusParts.join(' | '));
                                                } catch (err) {
                                                    setCalibStatus('❌ JSON 解析失败: ' + err.message);
                                                }
                                            };
                                            reader.readAsText(file);
                                        }}
                                        style={{ fontSize: '0.8em', maxWidth: '200px' }}
                                    />
                                    <div style={{ fontSize: '0.75em', color: '#888', marginTop: '4px' }}>
                                        支持纯数组或 {'{'} metadata, measurements {'}'} 格式
                                    </div>
                                </div>
                                {calibMeasurements.length > 0 && (
                                    <div style={{ fontSize: '0.8em', color: '#aaa', marginTop: '4px' }}>
                                        {'\ud83d\udcca'} {calibMeasurements.length} 点 |
                                        指标: {[
                                            calibMeasurements.some(m => m.cn0_dBHz != null) && 'C/N0 (dB-Hz)',
                                            calibMeasurements.some(m => m.cn_dB != null) && 'C/N (dB)',
                                            calibMeasurements.some(m => m.snr_dB != null) && 'SNR (dB)',
                                            calibMeasurements.some(m => m.rssi_dBm != null) && 'RSSI',
                                            calibMeasurements.some(m => m.xpd_dB != null) && 'XPD',
                                            calibMeasurements.some(m => m.attenuation_dB != null) && 'Atten',
                                            calibMeasurements.some(m => m.scatterPower_dB != null) && 'Scatter'
                                        ].filter(Boolean).join(', ') || '无'}
                                    </div>
                                )}
                            </div>

                            {/* 右列：已知卫星选择 */}
                            <div>
                                <strong style={{ fontSize: '0.85em', color: '#4ecdc4' }}>{'\ud83d\udef0\ufe0f'} 已知卫星参考</strong>
                                <div style={{ marginTop: '6px', display: 'flex', gap: '6px', flexWrap: 'wrap' }}>
                                    <select
                                        value={calibSatId}
                                        onChange={e => {
                                            setCalibSatId(e.target.value);
                                            setCalibBandKey('');
                                        }}
                                        style={{ fontSize: '0.8em', padding: '3px 6px', background: '#1a1a2e', color: '#eee', border: '1px solid #555', borderRadius: '3px' }}
                                    >
                                        <option value="">手动参数</option>
                                        {getSatelliteList().map(s => (
                                            <option key={s.id} value={s.id}>{s.name} ({s.type})</option>
                                        ))}
                                    </select>
                                    {calibSatId && (
                                        <select
                                            value={calibBandKey}
                                            onChange={e => {
                                                setCalibBandKey(e.target.value);
                                                const bp = getSatelliteBandParams(calibSatId, e.target.value);
                                                if (bp) {
                                                    onLinkParamsChange?.({ freq: bp.freq, eirp: bp.eirp, bandwidth: bp.bandwidth });
                                                    setCalibStatus(`\u2705 已应用 ${bp.satName} ${e.target.value} 频段: ${bp.freq}GHz, ${bp.eirp}dBW, ${bp.polarization}`);
                                                }
                                            }}
                                            style={{ fontSize: '0.8em', padding: '3px 6px', background: '#1a1a2e', color: '#eee', border: '1px solid #555', borderRadius: '3px' }}
                                        >
                                            <option value="">选择频段</option>
                                            {getSatelliteList().find(s => s.id === calibSatId)?.bands.map(b => (
                                                <option key={b} value={b}>{b}</option>
                                            ))}
                                        </select>
                                    )}
                                </div>
                            </div>
                        </div>

                        {/* 校准按钮 + 状态 */}
                        <div style={{ marginTop: '10px', display: 'flex', gap: '10px', alignItems: 'center', flexWrap: 'wrap' }}>
                            <button
                                onClick={() => {
                                    if (calibMeasurements.length === 0) {
                                        setCalibStatus('\u26a0\ufe0f 请先导入测量数据');
                                        return;
                                    }
                                    // 卫星参数完整性校验
                                    const meta = calibMetadata;
                                    const errors = [];
                                    const warnings = [];

                                    // 自定义卫星必填校验
                                    if (meta && typeof meta.satellite === 'object') {
                                        const sat = meta.satellite;
                                        if ((sat.frequency_GHz ?? sat.freq) == null) errors.push('frequency_GHz(频率)');
                                        if ((sat.eirp_dBW ?? sat.eirp) == null) errors.push('eirp_dBW(发射功率)');
                                        if (!sat.polarization) errors.push('polarization(极化)');
                                        if (sat.bandwidth_Hz == null && sat.bandwidth == null) errors.push('bandwidth_Hz(带宽)');
                                    }

                                    // 地面站校验
                                    if (!meta?.groundStation || meta.groundStation.lat == null || meta.groundStation.lon == null) {
                                        if (meta) {
                                            warnings.push('未提供地面站坐标，无法验证地理一致性');
                                        }
                                    }

                                    // 测量点校验
                                    const validPoints = calibMeasurements.filter(m =>
                                        m.cn0_dBHz != null || m.cn_dB != null || m.snr_dB != null ||
                                        m.rssi_dBm != null || m.xpd_dB != null ||
                                        m.attenuation_dB != null || m.scatterPower_dB != null
                                    );
                                    if (validPoints.length === 0) {
                                        errors.push('所有测量点均无有效指标(C/N0, RSSI, XPD, Atten)');
                                    }
                                    const noElevPts = validPoints.filter(m => m.elevation_deg == null).length;
                                    if (noElevPts === validPoints.length && validPoints.length > 0) {
                                        errors.push('所有点缺少 elevation_deg；校准不会假设默认仰角');
                                    }
                                    const noRangePts = validPoints.filter(m => m.slantRange_km == null).length;
                                    if (noRangePts > 0) errors.push(`${noRangePts} 个点缺少 slantRange_km；不会回退 GEO 距离`);

                                    // 无卫星参考校验
                                    if (!calibSatId && !meta?.satellite) {
                                        warnings.push('未指定参考卫星，使用面板当前 Freq/EIRP');
                                    }

                                    // 有致命错误则阻止
                                    if (errors.length > 0) {
                                        setCalibStatus(`⛔ 无法校准 — ${errors.join('; ')}`);
                                        return;
                                    }

                                    const warnText = warnings.length > 0 ? `⚠️ ${warnings.join('; ')} | ` : '';
                                    setCalibStatus(`${warnText}⏳ 正在校准...`);
                                    setTimeout(() => {
                                        try {
                                            const refSat = calibSatId && calibBandKey ? getSatelliteBandParams(calibSatId, calibBandKey) : null;
                                            const profile = calibrateModel(calibMeasurements, { freq, eirp, gRx, tRx, bandwidth, tec, env, rainRate }, refSat);
                                            setCalibProfile(profile);
                                            setUseCalibration(profile.calibrated);
                                            const estimated = getCalibParamDefs()
                                                .filter(definition => profile.parameterStatus[definition.key] === 'estimated')
                                                .map(definition => `${definition.label}: ${profile.params[definition.key].toFixed(3)}`);
                                            const frozenCount = Object.values(profile.parameterStatus).filter(status => status === 'frozen').length;
                                            setCalibStatus(profile.calibrated
                                                ? `✅ 校准完成，RMS=${profile.residualRms.toFixed(3)}；已估计 ${estimated.join(' | ')}；冻结 ${frozenCount} 项`
                                                : '⚠️ 数据不足以辨识任何参数，全部参数保持冻结');
                                        } catch (error) {
                                            setCalibStatus(`⛔ 校准失败 — ${error.message}`);
                                        }
                                    }, 50);
                                }}
                                disabled={calibMeasurements.length === 0}
                                style={{ ...btnPrimary, background: 'linear-gradient(135deg, #4ecdc4, #2ecc71)', fontSize: '0.85em' }}
                            >
                                {'\ud83c\udfaf'} 运行多参数校准
                            </button>
                            {calibProfile.calibrated && (
                                <button
                                    onClick={() => {
                                        setCalibProfile(createDefaultCalibration());
                                        setUseCalibration(false);
                                        setCalibStatus('已重置校准参数');
                                    }}
                                    style={{ ...btnExport, fontSize: '0.85em', color: '#ff6b6b', borderColor: '#ff6b6b' }}
                                >
                                    {'\ud83d\uddd1\ufe0f'} 重置校准
                                </button>
                            )}
                        </div>
                        {calibStatus && (
                            <div style={{ marginTop: '6px', fontSize: '0.8em', color: '#88ccff', fontFamily: 'monospace', wordBreak: 'break-all' }}>
                                {calibStatus}
                            </div>
                        )}

                        {/* 校准结果详情 */}
                        {calibProfile.calibrated && (() => {
                            // 计算校准地点与当前地面站的距离
                            const meta = calibMetadata;
                            const calibGs = meta?.groundStation;
                            let distKm = 0;
                            if (calibGs && calibGs.lat != null && calibGs.lon != null) {
                                const dLat = (calibGs.lat - gsLat) * 111.32;
                                const dLon = (calibGs.lon - gsLon) * 111.32 * Math.cos(gsLat * Math.PI / 180);
                                distKm = Math.sqrt(dLat * dLat + dLon * dLon);
                            }
                            const calibSatName = meta?.satellite
                                ? (typeof meta.satellite === 'string' ? meta.satellite : (meta.satellite.name || '自定义卫星'))
                                : null;

                            return (
                                <div style={{ marginTop: '8px', padding: '8px', background: 'rgba(0,255,136,0.05)', borderRadius: '5px', border: '1px solid rgba(0,255,136,0.2)' }}>
                                    {/* 来源信息 */}
                                    {meta && (
                                        <div style={{ fontSize: '0.8em', color: '#aaa', marginBottom: '6px', display: 'flex', gap: '10px', flexWrap: 'wrap', alignItems: 'center' }}>
                                            {calibSatName && (
                                                <span style={{ padding: '2px 6px', borderRadius: '3px', background: 'rgba(78,205,196,0.1)', border: '1px solid rgba(78,205,196,0.3)', color: '#4ecdc4' }}>
                                                    {'\ud83d\udef0\ufe0f'} {calibSatName}
                                                </span>
                                            )}
                                            {calibGs && (
                                                <span style={{ padding: '2px 6px', borderRadius: '3px', background: 'rgba(78,205,196,0.1)', border: '1px solid rgba(78,205,196,0.3)', color: '#4ecdc4' }}>
                                                    {'\ud83d\udccd'} ({calibGs.lat}, {calibGs.lon})
                                                </span>
                                            )}
                                            {meta.description && (
                                                <span style={{ color: '#888', fontStyle: 'italic' }}>{'\ud83d\udcdd'} {meta.description}</span>
                                            )}
                                        </div>
                                    )}

                                    {/* 经纬度不匹配警告 */}
                                    {calibGs && distKm > 50 && (
                                        <div style={{
                                            fontSize: '0.8em', padding: '6px 10px', borderRadius: '4px', marginBottom: '6px',
                                            background: distKm > 200 ? 'rgba(255,50,50,0.15)' : 'rgba(255,200,50,0.15)',
                                            border: distKm > 200 ? '1px solid rgba(255,50,50,0.4)' : '1px solid rgba(255,200,50,0.4)',
                                            color: distKm > 200 ? '#ff6b6b' : '#ffc832'
                                        }}>
                                            {distKm > 200 ? '\u26d4' : '\u26a0\ufe0f'}
                                            {' '}校准数据来自 ({calibGs.lat}, {calibGs.lon})，
                                            与当前地面站 ({gsLat}, {gsLon}) 相距
                                            <strong> {distKm.toFixed(0)} km</strong>
                                            {distKm > 200
                                                ? '   — 距离过远，校准结果可能无效（不同气候区/大气条件）'
                                                : '   — 请注意局部环境差异可能影响校准精度'}
                                        </div>
                                    )}

                                    <div style={{ fontSize: '0.8em', color: '#aaa', marginBottom: '4px' }}>
                                        {'\ud83d\udcc8'} 校准结果 | {calibProfile.dataPointCount} 个数据点 | RMS: {calibProfile.residualRMS.toFixed(3)}
                                        {calibProfile.refSatellite && ` | 参考: ${calibProfile.refSatellite}`}
                                    </div>
                                    <div style={{ display: 'flex', gap: '8px', flexWrap: 'wrap' }}>
                                        {getCalibParamDefs().map(d => {
                                            const val = calibProfile.params[d.key];
                                            const isDefault = Math.abs(val - d.defaultVal) < 0.001;
                                            return (
                                                <span key={d.key} style={{
                                                    fontSize: '0.75em', padding: '2px 6px', borderRadius: '3px', fontFamily: 'monospace',
                                                    background: isDefault ? 'rgba(255,255,255,0.05)' : 'rgba(78,205,196,0.15)',
                                                    color: isDefault ? '#777' : '#4ecdc4',
                                                    border: isDefault ? '1px solid #333' : '1px solid rgba(78,205,196,0.4)'
                                                }}>
                                                    {d.label}: {val.toFixed(3)}
                                                </span>
                                            );
                                        })}
                                    </div>
                                </div>
                            );
                        })()}
                    </div>
                )}
            </div>

            {/* Pass Selection */}
            {passes.length > 0 && (
                <div style={{ marginBottom: '10px', padding: '8px', background: 'rgba(243,156,18,0.1)', borderRadius: '5px', border: '1px solid rgba(243,156,18,0.3)' }}>
                    <strong style={{ fontSize: '0.85em' }}>{'\ud83d\udcc5'} Available Passes (click to select):</strong>
                    <div style={{ display: 'flex', gap: '6px', marginTop: '6px', flexWrap: 'wrap' }}>
                        {passes.map((p, i) => {
                            const isSelected = selectedPass === p;
                            const quality = p.maxElev >= 45 ? '\ud83d\udfe2' : p.maxElev >= 20 ? '\ud83d\udfe1' : '\ud83d\udfe0';
                            return (
                                <button
                                    key={i}
                                    onClick={() => {
                                        setSelectedPassKey(passKey(p));
                                        setDurationMin(Math.ceil(p.durationSec / 60));
                                        setStatusMsg('Selected pass #' + (i + 1) + ': ' + p.aos.toLocaleTimeString() + ' ~ ' + p.los.toLocaleTimeString() + ', max elev ' + p.maxElev.toFixed(1) + '\u00b0. Auto-generating statistical PDP...');
                                    }}
                                    style={{
                                        padding: '4px 10px', borderRadius: '4px', cursor: 'pointer', fontSize: '0.8em', fontFamily: 'monospace',
                                        background: isSelected ? '#f39c12' : '#2c3e50',
                                        color: isSelected ? '#000' : '#eee',
                                        border: isSelected ? '2px solid #fff' : '1px solid #555',
                                        fontWeight: isSelected ? 'bold' : 'normal'
                                    }}
                                >
                                    {quality} {p.aos.toLocaleTimeString().slice(0, 5)}~{p.los.toLocaleTimeString().slice(0, 5)} | Max {p.maxElev.toFixed(0)}{'\u00b0'}
                                </button>
                            );
                        })}
                    </div>
                </div>
            )}

            {/* Status Message */}
            {statusMsg && (
                <div style={{ fontSize: '0.85em', marginBottom: '10px', padding: '6px 10px', borderRadius: '4px', background: statusMsg.includes('\u26a0') ? 'rgba(255,107,107,0.15)' : 'rgba(78,205,196,0.15)', border: '1px solid ' + (statusMsg.includes('\u26a0') ? 'rgba(255,107,107,0.3)' : 'rgba(78,205,196,0.3)') }}>
                    {statusMsg}
                </div>
            )}

            <button
                type="button"
                onClick={() => setShowMpdbTools(visible => !visible)}
                style={{ ...btnExport, marginBottom: '12px', borderColor: '#ffd60a', color: '#ffd60a' }}
            >
                {showMpdbTools ? '收起 MPDB / RT 比较工具' : '加载 MPDB / RT 比较工具'}
            </button>
            {showMpdbTools && (
                <Suspense fallback={<div style={{ color: '#aaa', marginBottom: '12px' }}>正在按需加载 MPDB 解析器…</div>}>
                    <div data-mpdb-scenario-id={mpdbScenario?.scenarioId ?? ''}>
                        <MpdbImportPanel onScenarioChange={handleMpdbScenarioChange} />
                    </div>
                    {mpdbScenario && (
                        <ChannelComparisonPanel
                            key={comparisonRequestKey}
                            scenario={mpdbScenario}
                            requestKey={comparisonRequestKey}
                            statisticalParameters={comparisonStatisticalParameters}
                            linkBudgetParameters={comparisonRequest.linkBudgetParameters}
                            parameterError={comparisonRequest.error}
                            onReportChange={handleComparisonReportChange}
                            autoRun={Boolean(comparisonRequestKey && !activeComparisonReport)}
                            preservePreviousReport={Boolean(comparisonPreviewReport)}
                        />
                    )}
                </Suspense>
            )}

            {!hasChannelOutput && (
                <div style={{ fontSize: '0.85em', color: '#aaa', marginBottom: '15px' }}>
                    {passes.length > 0
                        ? '请选择一个过顶窗口，选中后将自动生成统计 PDP 时间序列。'
                        : '当前 24 小时内没有可用过顶窗口，也可导入 MPDB 时间窗口。'}
                </div>
            )}

            {/* === Output Area === */}
            {hasChannelOutput && (
                <>
                    {showAnalyticsPanels && (
                        <div style={{ background: 'rgba(0,0,0,0.3)', borderRadius: '6px', padding: '12px', marginBottom: '15px' }}>
                            <Line data={rxSnrChartData} options={rxSnrChartOpts} />
                        </div>
                    )}

                    {displayedPlaybackReport ? (
                        <PdpComparisonPlayer
                            key={displayedPlaybackReport.scenarioId}
                            report={displayedPlaybackReport}
                            rtAvailable={Boolean(displayedComparisonReport && activeComparisonReport)}
                            isRefreshing={isComparisonRefreshing}
                            onPositionChange={handlePlaybackPositionChange}
                        />
                    ) : null}

                    {showAnalyticsPanels && (
                        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '15px' }}>
                            {attBreakdownData && (
                                <div style={{ background: 'rgba(0,0,0,0.3)', borderRadius: '6px', padding: '12px' }}>
                                    <Bar data={attBreakdownData} options={{
                                        responsive: true,
                                        plugins: {
                                            legend: { display: false },
                                            title: { display: true, text: 'Loss Breakdown @ ' + (currentFrame?.timeLabel || ''), color: '#fff', font: { size: 12 } }
                                        },
                                        scales: {
                                            x: { ticks: { color: '#aaa', font: { size: 10 } }, grid: { color: 'rgba(255,255,255,0.05)' } },
                                            y: { title: { display: true, text: 'dB', color: '#ccc' }, ticks: { color: '#aaa' }, grid: { color: 'rgba(255,255,255,0.08)' } }
                                        }
                                    }} />
                                </div>
                            )}

                            {currentFrame && (
                                <div style={{ background: 'rgba(0,0,0,0.3)', borderRadius: '6px', padding: '12px', fontSize: '0.88em' }}>
                                    <h4 style={{ margin: '0 0 8px 0', color: currentFrame.elevation > 0 ? '#4ecdc4' : '#ff6b6b' }}>
                                        {currentFrame.elevation > 0 ? '\u2705' : '\u26a0\ufe0f'} Frame Details {currentFrame.elevation <= 0 ? '(Below Horizon)' : ''}
                                    </h4>
                                    <table style={{ width: '100%', borderCollapse: 'collapse' }}>
                                        <tbody>
                                            {[
                                                ['Elevation', currentFrame.elevation.toFixed(2) + '\u00b0', 'Azimuth', currentFrame.azimuth.toFixed(1) + '\u00b0'],
                                                ['Range', currentFrame.slantRange.toFixed(1) + ' km', 'FSPL', currentFrame.absoluteFspl.toFixed(2) + ' dB'],
                                                ['Rx Power', currentFrame.rxPowerDbm.toFixed(2) + ' dBm', 'SNR', currentFrame.snrDb.toFixed(2) + ' dB'],
                                                ['Noise Floor', currentFrame.noiseFloorDbm.toFixed(2) + ' dBm', 'T_sky', currentFrame.tSky.toFixed(1) + ' K'],
                                                ['XPD', currentFrame.xpd.toFixed(2) + ' dB', 'MIMO R2', currentFrame.capRank2.toFixed(2) + ' bps/Hz'],
                                                ['Group Delay', currentFrame.groupDelayNs.toFixed(2) + ' ns', 'Dispersion', currentFrame.dispersionNs.toFixed(3) + ' ns'],
                                                ['\u03c3_\u03c4', currentFrame.cir.rmsDelaySpread_ns.toFixed(2) + ' ns', 'Bc', currentFrame.cir.coherenceBandwidth_MHz.toFixed(1) + ' MHz'],
                                            ].map((row, i) => (
                                                <tr key={i} style={{ borderBottom: '1px solid rgba(255,255,255,0.06)' }}>
                                                    <td style={{ padding: '3px 6px', color: '#aaa' }}>{row[0]}</td>
                                                    <td style={{ padding: '3px 6px', fontFamily: 'monospace', fontWeight: 'bold' }}>{row[1]}</td>
                                                    <td style={{ padding: '3px 6px', color: '#aaa' }}>{row[2]}</td>
                                                    <td style={{ padding: '3px 6px', fontFamily: 'monospace', fontWeight: 'bold' }}>{row[3]}</td>
                                                </tr>
                                            ))}
                                        </tbody>
                                    </table>
                                </div>
                            )}
                        </div>
                    )}
                </>
            )}
        </div>
    );
}
