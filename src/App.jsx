import React, { useState, useEffect, useRef, useCallback, useMemo } from 'react';
import { Chart as ChartJS, CategoryScale, LinearScale, PointElement, LineElement, BarElement, BarController, Title, Tooltip, Legend, ScatterController } from 'chart.js';
import { Line } from 'react-chartjs-2';
import JSZip from 'jszip';
import './App.css';
import { calculateLinkBudget, calculateMIMOCapacity, calculateDynamicOrbit, predictPasses, computeGroundTrack, computeSkyTrack, generatePassReplay, generateTrajectoryExport, extractGoldenTrajectory } from './model';
import ChannelSimPanel from './ChannelSimPanel';
import UserManual from './UserManual';
import ApiDashboard from './panels/ApiDashboard';
import { buildSimulationProjectManifest, buildTrajectoryCsv } from './projectSync';
import { ORBIT_SATELLITES } from './knownSatellites.js';
import { diagnoseTleAge } from './orbit/tle.js';
import { useChannelReplay } from './features/replay/useChannelReplay.js';
import { appendBounded } from './replay/boundedSeries.js';
import { deriveOpenMeteoSample } from './replay/weatherSample.js';

ChartJS.register(CategoryScale, LinearScale, PointElement, LineElement, BarElement, BarController, Title, Tooltip, Legend, ScatterController);
ChartJS.defaults.color = 'rgba(0, 229, 255, 0.7)';
ChartJS.defaults.borderColor = 'rgba(0, 229, 255, 0.1)';
ChartJS.defaults.font.family = "'Space Mono', monospace";

const DEFAULT_CIR_SYNC_STATE = {
  isStandaloneMode: false,
  activeIndex: 0,
  samplePoints: [],
  handshake: null,
  importInfo: null,
  tleLine1: '',
  tleLine2: '',
  groundStation: null
};


// === Milestone 22: Ground Track Canvas Component ===
function GroundTrackCanvas({ canvasRef, tleLine1, tleLine2, syncLat, syncLon, samplePoints = [], activeSampleIndex = 0, onSamplePointSelect }) {
  const localRef = useRef(null);
  const ref = canvasRef || localRef;
  const sampleMarkersRef = useRef([]);

  function handleCanvasClick(event) {
    if (!sampleMarkersRef.current.length || !onSamplePointSelect) return;
    const rect = event.currentTarget.getBoundingClientRect();
    const clickX = event.clientX - rect.left;
    const clickY = event.clientY - rect.top;

    let nearest = null;
    let nearestDist = Number.POSITIVE_INFINITY;

    for (const marker of sampleMarkersRef.current) {
      const dist = Math.hypot(marker.x - clickX, marker.y - clickY);
      if (dist < nearestDist) {
        nearest = marker;
        nearestDist = dist;
      }
    }

    if (nearest && nearestDist <= 10) {
      onSamplePointSelect(nearest.index);
    }
  }

  useEffect(() => {
    const canvas = ref.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    const W = canvas.width, H = canvas.height;

    function draw() {
      sampleMarkersRef.current = [];
      ctx.clearRect(0, 0, W, H);
      // Background ocean
      ctx.fillStyle = '#1a2a4a';
      ctx.fillRect(0, 0, W, H);

      // Grid lines
      ctx.strokeStyle = 'rgba(255,255,255,0.12)';
      ctx.lineWidth = 0.5;
      for (let lat = -60; lat <= 60; lat += 30) {
        const y = H / 2 - (lat / 90) * (H / 2);
        ctx.beginPath(); ctx.moveTo(0, y); ctx.lineTo(W, y); ctx.stroke();
      }
      for (let lon = -150; lon <= 150; lon += 30) {
        const x = W / 2 + (lon / 180) * (W / 2);
        ctx.beginPath(); ctx.moveTo(x, 0); ctx.lineTo(x, H); ctx.stroke();
      }
      // Equator
      ctx.strokeStyle = 'rgba(255,255,255,0.3)'; ctx.lineWidth = 1;
      ctx.beginPath(); ctx.moveTo(0, H / 2); ctx.lineTo(W, H / 2); ctx.stroke();
      // Labels
      ctx.fillStyle = 'rgba(255,255,255,0.5)'; ctx.font = '10px monospace';
      ctx.fillText('0\u00b0', W / 2 + 2, H / 2 - 2);
      ctx.fillText('90\u00b0N', 2, H * 0.5 - H * 0.5 * (90 / 90) + 12);
      ctx.fillText('90\u00b0S', 2, H - 4);
      ctx.fillText('180\u00b0W', 2, H / 2 + 12);
      ctx.fillText('180\u00b0E', W - 30, H / 2 + 12);

      // Compute ground track
      const points = computeGroundTrack(tleLine1, tleLine2, 100);
      let currentPt = null;
      if (points.length >= 2) {
        for (let i = 1; i < points.length; i++) {
          const p0 = points[i - 1], p1 = points[i];
          const x0 = W / 2 + (p0.lon / 180) * (W / 2);
          const y0 = H / 2 - (p0.lat / 90) * (H / 2);
          const x1 = W / 2 + (p1.lon / 180) * (W / 2);
          const y1 = H / 2 - (p1.lat / 90) * (H / 2);

          // Skip wrap-around segments
          if (Math.abs(p1.lon - p0.lon) > 180) continue;

          const alpha = p1.isCurrent ? 1.0 : 0.3 + 0.7 * (i / points.length);
          ctx.strokeStyle = `rgba(0, 255, 136, ${alpha})`;
          ctx.lineWidth = p1.isCurrent ? 3 : 1.5;
          ctx.beginPath(); ctx.moveTo(x0, y0); ctx.lineTo(x1, y1); ctx.stroke();

          if (p1.isCurrent) currentPt = { x: x1, y: y1, lat: p1.lat, lon: p1.lon, alt: p1.alt };
        }
      }

      // Ground station marker
      const gsX = W / 2 + (syncLon / 180) * (W / 2);
      const gsY = H / 2 - (syncLat / 90) * (H / 2);
      ctx.fillStyle = '#ff4444'; ctx.beginPath(); ctx.arc(gsX, gsY, 5, 0, Math.PI * 2); ctx.fill();
      ctx.strokeStyle = '#fff'; ctx.lineWidth = 1.5; ctx.stroke();
      ctx.fillStyle = '#fff'; ctx.font = 'bold 10px sans-serif';
      ctx.fillText('GS', gsX + 8, gsY + 4);

      // Current satellite marker
      if (currentPt) {
        ctx.fillStyle = '#00ff88'; ctx.beginPath(); ctx.arc(currentPt.x, currentPt.y, 6, 0, Math.PI * 2); ctx.fill();
        ctx.strokeStyle = '#fff'; ctx.lineWidth = 2; ctx.stroke();
        ctx.fillStyle = '#fff'; ctx.font = 'bold 10px sans-serif';
        ctx.fillText(`SAT ${currentPt.alt.toFixed(0)}km`, currentPt.x + 10, currentPt.y - 4);
      }

      if (samplePoints.length > 0) {
        ctx.strokeStyle = 'rgba(255, 214, 10, 0.65)';
        ctx.lineWidth = 1.5;
        ctx.beginPath();
        samplePoints.forEach((point, index) => {
          const x = W / 2 + (point.lon / 180) * (W / 2);
          const y = H / 2 - (point.lat / 90) * (H / 2);
          if (index === 0 || Math.abs(point.lon - samplePoints[index - 1].lon) > 180) {
            ctx.moveTo(x, y);
          } else {
            ctx.lineTo(x, y);
          }
        });
        ctx.stroke();

        samplePoints.forEach((point, index) => {
          const x = W / 2 + (point.lon / 180) * (W / 2);
          const y = H / 2 - (point.lat / 90) * (H / 2);
          const isActive = index === activeSampleIndex;
          sampleMarkersRef.current.push({ index, x, y });

          ctx.fillStyle = isActive ? '#ffd60a' : 'rgba(255, 214, 10, 0.72)';
          ctx.beginPath();
          ctx.arc(x, y, isActive ? 4.5 : 1.8, 0, Math.PI * 2);
          ctx.fill();

          if (isActive) {
            ctx.strokeStyle = '#fff';
            ctx.lineWidth = 1.5;
            ctx.stroke();
          }
        });
      }

      // Title
      ctx.fillStyle = '#fff'; ctx.font = 'bold 12px sans-serif';
      ctx.fillText('\ud83c\udf0d Ground Track (Equirectangular)', 8, 16);
      if (samplePoints.length > 0) {
        ctx.fillStyle = '#ffd60a';
        ctx.font = '10px monospace';
        ctx.fillText(`Linked CIR samples: ${samplePoints.length}`, 8, 31);
      }
    }

    draw();
    const timer = setInterval(draw, 5000);
    return () => clearInterval(timer);
  }, [tleLine1, tleLine2, syncLat, syncLon, samplePoints, activeSampleIndex, ref]);

  return (
    <canvas
      ref={ref}
      width={560}
      height={280}
      onClick={handleCanvasClick}
      style={{ border: '1px solid #333', borderRadius: '5px', flex: '1 1 540px', minWidth: '300px', cursor: samplePoints.length > 0 ? 'pointer' : 'default' }}
    />
  );
}

