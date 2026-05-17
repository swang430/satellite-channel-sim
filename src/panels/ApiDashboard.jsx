import React, { useState, useEffect, useCallback } from 'react';

/**
 * ApiDashboard — Lightweight API management panel for Link State Prediction API.
 * 
 * Features:
 *   - API connection status indicator
 *   - Quick endpoint tester (health, predict/now, predict/window, predict/mods)
 *   - WebSocket stream viewer
 *   - Link state table for latest prediction
 *   - MODCOD timeline visualization (simple text-based)
 */

const DEFAULT_API_URL = 'http://localhost:3001';

const panelStyle = {
  background: 'rgba(0, 20, 40, 0.9)',
  border: '1px solid rgba(0, 229, 255, 0.2)',
  borderRadius: '8px',
  padding: '20px',
  margin: '10px 0',
  fontFamily: "'Space Mono', monospace",
  color: 'rgba(0, 229, 255, 0.9)',
  maxHeight: '80vh',
  overflowY: 'auto'
};

const titleStyle = {
  fontSize: '18px',
  fontWeight: 'bold',
  marginBottom: '15px',
  borderBottom: '1px solid rgba(0, 229, 255, 0.2)',
  paddingBottom: '8px'
};

const buttonStyle = {
  background: 'rgba(0, 229, 255, 0.15)',
  border: '1px solid rgba(0, 229, 255, 0.3)',
  color: 'rgba(0, 229, 255, 0.9)',
  padding: '6px 14px',
  borderRadius: '4px',
  cursor: 'pointer',
  fontFamily: "'Space Mono', monospace",
  fontSize: '12px',
  marginRight: '8px',
  marginBottom: '6px'
};

const inputStyle = {
  background: 'rgba(0, 0, 0, 0.3)',
  border: '1px solid rgba(0, 229, 255, 0.2)',
  color: 'rgba(0, 229, 255, 0.9)',
  padding: '5px 10px',
  borderRadius: '4px',
  fontFamily: "'Space Mono', monospace",
  fontSize: '12px',
  width: '200px',
  marginRight: '8px'
};

const statusIndicator = (ok) => ({
  display: 'inline-block',
  width: '10px',
  height: '10px',
  borderRadius: '50%',
  background: ok ? '#00ff88' : '#ff4444',
  marginRight: '8px',
  boxShadow: ok ? '0 0 6px #00ff88' : '0 0 6px #ff4444'
});

const badgeStyle = {
  display: 'inline-block',
  padding: '2px 8px',
  borderRadius: '3px',
  fontSize: '11px',
  marginRight: '6px',
  marginBottom: '4px'
};

