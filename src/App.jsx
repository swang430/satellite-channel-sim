
import React, { useState } from 'react';
import { Chart as ChartJS, CategoryScale, LinearScale, PointElement, LineElement, Title, Tooltip, Legend } from 'chart.js';
import { Line } from 'react-chartjs-2';
import './App.css';

ChartJS.register(CategoryScale, LinearScale, PointElement, LineElement, Title, Tooltip, Legend);

function App() {
  const [params, setParams] = useState({
    freq: 30.0,
    rainRate: 20.0,
    elevation: 40.0,
    env: 'suburban'
  });

  // Calculate Link Budget
  const { attRain, attGas, attCloud, fadeLMS, totalLoss, xpd } = calculateLinkBudget(params);
  
  // Calculate Capacity (Example SNR)
  const baseSnr = 25.0; // Clear Sky
  const currentSnr = Math.max(-10.0, baseSnr - totalLoss);
  const { capRank2, capRank1 } = calculateMIMOCapacity(currentSnr, xpd);

  // Recommendation Logic
  let recommendation = "";
  let statusClass = "ok";

  if (currentSnr < -3) {
    recommendation = "LINK BROKEN (SNR < -3dB)";
    statusClass = "alert";
  } else if (capRank2 > capRank1 * 1.05) { 
    // Hysteresis: Rank 2 must be >5% better than Rank 1 to justify complexity
    recommendation = "Use Dual Pol (Rank 2)";
    statusClass = "ok";
  } else {
    recommendation = "SWITCH TO RANK 1 (Stability)";
    statusClass = "warn";
  }

  // Prepare Chart Data (Rain Sweep)
  const rainRates = Array.from({ length: 50 }, (_, i) => i * 2);
  const dataRain = rainRates.map(r => {
    const res = calculateLinkBudget({ ...params, rainRate: r });
    return res.totalLoss;
  });

  const chartData = {
    labels: rainRates,
    datasets: [
      {
        label: `Total Attenuation (dB) - ${params.env}`,
        data: dataRain,
        borderColor: 'rgb(255, 99, 132)',
        backgroundColor: 'rgba(255, 99, 132, 0.5)',
      }
    ],
  };

  return (
    <div className="App">
      <h1>Satellite Channel Simulator</h1>
      <p>Simulating Rain Fade & Depolarization (Ka-Band Example)</p>
      
      <div className="controls">
        <label>
          Frequency (GHz):
          <input type="number" value={params.freq} onChange={e => setParams({...params, freq: parseFloat(e.target.value)})} />
        </label>
        <label>
          Rain Rate (mm/h):
          <input type="range" min="0" max="100" value={params.rainRate} onChange={e => setParams({...params, rainRate: parseFloat(e.target.value)})} />
          <span>{params.rainRate} mm/h</span>
        </label>
        <label>
          Environment:
          <select value={params.env} onChange={e => setParams({...params, env: e.target.value})}>
            <option value="open">Open (Rural)</option>
            <option value="suburban">Suburban (Trees)</option>
            <option value="urban">Urban (Buildings)</option>
          </select>
        </label>
      </div>

      <div className="results">
        <div className="card">
          <h3>Link Budget</h3>
          <p>Rain Attenuation: {attRain.toFixed(2)} dB</p>
          <p>Gas/Cloud Loss: {(attGas + attCloud).toFixed(2)} dB</p>
          <p>Ground Shadowing: {fadeLMS.toFixed(2)} dB</p>
          <hr/>
          <p><strong>Total Loss: {totalLoss.toFixed(2)} dB</strong></p>
          <p>Effective SNR: {currentSnr.toFixed(2)} dB</p>
        </div>

        <div className="card">
          <h3>MIMO Performance</h3>
          <p>XPD (Depolarization): {xpd.toFixed(2)} dB</p>
          <p>Rank 2 Capacity: {capRank2.toFixed(2)} bps/Hz</p>
          <p>Rank 1 Capacity: {capRank1.toFixed(2)} bps/Hz</p>
          <p className={statusClass}>
            Recommendation: {recommendation}
          </p>
        </div>
      </div>
      
      <div className="chart-container">
        <Line options={{ responsive: true, plugins: { legend: { position: 'top' }, title: { display: true, text: 'Attenuation vs Rain Rate' } } }} data={chartData} />
      </div>

    </div>
  );
}

// --- Quick Hack: Paste Logic Here for Demo ---
// (In real project, import from model.js)
const RAIN_COEFFS = {
  2.2: { k: 0.0002, alpha: 0.95 },
  12.0: { k: 0.018, alpha: 1.15 },
  30.0: { k: 0.187, alpha: 1.021 }, // Ka-band vertical
  40.0: { k: 0.35, alpha: 0.93 },
  50.0: { k: 0.55, alpha: 0.88 }
};

function calculateLinkBudget(params) {
  const { freq, rainRate, elevation, env } = params;
  
  let k = 0.018, alpha = 1.15; // default Ku
  let minDiff = 100;
  // Simple check for coeffs
  if (Math.abs(freq - 30) < 5) { k=0.187; alpha=1.021; }
  else if (Math.abs(freq - 40) < 5) { k=0.35; alpha=0.93; }
  else if (Math.abs(freq - 50) < 5) { k=0.55; alpha=0.88; }
  else if (Math.abs(freq - 2) < 2) { k=0.0002; alpha=0.95; }

  const gamma = k * Math.pow(rainRate, alpha);
  const elevRad = (elevation * Math.PI) / 180;
  const heightRain = 3.0; // km
  const slantPath = heightRain / Math.sin(elevRad);
  const rFactor = 1 / (1 + 0.045 * slantPath);
  const lEff = slantPath * rFactor;
  const attRain = gamma * lEff;

  let attZenithGas = 0.3; // Approx Ka
  const attGas = attZenithGas / Math.sin(elevRad);

  const K_l = 0.0002 * Math.pow(freq, 1.95);
  const L_content = 0.5; // mm
  const attCloud = (L_content * K_l) / Math.sin(elevRad);

  const totalAtmosphericLoss = attRain + attGas + attCloud;

  let xpd = 40.0;
  if (attRain > 0.1) {
    const U = 30 * Math.log10(freq);
    const V = 20.0;
    xpd = U - V * Math.log10(attRain);
    xpd = Math.max(0, Math.min(40, xpd));
  }

  let fadeLMS = 0;
  if (env === 'urban') fadeLMS = 15.0; 
  else if (env === 'suburban') fadeLMS = 5.0; 
  else fadeLMS = 0.5; 

  const totalLoss = totalAtmosphericLoss + fadeLMS;

  return { attRain, attGas, attCloud, fadeLMS, totalLoss, xpd };
}

function calculateMIMOCapacity(snrDb, xpdDb) {
  const snr = Math.pow(10, snrDb / 10);
  const crosstalkPower = Math.pow(10, -xpdDb / 10);
  const pSig = snr / 2;
  const sinrSimple = pSig / (1 + pSig * crosstalkPower);
  const capRank2 = 2 * Math.log2(1 + sinrSimple);
  const capRank1 = Math.log2(1 + snr);
  return { capRank2, capRank1 };
}

export default App;
