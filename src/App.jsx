import React, { useState, useEffect, useRef, useCallback } from 'react';
import { Chart as ChartJS, CategoryScale, LinearScale, PointElement, LineElement, BarElement, BarController, Title, Tooltip, Legend, ScatterController } from 'chart.js';
import { Line, Scatter } from 'react-chartjs-2';
import './App.css';
import { calculateLinkBudget, calculateMIMOCapacity, fitModelToData, calibrateModel, applyCalibration, createDefaultCalibration, calculateDynamicOrbit, predictPasses, computeGroundTrack, computeSkyTrack, generatePassReplay } from './model';
import ChannelSimPanel from './ChannelSimPanel';
import UserManual from './UserManual';

ChartJS.register(CategoryScale, LinearScale, PointElement, LineElement, BarElement, BarController, Title, Tooltip, Legend, ScatterController);


// === Milestone 22: Ground Track Canvas Component ===
function GroundTrackCanvas({ canvasRef, tleLine1, tleLine2, syncLat, syncLon }) {
  const localRef = useRef(null);
  const ref = canvasRef || localRef;

  useEffect(() => {
    const canvas = ref.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    const W = canvas.width, H = canvas.height;

    function draw() {
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
      if (points.length < 2) return;

      // Draw track
      let currentPt = null;
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

      // Title
      ctx.fillStyle = '#fff'; ctx.font = 'bold 12px sans-serif';
      ctx.fillText('\ud83c\udf0d Ground Track (Equirectangular)', 8, 16);
    }

    draw();
    const timer = setInterval(draw, 5000);
    return () => clearInterval(timer);
  }, [tleLine1, tleLine2, syncLat, syncLon]);

  return <canvas ref={ref} width={560} height={280} style={{ border: '1px solid #333', borderRadius: '5px', flex: '1 1 540px', minWidth: '300px' }} />;
}