export default function ApiDashboard() {
  const [apiUrl, setApiUrl] = useState(() => {
    return localStorage.getItem('apiUrl') || DEFAULT_API_URL;
  });
  const [connected, setConnected] = useState(false);
  const [lastResponse, setLastResponse] = useState(null);
  const [endpoint, setEndpoint] = useState('health');
  const [wsMessages, setWsMessages] = useState([]);
  const [loading, setLoading] = useState(false);
  const [satellite, setSatellite] = useState('ISS');
  const [gsInput, setGsInput] = useState('31.23,121.47,0');
  const [hoursInput, setHoursInput] = useState('6');

  // ─── Health check on mount and URL change ────────────────────
  const checkHealth = useCallback(async () => {
    try {
      const res = await fetch(`${apiUrl}/api/v1/health`);
      const data = await res.json();
      setConnected(data.status === 'ok');
    } catch {
      setConnected(false);
    }
  }, [apiUrl]);

  useEffect(() => {
    checkHealth();
    const interval = setInterval(checkHealth, 10000);
    return () => clearInterval(interval);
  }, [checkHealth]);

  // ─── Save API URL ────────────────────────────────────────────
  const saveApiUrl = () => {
    localStorage.setItem('apiUrl', apiUrl);
    checkHealth();
  };

  // ─── Test endpoints ──────────────────────────────────────────
  const testEndpoint = async (ep) => {
    setLoading(true);
    setEndpoint(ep);
    try {
      let url;
      switch (ep) {
        case 'health':
          url = `${apiUrl}/api/v1/health`;
          break;
        case 'predict-now':
          url = `${apiUrl}/api/v1/predict/now?sat=${satellite}&gs=${gsInput}`;
          break;
        case 'predict-window':
          url = `${apiUrl}/api/v1/predict/window?sat=${satellite}&gs=${gsInput}&hours=${hoursInput}`;
          break;
        case 'predict-mods':
          url = `${apiUrl}/api/v1/predict/mods?sat=${satellite}&gs=${gsInput}&hours=${hoursInput}`;
          break;
        case 'satellites':
          url = `${apiUrl}/api/v1/satellites`;
          break;
        default:
          url = `${apiUrl}/api/v1/health`;
      }
      const res = await fetch(url);
      const data = await res.json();
      setLastResponse(data);
    } catch (e) {
      setLastResponse({ error: e.message });
    }
    setLoading(false);
  };

  // ─── WebSocket ───────────────────────────────────────────────
  const connectWS = () => {
    const wsUrl = apiUrl.replace(/^http/, 'ws') + '/api/v1/predict/stream';
    const ws = new WebSocket(wsUrl);
    setWsMessages(prev => [...prev, { type: 'system', text: `Connecting to ${wsUrl}...` }]);
    
    ws.onopen = () => {
      setWsMessages(prev => [...prev, { type: 'system', text: '✅ Connected' }]);
      // Request prediction
      ws.send(JSON.stringify({ sat: satellite, gs: gsInput, hours: parseInt(hoursInput) || 6 }));
    };
    
    ws.onmessage = (event) => {
      try {
        const data = JSON.parse(event.data);
        setWsMessages(prev => [...prev, { type: 'data', data }]);
      } catch {
        setWsMessages(prev => [...prev, { type: 'raw', text: event.data }]);
      }
    };
    
    ws.onerror = () => {
      setWsMessages(prev => [...prev, { type: 'system', text: '❌ WebSocket error' }]);
    };
    
    ws.onclose = () => {
      setWsMessages(prev => [...prev, { type: 'system', text: '🔌 Disconnected' }]);
    };
    
    // Close after 30 seconds (avoid lingering connections)
    setTimeout(() => {
      if (ws.readyState === WebSocket.OPEN) ws.close();
    }, 30000);
  };

  // ─── Render helpers ──────────────────────────────────────────
  const renderConnectionStatus = () => (
    <div style={{ marginBottom: '15px' }}>
      <span style={statusIndicator(connected)}></span>
      <span style={{ color: connected ? '#00ff88' : '#ff4444' }}>
        {connected ? 'API Connected' : 'API Disconnected'}
      </span>
      <span style={{ color: 'rgba(0, 229, 255, 0.4)', fontSize: '11px', marginLeft: '12px' }}>
        {apiUrl}
      </span>
    </div>
  );

  const renderConfig = () => (
    <div style={{ marginBottom: '15px', padding: '10px', background: 'rgba(0,0,0,0.2)', borderRadius: '4px' }}>
      <div style={{ fontSize: '13px', marginBottom: '8px', color: 'rgba(0, 229, 255, 0.6)' }}>
        ⚙️ API Configuration
      </div>
      <div style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: '8px', marginBottom: '8px' }}>
        <input
          style={inputStyle}
          value={apiUrl}
          onChange={(e) => setApiUrl(e.target.value)}
          placeholder="API URL"
        />
        <button style={buttonStyle} onClick={saveApiUrl}>Save & Reconnect</button>
      </div>
      <div style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: '8px' }}>
        <span style={{ fontSize: '11px', color: 'rgba(0, 229, 255, 0.5)' }}>Sat:</span>
        <input style={{ ...inputStyle, width: '120px' }} value={satellite} onChange={(e) => setSatellite(e.target.value)} placeholder="Satellite" />
        <span style={{ fontSize: '11px', color: 'rgba(0, 229, 255, 0.5)' }}>GS:</span>
        <input style={{ ...inputStyle, width: '160px' }} value={gsInput} onChange={(e) => setGsInput(e.target.value)} placeholder="lat,lon,alt" />
        <span style={{ fontSize: '11px', color: 'rgba(0, 229, 255, 0.5)' }}>Hours:</span>
        <input style={{ ...inputStyle, width: '60px' }} value={hoursInput} onChange={(e) => setHoursInput(e.target.value)} placeholder="6" />
      </div>
    </div>
  );

  const renderTestButtons = () => (
    <div style={{ marginBottom: '15px' }}>
      <button style={buttonStyle} onClick={() => testEndpoint('health')} disabled={loading}>🏥 Health</button>
      <button style={buttonStyle} onClick={() => testEndpoint('predict-now')} disabled={loading}>📡 Predict Now</button>
      <button style={buttonStyle} onClick={() => testEndpoint('predict-window')} disabled={loading}>🗓️ Window</button>
      <button style={buttonStyle} onClick={() => testEndpoint('predict-mods')} disabled={loading}>📶 MODCOD</button>
      <button style={buttonStyle} onClick={() => testEndpoint('satellites')} disabled={loading}>🛰️ Satellites</button>
      <button style={{ ...buttonStyle, borderColor: 'rgba(0, 255, 136, 0.5)', color: '#00ff88' }} onClick={connectWS}>🔌 WS Stream</button>
    </div>
  );

  const renderResponse = () => {
    if (!lastResponse) return null;
    
    if (endpoint === 'predict-window' && lastResponse.predictions) {
      const p = lastResponse;
      return (
        <div style={{ padding: '10px', background: 'rgba(0,0,0,0.3)', borderRadius: '4px' }}>
          <div style={{ fontSize: '13px', marginBottom: '8px', color: '#00ff88' }}>
            ✓ {p.satellite} — {p.passCount} passes in {p.lookaheadHours}h
          </div>
          {p.predictions.map((pass, i) => {
            const s = pass.summary;
            return (
              <div key={i} style={{ fontSize: '11px', marginBottom: '4px', padding: '4px', background: 'rgba(0,229,255,0.05)', borderRadius: '3px' }}>
                <span style={badgeStyle}>Pass {i+1}</span>
                <span style={{ color: 'rgba(0,229,255,0.6)' }}>
                  {pass.pass.aos?.slice(11,19)} → {pass.pass.los?.slice(11,19)}
                </span>
                <span style={{ marginLeft: '8px', color: s?.peakSNR_dB > 10 ? '#00ff88' : '#ffaa00' }}>
                  Max {pass.pass.maxElevation}° | Peak {s?.peakSNR_dB}dB | Mean {s?.meanSNR_dB}dB
                </span>
                <span style={{ marginLeft: '8px', color: s?.rank2Feasible ? '#00ff88' : 'rgba(0,229,255,0.4)' }}>
                  Rank2: {s?.rank2Feasible ? '✓' : '✗'}
                </span>
              </div>
            );
          })}
        </div>
      );
    }
    
    if (endpoint === 'predict-mods' && lastResponse.modcodTimeline) {
      const best = lastResponse.modcodTimeline.reduce((a, b) => 
        a.spectralEfficiency_bpsHz > b.spectralEfficiency_bpsHz ? a : b
      );
      return (
        <div style={{ padding: '10px', background: 'rgba(0,0,0,0.3)', borderRadius: '4px' }}>
          <div style={{ fontSize: '13px', marginBottom: '8px', color: '#00ff88' }}>
            ✓ {lastResponse.totalSamples} MODCOD samples
          </div>
          <div style={{ fontSize: '12px', marginBottom: '8px' }}>
            Best: <span style={{ color: '#00ff88' }}>{best.predicted}</span>
            {' '}({best.spectralEfficiency_bpsHz} bps/Hz)
            {' '}at SNR={best.snr_dB}dB, El={best.elevation_deg}°
          </div>
          <div style={{ fontSize: '11px', color: 'rgba(0,229,255,0.5)' }}>
            Safe: {best.safeRecommendation} ({best.safeSpectralEfficiency_bpsHz} bps/Hz)
            {' '}Margin: {best.margin_dB}dB
          </div>
        </div>
      );
    }
    
    return (
      <div style={{ padding: '10px', background: 'rgba(0,0,0,0.3)', borderRadius: '4px', maxHeight: '300px', overflowY: 'auto' }}>
        <pre style={{ fontSize: '11px', margin: 0, whiteSpace: 'pre-wrap', wordBreak: 'break-all' }}>
          {JSON.stringify(lastResponse, null, 2)}
        </pre>
      </div>
    );
  };

  const renderWSLog = () => {
    if (wsMessages.length === 0) return null;
    return (
      <div style={{ marginTop: '10px', padding: '10px', background: 'rgba(0,0,0,0.3)', borderRadius: '4px', maxHeight: '200px', overflowY: 'auto' }}>
        <div style={{ fontSize: '12px', marginBottom: '6px', color: '#00ff88' }}>📨 WebSocket Log ({wsMessages.length})</div>
        {wsMessages.slice(-20).map((msg, i) => (
          <div key={i} style={{ fontSize: '10px', marginBottom: '2px', color: msg.type === 'system' ? 'rgba(0,229,255,0.5)' : 'rgba(0,255,136,0.7)' }}>
            {msg.type === 'system' ? msg.text : JSON.stringify(msg.data).slice(0, 200) + '...'}
          </div>
        ))}
        <button style={{ ...buttonStyle, marginTop: '6px', fontSize: '10px' }} onClick={() => setWsMessages([])}>
          Clear
        </button>
      </div>
    );
  };

  return (
    <div style={panelStyle}>
      <div style={titleStyle}>
        🛰️ Link State Prediction API Dashboard
      </div>
      
      {renderConnectionStatus()}
      {renderConfig()}
      {renderTestButtons()}
      
      <div style={{ marginTop: '10px' }}>
        {loading ? (
          <div style={{ color: 'rgba(0,229,255,0.5)', fontSize: '12px' }}>
            ⏳ Loading [{endpoint}]...
          </div>
        ) : (
          renderResponse()
        )}
      </div>
      
      {renderWSLog()}
    </div>
  );
}
