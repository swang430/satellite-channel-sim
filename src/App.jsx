import React, { useState, useEffect } from 'react';
import { Chart as ChartJS, CategoryScale, LinearScale, PointElement, LineElement, Title, Tooltip, Legend } from 'chart.js';
import { Line } from 'react-chartjs-2';
import './App.css';
import { calculateLinkBudget, calculateMIMOCapacity, fitModelToData, calculateDynamicOrbit } from './model';

ChartJS.register(CategoryScale, LinearScale, PointElement, LineElement, Title, Tooltip, Legend);

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

  const [replayData, setReplayData] = useState([]);
  const [replayIndex, setReplayIndex] = useState(0);

  // Orbital Mechanics Controls
  const ISS_TLE1 = '1 25544U 98067A   23249.52157811  .00018042  00000-0  32479-3 0  9997';
  const ISS_TLE2 = '2 25544  51.6420 330.1245 0005273  19.5398  65.7335 15.49841804414341';
  const [tleLine1, setTleLine1] = useState(ISS_TLE1);
  const [tleLine2, setTleLine2] = useState(ISS_TLE2);
  const [isDynamicOrbit, setIsDynamicOrbit] = useState(false);
  const [orbitData, setOrbitData] = useState(null);

  // Dynamic Orbit Ticker
  useEffect(() => {
    let intervalId;
    if (isDynamicOrbit) {
      intervalId = setInterval(() => {
        const result = calculateDynamicOrbit(tleLine1, tleLine2, syncLat, syncLon, 0, new Date());
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

  const currentParams = { ...params, simTime: simTime };
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
      <h1>Satellite Channel Simulator</h1>
      <p>Simulating Rain Fade & Depolarization (Ka-Band Example) with Data Calibration</p>

      <div className="orbit-controls" style={{ padding: '15px', border: '1px solid #ccc', borderRadius: '5px', marginBottom: '20px', background: '#f9f9f9', textAlign: 'left' }}>
        <h3>Satellite Orbit Configuration (SGP4)</h3>
        <label style={{ display: 'block', marginBottom: '10px', cursor: 'pointer' }}>
          <input type="checkbox" checked={isDynamicOrbit} onChange={e => setIsDynamicOrbit(e.target.checked)} />
          <strong style={{ marginLeft: '8px' }}>Enable Real-time Orbit Tracking</strong>
        </label>
        {isDynamicOrbit && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
            <input type="text" value={tleLine1} onChange={e => setTleLine1(e.target.value)} placeholder="TLE Line 1" style={{ width: '100%', fontFamily: 'monospace', fontSize: '0.9em' }} />
            <input type="text" value={tleLine2} onChange={e => setTleLine2(e.target.value)} placeholder="TLE Line 2" style={{ width: '100%', fontFamily: 'monospace', fontSize: '0.9em' }} />
            {orbitData && (
              <div style={{ fontSize: '0.9em', color: '#0056b3', marginTop: '5px' }}>
                <strong>Live Tracking:</strong> Azimuth {orbitData.azimuth.toFixed(1)}° | Elevation {orbitData.elevation.toFixed(1)}° | Slant Range {orbitData.slantRange.toFixed(1)} km
              </div>
            )}
            <small style={{ color: '#888' }}>Ground Station coordinates are derived from the 'Live Sync Source' panel below.</small>
          </div>
        )}
      </div>

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

      <div className="calibration-controls">
        <h3>Calibration & Data Import</h3>

        <div style={{ display: 'flex', gap: '10px', alignItems: 'center', flexWrap: 'wrap' }}>
          <input type="file" accept=".json" onChange={handleFileUpload} />
          <button onClick={triggerCalibration} disabled={realData.length === 0}>
            Run Model Calibration
          </button>
        </div>

        <div style={{ marginTop: '15px', padding: '10px', borderTop: '1px solid #ddd' }}>
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
            {isLiveSync ? "STOP LIVE SONYC" : "START LIVE SYNC"}
          </label>
        </div>
        {fittingInfo && <p className="info-text">{fittingInfo}</p>}
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

    </div>
  );
}

export default App;
