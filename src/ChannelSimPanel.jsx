import React, { useState, useRef, useEffect } from 'react';
import { Line, Bar } from 'react-chartjs-2';
import JSZip from 'jszip';
import { read as readMat } from 'mat-for-js';
import { generateChannelTimeSeries, generateChannelTimeSeriesForTimestamps, generateChannelTimeSeriesFromGeometry, generateTrajectoryExport, predictPasses, calibrateModel, applyCalibration, createDefaultCalibration, getCalibParamDefs, calculateDopplerShift } from './model.js';
import { getSatelliteList, getSatelliteBandParams } from './knownSatellites.js';
import { SimulationValidator } from './ValidationModule.js';
import { parseTrajectoryCsv } from './projectSync.js';

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
    activeProjectManifest,
    requestedCirIndex,
    onCirSyncStateChange
}) {
    // === Ground Station Config ===
    const [gsLat, setGsLat] = useState(groundStation?.lat ?? 31.062718);
    const [gsLon, setGsLon] = useState(groundStation?.lon ?? 121.244818);
    const [gsAlt, setGsAlt] = useState(groundStation?.alt ?? 15);

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
    // env 和 disableFastFading 保留本地控制（仿真模式专属）
    const [env, setEnv] = useState(globalParams?.env || 'suburban');
    const [disableFastFading, setDisableFastFading] = useState(true);
    // 当 globalParams.env 外部改变时同步
    const prevGlobalEnvRef = React.useRef(globalParams?.env);
    useEffect(() => {
        if (globalParams?.env && globalParams.env !== prevGlobalEnvRef.current) {
            prevGlobalEnvRef.current = globalParams.env;
            setEnv(globalParams.env);
        }
    }, [globalParams?.env]);

    // === Calibration State ===
    const [calibProfile, setCalibProfile] = useState(createDefaultCalibration());
    const [useCalibration, setUseCalibration] = useState(false);
    const [calibMeasurements, setCalibMeasurements] = useState([]);
    const [calibSatId, setCalibSatId] = useState('');
    const [calibBandKey, setCalibBandKey] = useState('');
    const [calibStatus, setCalibStatus] = useState('');
    const [showCalibPanel, setShowCalibPanel] = useState(false);
    const [calibMetadata, setCalibMetadata] = useState(null);

    // === Output State ===
    const [importedTimeline, setImportedTimeline] = useState([]);
    const [viewMode, setViewMode] = useState('imported'); // 'native' | 'imported'
    const [generatedTimeline, setGeneratedTimeline] = useState([]);
    
    const timeline = viewMode === 'imported' && importedTimeline.length > 0 ? importedTimeline : generatedTimeline;
    
    const [generatedTrajectorySamples, setGeneratedTrajectorySamples] = useState([]);
    const [computing, setComputing] = useState(false);
    const [cirIdx, setCirIdx] = useState(0);
    const [statusMsg, setStatusMsg] = useState('');
    const [isStandaloneMode, setIsStandaloneMode] = useState(false);
    const [linkedTrajectorySamples, setLinkedTrajectorySamples] = useState([]);
    const [handshakeInfo, setHandshakeInfo] = useState(null);
    const [linkedViewerTle, setLinkedViewerTle] = useState({ tleLine1: '', tleLine2: '' });
    const [linkedGroundStation, setLinkedGroundStation] = useState(null);

    // === External CIR Import (ZIP of .mat frames) ===
    const [importInfo, setImportInfo] = useState(null);
    const [isCirPlaying, setIsCirPlaying] = useState(false);
    const [cirFps, setCirFps] = useState(5);

    // === Pass Search State ===
    const [passes, setPasses] = useState([]);
    const [selectedPass, setSelectedPass] = useState(null);
    const [searchingPass, setSearchingPass] = useState(false);

    const cirCanvasRef = useRef(null);
    const hasGroundStationProp = groundStation != null;
    const groundStationLat = groundStation?.lat;
    const groundStationLon = groundStation?.lon;
    const groundStationAlt = groundStation?.alt;

    useEffect(() => {
        if (!hasGroundStationProp) return;
        if (groundStationLat != null) setGsLat(groundStationLat);
        if (groundStationLon != null) setGsLon(groundStationLon);
        if (groundStationAlt != null) setGsAlt(groundStationAlt);
    }, [hasGroundStationProp, groundStationLat, groundStationLon, groundStationAlt]);

    // === Find Next Pass ===
    function handleFindPass() {
        if (!tleLine1 || !tleLine2) {
            setStatusMsg('\u26a0\ufe0f Please load satellite TLE first');
            return;
        }
        setSearchingPass(true);
        setStatusMsg('\ud83d\udd0d Searching passes in next 24 hours...');
        setTimeout(() => {
            const results = predictPasses(tleLine1, tleLine2, gsLat, gsLon, gsAlt, 24, 0);
            setPasses(results);
            if (results.length > 0) {
                setSelectedPass(results[0]);
                const passDurMin = Math.ceil(results[0].durationSec / 60) + 4;
                setDurationMin(passDurMin);
                setStatusMsg('\u2705 Found ' + results.length + ' passes. Auto-selected nearest (max elev ' + results[0].maxElev.toFixed(1) + '\u00b0)');
            } else {
                setSelectedPass(null);
                setStatusMsg('\u26a0\ufe0f No visible passes in next 24h. Try another satellite.');
            }
            setSearchingPass(false);
        }, 50);
    }

    // === Generate Timeline ===
    function handleGenerate(overridePass) {
        if (!tleLine1 || !tleLine2) {
            setStatusMsg('\u26a0\ufe0f Please load satellite TLE first');
            return;
        }
        setComputing(true);
        setStatusMsg('\u23f3 Generating channel time series...');
        
        const isEvent = overridePass && overridePass._reactName;
        const targetPass = (overridePass && !isEvent) ? overridePass : selectedPass;

        setTimeout(() => {
            let startTime, endTime;
            let currentDuration = durationMin;
            if (targetPass) {
                startTime = new Date(targetPass.aos.getTime() - 2 * 60000);
                endTime = new Date(targetPass.los.getTime() + 2 * 60000);
                currentDuration = Math.ceil(targetPass.durationSec / 60) + 4;
            } else if (!linkedTrajectorySamples || linkedTrajectorySamples.length === 0) {
                // No pass selected and no linked trajectory — auto-find next visible pass
                const autoPass = predictPasses(tleLine1, tleLine2, gsLat, gsLon, gsAlt, 24, 5);
                if (autoPass && autoPass.length > 0) {
                    const best = autoPass[0];
                    startTime = new Date(best.aos.getTime() - 2 * 60000);
                    endTime = new Date(best.los.getTime() + 2 * 60000);
                    currentDuration = Math.ceil(best.durationSec / 60) + 4;
                    setStatusMsg('\u2139\ufe0f No pass selected — auto-using next pass (max El ' + best.maxElev.toFixed(1) + '\u00b0, ' + best.aos.toLocaleTimeString() + ')');
                } else {
                    startTime = new Date();
                    endTime = new Date(startTime.getTime() + currentDuration * 60 * 1000);
                    setStatusMsg('\u26a0\ufe0f No visible pass in 24h. Generating from current time (satellite may be below horizon).');
                }
            } else {
                startTime = new Date();
                endTime = new Date(startTime.getTime() + currentDuration * 60 * 1000);
            }
            let linkParams = { freq, eirp, gRx, tRx, bandwidth, tec, env, rainRate, disableFastFading };
            if (useCalibration && calibProfile.calibrated) {
                linkParams = applyCalibration(linkParams, calibProfile);
            }
            let result;
            // Priority: 1) linked trajectory samples (handshake), 2) imported timeline timestamps, 3) auto-find pass
            const effectiveSamples = (linkedTrajectorySamples && linkedTrajectorySamples.length > 0)
                ? linkedTrajectorySamples
                : null;
            // If no handshake but imported CIR exists with timestamps, use those for A/B comparison
            const importedTimestamps = (!effectiveSamples && importedTimeline && importedTimeline.length > 0)
                ? importedTimeline.filter(f => f.time || f.elevation > 0).map(f => ({
                    time: f.time,
                    elevation: f.elevation,
                    azimuth: f.azimuth,
                    slantRange: f.slantRange,
                    satLat: f.satLat, satLon: f.satLon, satAlt: f.satAlt,
                    dopplerHz: f.dopplerHz
                  }))
                : null;

            if (effectiveSamples && effectiveSamples.length > 0) {
                const timestamps = effectiveSamples.map(s => new Date(s.time));
                result = generateChannelTimeSeriesForTimestamps(
                    tleLine1, tleLine2,
                    gsLat, gsLon, gsAlt,
                    timestamps,
                    linkParams
                );
            } else if (importedTimestamps && importedTimestamps.length > 0) {
                // A/B comparison: use exact geometry (el/az/range) from imported CIR frames
                // Do NOT re-propagate via SGP4 — the imported data may use a different satellite/TLE
                result = generateChannelTimeSeriesFromGeometry(importedTimestamps, linkParams);
                setStatusMsg('\u2705 Generated native CIR using imported trajectory geometry (' + importedTimestamps.length + ' points) for A/B comparison.');
            } else {
                result = generateChannelTimeSeries(
                    tleLine1, tleLine2,
                    gsLat, gsLon, gsAlt,
                    startTime, endTime, stepSec,
                    linkParams
                );
            }
            const trajectorySamples = buildTrajectorySamplesFromTimeline(result);
            setGeneratedTimeline(result);
            setGeneratedTrajectorySamples(trajectorySamples);
            // We DO NOT clear importInfo or importedTimeline here, 
            // so we preserve the A/B comparison state if the user generates native *after* importing
            setViewMode('native');
            setIsCirPlaying(false);
            setCirIdx(0);
            const visibleFrames = result.filter(f => f.elevation > 0);
            if (visibleFrames.length === 0) {
                setStatusMsg('\u26a0\ufe0f ' + result.length + ' frames generated but satellite NOT visible (elev < 0\u00b0). Click "\ud83d\udd0d Search Passes" to find a visible window.');
            } else {
                const maxElFrame = visibleFrames.reduce((a, b) => a.elevation > b.elevation ? a : b);
                setStatusMsg('\u2705 ' + result.length + ' frames | Visible: ' + visibleFrames.length + ' | Max Elev: ' + maxElFrame.elevation.toFixed(1) + '\u00b0 @ ' + maxElFrame.timeLabel + ' | Peak SNR: ' + maxElFrame.snrDb.toFixed(1) + ' dB');

                // === Validation Module Call ===
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
                // ==============================
            }
            setComputing(false);
        }, 50);
    }

    function safeNum(x, fallback = 0) {
        if (typeof x === 'number' && Number.isFinite(x)) return x;
        if (typeof x === 'bigint') return Number(x);
        return fallback;
    }

    function updateGroundStation(nextGroundStation) {
        setGsLat(nextGroundStation.lat);
        setGsLon(nextGroundStation.lon);
        setGsAlt(nextGroundStation.alt);
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

    function formatFrameTimeLabel(value, fallback = '') {
        if (!value) return fallback;
        const date = value instanceof Date ? value : new Date(value);
        if (Number.isNaN(date.getTime())) return fallback || String(value);
        return date.toLocaleTimeString();
    }

    function buildTrajectorySamplesFromTimeline(sourceTimeline) {
        return (sourceTimeline || []).map((frame, index) => ({
            index,
            lat: safeNum(frame.satLat, 0),
            lon: safeNum(frame.satLon, 0),
            alt: safeNum(frame.satAlt, 0),
            azimuth: safeNum(frame.azimuth, 0),
            elevation: safeNum(frame.elevation, 0),
            slantRange: safeNum(frame.slantRange, 0),
            time: frame.time instanceof Date ? frame.time.toISOString() : (frame.time || ''),
            timeLabel: frame.timeLabel || formatFrameTimeLabel(frame.time, `Frame ${index + 1}`)
        })).filter((point) => Number.isFinite(point.lat) && Number.isFinite(point.lon));
    }

    function buildTrajectorySamplesFromCsv(csvText) {
        return parseTrajectoryCsv(csvText).map((point, index) => ({
            index,
            lat: safeNum(point.satLat, 0),
            lon: safeNum(point.satLon, 0),
            alt: safeNum(point.satAlt, 0),
            azimuth: safeNum(point.azimuth, 0),
            elevation: safeNum(point.elevation, 0),
            slantRange: safeNum(point.slantRange, 0),
            time: point.time || '',
            timeLabel: formatFrameTimeLabel(point.time, `Frame ${index + 1}`)
        }));
    }

    function getZipEntry(zip, entryName) {
        return Object.values(zip.files).find((file) => !file.dir && file.name.split('/').pop().toLowerCase() === entryName.toLowerCase()) || null;
    }

    function getManifestGroundStation(manifest) {
        if (!manifest?.groundStation) return null;
        return {
            lat: safeNum(manifest.groundStation.lat, gsLat),
            lon: safeNum(manifest.groundStation.lon, gsLon),
            alt: safeNum(manifest.groundStation.alt, gsAlt)
        };
    }

    function buildTrajectorySamplesFromManifest(manifest) {
        if (!manifest?.trajectory) return [];
        const resolvedTleLine1 = manifest?.satellite?.tleLine1 || activeProjectManifest?.satellite?.tleLine1 || tleLine1;
        const resolvedTleLine2 = manifest?.satellite?.tleLine2 || activeProjectManifest?.satellite?.tleLine2 || tleLine2;
        if (!resolvedTleLine1 || !resolvedTleLine2) return [];

        const manifestGroundStation = getManifestGroundStation(manifest) || getManifestGroundStation(activeProjectManifest) || { lat: gsLat, lon: gsLon, alt: gsAlt };
        const startTime = manifest.trajectory.startTime ? new Date(manifest.trajectory.startTime) : new Date();
        const stepMs = safeNum(manifest.trajectory.stepMs, 0);
        const sampleCount = Math.max(0, Math.floor(safeNum(manifest.trajectory.sampleCount, 0)));
        const durationMs = manifest.trajectory.durationMs != null
            ? safeNum(manifest.trajectory.durationMs, 0)
            : (sampleCount > 0 ? Math.max(0, (sampleCount - 1) * stepMs) : 0);

        if (!sampleCount || stepMs <= 0) return [];

        const exportPoints = generateTrajectoryExport(
            resolvedTleLine1,
            resolvedTleLine2,
            manifestGroundStation.lat,
            manifestGroundStation.lon,
            manifestGroundStation.alt,
            { startTime, durationMs, stepMs }
        );
        const trajectorySamples = exportPoints.map((point, index) => ({
            index,
            lat: safeNum(point.satLat, 0),
            lon: safeNum(point.satLon, 0),
            alt: safeNum(point.satAlt, 0),
            azimuth: safeNum(point.azimuth, 0),
            elevation: safeNum(point.elevation, 0),
            slantRange: safeNum(point.range, 0),
            time: point.time || '',
            timeLabel: formatFrameTimeLabel(point.time, `Frame ${index + 1}`)
        }));

        return trajectorySamples.length === sampleCount ? trajectorySamples : [];
    }

    function applyTrajectoryToFrame(frame, sample, index) {
        if (!sample) return frame;
        const frameTime = sample.time ? new Date(sample.time) : frame.time;
        // Compute Doppler from TLE + frame timestamp
        let dopplerHz = 0;
        if (frameTime && tleLine1 && tleLine2 && gsLat != null && gsLon != null) {
            try {
                const fq = frame.freqGHz ?? (globalParams?.freq ?? 12.0);
                dopplerHz = calculateDopplerShift(tleLine1, tleLine2, gsLat, gsLon, gsAlt, frameTime, fq);
            } catch (_) { dopplerHz = 0; }
        }
        return {
            ...frame,
            frameIndex: index,
            time: frameTime,
            timeLabel: sample.timeLabel || frame.timeLabel,
            elevation: safeNum(sample.elevation, frame.elevation),
            azimuth: safeNum(sample.azimuth, frame.azimuth),
            slantRange: safeNum(sample.slantRange, frame.slantRange),
            satLat: safeNum(sample.lat, frame.satLat),
            satLon: safeNum(sample.lon, frame.satLon),
            satAlt: safeNum(sample.alt, frame.satAlt),
            dopplerHz
        };
    }

    function describeHandshakeSource(source) {
        switch (source) {
            case 'task-id':
                return 'Task_ID';
            case 'trajectory-csv':
                return 'trajectory.csv';
            case 'frame-count':
                return 'frame count';
            case 'manifest':
                return 'manifest';
            case 'active-project':
                return 'active project';
            default:
                return source || 'standalone';
        }
    }

    function buildCirFromRays(rays) {
        // rays: array of rows (N x 19)
        // Confirmed column mapping (from MAT data analysis):
        //   col[2]  : absolute propagation delay (seconds)
        //   col[4]  : E-field Real part
        //   col[5]  : E-field Imaginary part
        //   col[8]  : arrival phase (degrees, -180~+180) -- NOT power!
        // BUG FIX: previously used col[8] (phase) as amplitude_dB, causing all
        //          taps to appear at similar power levels in the PDP plot.
        //          Now correctly derived from |E| = sqrt(col4^2 + col5^2).

        const MIN_E_MAG = 1e-30; // floor to avoid log(0)

        const taps = (rays || []).map((row, i) => {
            const delay_s = safeNum(row?.[2], 0);
            const delay_ns = delay_s * 1e9;

            // Correct: compute path amplitude from E-field complex magnitude
            const eRe = safeNum(row?.[4], 0);
            const eIm = safeNum(row?.[5], 0);
            const eMag = Math.sqrt(eRe * eRe + eIm * eIm);
            const amp_dB = 20 * Math.log10(Math.max(eMag, MIN_E_MAG));

            // Store phase for reference
            const phase_deg = safeNum(row?.[8], 0);

            return {
                excessDelay_ns: delay_ns,
                amplitude_dB: amp_dB,
                phase_rad: phase_deg * Math.PI / 180,
                label: 'Tap' + (i + 1)
            };
        }).sort((a, b) => a.excessDelay_ns - b.excessDelay_ns);

        let absoluteDelay_ns = 0;
        // Normalize excessDelay_ns to start at 0
        if (taps.length > 0) {
            const minDelay = taps[0].excessDelay_ns;
            absoluteDelay_ns = minDelay;
            taps.forEach(t => t.excessDelay_ns -= minDelay);
        }

        // Normalize so strongest tap = 0 dB (relative PDP)
        const maxAmp = taps.length > 0 ? Math.max(...taps.map(t => t.amplitude_dB)) : 0;
        taps.forEach(t => { t.amplitude_dB -= maxAmp; });

        // Drop taps more than 80 dB below the strongest (insignificant)
        const DYNAMIC_RANGE_DB = 80;
        const filteredTaps = taps.filter(t => t.amplitude_dB >= -DYNAMIC_RANGE_DB);
        const finalTaps = filteredTaps.length > 0 ? filteredTaps : taps.slice(0, 1);

        // Compute RMS delay spread using power-weighted mean
        const pLin = finalTaps.map(t => Math.pow(10, t.amplitude_dB / 10));
        const sumP = pLin.reduce((a, b) => a + b, 0) || 1;
        const meanTau = finalTaps.reduce((acc, t, idx) => acc + t.excessDelay_ns * pLin[idx], 0) / sumP;
        const meanTau2 = finalTaps.reduce((acc, t, idx) => acc + (t.excessDelay_ns ** 2) * pLin[idx], 0) / sumP;
        const rms = Math.sqrt(Math.max(0, meanTau2 - meanTau ** 2));
        const coherenceMHz = rms > 0 ? (1 / (5 * rms * 1e-9)) / 1e6 : 0; // ~1/(5*sigma_tau)

        return {
            taps: finalTaps.length ? finalTaps : [{ excessDelay_ns: 0, amplitude_dB: 0, label: 'LOS' }],
            rmsDelaySpread_ns: safeNum(rms, 0),
            coherenceBandwidth_MHz: safeNum(coherenceMHz, 0),
            absoluteDelay_ns: safeNum(absoluteDelay_ns, 0)
        };
    }

    async function handleImportCirZip(file) {
        if (!file) return;
        setComputing(true);
        setStatusMsg('\u23f3 Importing CIR frames from ZIP...');
        try {
            const ab = await file.arrayBuffer();
            const zip = await JSZip.loadAsync(ab);
            const manifestEntry = getZipEntry(zip, 'manifest.json');
            const trajectoryEntry = getZipEntry(zip, 'trajectory.csv');
            const entries = Object.keys(zip.files)
                .filter(name => name.toLowerCase().endsWith('.mat') && !zip.files[name].dir && !name.includes('__MACOSX'));

            if (entries.length === 0) {
                setStatusMsg('\u26a0\ufe0f No .mat files found in ZIP');
                setComputing(false);
                return;
            }

            function frameIndexFromName(name) {
                const m = name.match(/(\d+)/g);
                if (!m) return Number.MAX_SAFE_INTEGER;
                return parseInt(m[m.length - 1], 10);
            }

            entries.sort((a, b) => frameIndexFromName(a) - frameIndexFromName(b));

            let importedManifest = null;
            if (manifestEntry) {
                try {
                    importedManifest = JSON.parse(await manifestEntry.async('string'));
                } catch (err) {
                    console.warn('Failed to parse manifest.json from CIR ZIP:', err);
                }
            }

            if (importedManifest?.groundStation) {
                updateGroundStation(getManifestGroundStation(importedManifest));
            }

            let zipTrajectorySamples = [];
            if (trajectoryEntry) {
                try {
                    zipTrajectorySamples = buildTrajectorySamplesFromCsv(await trajectoryEntry.async('string'));
                } catch (err) {
                    console.warn('Failed to parse trajectory.csv from CIR ZIP:', err);
                }
            }

            const frames = [];
            for (let i = 0; i < entries.length; i++) {
                const name = entries[i];
                const u8 = await zip.files[name].async('uint8array');
                const ab = u8.buffer.slice(u8.byteOffset, u8.byteOffset + u8.byteLength);
                const matFile = readMat(ab);
                const mat = matFile?.data || matFile;

                // mat-for-js returns {header, data}
                const numberRays = safeNum(mat?.NumberRays?.[0], 0);
                let rays = mat?.RaysProperties;

                // Normalize RaysProperties into array-of-rows
                // Common shapes: [N][19] or flat [1][19]
                if (Array.isArray(rays) && Array.isArray(rays[0]) && typeof rays[0][0] === 'number') {
                    // already rows
                } else if (Array.isArray(rays) && typeof rays[0] === 'number') {
                    rays = [rays];
                } else {
                    rays = [];
                }

                // If NumberRays hints multiple rays but rays parsed as flat, try chunking
                if (numberRays > 1 && rays.length === 1 && rays[0].length === numberRays * 19) {
                    const flat = rays[0];
                    rays = [];
                    for (let r = 0; r < numberRays; r++) rays.push(flat.slice(r * 19, (r + 1) * 19));
                }

                const cir = buildCirFromRays(rays);
                const idx = frameIndexFromName(name);
                
                // Get path loss (ReceivedPower_COH or NONCOH)
                const rxPower = safeNum(mat?.ReceivedPower_NONCOH?.[0], -150);

                // 提取频率信息（常见字段：CenterFrequency、Frequency，单位 Hz）
                const rawFreqHz = mat?.CenterFrequency?.[0] ?? mat?.Frequency?.[0] ?? mat?.freq?.[0] ?? null;
                const frameFreqGHz = rawFreqHz != null ? safeNum(rawFreqHz, 0) / 1e9 : null;
                
                frames.push({
                    frameIndex: i,
                    importedFrameId: idx,
                    timeLabel: `Imported frame ${idx}`,
                    freqGHz: frameFreqGHz,
                    elevation: 10,
                    azimuth: 0,
                    slantRange: 0,
                    absoluteFspl: -rxPower, // In imported mat, absoluteFspl will hold path loss
                    rxPowerDbm: rxPower,
                    rtPathLoss: rxPower,       // RT engine total received power (dB, positive = loss)
                    isImportedFrame: true,
                    dopplerHz: 0,              // filled after handshake merge below
                    snrDb: 0,
                    noiseFloorDbm: -100,
                    attRain: 0,
                    attGas: 0,
                    attCloud: 0,
                    totalAtmosphericLoss: 0,
                    fadeLMS: 0,
                    lossFaraday: 0,
                    pointingLoss: 0,
                    scanLoss: 0,
                    multipathLoss: 0,
                    scintLoss: 0,
                    tSky: 0,
                    xpd: 0,
                    capRank1: 0,
                    capRank2: 0,
                    groupDelayNs: cir.taps[0].excessDelay_ns,
                    dispersionNs: cir.rmsDelaySpread_ns,
                    satLat: 0,
                    satLon: 0,
                    satAlt: 0,
                    cir
                });
            }

            let handshakeSource = '';
            let handshakeSamples = [];
            let handshakeManifest = null;
            let handshakeTle = { tleLine1: '', tleLine2: '' };
            let handshakeGroundStation = null;

            const activeManifestMatchesFrameCount = activeProjectManifest?.trajectory?.sampleCount === frames.length;
            const taskIdMatches = importedManifest?.Task_ID && activeProjectManifest?.Task_ID && importedManifest.Task_ID === activeProjectManifest.Task_ID;

            if (zipTrajectorySamples.length === frames.length) {
                handshakeSource = 'trajectory-csv';
                handshakeSamples = zipTrajectorySamples;
                handshakeManifest = importedManifest || activeProjectManifest || null;
            } else if (generatedTrajectorySamples.length === frames.length) {
                handshakeSource = 'frame-count';
                handshakeSamples = generatedTrajectorySamples;
                handshakeManifest = importedManifest || null;
            } else {
                const manifestCandidate = taskIdMatches
                    ? (importedManifest || activeProjectManifest)
                    : (importedManifest || (activeManifestMatchesFrameCount ? activeProjectManifest : null));
                if (manifestCandidate) {
                    const manifestSamples = buildTrajectorySamplesFromManifest(manifestCandidate);
                    if (manifestSamples.length === frames.length) {
                        handshakeSource = taskIdMatches ? 'task-id' : (manifestCandidate === activeProjectManifest ? 'active-project' : 'manifest');
                        handshakeSamples = manifestSamples;
                        handshakeManifest = manifestCandidate;
                    }
                }
            }

            if (handshakeSamples.length === frames.length) {
                handshakeTle = {
                    tleLine1: handshakeManifest?.satellite?.tleLine1 || activeProjectManifest?.satellite?.tleLine1 || tleLine1 || '',
                    tleLine2: handshakeManifest?.satellite?.tleLine2 || activeProjectManifest?.satellite?.tleLine2 || tleLine2 || ''
                };
                handshakeGroundStation = getManifestGroundStation(handshakeManifest)
                    || getManifestGroundStation(activeProjectManifest)
                    || { lat: gsLat, lon: gsLon, alt: gsAlt };
            }

            const linkedFrames = handshakeSamples.length === frames.length
                ? frames.map((frame, index) => applyTrajectoryToFrame(frame, handshakeSamples[index], index))
                : frames;

            setImportedTimeline(linkedFrames);
            setViewMode('imported');
            setIsCirPlaying(false);
            setCirIdx(0);
            setImportInfo({
                name: file.name,
                frames: frames.length,
                hasManifest: Boolean(importedManifest),
                standalone: handshakeSamples.length !== frames.length,
                handshakeSource,
                taskId: importedManifest?.Task_ID || handshakeManifest?.Task_ID || null,
                // 频率：取所有帧中第一个有效值
                freqGHz: frames.find(f => f.freqGHz != null)?.freqGHz ?? null
            });

            if (handshakeSamples.length === frames.length) {
                setIsStandaloneMode(false);
                setLinkedTrajectorySamples(handshakeSamples);
                setHandshakeInfo({
                    linked: true,
                    source: handshakeSource,
                    taskId: importedManifest?.Task_ID || handshakeManifest?.Task_ID || null
                });
                setLinkedViewerTle(handshakeTle);
                setLinkedGroundStation(handshakeGroundStation);
                setStatusMsg(`\u2705 Imported ${frames.length} CIR frames from ${file.name} and linked them via ${describeHandshakeSource(handshakeSource)}. Click the highlighted trajectory samples to jump frames.`);
            } else {
                setIsStandaloneMode(true);
                setLinkedTrajectorySamples([]);
                setHandshakeInfo({
                    linked: false,
                    source: 'standalone',
                    taskId: importedManifest?.Task_ID || null
                });
                setLinkedViewerTle({ tleLine1: '', tleLine2: '' });
                setLinkedGroundStation(null);
                setStatusMsg(`\u2705 Imported ${frames.length} CIR frames from ${file.name} in standalone viewer mode. Skyplot and trajectory views are hidden until a project handshake is available.`);
            }
        } catch (e) {
            console.error(e);
            setStatusMsg('\u26a0\ufe0f Import failed: ' + (e?.message || String(e)));
        } finally {
            setComputing(false);
        }
    }

    // === CIR playback ===
    useEffect(() => {
        if (!isCirPlaying || timeline.length === 0) return;
        const intervalMs = Math.max(20, Math.round(1000 / Math.max(1, cirFps)));
        const timer = setInterval(() => {
            setCirIdx(prev => {
                const next = prev + 1;
                if (next >= timeline.length) return 0;
                return next;
            });
        }, intervalMs);
        return () => clearInterval(timer);
    }, [isCirPlaying, cirFps, timeline.length]);

    useEffect(() => {
        if (timeline.length === 0) {
            if (cirIdx !== 0) setCirIdx(0);
            return;
        }
        if (cirIdx >= timeline.length) {
            setCirIdx(timeline.length - 1);
        }
    }, [timeline.length, cirIdx]);

    const prevRequestedIdxRef = useRef(requestedCirIndex);
    useEffect(() => {
        if (!Number.isInteger(requestedCirIndex)) return;
        if (requestedCirIndex < 0 || requestedCirIndex >= timeline.length) return;
        if (prevRequestedIdxRef.current !== requestedCirIndex) {
            prevRequestedIdxRef.current = requestedCirIndex;
            setIsCirPlaying(false);
            setCirIdx(requestedCirIndex);
        }
    }, [requestedCirIndex, timeline.length]);

    useEffect(() => {
        onCirSyncStateChange?.({
            isStandaloneMode,
            activeIndex: timeline.length ? cirIdx : 0,
            samplePoints: linkedTrajectorySamples,
            handshake: handshakeInfo,
            importInfo,
            tleLine1: linkedViewerTle.tleLine1,
            tleLine2: linkedViewerTle.tleLine2,
            groundStation: linkedGroundStation
        });
    }, [
        isStandaloneMode,
        cirIdx,
        timeline.length,
        linkedTrajectorySamples,
        handshakeInfo,
        importInfo,
        linkedViewerTle.tleLine1,
        linkedViewerTle.tleLine2,
        linkedGroundStation,
        onCirSyncStateChange
    ]);

    // === CIR Canvas ===
    useEffect(() => {
        if (!cirCanvasRef.current || timeline.length === 0) return;
        const canvas = cirCanvasRef.current;
        const ctx = canvas.getContext('2d');
        const W = canvas.width, H = canvas.height;

        ctx.fillStyle = '#0a0a1a';
        ctx.fillRect(0, 0, W, H);

        const frame = timeline[cirIdx];
        if (!frame || !frame.cir) return;

        const { taps, rmsDelaySpread_ns, coherenceBandwidth_MHz, absoluteDelay_ns } = frame.cir;
        const maxExcessDelay = Math.max(1, ...taps.map(t => t.excessDelay_ns)) * 1.3;
        const losPower = taps[0].amplitude_dB;
        const minDb = -50;
        const padL = 60, padR = 20, padT = 40, padB = 45;
        const plotW = W - padL - padR;
        const plotH = H - padT - padB;

        ctx.strokeStyle = 'rgba(255,255,255,0.08)';
        ctx.lineWidth = 0.5;
        for (let i = 0; i <= 5; i++) {
            const y = padT + (plotH * i / 5);
            ctx.beginPath(); ctx.moveTo(padL, y); ctx.lineTo(W - padR, y); ctx.stroke();
        }
        for (let i = 0; i <= 4; i++) {
            const x = padL + (plotW * i / 4);
            ctx.beginPath(); ctx.moveTo(x, padT); ctx.lineTo(x, H - padB); ctx.stroke();
        }

        ctx.fillStyle = '#aaa';
        ctx.font = '10px monospace';
        ctx.textAlign = 'right';
        for (let i = 0; i <= 5; i++) {
            const dbVal = 0 - (i / 5) * Math.abs(minDb);
            ctx.fillText(dbVal.toFixed(0) + ' dB', padL - 5, padT + (plotH * i / 5) + 4);
        }
        ctx.textAlign = 'center';
        for (let i = 0; i <= 4; i++) {
            const ns = (maxExcessDelay * i / 4).toFixed(0);
            ctx.fillText(ns + ' ns', padL + (plotW * i / 4), H - padB + 15);
        }

        ctx.fillStyle = '#ccc';
        ctx.font = '11px sans-serif';
        ctx.textAlign = 'center';
        ctx.fillText('Excess Delay (ns)', padL + plotW / 2, H - 5);
        ctx.save();
        ctx.translate(14, padT + plotH / 2);
        ctx.rotate(-Math.PI / 2);
        ctx.fillText('Relative Power (dB)', 0, 0);
        ctx.restore();

        // Below horizon warning
        if (frame.elevation < 0) {
            ctx.fillStyle = 'rgba(255,100,100,0.15)';
            ctx.fillRect(padL, padT, plotW, plotH);
            ctx.fillStyle = '#ff6b6b';
            ctx.font = 'bold 14px sans-serif';
            ctx.textAlign = 'center';
            ctx.fillText('BELOW HORIZON (El=' + frame.elevation.toFixed(1) + '\u00b0) - No valid CIR', padL + plotW / 2, padT + plotH / 2);
        }

        const colors = ['#00ff88', '#ff6b6b', '#4ecdc4', '#f7dc6f', '#bb8fce'];
        
        // Decluttering logic for dense CIR data (like from Ray Tracing)
        const isDense = taps.length > 15;
        // Identify top N strongest paths to keep them prominent and labeled
        const topTaps = new Set([...taps].sort((a, b) => b.amplitude_dB - a.amplitude_dB).slice(0, 5));

        taps.forEach((tap, i) => {
            const x = padL + (tap.excessDelay_ns / maxExcessDelay) * plotW;
            const relPower = tap.amplitude_dB - losPower;
            const normY = Math.max(0, Math.min(1, -relPower / Math.abs(minDb)));
            const y = padT + normY * plotH;
            
            const isStrong = topTaps.has(tap) || i === 0; // Ensure LOS (i=0) and strongest paths are highlighted

            let colorStr = colors[i % colors.length];
            if (isDense && !isStrong) {
                colorStr = 'rgba(120, 150, 180, 0.4)'; // Dim weaker paths in dense mode
            }

            ctx.strokeStyle = colorStr;
            ctx.lineWidth = (isDense && !isStrong) ? 0.8 : 2;
            ctx.beginPath();
            ctx.moveTo(x, padT + plotH);
            ctx.lineTo(x, y);
            ctx.stroke();

            ctx.fillStyle = colorStr;
            ctx.beginPath();
            ctx.arc(x, y, (isDense && !isStrong) ? 1.5 : 4, 0, Math.PI * 2);
            ctx.fill();

            // Label collision avoidance: only label strong paths when dense
            if (!isDense || isStrong) {
                ctx.fillStyle = '#fff';
                ctx.font = isDense ? '8px sans-serif' : '9px sans-serif';
                ctx.textAlign = 'center';
                const labelY = y - 10 < padT ? y + 15 : y - 10;
                
                // Add a semi-transparent background to labels in dense mode to improve readability over other lines
                if (isDense) {
                    const textW = ctx.measureText(tap.label).width;
                    ctx.fillStyle = 'rgba(10, 10, 26, 0.7)';
                    ctx.fillRect(x - textW / 2 - 2, labelY - 8, textW + 4, 22);
                    ctx.fillStyle = '#fff';
                }
                
                ctx.fillText(tap.label, x, labelY);
                ctx.fillStyle = '#aaa';
                ctx.fillText(relPower.toFixed(1) + 'dB', x, labelY + 11);
            }
        });

        ctx.fillStyle = '#fff';
        ctx.font = 'bold 12px sans-serif';
        ctx.textAlign = 'left';
        let titleText = 'CIR \u2014 |h(\u03c4)| Power Delay Profile';
        if (absoluteDelay_ns) {
            titleText += ` (LOS Delay: ${(absoluteDelay_ns / 1e6).toFixed(4)} ms)`;
        }
        ctx.fillText(titleText, padL, 18);

        ctx.fillStyle = '#88ccff';
        ctx.font = '10px monospace';
        ctx.textAlign = 'right';
        const powerLabel = frame.isImportedFrame
            ? 'RT PathLoss: ' + Math.abs(frame.rtPathLoss ?? frame.rxPowerDbm).toFixed(1) + ' dB'
            : 'Rx: ' + (frame.rxPowerDbm ?? 0).toFixed(1) + ' dBm | SNR: ' + (frame.snrDb ?? 0).toFixed(1) + ' dB';
        ctx.fillText(powerLabel + ' | El: ' + frame.elevation.toFixed(1) + '\u00b0', W - padR, 15);
        ctx.fillText('DS(\u03c3_\u03c4): ' + rmsDelaySpread_ns.toFixed(2) + ' ns | Bc: ' + coherenceBandwidth_MHz.toFixed(1) + ' MHz', W - padR, 29);
        const dopHz = frame.dopplerHz ?? 0;
        const dopKHz = dopHz / 1000;
        const dopSign = dopHz >= 0 ? '+' : '';
        ctx.fillStyle = dopHz >= 0 ? '#7ecfff' : '#ffb347';
        ctx.fillText('Doppler: ' + dopSign + dopKHz.toFixed(2) + ' kHz (' + (dopHz >= 0 ? 'approaching ↑▲' : 'receding ↓▼') + ')', W - padR, 43);

    }, [timeline, cirIdx]);

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

    function handleClearImportedCir() {
        setIsCirPlaying(false);
        setImportInfo(null);
        setIsStandaloneMode(false);
        setLinkedTrajectorySamples([]);
        setHandshakeInfo(null);
        setLinkedViewerTle({ tleLine1: '', tleLine2: '' });
        setLinkedGroundStation(null);
        setImportedTimeline([]);
        setViewMode('native');
        if (generatedTimeline.length > 0) {
            setCirIdx(Math.min(cirIdx, Math.max(0, generatedTimeline.length - 1)));
            setStatusMsg('Cleared imported CIR and restored the generated channel timeline.');
        } else {
            setCirIdx(0);
            setStatusMsg('Cleared imported CIR.');
        }
    }

    // === Chart Data ===
    const isImportedTimeline = Boolean(importInfo);
    const showAnalyticsPanels = timeline.length > 0 && !isImportedTimeline;
    const chartLabels = timeline.map(f => f.timeLabel);

    const rxSnrChartData = {
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
    };

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
                        <strong style={{ fontSize: '0.9em' }}>{'\u2699\ufe0f'} Channel Engine</strong>
                        <label style={labelStyle}>Env:
                            <select value={env} onChange={e => setEnv(e.target.value)} style={selectStyle}>
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
                <button onClick={handleFindPass} disabled={searchingPass} style={{ ...btnPrimary, background: 'linear-gradient(135deg, #f39c12, #e67e22)' }}>
                    {searchingPass ? '\u23f3 Searching...' : '\ud83d\udd0d Search Passes'}
                </button>
                <button onClick={handleGenerate} disabled={computing} style={btnPrimary}>
                    {computing ? '\u23f3 Computing...' : '\ud83d\ude80 Generate Channel TimeSeries'}
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
                                                    // 兼容两种格式：纯数组 或 { metadata, measurements }
                                                    const data = Array.isArray(json) ? json : (json.measurements || []);
                                                    setCalibMeasurements(data);
                                                    setCalibMetadata(json.metadata || null);

                                                    const statusParts = [`✅ 已加载 ${data.length} 个测量数据点`];

                                                    // 解析 metadata → 自动填充 UI
                                                    const meta = json.metadata;
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
                                                                const nextParams = {};
                                                                if (sat.freq != null) nextParams.freq = sat.freq;
                                                                if (sat.eirp != null) nextParams.eirp = sat.eirp;
                                                                if (sat.bandwidth != null) nextParams.bandwidth = sat.bandwidth;
                                                                if (Object.keys(nextParams).length > 0) onLinkParamsChange?.(nextParams);
                                                                // 必填字段校验
                                                                const missing = [];
                                                                if (sat.freq == null) missing.push('freq(频率)');
                                                                if (sat.eirp == null) missing.push('eirp(发射功率)');
                                                                if (!sat.polarization) missing.push('polarization(极化)');
                                                                if (sat.bandwidth == null) missing.push('bandwidth(带宽)');
                                                                if (missing.length > 0) {
                                                                    statusParts.push(`⛔ 自定义卫星缺少必填字段: ${missing.join(', ')} — 无法校准!`);
                                                                } else {
                                                                    statusParts.push(`🛰️ 自定义卫星 "${sat.name || '未命名'}" (${sat.freq}GHz, ${sat.eirp}dBW, ${sat.polarization}, BW=${sat.bandwidth}MHz)`);
                                                                }
                                                            }
                                                        }
                                                        // 地面站校验
                                                        if (meta.groundStation) {
                                                            const gs = meta.groundStation;
                                                            if (gs.lat != null || gs.lon != null || gs.alt != null) {
                                                                updateGroundStation({
                                                                    lat: gs.lat != null ? gs.lat : gsLat,
                                                                    lon: gs.lon != null ? gs.lon : gsLon,
                                                                    alt: gs.alt != null ? gs.alt : gsAlt
                                                                });
                                                            }
                                                            if (gs.lat != null && gs.lon != null) {
                                                                statusParts.push(`📍 地面站 (${gs.lat}, ${gs.lon})`);
                                                            } else {
                                                                statusParts.push('⚠️ 地面站缺少 lat/lon — 无法验证地理一致性');
                                                            }
                                                        } else {
                                                            statusParts.push('⚠️ 未提供地面站信息 — 无法验证地理一致性');
                                                        }
                                                        // 接收机参数
                                                        if (meta.receiver) {
                                                            const rx = meta.receiver;
                                                            if (rx.gRx != null) setGRx(rx.gRx);
                                                            if (rx.tRx != null) setTRx(rx.tRx);
                                                            if (rx.bandwidth != null) setBandwidth(rx.bandwidth);
                                                        }

                                                        // 测量点数据质量校验
                                                        const noElevCount = data.filter(m => m.elevation == null).length;
                                                        const noMetricCount = data.filter(m =>
                                                            m.measuredCN0_dB == null && m.measuredRSSI_dBm == null &&
                                                            m.measuredXPD_dB == null && m.measuredAttenuation_dB == null &&
                                                            m.measuredLoss == null
                                                        ).length;
                                                        if (noElevCount > 0) {
                                                            statusParts.push(`⚠️ ${noElevCount}个点缺少 elevation(仰角)，将使用默认值`);
                                                        }
                                                        if (noMetricCount > 0) {
                                                            statusParts.push(`⛔ ${noMetricCount}个点无任何测量指标，将被忽略`);
                                                        }
                                                        // 环境
                                                        if (meta.environment) setEnv(meta.environment);
                                                        if (meta.tec != null) setTec(meta.tec);
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
                                            calibMeasurements.some(m => m.measuredCN0_dB != null) && 'C/N0',
                                            calibMeasurements.some(m => m.measuredRSSI_dBm != null) && 'RSSI',
                                            calibMeasurements.some(m => m.measuredXPD_dB != null) && 'XPD',
                                            calibMeasurements.some(m => m.measuredAttenuation_dB != null) && 'Atten',
                                            calibMeasurements.some(m => m.measuredLoss != null) && 'Loss(旧)'
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
                                                    setFreq(bp.freq);
                                                    setEirp(bp.eirp);
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
                                        if (sat.freq == null) errors.push('freq(频率)');
                                        if (sat.eirp == null) errors.push('eirp(发射功率)');
                                        if (!sat.polarization) errors.push('polarization(极化)');
                                        if (sat.bandwidth == null) errors.push('bandwidth(带宽)');
                                    }

                                    // 地面站校验
                                    if (!meta?.groundStation || meta.groundStation.lat == null || meta.groundStation.lon == null) {
                                        if (meta) {
                                            warnings.push('未提供地面站坐标，无法验证地理一致性');
                                        }
                                    }

                                    // 测量点校验
                                    const validPoints = calibMeasurements.filter(m =>
                                        m.measuredCN0_dB != null || m.measuredRSSI_dBm != null ||
                                        m.measuredXPD_dB != null || m.measuredAttenuation_dB != null ||
                                        m.measuredLoss != null
                                    );
                                    if (validPoints.length === 0) {
                                        errors.push('所有测量点均无有效指标(C/N0, RSSI, XPD, Atten)');
                                    }
                                    const noElevPts = validPoints.filter(m => m.elevation == null).length;
                                    if (noElevPts === validPoints.length && validPoints.length > 0) {
                                        warnings.push('所有点缺少 elevation，将使用默认值 30°');
                                    }

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
                                        const refSat = calibSatId && calibBandKey ? getSatelliteBandParams(calibSatId, calibBandKey) : null;
                                        const profile = calibrateModel(calibMeasurements, { freq, eirp, gRx, tRx, bandwidth, tec, env, rainRate }, refSat);
                                        setCalibProfile(profile);
                                        setUseCalibration(true);
                                        const defs = getCalibParamDefs();
                                        const paramSummary = defs.map(d => `${d.label}: ${profile.params[d.key].toFixed(3)}`).join(' | ');
                                        setCalibStatus(`\u2705 校准完成! RMS残差=${profile.residualRMS.toFixed(3)} | ${paramSummary}`);
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
                                        setSelectedPass(p);
                                        setDurationMin(Math.ceil(p.durationSec / 60) + 4);
                                        setStatusMsg('Selected pass #' + (i + 1) + ': ' + p.aos.toLocaleTimeString() + ' ~ ' + p.los.toLocaleTimeString() + ', max elev ' + p.maxElev.toFixed(1) + '\u00b0. Auto-generating...');
                                        handleGenerate(p);
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
                        <button
                            onClick={() => { setSelectedPass(null); setStatusMsg('Switched to free time mode (starts from now)'); }}
                            style={{ padding: '4px 10px', borderRadius: '4px', cursor: 'pointer', fontSize: '0.8em', background: !selectedPass ? '#4ecdc4' : '#2c3e50', color: !selectedPass ? '#000' : '#eee', border: !selectedPass ? '2px solid #fff' : '1px solid #555' }}
                        >
                            {'\ud83d\udd70\ufe0f'} Start from now
                        </button>
                    </div>
                </div>
            )}

            {/* Status Message */}
            {statusMsg && (
                <div style={{ fontSize: '0.85em', marginBottom: '10px', padding: '6px 10px', borderRadius: '4px', background: statusMsg.includes('\u26a0') ? 'rgba(255,107,107,0.15)' : 'rgba(78,205,196,0.15)', border: '1px solid ' + (statusMsg.includes('\u26a0') ? 'rgba(255,107,107,0.3)' : 'rgba(78,205,196,0.3)') }}>
                    {statusMsg}
                </div>
            )}

            <div style={{ background: 'rgba(0,0,0,0.3)', borderRadius: '6px', padding: '12px', marginBottom: timeline.length > 0 ? '15px' : 0 }}>
                <div style={{ display: 'flex', gap: '10px', alignItems: 'center', flexWrap: 'wrap', marginBottom: timeline.length > 0 ? '10px' : 0 }}>
                    <strong style={{ fontSize: '0.9em' }}>Import CIR:</strong>
                    <input
                        type="file"
                        accept=".zip"
                        onChange={e => handleImportCirZip(e.target.files?.[0])}
                        style={{ maxWidth: '320px' }}
                    />
                    {importInfo && (
                        <span style={{ fontFamily: 'monospace', fontSize: '0.85em', color: '#88ccff' }}>
                            Loaded: {importInfo.name} ({importInfo.frames} frames)
                        </span>
                    )}
                    {importInfo && (
                        <span style={{
                            fontSize: '0.78em',
                            padding: '2px 8px',
                            borderRadius: '999px',
                            background: isStandaloneMode ? 'rgba(255,107,107,0.14)' : 'rgba(255,214,10,0.16)',
                            border: isStandaloneMode ? '1px solid rgba(255,107,107,0.35)' : '1px solid rgba(255,214,10,0.35)',
                            color: isStandaloneMode ? '#ffb3b3' : '#ffd60a'
                        }}>
                            {isStandaloneMode ? 'Standalone CIR Viewer' : `Linked via ${describeHandshakeSource(importInfo.handshakeSource)}`}
                        </span>
                    )}
                    <button
                        onClick={handleClearImportedCir}
                        style={{ padding: '4px 10px', borderRadius: '4px', cursor: 'pointer', background: '#2c3e50', color: '#eee', border: '1px solid #555' }}
                    >
                        Clear
                    </button>
                    {importInfo && (
                        <>
                            <button onClick={exportCSV} style={{ ...btnExport, background: '#138496', color: '#fff', borderColor: '#117a8b' }}>
                                {'\ud83d\udce5'} Export CSV
                            </button>
                            {importInfo.taskId && (
                                <span style={{ fontSize: '0.8em', color: '#ffd60a', fontFamily: 'monospace' }}>
                                    Task_ID: {importInfo.taskId.slice(0, 8)}...
                                </span>
                            )}
                            <span style={{
                                fontSize: '0.8em', fontFamily: 'monospace', padding: '2px 8px', borderRadius: '999px',
                                background: importInfo.freqGHz != null ? 'rgba(78,205,196,0.15)' : 'rgba(150,150,150,0.1)',
                                border: importInfo.freqGHz != null ? '1px solid rgba(78,205,196,0.4)' : '1px solid rgba(150,150,150,0.3)',
                                color: importInfo.freqGHz != null ? '#4ecdc4' : '#888'
                            }}>
                                📡 {importInfo.freqGHz != null ? `${importInfo.freqGHz.toFixed(2)} GHz` : 'Freq: 未知'}
                            </span>
                            {!isStandaloneMode && (
                                <span style={{ fontSize: '0.85em', color: '#ccc', marginLeft: 'auto' }}>
                                    Click a highlighted point in the trajectory view to jump this CIR frame.
                                </span>
                            )}
                        </>
                    )}
                </div>

                {timeline.length === 0 && (
                    <div style={{ fontSize: '0.85em', color: '#aaa' }}>
                        Import a CIR ZIP to open the viewer, or generate a channel timeline to simulate and export locally.
                    </div>
                )}
            </div>

            {/* === Output Area === */}
            {timeline.length > 0 && (
                <>
                    {showAnalyticsPanels && (
                        <div style={{ background: 'rgba(0,0,0,0.3)', borderRadius: '6px', padding: '12px', marginBottom: '15px' }}>
                            <Line data={rxSnrChartData} options={rxSnrChartOpts} />
                        </div>
                    )}

                    <div style={{ background: 'rgba(0,0,0,0.3)', borderRadius: '6px', padding: '12px', marginBottom: showAnalyticsPanels ? '15px' : 0 }}>
                        {isStandaloneMode && (
                            <div style={{ marginBottom: '8px', fontSize: '0.82em', color: '#ffb3b3' }}>
                                Standalone CIR Viewer Mode: trajectory and skyplot linkage are unavailable for this import.
                            </div>
                        )}
                        <div style={{ display: 'flex', gap: '10px', alignItems: 'center', marginBottom: '8px', flexWrap: 'wrap' }}>
                            <strong style={{ fontSize: '0.9em' }}>CIR Frame:</strong>
                            <button
                                onClick={() => setIsCirPlaying(p => !p)}
                                style={{ padding: '4px 10px', borderRadius: '4px', cursor: 'pointer', background: isCirPlaying ? '#f39c12' : '#4ecdc4', color: '#000', border: '1px solid #333', fontWeight: 'bold' }}
                            >
                                {isCirPlaying ? '⏸ Pause' : '▶ Play'}
                            </button>
                            <span style={{ fontSize: '0.85em', color: '#aaa' }}>FPS</span>
                            <input type="number" min={1} max={60} value={cirFps} onChange={e => setCirFps(parseInt(e.target.value || '5'))} style={{ width: '70px' }} />

                            {importedTimeline.length > 0 && generatedTimeline.length > 0 && (
                                <button
                                    onClick={() => setViewMode(m => m === 'native' ? 'imported' : 'native')}
                                    style={{
                                        padding: '4px 10px', borderRadius: '4px', cursor: 'pointer',
                                        background: 'rgba(255,255,255,0.1)', color: '#fff', border: '1px solid rgba(255,255,255,0.3)',
                                        marginLeft: '10px', fontSize: '0.85em', display: 'flex', alignItems: 'center', gap: '5px'
                                    }}
                                    title="Toggle between natively generated SGP4 CIR and imported Ray-Tracing CIR"
                                >
                                    🔄 {viewMode === 'native' ? 'View: Native CIR' : 'View: RT CIR (Imported)'}
                                </button>
                            )}

                            <input
                                type="range"
                                min={0}
                                max={timeline.length - 1}
                                value={cirIdx}
                                onChange={e => { setIsCirPlaying(false); setCirIdx(parseInt(e.target.value)); }}
                                style={{ flex: 1, minWidth: '240px' }}
                            />
                            <span style={{ fontFamily: 'monospace', fontSize: '0.85em', minWidth: '300px', textAlign: 'right' }}>
                                {timeline[cirIdx]?.timeLabel || ''}
                                {' | El: '}{safeNum(timeline[cirIdx]?.elevation, 0).toFixed(1)}{'\u00b0'}
                                {' | SNR: '}{safeNum(timeline[cirIdx]?.snrDb, 0).toFixed(1)}{'dB'}
                                {' | RxP: '}{safeNum(timeline[cirIdx]?.rxPowerDbm, 0).toFixed(1)}{'dBm'}
                            </span>
                        </div>
                        <canvas ref={cirCanvasRef} width={700} height={280} style={{ width: '100%', borderRadius: '4px' }} />
                    </div>

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