// === Milestone 22: Sky Plot Canvas Component ===
function SkyPlotCanvas({ canvasRef, tleLine1, tleLine2, syncLat, syncLon }) {
  const localRef = useRef(null);
  const ref = canvasRef || localRef;

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
      if (points.length < 2) return;

      let currentPt = null;
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

      // Title
      ctx.fillStyle = '#fff'; ctx.font = 'bold 12px sans-serif';
      ctx.textAlign = 'left';
      ctx.fillText('\ud83c\udf1f Sky Plot (Polar)', 8, 16);
    }

    draw();
    const timer = setInterval(draw, 5000);
    return () => clearInterval(timer);
  }, [tleLine1, tleLine2, syncLat, syncLon]);

  return <canvas ref={ref} width={300} height={300} style={{ border: '1px solid #333', borderRadius: '5px', flex: '0 0 300px' }} />;
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
    rainRate: 20.0,
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
  const [syncLat, setSyncLat] = useState(22.54);
  const [syncLon, setSyncLon] = useState(114.05);
  const [gsAlt, setGsAlt] = useState(0); // Ground Station altitude in meters
  const [disableFastFading, setDisableFastFading] = useState(false);

  const [replayData, setReplayData] = useState([]);
  const [replayIndex, setReplayIndex] = useState(0);

  // Orbital Mechanics Controls
  const ISS_TLE1 = '1 25544U 98067A   23249.52157811  .00018042  00000-0  32479-3 0  9997';
  const ISS_TLE2 = '2 25544  51.6420 330.1245 0005273  19.5398  65.7335 15.49841804414341';
  const [tleLine1, setTleLine1] = useState(ISS_TLE1);
  const [tleLine2, setTleLine2] = useState(ISS_TLE2);
  const [isDynamicOrbit, setIsDynamicOrbit] = useState(false);
  const [showManual, setShowManual] = useState(false);
  const [orbitData, setOrbitData] = useState(null);
  const [passData, setPassData] = useState([]);
  const [passComputing, setPassComputing] = useState(false);
  const [passHours, setPassHours] = useState(24);

  // === Milestone 22: Visualization Refs ===
  const groundTrackRef = useRef(null);
  const skyPlotRef = useRef(null);

  // === Milestone 23: Replay State ===
  const [replayTimeline, setReplayTimeline] = useState([]);
  const [replayIdx, setReplayIdx] = useState(0);
  const [isReplaying, setIsReplaying] = useState(false);
  const [replaySpeed, setReplaySpeed] = useState(5);
  const replayTimerRef = useRef(null);
  const [replayMinutesAhead, setReplayMinutesAhead] = useState(20);

  // Replay animation effect
  useEffect(() => {
    if (isReplaying && replayTimeline.length > 0) {
      replayTimerRef.current = setInterval(() => {
        setReplayIdx(prev => {
          if (prev >= replayTimeline.length - 1) { setIsReplaying(false); return prev; }
          return prev + 1;
        });
      }, 1000 / replaySpeed);
    }
    return () => clearInterval(replayTimerRef.current);
  }, [isReplaying, replaySpeed, replayTimeline.length]);

  // Sync replay frame to link params
  useEffect(() => {
    if (replayTimeline.length > 0 && replayIdx < replayTimeline.length) {
      const frame = replayTimeline[replayIdx];
      setParams(prev => ({ ...prev, elevation: Math.max(0.1, frame.elevation), slantRange: frame.slantRange }));
    }
  }, [replayIdx, replayTimeline]);

  function handleGenerateReplay() {
    const now = new Date();
    const end = new Date(now.getTime() + replayMinutesAhead * 60000);
    const tl = generatePassReplay(tleLine1, tleLine2, syncLat, syncLon, gsAlt, now, end, 10, params);
    setReplayTimeline(tl);
    setReplayIdx(0);
    setIsReplaying(false);
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
  const [satName, setSatName] = useState('ISS (ZARYA)');
  const [noradId, setNoradId] = useState('25544');
  const [tleFetching, setTleFetching] = useState(false);
  const [tleFetchError, setTleFetchError] = useState('');

  // === Milestone 20: Satellite Preset Catalog ===
  const SAT_PRESETS = [
    { label: '--- 选择卫星 ---', id: '', name: '' },
    { label: '🇨🇳 CSS (中国空间站/天和)', id: '48274', name: 'CSS' },
    { label: '🇨🇳 千帆-1 (G60/垣信)', id: '', name: 'QIANFAN-1' },
    { label: '🇨🇳 千帆-7 (G60/垣信)', id: '', name: 'QIANFAN-7' },
    { label: '🇨🇳 千帆-19 (G60/垣信)', id: '', name: 'QIANFAN-19' },
    { label: '🇨🇳 北斗-3 M1', id: '43001', name: '' },
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
      const yearStr = tle1.substring(18, 20);
      const dayStr = tle1.substring(20, 32);
      const year2d = parseInt(yearStr);
      const fullYear = year2d >= 57 ? 1900 + year2d : 2000 + year2d;
      const dayOfYear = parseFloat(dayStr);
      const epochDate = new Date(Date.UTC(fullYear, 0, 1));
      epochDate.setTime(epochDate.getTime() + (dayOfYear - 1) * 86400000);
      const ageDays = (Date.now() - epochDate.getTime()) / 86400000;
      return { epochDate, ageDays };
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
  }, [isDynamicOrbit, tleLine1, tleLine2, syncLat, syncLon]);

  // Live Sync Effect (Client-Side Only)
  useEffect(() => {
    let intervalId;

    if (isLiveSync) {
      if (syncMode === 'A') {
        const fetchWeather = async () => {
          try {
            const url = `https://api.open-meteo.com/v1/forecast?latitude=${syncLat}&longitude=${syncLon}&current=precipitation&timezone=auto`;
            const res = await fetch(url);
            const data = await res.json();
            const rain_rate = data?.current?.precipitation || 0;

            const theoretical_loss_ku = 0.018 * Math.pow(rain_rate, 1.15) * 5.0;
            const noise = (Math.random() * 1.0) - 0.5;
            const measuredLoss = Math.max(0, theoretical_loss_ku + noise);

            setRealData(prev => [...prev, { rainRate: rain_rate, measuredLoss }]);
            setFittingInfo(`[Live API] Lat ${syncLat}, Lon ${syncLon} -> Rain: ${rain_rate} mm/h`);
          } catch (e) {
            setFittingInfo("[Live API Error] " + e.message);
            setIsLiveSync(false);
          }
        };

        setFittingInfo(`Connecting to Open-Meteo API...`);
        fetchWeather();
        intervalId = setInterval(fetchWeather, 10000);

      } else if (syncMode === 'B') {
        if (replayData.length === 0) {
          setFittingInfo("Replay Error: No JSON data loaded.");
          setIsLiveSync(false);
          return;
        }

        setFittingInfo("Starting Historical Data Replay...");
        intervalId = setInterval(() => {
          setReplayIndex(prevIdx => {
            if (prevIdx < replayData.length) {
              const point = replayData[prevIdx];
              setRealData(prev => [...prev, { rainRate: point.rainRate, measuredLoss: point.measuredLoss }]);
              setFittingInfo(`[Replay Mode] Sent Frame ${prevIdx + 1}/${replayData.length}`);
              return prevIdx + 1;
            } else {
              setFittingInfo("Replay Finished.");
              setIsLiveSync(false);
              return prevIdx;
            }
          });
        }, 1000);
      }
    }

    return () => clearInterval(intervalId);
  }, [isLiveSync, syncMode, syncLat, syncLon, replayData]);

  const handleToggleSync = (e) => {
    const checked = e.target.checked;
    setIsLiveSync(checked);
    if (checked) {
      setRealData([]);
      if (syncMode === 'B') {
        setReplayIndex(0);
      }
    }
  };

  const currentParams = { ...params, simTime: simTime, disableFastFading };
  const {
    attRain, attGas, attCloud, fadeLMS, lossFaraday, omegaDeg,
    totalLoss, xpd, actualFspl, deltaFspl,
    apparentElevation, refractionCorrection, pointingLoss, scanLoss, multipathLoss, tSky, totalAtmosphericLoss, scintLoss, scintillationSigma,
    groupDelayNs, dispersionNs, maxSymbolRateMbaud
  } = calculateLinkBudget(currentParams);

  // === Dynamic Sky Noise & Absolute Received Power ===
  const k_boltzmann = 1.380649e-23;
  const tSys = (params.tRx || 150.0) + tSky + 3.0; // 3K cosmic
  const noisePowerW = k_boltzmann * tSys * ((params.bandwidth || 400.0) * 1e6);
  const noiseFloorDbm = 10 * Math.log10(noisePowerW) + 30;

  const absoluteLoss = totalAtmosphericLoss + fadeLMS + lossFaraday + pointingLoss + (scanLoss || 0) + (multipathLoss || 0) + (scintLoss || 0) + actualFspl;
  const rxPowerDbm = (params.eirp || 60.0) + 30 - absoluteLoss + (params.gRx || 42.0);

  const currentSnr = Math.max(-10.0, rxPowerDbm - noiseFloorDbm);
  const { capRank2, capRank1 } = calculateMIMOCapacity(currentSnr, xpd);

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

  const handleFileUpload = (event) => {
    const file = event.target.files[0];
    if (!file) return;

    const reader = new FileReader();
    reader.onload = (e) => {
      try {
        const json = JSON.parse(e.target.result);
        if (Array.isArray(json)) {
          setReplayData(json);
          setRealData(json);
          setFittingInfo(`Loaded ${json.length} data points into Replay/Static Buffer.`);
        } else {
          setFittingInfo("Invalid JSON format. Expected an array of objects.");
        }
      } catch (err) {
        setFittingInfo("Error parsing JSON file: " + err.message);
      }
    };
    reader.readAsText(file);
  };

  const triggerCalibration = () => {
    if (realData.length === 0) {
      setFittingInfo("No real data to calibrate against!");
      return;
    }
    const bestFactor = fitModelToData(realData, params);
    setParams(prev => ({ ...prev, correctionFactor: bestFactor }));
    setFittingInfo(`Calibrated! New Correction Factor: ${bestFactor.toFixed(3)}`);
  };

  const rainRates = Array.from({ length: 50 }, (_, i) => i * 2);

  const dataRain = rainRates.map(r => {
    const res = calculateLinkBudget({ ...params, rainRate: r });
    return res.totalLoss;
  });

  const scatterData = realData.map(d => ({
    x: d.rainRate,
    y: d.measuredLoss
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
        label: 'Real Measurement Data',
        data: scatterData,
        backgroundColor: 'rgb(54, 162, 235)',
        borderColor: 'rgb(54, 162, 235)',
        pointRadius: 5,
        order: 1
      }
    ],
  };

  const freqs = [1, 2, 5, 10, 15, 20, 22.2, 25, 30, 35, 40, 45, 50, 55, 60, 65, 70];
  const dataFreq = freqs.map(f => {
    const res = calculateLinkBudget({ ...params, freq: f });
    return res.totalLoss;
  });

  const scatterDataFreq = realData.map(d => ({
    x: d.freq || params.freq, // Support Sweep: use injected freq or fallback to global UI freq
    y: d.measuredLoss
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
        label: `Scatter Measurements (Multi-Freq Capable)`,
        data: scatterDataFreq,
        backgroundColor: 'rgb(153, 102, 255)',
        borderColor: 'rgb(153, 102, 255)',
        pointRadius: 5,
        order: 1
      }
    ],
  };

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
      </div>
      <p>Simulating Rain Fade & Depolarization (Ka-Band Example) with Data Calibration</p>

      <div className="orbit-controls" style={{ padding: '15px', border: '1px solid #ccc', borderRadius: '5px', marginBottom: '20px', background: '#f9f9f9', textAlign: 'left' }}>
        <h3>🛰️ Satellite Orbit Configuration (SGP4)</h3>
        <label style={{ display: 'block', marginBottom: '10px', cursor: 'pointer' }}>
          <input type="checkbox" checked={isDynamicOrbit} onChange={e => setIsDynamicOrbit(e.target.checked)} />
          <strong style={{ marginLeft: '8px' }}>Enable Real-time Orbit Tracking</strong>
        </label>
        {isDynamicOrbit && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
            {/* Ground Station Configuration */}
            <div style={{ display: 'flex', gap: '10px', alignItems: 'center', flexWrap: 'wrap', padding: '8px', background: '#e8f4fd', borderRadius: '4px', border: '1px solid #b8daff' }}>
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
            {/* Fast Fading Toggle */}
            <label style={{ display: 'flex', gap: '6px', alignItems: 'center', cursor: 'pointer' }}>
              <input type="checkbox" checked={disableFastFading} onChange={e => setDisableFastFading(e.target.checked)} />
              <span>🚫 Disable Fast Fading (Scintillation)</span>
              <small style={{ color: '#888' }}>— recommended for smooth replay</small>
            </label>
            {/* Milestone 20: Satellite Preset Dropdown */}
            <div style={{ display: 'flex', gap: '8px', alignItems: 'center', flexWrap: 'wrap' }}>
              <label style={{ whiteSpace: 'nowrap', fontWeight: 'bold' }}>📡 Quick Select:</label>
              <select onChange={handlePresetChange} style={{ padding: '4px 8px', borderRadius: '4px', minWidth: '200px' }}>
                {SAT_PRESETS.map((p, i) => <option key={i} value={i}>{p.label}</option>)}
              </select>
              {satName && <span style={{ color: '#333', fontWeight: 'bold' }}>🛰️ {satName}</span>}
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
            {orbitData && (
              <div style={{ fontSize: '0.9em', color: '#0056b3', marginTop: '5px' }}>
                <strong>Live Tracking:</strong> Azimuth {orbitData.azimuth.toFixed(1)}° | Elevation {orbitData.elevation.toFixed(1)}° | Slant Range {orbitData.slantRange.toFixed(1)} km
              </div>
            )}
            <small style={{ color: '#888' }}>Ground Station coordinates are derived from the 'Live Sync Source' panel below.</small>

            {/* Milestone 21: Pass Prediction */}
            <div style={{ marginTop: '10px', padding: '10px', border: '1px dashed #aaa', borderRadius: '5px', background: '#fff' }}>
              <div style={{ display: 'flex', gap: '8px', alignItems: 'center', flexWrap: 'wrap' }}>
                <strong>📅 Pass Prediction</strong>
                <label>Hours ahead:
                  <input type="number" min="1" max="72" value={passHours} onChange={e => setPassHours(parseInt(e.target.value) || 24)} style={{ width: '50px', marginLeft: '4px' }} />
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
                  style={{ padding: '4px 12px', background: '#28a745', color: 'white', border: 'none', borderRadius: '4px', fontWeight: 'bold', cursor: passComputing ? 'wait' : 'pointer' }}
                >
                  {passComputing ? '⏳ Computing...' : '🔍 Predict Passes'}
                </button>
              </div>
              {passData.length > 0 && (
                <div style={{ marginTop: '8px', overflowX: 'auto' }}>
                  <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '0.85em' }}>
                    <thead>
                      <tr style={{ background: '#e9ecef', textAlign: 'left' }}>
                        <th style={{ padding: '6px', border: '1px solid #dee2e6' }}>#</th>
                        <th style={{ padding: '6px', border: '1px solid #dee2e6' }}>📡 AOS (Rise)</th>
                        <th style={{ padding: '6px', border: '1px solid #dee2e6' }}>📡 TCA (Peak)</th>
                        <th style={{ padding: '6px', border: '1px solid #dee2e6' }}>📡 LOS (Set)</th>
                        <th style={{ padding: '6px', border: '1px solid #dee2e6' }}>Max Elev</th>
                        <th style={{ padding: '6px', border: '1px solid #dee2e6' }}>Duration</th>
                        <th style={{ padding: '6px', border: '1px solid #dee2e6' }}>Quality</th>
                      </tr>
                    </thead>
                    <tbody>
                      {passData.map((p, i) => {
                        const quality = p.maxElev >= 45 ? '🟢 Excellent' : p.maxElev >= 20 ? '🟡 Good' : '🟠 Low';
                        const mins = Math.floor(p.durationSec / 60);
                        const secs = Math.floor(p.durationSec % 60);
                        return (
                          <tr key={i} style={{ background: i % 2 === 0 ? '#fff' : '#f8f9fa' }}>
                            <td style={{ padding: '4px 6px', border: '1px solid #dee2e6' }}>{i + 1}</td>
                            <td style={{ padding: '4px 6px', border: '1px solid #dee2e6', fontFamily: 'monospace' }}>{p.aos.toLocaleTimeString()}</td>
                            <td style={{ padding: '4px 6px', border: '1px solid #dee2e6', fontFamily: 'monospace' }}>{p.tca.toLocaleTimeString()}</td>
                            <td style={{ padding: '4px 6px', border: '1px solid #dee2e6', fontFamily: 'monospace' }}>{p.los.toLocaleTimeString()}</td>
                            <td style={{ padding: '4px 6px', border: '1px solid #dee2e6', fontWeight: 'bold', color: p.maxElev >= 45 ? '#28a745' : p.maxElev >= 20 ? '#ffc107' : '#fd7e14' }}>{p.maxElev.toFixed(1)}°</td>
                            <td style={{ padding: '4px 6px', border: '1px solid #dee2e6' }}>{mins}m {secs}s</td>
                            <td style={{ padding: '4px 6px', border: '1px solid #dee2e6' }}>{quality}</td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                  <small style={{ color: '#666' }}>🟢 Excellent (≥45°) | 🟡 Good (≥20°) | 🟠 Low (&lt;20°) — Found {passData.length} passes in next {passHours}h</small>
                </div>
              )}
              {passData.length === 0 && !passComputing && <small style={{ color: '#999', marginTop: '4px', display: 'block' }}>Click "Predict Passes" to scan future overflight windows.</small>}
            </div>
          </div>
        )}
      </div>

      {/* Milestone 22: Orbit Visualization */}
      {isDynamicOrbit && (
        <div style={{ display: 'flex', gap: '15px', marginBottom: '20px', flexWrap: 'wrap' }}>
          <GroundTrackCanvas canvasRef={groundTrackRef} tleLine1={tleLine1} tleLine2={tleLine2} syncLat={syncLat} syncLon={syncLon} />
          <SkyPlotCanvas canvasRef={skyPlotRef} tleLine1={tleLine1} tleLine2={tleLine2} syncLat={syncLat} syncLon={syncLon} />
        </div>
      )}

      {/* Milestone 23: Historical Replay Panel */}
      {isDynamicOrbit && (
        <div style={{ padding: '15px', border: '1px solid #555', borderRadius: '5px', marginBottom: '20px', background: '#1a1a2e', color: '#eee', textAlign: 'left' }}>
          <h3 style={{ margin: '0 0 10px 0' }}>⏱️ Historical Replay & Channel Analysis</h3>
          <div style={{ display: 'flex', gap: '10px', alignItems: 'center', flexWrap: 'wrap', marginBottom: '10px' }}>
            <label>Duration (min):
              <input type="number" min="5" max="120" value={replayMinutesAhead} onChange={e => setReplayMinutesAhead(parseInt(e.target.value) || 20)} style={{ width: '50px', marginLeft: '4px' }} />
            </label>
            <button onClick={handleGenerateReplay} style={{ padding: '4px 12px', background: '#6f42c1', color: 'white', border: 'none', borderRadius: '4px', fontWeight: 'bold', cursor: 'pointer' }}>
              📊 Generate Timeline
            </button>
            {replayTimeline.length > 0 && (
              <>
                <button onClick={() => setIsReplaying(!isReplaying)} style={{ padding: '4px 12px', background: isReplaying ? '#dc3545' : '#28a745', color: 'white', border: 'none', borderRadius: '4px', fontWeight: 'bold', cursor: 'pointer' }}>
                  {isReplaying ? '⏸ Pause' : '▶️ Play'}
                </button>
                <label style={{ fontSize: '0.85em' }}>Speed:
                  <select value={replaySpeed} onChange={e => setReplaySpeed(parseInt(e.target.value))} style={{ marginLeft: '4px' }}>
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
                <input type="range" min={0} max={replayTimeline.length - 1} value={replayIdx} onChange={e => { setIsReplaying(false); setReplayIdx(parseInt(e.target.value)); }} style={{ flex: 1 }} />
                <span style={{ fontFamily: 'monospace', fontSize: '0.85em', minWidth: '180px' }}>
                  {replayTimeline[replayIdx]?.timeLabel} | El: {replayTimeline[replayIdx]?.elevation.toFixed(1)}° | Loss: {replayTimeline[replayIdx]?.totalLoss.toFixed(1)}dB
                </span>
              </div>

              {/* Dual-axis Chart: Elevation + Total Loss vs Time */}
              <div style={{ background: '#fff', borderRadius: '5px', padding: '10px' }}>
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
                        borderColor: '#007bff',
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
                    plugins: { legend: { position: 'top' }, title: { display: true, text: '⏱️ Replay: Elevation & Channel Loss vs Time' } },
                    scales: {
                      x: { display: true, title: { display: true, text: 'Time' }, ticks: { maxTicksLimit: 12 } },
                      y1: { type: 'linear', position: 'left', title: { display: true, text: 'Elevation (°)' }, grid: { drawOnChartArea: false } },
                      y2: { type: 'linear', position: 'right', title: { display: true, text: 'Loss (dB)' } }
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
          Frequency (GHz):
          <input type="number" step="0.5" value={params.freq} onChange={e => setParams({ ...params, freq: parseFloat(e.target.value) })} />
        </label>
        <label>
          Rain Rate (mm/h):
          <input type="range" min="0" max="100" value={params.rainRate} onChange={e => setParams({ ...params, rainRate: parseFloat(e.target.value) })} />
          <span>{params.rainRate} mm/h</span>
        </label>
        <label>
          Elevation (Deg):
          {isDynamicOrbit ? (
            <span style={{ marginLeft: '10px', fontWeight: 'bold', color: '#0056b3' }}>{orbitData ? orbitData.elevation.toFixed(1) : '---'}° (Auto)</span>
          ) : (
            <input type="number" step="1" value={params.elevation} onChange={e => setParams({ ...params, elevation: parseFloat(e.target.value) })} />
          )}
        </label>
        <label title="Satellite Effective Isotropic Radiated Power">
          EIRP (dBW):
          <input type="number" step="1" value={params.eirp !== undefined ? params.eirp : 60.0} onChange={e => setParams({ ...params, eirp: parseFloat(e.target.value) })} />
        </label>
        <label title="User Terminal Antenna Gain">
          Rx Gain (dBi):
          <input type="number" step="1" value={params.gRx !== undefined ? params.gRx : 42.0} onChange={e => setParams({ ...params, gRx: parseFloat(e.target.value) })} />
        </label>
        <label title="User Terminal LNA Noise Temperature">
          LNA T (K):
          <input type="number" step="10" value={params.tRx !== undefined ? params.tRx : 150.0} onChange={e => setParams({ ...params, tRx: parseFloat(e.target.value) })} />
        </label>
        <label title="Channel Bandwidth in MHz">
          Bandwidth (MHz):
          <input type="number" step="10" value={params.bandwidth !== undefined ? params.bandwidth : 400.0} onChange={e => setParams({ ...params, bandwidth: parseFloat(e.target.value) })} />
        </label>
        <label>
          TEC (TECU):
          <input type="number" step="10" value={params.tec} onChange={e => setParams({ ...params, tec: parseFloat(e.target.value) })} />
        </label>
        <label>
          Antenna XPD (dB):
          <input type="number" step="1" value={params.xpdAnt} onChange={e => setParams({ ...params, xpdAnt: parseFloat(e.target.value) })} />
        </label>
        <label title="Terminal Half-Power Beam Width">
          Antenna HPBW (°):
          <input type="number" step="0.1" value={params.hpbw !== undefined ? params.hpbw : 2.0} onChange={e => setParams({ ...params, hpbw: parseFloat(e.target.value) })} />
        </label>
        <label title="Enable Flat Panel Phased Array Broadside Scan Roll-off">
          <input type="checkbox" checked={params.isPhasedArray || false} onChange={e => setParams({ ...params, isPhasedArray: e.target.checked })} style={{ width: 'auto', marginRight: '5px' }} />
          Phased Array Terminal
        </label>
        <label>
          Environment:
          <select value={params.env} onChange={e => setParams({ ...params, env: e.target.value })}>
            <option value="open">Open (Rural)</option>
            <option value="suburban">Suburban (Trees)</option>
            <option value="urban">Urban (Buildings)</option>
            <option value="maritime">Maritime (Flat Sea)</option>
          </select>
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
      </div>

      {/* === 信道传播仿真面板 === */}
      {isDynamicOrbit && (
        <ChannelSimPanel
          tleLine1={tleLine1}
          tleLine2={tleLine2}
          satName={satName}
          globalParams={params}
        />
      )}

      {/* === 使用手册浮层 === */}
      {showManual && <UserManual onClose={() => setShowManual(false)} />}

    </div>
  );
}

export default App;