// === Milestone 22: Sky Plot Canvas Component ===
function SkyPlotCanvas({ canvasRef, tleLine1, tleLine2, syncLat, syncLon, samplePoints = [], activeSampleIndex = 0, onSamplePointSelect }) {
  const localRef = useRef(null);
  const ref = canvasRef || localRef;
  const sampleMarkersRef = useRef([]);

  function handleCanvasClick(event) {
    if (!sampleMarkersRef.current.length || !onSamplePointSelect) return;
    const rect = event.currentTarget.getBoundingClientRect();
    const clickX = event.clientX - rect.left;
    const clickY = event.clientY - rect.top;

    let nearest = null;
    let nearestDist = Number.POSITIVE_INFINITY;

    for (const marker of sampleMarkersRef.current) {
      const dist = Math.hypot(marker.x - clickX, marker.y - clickY);
      if (dist < nearestDist) {
        nearestDist = dist;
        nearest = marker;
      }
    }

    if (nearest && nearestDist < 15) { // 15px hit radius
      onSamplePointSelect(nearest.index);
    }
  }

  useEffect(() => {
    const canvas = ref.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    const W = canvas.width, H = canvas.height;
    const cx = W / 2, cy = H / 2;
    const R = Math.min(cx, cy) - 25;

    function draw() {
      ctx.clearRect(0, 0, W, H);
      ctx.fillStyle = '#0a1628';
      ctx.fillRect(0, 0, W, H);

      // Elevation rings (90° center, 0° edge)
      ctx.strokeStyle = 'rgba(255,255,255,0.15)';
      ctx.lineWidth = 0.5;
      for (let el = 0; el <= 90; el += 30) {
        const r = R * (1 - el / 90);
        ctx.beginPath(); ctx.arc(cx, cy, r, 0, Math.PI * 2); ctx.stroke();
        ctx.fillStyle = 'rgba(255,255,255,0.4)'; ctx.font = '9px monospace';
        ctx.fillText(`${el}\u00b0`, cx + 3, cy - r + 12);
      }
      // Horizon ring
      ctx.strokeStyle = 'rgba(255,200,0,0.5)'; ctx.lineWidth = 2;
      ctx.beginPath(); ctx.arc(cx, cy, R, 0, Math.PI * 2); ctx.stroke();

      // Cardinal directions
      ctx.fillStyle = '#fff'; ctx.font = 'bold 12px sans-serif';
      ctx.textAlign = 'center';
      ctx.fillText('N', cx, cy - R - 6);
      ctx.fillText('S', cx, cy + R + 14);
      ctx.fillText('E', cx + R + 10, cy + 4);
      ctx.fillText('W', cx - R - 10, cy + 4);
      ctx.textAlign = 'left';

      // Cross-hairs
      ctx.strokeStyle = 'rgba(255,255,255,0.1)'; ctx.lineWidth = 0.5;
      ctx.beginPath(); ctx.moveTo(cx - R, cy); ctx.lineTo(cx + R, cy); ctx.stroke();
      ctx.beginPath(); ctx.moveTo(cx, cy - R); ctx.lineTo(cx, cy + R); ctx.stroke();

      // Compute sky track
      const points = computeSkyTrack(tleLine1, tleLine2, syncLat, syncLon, 0, 100);
      let currentPt = null;
      if (points.length >= 2) {
        for (let i = 1; i < points.length; i++) {
          const p0 = points[i - 1], p1 = points[i];
          if (p0.elev < -5 && p1.elev < -5) continue; // skip fully below horizon
          const r0 = R * (1 - Math.max(0, p0.elev) / 90);
          const a0 = (p0.az - 90) * Math.PI / 180;
          const r1 = R * (1 - Math.max(0, p1.elev) / 90);
          const a1 = (p1.az - 90) * Math.PI / 180;
          const x0 = cx + r0 * Math.cos(a0), y0 = cy + r0 * Math.sin(a0);
          const x1 = cx + r1 * Math.cos(a1), y1 = cy + r1 * Math.sin(a1);

          const visible = p1.elev > 0;
          ctx.strokeStyle = visible ? 'rgba(0, 255, 136, 0.8)' : 'rgba(255, 100, 100, 0.3)';
          ctx.lineWidth = visible ? 2 : 1;
          ctx.beginPath(); ctx.moveTo(x0, y0); ctx.lineTo(x1, y1); ctx.stroke();

          if (p1.isCurrent) currentPt = { x: x1, y: y1, az: p1.az, elev: p1.elev };
        }
      }

      // Current position marker
      if (currentPt) {
        const color = currentPt.elev > 0 ? '#00ff88' : '#ff4444';
        ctx.fillStyle = color; ctx.beginPath(); ctx.arc(currentPt.x, currentPt.y, 6, 0, Math.PI * 2); ctx.fill();
        ctx.strokeStyle = '#fff'; ctx.lineWidth = 2; ctx.stroke();
        ctx.fillStyle = '#fff'; ctx.font = 'bold 10px sans-serif';
        ctx.fillText(`Az:${currentPt.az.toFixed(0)}\u00b0 El:${currentPt.elev.toFixed(1)}\u00b0`, currentPt.x + 10, currentPt.y - 4);
      }

      // Zenith marker
      ctx.fillStyle = 'rgba(255,255,255,0.3)'; ctx.beginPath(); ctx.arc(cx, cy, 3, 0, Math.PI * 2); ctx.fill();

      if (samplePoints.length > 0) {
        ctx.strokeStyle = 'rgba(255, 214, 10, 0.65)';
        ctx.lineWidth = 1.5;
        ctx.beginPath();
        samplePoints.forEach((point, index) => {
          const r = R * (1 - Math.max(0, point.elevation) / 90);
          const a = (point.azimuth - 90) * Math.PI / 180;
          const x = cx + r * Math.cos(a);
          const y = cy + r * Math.sin(a);
          if (index === 0) {
            ctx.moveTo(x, y);
          } else {
            ctx.lineTo(x, y);
          }
        });
        ctx.stroke();

        samplePoints.forEach((point, index) => {
          const r = R * (1 - Math.max(0, point.elevation) / 90);
          const a = (point.azimuth - 90) * Math.PI / 180;
          const x = cx + r * Math.cos(a);
          const y = cy + r * Math.sin(a);
          const isActive = index === activeSampleIndex;
          ctx.fillStyle = isActive ? '#ffd60a' : 'rgba(255, 214, 10, 0.7)';
          ctx.beginPath();
          ctx.arc(x, y, isActive ? 4.5 : 1.8, 0, Math.PI * 2);
          ctx.fill();
          if (isActive) {
            ctx.strokeStyle = '#fff';
            ctx.lineWidth = 1.2;
            ctx.stroke();
          }
        });
      }

      // Title
      ctx.fillStyle = '#fff'; ctx.font = 'bold 12px sans-serif';
      ctx.textAlign = 'left';
      ctx.fillText('\ud83c\udf1f Sky Plot (Polar)', 8, 16);
      if (samplePoints.length > 0) {
        ctx.fillStyle = '#ffd60a';
        ctx.font = '10px monospace';
        ctx.fillText(`Linked CIR frame: ${activeSampleIndex + 1}/${samplePoints.length}`, 8, 31);
      }
    }

    draw();
    const timer = setInterval(draw, 5000);
    return () => clearInterval(timer);
  }, [tleLine1, tleLine2, syncLat, syncLon, samplePoints, activeSampleIndex, ref]);

  return (
    <canvas
      ref={ref}
      width={300}
      height={300}
      onClick={handleCanvasClick}
      style={{ border: '1px solid #333', borderRadius: '5px', flex: '0 0 300px', cursor: samplePoints.length > 0 ? 'pointer' : 'default' }}
    />
  );
}

function App() {
  const [simTime, setSimTime] = useState(0);

  useEffect(() => {
    // 10 FPS ultra-fast tick for Scintillation turbulence
    const timer = setInterval(() => {
      setSimTime(Date.now() / 1000.0);
    }, 100);
    return () => clearInterval(timer);
  }, []);

  const [params, setParams] = useState({
    freq: 30.0,
    rainRate: 0,
    elevation: 40.0,
    env: 'suburban',
    eirp: 60.0,
    gRx: 42.0,
    tRx: 150.0,
    bandwidth: 400.0,
    tec: 50.0,
    xpdAnt: 35.0,
    correctionFactor: 1.0,
    slantRange: 35786,
    hpbw: 2.0,
    isPhasedArray: false
  });

  const [realData, setRealData] = useState([]);
  const [fittingInfo, setFittingInfo] = useState('');

  // Live Sync Controls
  const [isLiveSync, setIsLiveSync] = useState(false);
  const [syncMode, setSyncMode] = useState('A');
  const [syncLat, setSyncLat] = useState(31.062718);
  const [syncLon, setSyncLon] = useState(121.244818);
  const [gsAlt, setGsAlt] = useState(15); // Ground Station altitude in meters
  const [disableFastFading, setDisableFastFading] = useState(true);
  const handleWeatherReplayFrame = useCallback((frame, frameIndex) => {
    const rainRate = frame.metrics.observation.rainRate_mmph ?? 0;
    const derivedLoss = frame.metrics.derived.rainAttenuation_dB ?? 0;
    setRealData(prev => appendBounded(prev, {
      timestampUtc: frame.timestampUtc,
      rainRate,
      derivedLoss,
      observationSource: frame.metrics.observation.source,
      lossSource: frame.metrics.derived.source,
    }, 3600));
    setFittingInfo(`[JSON 回放] 帧 ${frameIndex + 1}：观测降水 ${rainRate} mm/h；模型派生损耗 ${derivedLoss.toFixed(3)} dB`);
  }, []);
  const handleWeatherReplayComplete = useCallback(() => {
    setIsLiveSync(false);
    setFittingInfo('JSON 回放完成。');
  }, []);
  const weatherReplay = useChannelReplay({
    onFrame: handleWeatherReplayFrame,
    onComplete: handleWeatherReplayComplete,
  });

  // Orbital Mechanics Controls
  const [tleLine1, setTleLine1] = useState(ORBIT_SATELLITES.ISS.tleLine1);
  const [tleLine2, setTleLine2] = useState(ORBIT_SATELLITES.ISS.tleLine2);
  const [isDynamicOrbit, setIsDynamicOrbit] = useState(true);
  const [showManual, setShowManual] = useState(false);
  const [showApiDashboard, setShowApiDashboard] = useState(false);
  const [orbitData, setOrbitData] = useState(null);
  const [passData, setPassData] = useState([]);
  const [passComputing, setPassComputing] = useState(false);
  const [passHours, setPassHours] = useState(24);

  // === Milestone 22: Visualization Refs ===
  const groundTrackRef = useRef(null);
  const skyPlotRef = useRef(null);

  // === Milestone 23: Replay State ===
  const handleOrbitReplayFrame = useCallback((frame) => {
    setParams(prev => ({
      ...prev,
      elevation: Math.max(0.1, frame.elevation),
      slantRange: frame.slantRange,
    }));
  }, []);
  const orbitReplay = useChannelReplay({
    onFrame: handleOrbitReplayFrame,
    defaultSpeed: 5,
  });
  const replayTimeline = orbitReplay.frames;
  const replayIdx = orbitReplay.index;
  const isReplaying = orbitReplay.isPlaying;
  const replaySpeed = orbitReplay.speed;
  const [replayMinutesAhead, setReplayMinutesAhead] = useState(20);
  const [replayStartTime, setReplayStartTime] = useState(() => {
    const tzOffset = (new Date()).getTimezoneOffset() * 60000;
    return (new Date(Date.now() - tzOffset)).toISOString().slice(0, 16);
  });
  const [activeProjectManifest, setActiveProjectManifest] = useState(null);
  const [requestedCirIndex, setRequestedCirIndex] = useState(0);
  const [cirSyncState, setCirSyncState] = useState(DEFAULT_CIR_SYNC_STATE);

  function handleGenerateReplay() {
    const start = new Date(replayStartTime);
    const end = new Date(start.getTime() + replayMinutesAhead * 60000);
    const tl = generatePassReplay(tleLine1, tleLine2, syncLat, syncLon, gsAlt, start, end, 10, params);
    orbitReplay.loadFrames(tl);
  }

  function handleExportReplay() {
    if (replayTimeline.length === 0) return;
    const csv = 'Time,Elevation,Azimuth,SlantRange_km,TotalLoss_dB,DeltaFSPL_dB,AtmLoss_dB,SkyNoise_K\n' +
      replayTimeline.map(f => `${f.timeLabel},${f.elevation.toFixed(2)},${f.azimuth.toFixed(1)},${f.slantRange.toFixed(1)},${f.totalLoss.toFixed(2)},${f.deltaFspl.toFixed(2)},${f.totalAtmosphericLoss.toFixed(2)},${f.tSky.toFixed(1)}`).join('\n');
    const blob = new Blob([csv], { type: 'text/csv' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a'); a.href = url; a.download = `replay_${satName || 'sat'}_${new Date().toISOString().slice(0, 16)}.csv`; a.click();
    URL.revokeObjectURL(url);
  }

  async function handleExportWgs84Trajectory() {
    // Determine start time
    let startTime;
    if (denseStartTimeStr && denseStartTimeStr.trim()) {
      startTime = new Date(denseStartTimeStr.trim());
      if (isNaN(startTime.getTime())) startTime = new Date();
    } else {
      startTime = new Date();
    }

    // Determine duration
    let durationMs;
    if (denseDurationMin > 0) {
      durationMs = denseDurationMin * 60 * 1000;
    } else {
      // Auto: find next pass and use its duration
      const passes = predictPasses(tleLine1, tleLine2, syncLat, syncLon, gsAlt, 72, 0);
      if (passes && passes.length > 0) {
        const best = passes.reduce((a, b) => b.maxElev > a.maxElev ? b : a, passes[0]);
        startTime = new Date(best.aos.getTime() - 2 * 60000);
        const endTime = new Date(best.los.getTime() + 2 * 60000);
        durationMs = endTime.getTime() - startTime.getTime();
      } else {
        durationMs = 10 * 60 * 1000; // fallback 10 min
      }
    }

    const trajectoryConfig = { startTime, durationMs, stepMs: denseStepMs };
    const trajectory = generateTrajectoryExport(tleLine1, tleLine2, syncLat, syncLon, gsAlt, trajectoryConfig);
    if (!trajectory.length) {
      setTleFetchError('Failed to export WGS84 trajectory. Please verify the current TLE lines.');
      return;
    }

    const safeSat = (satName || noradId || 'satellite').replace(/[^a-zA-Z0-9._-]+/g, '_');
    const fileStamp = startTime.toISOString().replace(/:/g, '-').slice(0, 19);
    const manifest = buildSimulationProjectManifest({
      satellite: {
        name: satName,
        noradId,
        tleLine1,
        tleLine2,
        params: { ...params }
      },
      groundStation: { lat: syncLat, lon: syncLon, alt: gsAlt },
      trajectory: {
        file: 'trajectory.csv',
        startTime: startTime.toISOString(),
        durationMs: trajectoryConfig.durationMs,
        stepMs: trajectoryConfig.stepMs,
        sampleCount: trajectory.length
      },
      linkParams: {
        disableFastFading,
        syncMode
      }
    });
    const zip = new JSZip();
    zip.file('trajectory.csv', buildTrajectoryCsv(trajectory));
    zip.file('manifest.json', JSON.stringify(manifest, null, 2));
    const blob = await zip.generateAsync({ type: 'blob' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `${safeSat}_simulation_project_${fileStamp}.zip`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
    setActiveProjectManifest(manifest);
    setTleFetchError('');
  }
  async function handleExportGoldenTrajectory(specificPass = null) {
    // If the click event object is passed by mistake instead of a pass object, ignore it
    const isValidPass = specificPass && specificPass.aos && specificPass.los;
    let bestPass = isValidPass ? specificPass : null;
    
    if (!bestPass) {
      // 1. Predict passes to find the exact next visible window (up to 72 hours ahead)
      const passes = predictPasses(tleLine1, tleLine2, syncLat, syncLon, gsAlt, 72, 0);
      if (!passes || passes.length === 0) {
        setTleFetchError('No visible passes found in the next 72h. Cannot generate Golden RT trajectory.');
        return;
      }
      
      // Find the "best" pass (the one with the highest max elevation) to ensure a full NLOS->LOS->NLOS curve
      bestPass = passes[0];
      for (let i = 1; i < passes.length; i++) {
        if (passes[i].maxElev > bestPass.maxElev) {
          bestPass = passes[i];
        }
      }
    }
    
    // Add a 2-minute margin before AOS and after LOS to capture horizon edge effects
    const startTime = new Date(bestPass.aos.getTime() - 2 * 60 * 1000);
    const endTime = new Date(bestPass.los.getTime() + 2 * 60 * 1000);
    const durationMs = endTime.getTime() - startTime.getTime();

    // 2. Use a dense trajectory with 1s step for this specific dynamic window
    const trajectoryConfig = { startTime, durationMs, stepMs: 1000 };
    const denseTrajectory = generateTrajectoryExport(tleLine1, tleLine2, syncLat, syncLon, gsAlt, trajectoryConfig);
    if (!denseTrajectory || !denseTrajectory.length) {
      setTleFetchError('Failed to generate dense trajectory for RT Golden Export. Check TLE.');
      return;
    }

    const goldenPoints = extractGoldenTrajectory(denseTrajectory, streetAzimuth);
    if (!goldenPoints || !goldenPoints.length) {
      setTleFetchError('Failed to extract golden points. Maybe satellite never visible?');
      return;
    }

    const safeSat = (satName || noradId || 'satellite').replace(/[^a-zA-Z0-9._-]+/g, '_');
    const fileStamp = startTime.toISOString().replace(/:/g, '-').slice(0, 19);
    
    // Create manifest marking this as a Golden RT Trajectory
    const manifest = buildSimulationProjectManifest({
      satellite: {
        name: satName,
        noradId,
        tleLine1,
        tleLine2,
        params: { ...params }
      },
      groundStation: { lat: syncLat, lon: syncLon, alt: gsAlt },
      trajectory: {
        file: 'trajectory.csv',
        startTime: startTime.toISOString(),
        durationMs: trajectoryConfig.durationMs,
        stepMs: trajectoryConfig.stepMs,
        sampleCount: goldenPoints.length,
        type: 'golden_rt',
        streetAzimuth: streetAzimuth
      },
      linkParams: {
        disableFastFading,
        syncMode
      }
    });

    const zip = new JSZip();
    
    // Add feature/description columns to the CSV, plus the new Effective Altitude
    const csvHeader = 'Timestamp,Latitude (deg),Longitude (deg),Altitude (km),Azimuth (deg),Elevation (deg),Slant Range (km),Effective Altitude (km),Feature,Description\n';
    const csvRows = goldenPoints.map(p => {
      const ts = p.time || p.timestamp || '';
      // Effective Altitude = Slant Range * sin(Elevation)
      // This is crucial to "trick" local plane-based Ray Tracing engines into calculating the correct absolute delay and FSPL
      const elevRad = Math.max(0, p.elevation || 0) * Math.PI / 180;
      const effectiveAlt = (p.range || 0) * Math.sin(elevRad);
      
      const exportedAlt = applyEffectiveAlt ? effectiveAlt.toFixed(3) : (p.satAlt || 0).toFixed(3);
      
      return `${ts},${(p.satLat||0).toFixed(6)},${(p.satLon||0).toFixed(6)},${exportedAlt},${(p.azimuth||0).toFixed(2)},${(p.elevation||0).toFixed(2)},${(p.range||0).toFixed(2)},${effectiveAlt.toFixed(3)},"${p.feature||''}","${p.description||''}"`;
    });
    zip.file('trajectory.csv', csvHeader + csvRows.join('\n'));
    zip.file('manifest.json', JSON.stringify(manifest, null, 2));
    
    const blob = await zip.generateAsync({ type: 'blob' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `${safeSat}_GoldenRT_${fileStamp}.zip`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
    setActiveProjectManifest(manifest);
    setTleFetchError('');
  }

  const [satName, setSatName] = useState('ISS (ZARYA)');
  const [streetAzimuth, setStreetAzimuth] = useState('');
  const [denseStepMs, setDenseStepMs] = useState(100);
  const [denseDurationMin, setDenseDurationMin] = useState(0);  // 0 = auto (entire pass)
  const [denseStartTimeStr, setDenseStartTimeStr] = useState('');  // empty = auto
  const [applyEffectiveAlt, setApplyEffectiveAlt] = useState(true);
  const [noradId, setNoradId] = useState('25544');
  const [tleFetching, setTleFetching] = useState(false);
  const [tleFetchError, setTleFetchError] = useState('');  // === Milestone 20: Satellite Preset Catalog ===
  const SAT_PRESETS = [
    { label: '--- 选择卫星 ---', id: '', name: '' },
    // === 🇨🇳 中国卫星 ===
    { label: '🇨🇳 CSS (中国空间站/天和)', id: '48274', name: 'CSS' },
    { label: '🇨🇳 北斗-3 M1 (MEO)', id: '43001', name: '' },
    // --- 星网 (国网/互联网低轨) ---
    { label: '🇨🇳 星网 技术试验-A (86.5°轨道)', id: '57288', name: 'HULIANWANG JISHU SHIYAN' },
    { label: '🇨🇳 星网 技术试验-C (50°轨道)', id: '58691', name: '' },
    { label: '🇨🇳 星网 低轨-01 第一批 (86.5°)', id: '62323', name: 'HULIANWANG DIGUI-01' },
    { label: '🇨🇳 星网 低轨-05 第一批', id: '62327', name: 'HULIANWANG DIGUI-05' },
    { label: '🇨🇳 星网 低轨-11 第二批 (50°)', id: '62971', name: 'HULIANWANG DIGUI-11' },
    { label: '🇨🇳 星网 低轨-15 第二批', id: '62975', name: 'HULIANWANG DIGUI-15' },
    { label: '🇨🇳 星网 低轨-20 第三批 (86.5°)', id: '63687', name: 'HULIANWANG DIGUI-20' },
    // --- 千帆 (G60/垣信) ---
    { label: '🇨🇳 千帆-1 (G60/垣信)', id: '', name: 'QIANFAN-1' },
    { label: '🇨🇳 千帆-7 (G60/垣信)', id: '', name: 'QIANFAN-7' },
    { label: '🇨🇳 千帆-19 (G60/垣信)', id: '', name: 'QIANFAN-19' },
    // === 🇺🇸 国际卫星 ===
    { label: '🇺🇸 ISS (国际空间站)', id: '25544', name: 'ISS' },
    { label: '🇺🇸 Starlink-1008', id: '', name: 'STARLINK-1008' },
    { label: '🇺🇸 Starlink-1012', id: '', name: 'STARLINK-1012' },
    { label: '🇺🇸 Starlink-30000', id: '', name: 'STARLINK-30000' },
    { label: '🇺🇸 Starlink-31600', id: '', name: 'STARLINK-31600' },
    { label: '🇬🇧 OneWeb-0012', id: '', name: 'ONEWEB-0012' },
    { label: '🇬🇧 OneWeb-0601', id: '', name: 'ONEWEB-0601' },
    { label: '🇺🇸 Iridium 180 NEXT', id: '56730', name: 'IRIDIUM' },
    { label: '🇺🇸 NOAA 20 (气象)', id: '43013', name: '' },
    { label: '🇺🇸 Hubble (哈勃)', id: '20580', name: '' },
    { label: '🇺🇸 GPS BIIR-2 (PRN 13)', id: '24876', name: '' },
  ];

  // === Milestone 19: Parse TLE Epoch Age ===
  function parseTLEEpochAgeDays(tle1) {
    try {
      const diagnostics = diagnoseTleAge({ tleLine1: tle1 });
      return {
        epochDate: new Date(diagnostics.epochUtc),
        ageDays: diagnostics.ageDays,
        diagnostics
      };
    } catch { return { epochDate: null, ageDays: -1 }; }
  }
  const tleEpochInfo = parseTLEEpochAgeDays(tleLine1);

  // === Milestone 19+20: Robust TLE Fetch (CATNR → NAME fallback) ===
  async function fetchTLE(catNr, nameQuery) {
    setTleFetching(true);
    setTleFetchError('');
    try {
      // Strategy 1: Try NORAD ID first (fastest, single sat)
      if (catNr) {
        const url = `https://celestrak.org/NORAD/elements/gp.php?CATNR=${catNr}&FORMAT=TLE`;
        const resp = await fetch(url);
        if (resp.ok) {
          const text = await resp.text();
          if (!text.includes('No GP data found')) {
            const lines = text.trim().split(/\r?\n/);
            if (lines.length >= 3 && lines[1].startsWith('1 ') && lines[2].startsWith('2 ')) {
              setSatName(lines[0].trim());
              setTleLine1(lines[1].trim());
              setTleLine2(lines[2].trim());
              return;
            }
          }
        }
      }
      // Strategy 2: Fallback to NAME search (works for Starlink/OneWeb etc.)
      const searchName = nameQuery || catNr;
      if (searchName) {
        const url2 = `https://celestrak.org/NORAD/elements/gp.php?NAME=${encodeURIComponent(searchName)}&FORMAT=TLE`;
        const resp2 = await fetch(url2);
        if (resp2.ok) {
          const text2 = await resp2.text();
          if (!text2.includes('No GP data found') && text2.trim().length > 10) {
            const lines2 = text2.trim().split(/\r?\n/);
            // Take the first matching satellite from the results
            if (lines2.length >= 3 && lines2[1].startsWith('1 ') && lines2[2].startsWith('2 ')) {
              setSatName(lines2[0].trim());
              setTleLine1(lines2[1].trim());
              setTleLine2(lines2[2].trim());
              // Update NORAD ID from the fetched TLE
              const fetchedId = lines2[1].substring(2, 7).trim();
              setNoradId(fetchedId);
              return;
            }
          }
        }
      }
      throw new Error(`No TLE found for ID "${catNr}" or name "${searchName}". Try a preset from the dropdown.`);
    } catch (err) {
      if (err.message.includes('Failed to fetch')) {
        setTleFetchError('CORS/Network Error – please paste TLE manually');
      } else {
        setTleFetchError(err.message);
      }
    } finally {
      setTleFetching(false);
    }
  }

  // Handle preset selection
  function handlePresetChange(e) {
    const idx = parseInt(e.target.value);
    if (idx <= 0) return;
    const preset = SAT_PRESETS[idx];
    setNoradId(preset.id || '');
    fetchTLE(preset.id, preset.name);
  }

  // Dynamic Orbit Ticker
  useEffect(() => {
    let intervalId;
    if (isDynamicOrbit) {
      intervalId = setInterval(() => {
        const result = calculateDynamicOrbit(tleLine1, tleLine2, syncLat, syncLon, gsAlt, new Date());
        if (result) {
          setOrbitData(result);
          // Auto-update parameters ensuring elevation doesn't drop to 0 or negative for math stability
          setParams(prev => ({
            ...prev,
            elevation: Math.max(0.1, result.elevation),
            slantRange: result.slantRange
          }));
        } else {
          setOrbitData(null);
        }
      }, 1000);
    } else {
      setOrbitData(null);
      setParams(prev => ({ ...prev, slantRange: 35786 }));
    }
    return () => clearInterval(intervalId);
  }, [isDynamicOrbit, tleLine1, tleLine2, syncLat, syncLon, gsAlt]);

  // Live Sync Effect (Client-Side Only)
  useEffect(() => {
    let intervalId;

    if (isLiveSync && syncMode === 'A') {
        const fetchWeather = async () => {
          try {
            const url = `https://api.open-meteo.com/v1/forecast?latitude=${syncLat}&longitude=${syncLon}&current=precipitation&timezone=auto`;
            const res = await fetch(url);
            const data = await res.json();
            const sample = deriveOpenMeteoSample({
              timestampUtc: new Date().toISOString(),
              precipitation_mmph: data?.current?.precipitation ?? 0,
            });
            const rainRate = sample.metrics.observation.rainRate_mmph;
            const derivedLoss = sample.metrics.derived.rainAttenuation_dB;
            setRealData(prev => appendBounded(prev, {
              timestampUtc: sample.timestampUtc,
              rainRate,
              derivedLoss,
              observationSource: sample.metrics.observation.source,
              lossSource: sample.metrics.derived.source,
            }, 3600));
            setFittingInfo(`[Open-Meteo] 观测输入：降水 ${rainRate} mm/h；模型派生：雨衰 ${derivedLoss.toFixed(3)} dB`);
          } catch (e) {
            setFittingInfo("[Live API Error] " + e.message);
            setIsLiveSync(false);
          }
        };

        setFittingInfo(`Connecting to Open-Meteo API...`);
        fetchWeather();
        intervalId = setInterval(fetchWeather, 10000);
    }

    return () => clearInterval(intervalId);
  }, [isLiveSync, syncMode, syncLat, syncLon]);

  const handleToggleSync = (e) => {
    const checked = e.target.checked;
    setIsLiveSync(checked);
    if (checked) {
      setRealData([]);
      if (syncMode === 'B') {
        if (weatherReplay.frames.length === 0) {
          setFittingInfo('Replay Error: 请先加载 JSON 数据。');
          setIsLiveSync(false);
          return;
        }
        setFittingInfo('开始 Historical JSON Replay…');
        weatherReplay.start();
      }
    } else if (syncMode === 'B') {
      weatherReplay.stop();
    }
  };

  const currentParams = { ...params, simTime: simTime, disableFastFading };

  // useMemo: only recompute link budget when params or simTime change
  const linkBudget = useMemo(
    () => calculateLinkBudget(currentParams),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [JSON.stringify(currentParams)]
  );
  const {
    attRain, attGas, attCloud, fadeLMS, lossFaraday, omegaDeg,
    totalLoss, xpd, actualFspl, deltaFspl,
    apparentElevation, refractionCorrection, pointingLoss, scanLoss, multipathLoss, tSky, totalAtmosphericLoss, scintLoss, scintillationSigma,
    groupDelayNs, dispersionNs, maxSymbolRateMbaud
  } = linkBudget;

  // === Dynamic Sky Noise & Absolute Received Power ===
  const k_boltzmann = 1.380649e-23;
  const tSys = (params.tRx || 150.0) + tSky + 3.0; // 3K cosmic
  const noisePowerW = k_boltzmann * tSys * ((params.bandwidth || 400.0) * 1e6);
  const noiseFloorDbm = 10 * Math.log10(noisePowerW) + 30;

  const absoluteLoss = totalAtmosphericLoss + fadeLMS + lossFaraday + pointingLoss + (scanLoss || 0) + (multipathLoss || 0) + (scintLoss || 0) + actualFspl;
  const rxPowerDbm = (params.eirp || 60.0) + 30 - absoluteLoss + (params.gRx || 42.0);

  const currentSnr = Math.max(-10.0, rxPowerDbm - noiseFloorDbm);
  const { capRank2, capRank1 } = useMemo(
    () => calculateMIMOCapacity(currentSnr, xpd),
    [currentSnr, xpd]
  );

  let recommendation = "";
  let statusClass = "ok";

  if (currentSnr < -3) {
    recommendation = "LINK BROKEN (SNR < -3dB)";
    statusClass = "alert";
  } else if (capRank2 > capRank1 * 1.05) {
    recommendation = "Use Dual Pol (Rank 2)";
    statusClass = "ok";
  } else {
    recommendation = "SWITCH TO RANK 1 (Stability)";
    statusClass = "warn";
  }

  const rainRates = Array.from({ length: 50 }, (_, i) => i * 2);

  // useMemo: rain sweep — only recompute when params change (not on every render)
  const dataRain = useMemo(
    () => rainRates.map(r => calculateLinkBudget({ ...params, rainRate: r }).totalLoss),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [JSON.stringify(params)]
  );

  const scatterData = realData.map(d => ({
    x: d.rainRate,
    y: d.derivedLoss
  }));

  const chartData = {
    labels: rainRates,
    datasets: [
      {
        type: 'line',
        label: `Theoretical Loss (k=${params.correctionFactor.toFixed(2)}) - ${params.env}`,
        data: dataRain,
        borderColor: 'rgb(255, 99, 132)',
        backgroundColor: 'rgba(255, 99, 132, 0.5)',
        order: 2,
        tension: 0.1
      },
      {
        type: 'scatter',
        label: 'Model-derived loss (weather observation input)',
        data: scatterData,
        backgroundColor: 'rgb(54, 162, 235)',
        borderColor: 'rgb(54, 162, 235)',
        pointRadius: 5,
        order: 1
      }
    ],
  };

  const freqs = [1, 2, 5, 10, 15, 20, 22.2, 25, 30, 35, 40, 45, 50, 55, 60, 65, 70];

  // useMemo: freq sweep — only recompute when params change
  const dataFreq = useMemo(
    () => freqs.map(f => calculateLinkBudget({ ...params, freq: f }).totalLoss),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [JSON.stringify(params)]
  );

  const scatterDataFreq = realData.map(d => ({
    x: d.freq || params.freq, // Support Sweep: use injected freq or fallback to global UI freq
    y: d.derivedLoss
  }));

  const chartDataFreq = {
    labels: freqs,
    datasets: [
      {
        type: 'line',
        label: `Theoretical Loss across Band (${params.env}, Rain: ${params.rainRate})`,
        data: dataFreq,
        borderColor: 'rgb(75, 192, 192)',
        backgroundColor: 'rgba(75, 192, 192, 0.5)',
        order: 2,
        tension: 0.2
      },
      {
        type: 'scatter',
        label: `Model-derived samples (not measurements)`,
        data: scatterDataFreq,
        backgroundColor: 'rgb(153, 102, 255)',
        borderColor: 'rgb(153, 102, 255)',
        pointRadius: 5,
        order: 1
      }
    ],
  };

  const displayCirTleLine1 = cirSyncState.tleLine1 || tleLine1;
  const displayCirTleLine2 = cirSyncState.tleLine2 || tleLine2;
  const displayCirGroundStation = {
    lat: cirSyncState.groundStation?.lat ?? syncLat,
    lon: cirSyncState.groundStation?.lon ?? syncLon,
    alt: cirSyncState.groundStation?.alt ?? gsAlt
  };

  const handleChannelGroundStationChange = useCallback((nextGroundStation) => {
    if (nextGroundStation?.lat != null) setSyncLat(nextGroundStation.lat);
    if (nextGroundStation?.lon != null) setSyncLon(nextGroundStation.lon);
    if (nextGroundStation?.alt != null) setGsAlt(nextGroundStation.alt);
  }, []);

  const handleCirSyncStateChange = useCallback((nextState) => {
    const mergedState = {
      ...DEFAULT_CIR_SYNC_STATE,
      ...nextState,
      samplePoints: nextState?.samplePoints || []
    };
    setCirSyncState(mergedState);
    // Remove the setRequestedCirIndex call here to prevent feedback loops during playback
    // setRequestedCirIndex(mergedState.activeIndex || 0);
  }, []);

  return (
    <div className="App">
      <div style={{ display: 'flex', justifyContent: 'center', alignItems: 'center', gap: '15px', marginBottom: '0.5rem' }}>
        <h1 style={{ margin: 0 }}>Satellite Channel Simulator</h1>
        <button
          onClick={() => setShowManual(true)}
          title="使用手册"
          style={{
            background: 'linear-gradient(135deg, #4ecdc4, #3498db)', border: 'none',
            color: '#fff', fontSize: '1em', padding: '6px 14px', borderRadius: '6px',
            cursor: 'pointer', fontWeight: 'bold', boxShadow: '0 2px 8px rgba(78,205,196,0.3)',
            marginLeft: 0
          }}
        >📖 使用手册</button>
        <button
          onClick={() => setShowApiDashboard(!showApiDashboard)}
          title="API Dashboard"
          style={{
            background: showApiDashboard ? 'linear-gradient(135deg, #00e5ff, #00b8d4)' : 'rgba(0, 229, 255, 0.15)',
            border: '1px solid rgba(0, 229, 255, 0.4)',
            color: showApiDashboard ? '#000' : 'rgba(0, 229, 255, 0.9)',
            fontSize: '1em', padding: '6px 14px', borderRadius: '6px',
            cursor: 'pointer', fontWeight: 'bold', boxShadow: showApiDashboard ? '0 2px 8px rgba(0,229,255,0.4)' : 'none'
          }}
        >🛰️ API Dashboard</button>
      </div>

      <div className="orbit-controls" style={{ padding: '15px', border: '1px solid rgba(78,205,196,0.5)', borderRadius: '5px', marginBottom: '20px', background: 'linear-gradient(135deg, #0a0a2e 0%, #1a1a3e 100%)', textAlign: 'left', color: '#eee' }}>
        <h3>🛰️ Satellite Orbit Configuration (SGP4)</h3>
        <div style={{ display: 'flex', gap: '20px', alignItems: 'center', marginBottom: '10px', flexWrap: 'wrap' }}>
          <label style={{ display: 'flex', alignItems: 'center', cursor: 'pointer' }}>
            <input type="checkbox" checked={isDynamicOrbit} onChange={e => setIsDynamicOrbit(e.target.checked)} />
            <strong style={{ marginLeft: '8px' }}>Enable Real-time Orbit Tracking</strong>
          </label>
          {/* Fast Fading Toggle moved to the same line */}
          <label style={{ display: 'flex', gap: '6px', alignItems: 'center', cursor: 'pointer' }}>
            <input type="checkbox" checked={disableFastFading} onChange={e => setDisableFastFading(e.target.checked)} />
            <span>🚫 Disable Fast Fading (Scintillation)</span>
          </label>
        </div>
        {isDynamicOrbit && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
            {/* Ground Station Configuration */}
            <div style={{ display: 'flex', gap: '10px', alignItems: 'center', flexWrap: 'wrap', padding: '8px', background: 'rgba(78,205,196,0.1)', borderRadius: '4px', border: '1px solid rgba(78,205,196,0.3)' }}>
              <strong>📍 Ground Station:</strong>
              <label>Lat:
                <input type="number" step="0.01" value={syncLat} onChange={e => setSyncLat(parseFloat(e.target.value))} style={{ width: '75px', marginLeft: '4px', fontFamily: 'monospace' }} />
              </label>
              <label>Lon:
                <input type="number" step="0.01" value={syncLon} onChange={e => setSyncLon(parseFloat(e.target.value))} style={{ width: '75px', marginLeft: '4px', fontFamily: 'monospace' }} />
              </label>
              <label>Alt (m):
                <input type="number" step="1" value={gsAlt} onChange={e => setGsAlt(parseFloat(e.target.value) || 0)} style={{ width: '65px', marginLeft: '4px', fontFamily: 'monospace' }} />
              </label>
            </div>
            
            {/* Satellite Selection + Pass Prediction (merged) */}
            <div style={{ display: 'flex', gap: '8px', alignItems: 'center', flexWrap: 'wrap' }}>
              <label style={{ whiteSpace: 'nowrap', fontWeight: 'bold' }}>📡 Quick Select:</label>
              <select onChange={handlePresetChange} style={{ padding: '4px 8px', borderRadius: '4px', minWidth: '200px' }}>
                {SAT_PRESETS.map((p, i) => <option key={i} value={i}>{p.label}</option>)}
              </select>
              {satName && <span style={{ color: '#eee', fontWeight: 'bold' }}>🛰️ {satName}</span>}
              <span style={{ borderLeft: '1px solid rgba(255,255,255,0.2)', height: '20px', margin: '0 4px' }} />
              <label style={{ fontSize: '0.85em', color: '#aaa', display: 'flex', alignItems: 'center', gap: '3px' }}>
                📅 <input type="number" min="1" max="72" value={passHours} onChange={e => setPassHours(parseInt(e.target.value) || 24)} style={{ width: '40px', fontFamily: 'monospace' }} />h
              </label>
              <button
                onClick={() => {
                  setPassComputing(true);
                  setTimeout(() => {
                    const results = predictPasses(tleLine1, tleLine2, syncLat, syncLon, gsAlt, passHours);
                    setPassData(results);
                    setPassComputing(false);
                  }, 50);
                }}
                disabled={passComputing}
                style={{ padding: '3px 10px', background: '#28a745', color: 'white', border: 'none', borderRadius: '4px', fontWeight: 'bold', cursor: passComputing ? 'wait' : 'pointer', fontSize: '0.85em' }}
              >
                {passComputing ? '⏳...' : '🔍 Predict Passes'}
              </button>
              {passData.length > 0 && <small style={{ color: '#4ecdc4' }}>{passData.length} passes found</small>}
            </div>
            {/* Milestone 19: NORAD ID + Fetch Button */}
            <div style={{ display: 'flex', gap: '8px', alignItems: 'center' }}>
              <label style={{ whiteSpace: 'nowrap', fontWeight: 'bold' }}>NORAD ID:</label>
              <input type="text" value={noradId} onChange={e => setNoradId(e.target.value)} style={{ width: '80px', fontFamily: 'monospace' }} />
              <button
                onClick={() => fetchTLE(noradId)}
                disabled={tleFetching}
                style={{ padding: '4px 12px', cursor: tleFetching ? 'wait' : 'pointer', background: '#0056b3', color: 'white', border: 'none', borderRadius: '4px', fontWeight: 'bold' }}
              >
                {tleFetching ? '⏳ Fetching...' : '🔄 Fetch Latest TLE'}
              </button>
            </div>
            {tleFetchError && <div style={{ color: 'red', fontSize: '0.85em' }}>⚠️ {tleFetchError}</div>}

            {/* Milestone 19: TLE Epoch Age Badge */}
            {tleEpochInfo.ageDays >= 0 && (() => {
              const days = tleEpochInfo.ageDays;
              const color = days > 30 ? '#dc3545' : days > 7 ? '#ffc107' : '#28a745';
              const label = days > 30 ? '❌ STALE' : days > 7 ? '⚠️ AGING' : '✅ FRESH';
              return (
                <div style={{ fontSize: '0.85em', display: 'flex', alignItems: 'center', gap: '8px' }}>
                  <span style={{ background: color, color: days > 7 && days <= 30 ? '#333' : 'white', padding: '2px 8px', borderRadius: '10px', fontWeight: 'bold', fontSize: '0.8em' }}>{label}</span>
                  <span>TLE Epoch: {tleEpochInfo.epochDate.toISOString().slice(0, 10)} ({days.toFixed(1)} days ago)</span>
                </div>
              );
            })()}

            <input type="text" value={tleLine1} onChange={e => setTleLine1(e.target.value)} placeholder="TLE Line 1" style={{ width: '100%', fontFamily: 'monospace', fontSize: '0.9em' }} />
            <input type="text" value={tleLine2} onChange={e => setTleLine2(e.target.value)} placeholder="TLE Line 2" style={{ width: '100%', fontFamily: 'monospace', fontSize: '0.9em' }} />
            
            {/* Export Actions Group */}
            <div style={{ display: 'flex', flexDirection: 'column', gap: '8px', marginTop: '8px', padding: '10px', border: '1px dashed rgba(255,193,7,0.5)', borderRadius: '5px', background: 'rgba(0,0,0,0.2)' }}>
              <strong style={{ color: '#ffc107', fontSize: '0.95em' }}>📦 Project Export & Trajectory Generation</strong>
              
              {/* Golden RT Export */}
              <div style={{ display: 'flex', gap: '8px', alignItems: 'center', flexWrap: 'wrap' }}>
                <button
                  onClick={handleExportGoldenTrajectory}
                  style={{ padding: '4px 12px', background: '#ffc107', color: '#333', border: 'none', borderRadius: '4px', fontWeight: 'bold', cursor: 'pointer' }}
                >
                  🌟 Export Golden RT Trajectory (Non-Uniform)
                </button>
                <label style={{ whiteSpace: 'nowrap', fontSize: '0.9em', color: '#ccc' }}>
                  Street Azimuth (°): <input type="number" value={streetAzimuth} onChange={e => setStreetAzimuth(e.target.value)} placeholder="e.g. 0 for N-S" style={{ width: '80px', fontFamily: 'monospace', marginLeft: '4px' }} />
                </label>
                <label style={{ display: 'flex', gap: '6px', alignItems: 'center', cursor: 'pointer', fontSize: '0.9em', color: '#f39c12', marginLeft: '8px', borderLeft: '1px solid rgba(255,255,255,0.2)', paddingLeft: '8px' }}>
                  <input type="checkbox" checked={applyEffectiveAlt} onChange={e => setApplyEffectiveAlt(e.target.checked)} />
                  <span title="Replace absolute Altitude with Effective Altitude (SlantRange * sin(Elev)) to correct delays in planar RT engines.">Apply Effective Altitude for Planar RT</span>
                </label>
                <small style={{ color: '#aaa', width: '100%' }}>Extracts 8-10 geometric key points from the best next 72h pass for external Ray-Tracing engines.</small>
              </div>

              {/* Standard WGS84 Export */}
              <div style={{ display: 'flex', gap: '8px', alignItems: 'center', flexWrap: 'wrap', marginTop: '4px' }}>
                <button
                  onClick={handleExportWgs84Trajectory}
                  style={{ padding: '4px 12px', background: '#138496', color: 'white', border: 'none', borderRadius: '4px', fontWeight: 'bold', cursor: 'pointer' }}
                >
                  ⬇️ Export Simulation Project (Dense)
                </button>
                <label style={{ fontSize: '0.85em', color: '#ccc', display: 'flex', alignItems: 'center', gap: '4px' }}>
                  间隔(ms): <input type="number" min={1} max={10000} value={denseStepMs} onChange={e => setDenseStepMs(Math.max(1, parseInt(e.target.value) || 100))} style={{ width: '65px', fontFamily: 'monospace' }} />
                </label>
                <label style={{ fontSize: '0.85em', color: '#ccc', display: 'flex', alignItems: 'center', gap: '4px' }}>
                  时长(min): <input type="number" min={0} max={120} value={denseDurationMin} onChange={e => setDenseDurationMin(Math.max(0, parseInt(e.target.value) || 0))} style={{ width: '55px', fontFamily: 'monospace' }} title="0 = 自动(整个过顶)" />
                </label>
                <label style={{ fontSize: '0.85em', color: '#ccc', display: 'flex', alignItems: 'center', gap: '4px' }}
                  title={"起始时间选择说明:\n\n留空(自动): 搜索未来72h内最高仰角的pass,从AOS前2min开始\n手动: 输入ISO 8601格式, 如 2026-03-15T12:00:00Z (UTC)\n或本地时间: 2026-03-15T20:00:00+08:00\n\n提示: 可从Pass Prediction表格复制AOS时间"}
                >
                  起始: <input type="text" value={denseStartTimeStr} onChange={e => setDenseStartTimeStr(e.target.value)} placeholder="自动(选最高pass)" style={{ width: '180px', fontFamily: 'monospace', fontSize: '0.9em' }} />
                </label>
                <small style={{ color: '#666', width: '100%' }}>间隔{denseStepMs}ms · {denseDurationMin > 0 ? denseDurationMin + 'min' : '自动整个过顶'} · {denseStartTimeStr ? '手动: ' + denseStartTimeStr : '自动: 72h内最高仰角pass'}</small>
                {activeProjectManifest && (
                  <small style={{ color: '#4ecdc4', width: '100%' }}>
                    Active Task_ID: {activeProjectManifest.Task_ID.slice(0, 8)}...
                  </small>
                )}
              </div>
            </div>

            {orbitData && (
              <div style={{ fontSize: '0.9em', color: '#4ecdc4', marginTop: '5px' }}>
                <strong>Live Tracking:</strong> Azimuth {orbitData.azimuth.toFixed(1)}° | Elevation {orbitData.elevation.toFixed(1)}° | Slant Range {orbitData.slantRange.toFixed(1)} km
              </div>
            )}
            <small style={{ color: '#888' }}>Ground Station coordinates are derived from the 'Live Sync Source' panel below.</small>

            {/* Pass Prediction results table */}
            <div style={{ marginTop: '6px', padding: '8px', borderRadius: '5px', background: 'rgba(0,0,0,0.15)' }}>
              {passData.length > 0 && (
                <div style={{ marginTop: '8px', overflowX: 'auto' }}>
                  <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '0.85em', color: '#ddd' }}>
                    <thead>
                      <tr style={{ background: 'rgba(78,205,196,0.15)', textAlign: 'left', color: '#4ecdc4' }}>
                        <th style={{ padding: '6px', border: '1px solid rgba(78,205,196,0.3)' }}>#</th>
                        <th style={{ padding: '6px', border: '1px solid rgba(78,205,196,0.3)' }}>📡 AOS (Rise)</th>
                        <th style={{ padding: '6px', border: '1px solid rgba(78,205,196,0.3)' }}>📡 TCA (Peak)</th>
                        <th style={{ padding: '6px', border: '1px solid rgba(78,205,196,0.3)' }}>📡 LOS (Set)</th>
                        <th style={{ padding: '6px', border: '1px solid rgba(78,205,196,0.3)' }}>Max Elev</th>
                        <th style={{ padding: '6px', border: '1px solid rgba(78,205,196,0.3)' }}>Duration</th>
                        <th style={{ padding: '6px', border: '1px solid rgba(78,205,196,0.3)' }}>Quality</th>
                        <th style={{ padding: '6px', border: '1px solid rgba(78,205,196,0.3)', textAlign: 'center' }}>Action</th>
                      </tr>
                    </thead>
                    <tbody>
                      {passData.map((p, i) => {
                        const quality = p.maxElev >= 45 ? '🟢 Excellent' : p.maxElev >= 20 ? '🟡 Good' : '🟠 Low';
                        const mins = Math.floor(p.durationSec / 60);
                        const secs = Math.floor(p.durationSec % 60);
                        return (
                          <tr key={i} style={{ background: i % 2 === 0 ? 'rgba(0,0,0,0.3)' : 'rgba(255,255,255,0.05)' }}>
                            <td style={{ padding: '4px 6px', border: '1px solid rgba(78,205,196,0.3)' }}>{i + 1}</td>
                            <td style={{ padding: '4px 6px', border: '1px solid rgba(78,205,196,0.3)', fontFamily: 'monospace' }}>{p.aos.toLocaleTimeString()}</td>
                            <td style={{ padding: '4px 6px', border: '1px solid rgba(78,205,196,0.3)', fontFamily: 'monospace' }}>{p.tca.toLocaleTimeString()}</td>
                            <td style={{ padding: '4px 6px', border: '1px solid rgba(78,205,196,0.3)', fontFamily: 'monospace' }}>{p.los.toLocaleTimeString()}</td>
                            <td style={{ padding: '4px 6px', border: '1px solid rgba(78,205,196,0.3)', fontWeight: 'bold', color: p.maxElev >= 45 ? '#00ff88' : p.maxElev >= 20 ? '#ffc107' : '#fd7e14' }}>{p.maxElev.toFixed(1)}°</td>
                            <td style={{ padding: '4px 6px', border: '1px solid rgba(78,205,196,0.3)' }}>{mins}m {secs}s</td>
                            <td style={{ padding: '4px 6px', border: '1px solid rgba(78,205,196,0.3)' }}>{quality}</td>
                            <td style={{ padding: '4px 6px', border: '1px solid rgba(78,205,196,0.3)', textAlign: 'center' }}>
                              <button 
                                onClick={() => handleExportGoldenTrajectory(p)}
                                style={{ padding: '2px 8px', background: '#ffc107', color: '#333', border: 'none', borderRadius: '4px', cursor: 'pointer', fontSize: '0.85em', fontWeight: 'bold' }}
                                title="Export Golden RT Trajectory for this specific pass"
                              >
                                🌟 Export Golden
                              </button>
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                  <small style={{ color: '#aaa' }}>🟢 Excellent (≥45°) | 🟡 Good (≥20°) | 🟠 Low (&lt;20°) — Found {passData.length} passes in next {passHours}h</small>
                </div>
              )}
              {passData.length === 0 && !passComputing && <small style={{ color: '#999', marginTop: '4px', display: 'block' }}>Click "Predict Passes" to scan future overflight windows.</small>}
            </div>
          </div>
        )}
      </div>

      {/* Milestone 22: Orbit Visualization */}
      {isDynamicOrbit && !cirSyncState.isStandaloneMode && (
        <div style={{ display: 'flex', gap: '15px', marginBottom: '20px', flexWrap: 'wrap' }}>
          <GroundTrackCanvas
            canvasRef={groundTrackRef}
            tleLine1={displayCirTleLine1}
            tleLine2={displayCirTleLine2}
            syncLat={displayCirGroundStation.lat}
            syncLon={displayCirGroundStation.lon}
            samplePoints={cirSyncState.samplePoints}
            activeSampleIndex={cirSyncState.activeIndex}
            onSamplePointSelect={setRequestedCirIndex}
          />
          <SkyPlotCanvas
            canvasRef={skyPlotRef}
            tleLine1={displayCirTleLine1}
            tleLine2={displayCirTleLine2}
            syncLat={displayCirGroundStation.lat}
            syncLon={displayCirGroundStation.lon}
            samplePoints={cirSyncState.samplePoints}
            activeSampleIndex={cirSyncState.activeIndex}
            onSamplePointSelect={setRequestedCirIndex}
          />
        </div>
      )}


      {/* === 统一链路参数配置区 === */}
      <div style={{ padding: '15px', border: '1px solid rgba(255,193,7,0.5)', borderRadius: '5px', marginBottom: '20px', background: 'linear-gradient(135deg, #0a0a2e 0%, #1a1a3e 100%)', textAlign: 'left', color: '#eee' }}>
        <h3 style={{ margin: '0 0 10px 0' }}>📡 Link Parameters <span style={{ fontSize: '0.7em', color: '#ffc107', fontWeight: 'normal' }}>— 全局链路参数（供所有仿真模块共用）</span></h3>
        <div style={{ display: 'flex', gap: '10px', flexWrap: 'wrap', alignItems: 'center' }}>
          <label style={{ fontSize: '0.9em', whiteSpace: 'nowrap' }}>Freq (GHz):
            <input type="number" step="0.5" value={params.freq} onChange={e => setParams({ ...params, freq: parseFloat(e.target.value) })} style={{ width: '70px', marginLeft: '4px', fontFamily: 'monospace' }} />
          </label>
          <label style={{ fontSize: '0.9em', whiteSpace: 'nowrap' }} title="Satellite Effective Isotropic Radiated Power">EIRP (dBW):
            <input type="number" step="1" value={params.eirp} onChange={e => setParams({ ...params, eirp: parseFloat(e.target.value) })} style={{ width: '60px', marginLeft: '4px', fontFamily: 'monospace' }} />
          </label>
          <label style={{ fontSize: '0.9em', whiteSpace: 'nowrap' }} title="User Terminal Antenna Gain">Rx Gain (dBi):
            <input type="number" step="1" value={params.gRx} onChange={e => setParams({ ...params, gRx: parseFloat(e.target.value) })} style={{ width: '60px', marginLeft: '4px', fontFamily: 'monospace' }} />
          </label>
          <label style={{ fontSize: '0.9em', whiteSpace: 'nowrap' }}>Rain (mm/h):
            <input type="number" step="1" min="0" max="100" value={params.rainRate} onChange={e => setParams({ ...params, rainRate: parseFloat(e.target.value) })} style={{ width: '60px', marginLeft: '4px', fontFamily: 'monospace' }} />
          </label>
          <label style={{ fontSize: '0.9em', whiteSpace: 'nowrap' }}>TEC (TECU):
            <input type="number" step="10" value={params.tec} onChange={e => setParams({ ...params, tec: parseFloat(e.target.value) })} style={{ width: '60px', marginLeft: '4px', fontFamily: 'monospace' }} />
          </label>
          <label style={{ fontSize: '0.9em', whiteSpace: 'nowrap' }} title="Channel Bandwidth">BW (MHz):
            <input type="number" step="10" value={params.bandwidth} onChange={e => setParams({ ...params, bandwidth: parseFloat(e.target.value) })} style={{ width: '65px', marginLeft: '4px', fontFamily: 'monospace' }} />
          </label>
          <label style={{ fontSize: '0.9em', whiteSpace: 'nowrap' }} title="LNA Noise Temperature">LNA T (K):
            <input type="number" step="10" value={params.tRx} onChange={e => setParams({ ...params, tRx: parseFloat(e.target.value) })} style={{ width: '60px', marginLeft: '4px', fontFamily: 'monospace' }} />
          </label>
          <label style={{ fontSize: '0.9em', whiteSpace: 'nowrap' }}>XPD (dB):
            <input type="number" step="1" value={params.xpdAnt} onChange={e => setParams({ ...params, xpdAnt: parseFloat(e.target.value) })} style={{ width: '55px', marginLeft: '4px', fontFamily: 'monospace' }} />
          </label>
          <label style={{ fontSize: '0.9em', whiteSpace: 'nowrap' }} title="Half-Power Beam Width">HPBW (°):
            <input type="number" step="0.1" value={params.hpbw} onChange={e => setParams({ ...params, hpbw: parseFloat(e.target.value) })} style={{ width: '55px', marginLeft: '4px', fontFamily: 'monospace' }} />
          </label>
          <label style={{ fontSize: '0.9em' }}>Env:
            <select value={params.env} onChange={e => setParams({ ...params, env: e.target.value })} style={{ marginLeft: '4px', padding: '2px 4px', borderRadius: '3px' }}>
              <option value="open">Open (Rural)</option>
              <option value="suburban">Suburban</option>
              <option value="urban">Urban</option>
              <option value="maritime">Maritime</option>
            </select>
          </label>
          <label style={{ fontSize: '0.9em', display: 'flex', alignItems: 'center', gap: '4px', cursor: 'pointer' }} title="Flat Panel Phased Array Broadside Scan Roll-off">
            <input type="checkbox" checked={params.isPhasedArray || false} onChange={e => setParams({ ...params, isPhasedArray: e.target.checked })} style={{ width: 'auto' }} />
            Phased Array
          </label>
        </div>
        {isDynamicOrbit && (
          <div style={{ marginTop: '6px', fontSize: '0.8em', color: '#888' }}>
            ℹ️ 仰角(Elevation)与斜距(Slant Range)由轨道实时跟踪自动更新
          </div>
        )}
      </div>

      {/* === 信道传播仿真面板 === */}
      <ChannelSimPanel
        tleLine1={tleLine1}
        tleLine2={tleLine2}
        satName={satName}
        globalParams={params}
        groundStation={{ lat: syncLat, lon: syncLon, alt: gsAlt }}
        onGroundStationChange={handleChannelGroundStationChange}
        onLinkParamsChange={nextParams => setParams(prev => ({ ...prev, ...nextParams }))}
        activeProjectManifest={activeProjectManifest}
        requestedCirIndex={requestedCirIndex}
        onCirSyncStateChange={handleCirSyncStateChange}
      />


      {/* Milestone 23: Historical Replay Panel */}
      {isDynamicOrbit && (
        <div style={{ padding: '15px', border: '1px solid #555', borderRadius: '5px', marginBottom: '20px', background: '#1a1a2e', color: '#eee', textAlign: 'left' }}>
          <h3 style={{ margin: '0 0 10px 0' }}>⏱️ Historical Replay & Channel Analysis</h3>
          <div style={{ display: 'flex', gap: '10px', alignItems: 'center', flexWrap: 'wrap', marginBottom: '10px' }}>
            <label>Start Time:
              <input type="datetime-local" value={replayStartTime} onChange={e => setReplayStartTime(e.target.value)} style={{ marginLeft: '4px' }} />
            </label>
            <label>Duration (min):
              <input type="number" min="5" max="120" value={replayMinutesAhead} onChange={e => setReplayMinutesAhead(parseInt(e.target.value) || 20)} style={{ width: '50px', marginLeft: '4px' }} />
            </label>
            <button onClick={handleGenerateReplay} style={{ padding: '4px 12px', background: '#6f42c1', color: 'white', border: 'none', borderRadius: '4px', fontWeight: 'bold', cursor: 'pointer' }}>
              📊 Generate Timeline
            </button>
            {replayTimeline.length > 0 && (
              <>
                <button onClick={() => isReplaying ? orbitReplay.stop() : orbitReplay.start()} style={{ padding: '4px 12px', background: isReplaying ? '#dc3545' : '#28a745', color: 'white', border: 'none', borderRadius: '4px', fontWeight: 'bold', cursor: 'pointer' }}>
                  {isReplaying ? '⏸ Pause' : '▶️ Play'}
                </button>
                <label style={{ fontSize: '0.85em' }}>Speed:
                  <select value={replaySpeed} onChange={e => orbitReplay.setSpeed(parseInt(e.target.value))} style={{ marginLeft: '4px' }}>
                    <option value={1}>1x</option>
                    <option value={2}>2x</option>
                    <option value={5}>5x</option>
                    <option value={10}>10x</option>
                    <option value={20}>20x</option>
                  </select>
                </label>
                <button onClick={handleExportReplay} style={{ padding: '4px 12px', background: '#17a2b8', color: 'white', border: 'none', borderRadius: '4px', fontWeight: 'bold', cursor: 'pointer' }}>
                  💾 Export CSV
                </button>
              </>
            )}
          </div>

          {replayTimeline.length > 0 && (
            <>
              {/* Time scrub slider */}
              <div style={{ display: 'flex', gap: '10px', alignItems: 'center', marginBottom: '8px' }}>
                <input type="range" min={0} max={replayTimeline.length - 1} value={replayIdx} onChange={e => orbitReplay.seek(parseInt(e.target.value))} style={{ flex: 1 }} />
                <span style={{ fontFamily: 'monospace', fontSize: '0.85em', minWidth: '180px' }}>
                  {replayTimeline[replayIdx]?.timeLabel} | El: {replayTimeline[replayIdx]?.elevation.toFixed(1)}° | Loss: {replayTimeline[replayIdx]?.totalLoss.toFixed(1)}dB
                </span>
              </div>

              {/* Dual-axis Chart: Elevation + Total Loss vs Time */}
              <div style={{ background: 'rgba(0,0,0,0.3)', borderRadius: '5px', padding: '10px' }}>
                <Line
                  data={{
                    labels: replayTimeline.map(f => f.timeLabel),
                    datasets: [
                      {
                        label: 'Elevation (°)',
                        data: replayTimeline.map(f => f.elevation),
                        borderColor: '#28a745',
                        backgroundColor: 'rgba(40,167,69,0.1)',
                        fill: true,
                        yAxisID: 'y1',
                        tension: 0.3,
                        pointRadius: 0
                      },
                      {
                        label: 'Total Path Loss (dB)',
                        data: replayTimeline.map(f => f.totalLoss),
                        borderColor: '#dc3545',
                        yAxisID: 'y2',
                        tension: 0.3,
                        pointRadius: 0
                      },
                      {
                        label: 'FSPL Δ (dB)',
                        data: replayTimeline.map(f => f.deltaFspl),
                        borderColor: '#00e5ff',
                        borderDash: [5, 3],
                        yAxisID: 'y2',
                        tension: 0.3,
                        pointRadius: 0
                      }
                    ]
                  }}
                  options={{
                    responsive: true,
                    interaction: { mode: 'index', intersect: false },
                    plugins: { legend: { position: 'top', labels: { color: '#ccc', font: { size: 11 } } }, title: { display: true, text: '⏱️ Replay: Elevation & Channel Loss vs Time', color: '#fff', font: { size: 13 } } },
                    scales: {
                      x: { display: true, title: { display: true, text: 'Time', color: '#ccc' }, ticks: { maxTicksLimit: 12, color: '#aaa' }, grid: { color: 'rgba(255,255,255,0.05)' } },
                      y1: { type: 'linear', position: 'left', title: { display: true, text: 'Elevation (°)', color: '#ccc' }, grid: { drawOnChartArea: false }, ticks: { color: '#aaa' } },
                      y2: { type: 'linear', position: 'right', title: { display: true, text: 'Loss (dB)', color: '#ccc' }, grid: { color: 'rgba(255,255,255,0.08)' }, ticks: { color: '#aaa' } }
                    }
                  }}
                />
              </div>
              <small style={{ color: '#888', marginTop: '4px', display: 'block' }}>{replayTimeline.length} frames | 10s/frame | {replayMinutesAhead} min window</small>
            </>
          )}
        </div>
      )}
      <div className="controls">
        <label>
          Elevation (Deg):
          {isDynamicOrbit ? (
            <span style={{ marginLeft: '10px', fontWeight: 'bold', color: '#0056b3' }}>{orbitData ? orbitData.elevation.toFixed(1) : '---'}° (Auto)</span>
          ) : (
            <input type="number" step="1" value={params.elevation} onChange={e => setParams({ ...params, elevation: parseFloat(e.target.value) })} />
          )}
        </label>
      </div>

      <div className="results">
        <div className="card">
          <h3 title={`T_sys = ${tSys.toFixed(1)}K (LNA ${(params.tRx || 150)}K + Sky ${tSky.toFixed(1)}K + Cosmic 3K)`}>
            Rx Pwr: {rxPowerDbm.toFixed(1)} dBm
          </h3>
          <p style={{ color: '#ff6b6b' }} title={`Noise Floor jumps dynamically as rain radiates at 290K! N0 = k*T_sys*B`}>
            <strong>Noise Floor (N₀): {noiseFloorDbm.toFixed(2)} dBm (T_sky: {tSky.toFixed(1)}K)</strong>
          </p>
          <p style={{ color: '#0056b3' }} title={`Geometric: ${params.elevation.toFixed(2)}° | Refraction Shift: +${(refractionCorrection || 0).toFixed(3)}°`}>
            Apparent Elev: {(apparentElevation || params.elevation).toFixed(2)}°
          </p>
          <p>Pointing Error Loss: {(pointingLoss || 0).toFixed(2)} dB</p>
          {params.isPhasedArray && <p style={{ color: '#ff8c00' }} title="Phased Array effective aperture reduction at low elevations">Scan Roll-off Limit: {(scanLoss || 0).toFixed(2)} dB</p>}
          <p>Rain Attenuation: {attRain.toFixed(2)} dB</p>
          <p>Gas/Cloud Loss: {(attGas + attCloud).toFixed(2)} dB</p>
          <p>Ground Shadowing: {fadeLMS.toFixed(2)} dB</p>
          {params.env === 'maritime' && <p style={{ color: '#9932cc' }} title="Two-Ray Interference Path bounds (+6dB gain to -20dB fade)">Maritime Multipath: {(multipathLoss || 0).toFixed(2)} dB</p>}
          <p style={{ color: '#e67e22' }} title={`Tropospheric & Ionospheric Turbulence (σ = ${scintillationSigma?.toFixed(2)} dB)`}>Scintillation Fading: {(scintLoss || 0).toFixed(2)} dB</p>
          <p>Faraday Loss: {lossFaraday.toFixed(2)} dB ({omegaDeg.toFixed(1)}°)</p>
          <p title="Relative to Reference GEO distance 35786km">GEO FSPL Δ: {(deltaFspl || 0).toFixed(2)} dB ({params.slantRange?.toFixed(0) || 35786} km)</p>
          <hr />
          <p title={`Absolute Loss: ${absoluteLoss.toFixed(2)} dB`}><strong>Path Loss (rel): {totalLoss.toFixed(2)} dB</strong></p>
          <p style={{ fontWeight: 'bold', fontSize: '1.2em', color: currentSnr < 0 ? 'red' : 'green' }}>
            Effective SNR: {currentSnr.toFixed(2)} dB
          </p>
        </div>

        <div className="card">
          <h3>MIMO & Capacity Limit</h3>
          <p>XPD (Depolarization): {xpd.toFixed(2)} dB</p>
          <p>Rank 2 Capacity: {capRank2.toFixed(2)} bps/Hz</p>
          <p>Rank 1 Capacity: {capRank1.toFixed(2)} bps/Hz</p>
          <p className={statusClass}>
            Recommendation: {recommendation}
          </p>
          <hr />
          <p>Group Delay: {groupDelayNs.toFixed(2)} ns</p>
          <p>Pulse Broadening: {dispersionNs.toFixed(4)} ns</p>
          {params.bandwidth > maxSymbolRateMbaud ? (
            <p style={{ color: 'red', fontWeight: 'bold' }} title="Pulse dispersion exceeds symbol duration causing severe ISI!">
              ⚠️ ISI WARNING: Max Symbol Rate bounded to {maxSymbolRateMbaud.toFixed(1)} MBaud (Requested: {params.bandwidth} MHz)
            </p>
          ) : (
            <p style={{ color: 'green' }}>Channel Coherent across {params.bandwidth} MHz (ISI limit: {maxSymbolRateMbaud > 10000 ? '>10G' : maxSymbolRateMbaud.toFixed(0)}Baud)</p>
          )}
        </div>
      </div>

      <div className="chart-container" style={{ display: 'flex', flexWrap: 'wrap', gap: '20px', marginTop: '20px' }}>
        <div style={{ flex: '1 1 45%', minWidth: '400px' }}>
          <Line
            options={{
              responsive: true,
              plugins: { legend: { position: 'top' }, title: { display: true, text: 'Attenuation vs Rain Rate' } },
              scales: {
                x: { type: 'linear', position: 'bottom', title: { display: true, text: 'Rain Rate (mm/h)' } },
                y: { title: { display: true, text: 'Total Loss (dB)' } }
              }
            }}
            data={chartData}
          />
        </div>
        <div style={{ flex: '1 1 45%', minWidth: '400px' }}>
          <Line
            options={{
              responsive: true,
              plugins: { legend: { position: 'top' }, title: { display: true, text: 'Attenuation vs Frequency' } },
              scales: {
                x: { type: 'linear', position: 'bottom', title: { display: true, text: 'Frequency (GHz)' } },
                y: { title: { display: true, text: 'Total Loss (dB)' } }
              }
            }}
            data={chartDataFreq}
          />
        </div>
      </div>

      <div className="calibration-controls">
        <h3>天气数据 & 实时同步</h3>

        <div style={{ padding: '10px' }}>
          <strong style={{ marginRight: '10px' }}>Live Sync Source:</strong>
          <label style={{ display: 'inline-block', marginRight: '10px', flexDirection: 'row', fontWeight: 'normal' }}>
            <input type="radio" value="A" checked={syncMode === 'A'} onChange={e => setSyncMode(e.target.value)} disabled={isLiveSync} />
            Open-Meteo API
          </label>
          <label style={{ display: 'inline-block', marginRight: '20px', flexDirection: 'row', fontWeight: 'normal' }}>
            <input type="radio" value="B" checked={syncMode === 'B'} onChange={e => setSyncMode(e.target.value)} disabled={isLiveSync} />
            Loaded JSON Replay
          </label>

          {syncMode === 'B' && (
            <label style={{ display: 'inline-flex', alignItems: 'center', marginRight: '16px', flexDirection: 'row', gap: '6px' }}>
              <span>JSON:</span>
              <input
                type="file"
                accept="application/json,.json"
                disabled={isLiveSync}
                onChange={async event => {
                  const file = event.target.files?.[0];
                  if (!file) return;
                  try {
                    const parsed = weatherReplay.loadText(await file.text());
                    setFittingInfo(`已加载 ${parsed.frames.length} 个回放帧；${parsed.diagnostics.length} 条来源诊断。`);
                  } catch (error) {
                    setFittingInfo(`Replay JSON 错误：${error.message}`);
                  }
                }}
                style={{ width: '220px', marginTop: 0 }}
              />
              <span style={{ color: '#4ecdc4', fontSize: '0.8em' }}>{weatherReplay.frames.length} 帧</span>
            </label>
          )}

          <span style={{ display: 'inline-flex', gap: '5px' }}>
            <input type="number" step="0.1" value={syncLat} onChange={e => setSyncLat(parseFloat(e.target.value))} placeholder="Lat" style={{ width: '80px', marginTop: 0 }} disabled={isLiveSync} />
            <input type="number" step="0.1" value={syncLon} onChange={e => setSyncLon(parseFloat(e.target.value))} placeholder="Lon" style={{ width: '80px', marginTop: 0 }} disabled={isLiveSync} />
          </span>

          <label style={{ display: 'inline-block', marginLeft: '1rem', marginTop: 0, fontWeight: 'bold', cursor: 'pointer', color: isLiveSync ? 'red' : 'green' }}>
            <input
              type="checkbox"
              checked={isLiveSync}
              onChange={handleToggleSync}
              style={{ marginRight: '5px' }}
            />
            {isLiveSync ? "STOP LIVE SYNC" : "START LIVE SYNC"}
          </label>
        </div>
        {fittingInfo && <p className="info-text">{fittingInfo}</p>}
        {realData.length > 0 && (
          <p style={{ fontSize: '0.8em', color: '#aaa' }}>
            <span style={{ color: '#4ecdc4' }}>观测输入：降水率</span>
            {' · '}
            <span style={{ color: '#f7dc6f' }}>模型派生：雨衰（synthetic-derived）</span>
            {' · '}
            有界序列 {realData.length}/3600
          </p>
        )}
      </div>

      {/* === 使用手册浮层 === */}
      {showManual && <UserManual onClose={() => setShowManual(false)} />}
      {showApiDashboard && <ApiDashboard />}

    </div>
  );
}

export default App;
