/**
 * server/index.js — Link State Prediction API Server
 * 
 * Lightweight HTTP + WebSocket server exposing the Oracle Core as a REST API.
 * Uses Node.js built-in http module + ws for WebSocket.
 * 
 * Start:  node server/index.js
 * Health: curl http://localhost:3001/api/v1/health
 */

import { createServer } from 'node:http';
import { parse as parseUrl } from 'node:url';
import { networkInterfaces } from 'node:os';
import { WebSocketServer } from 'ws';

// Dynamic import so Vite doesn't try to bundle this during `npm run build`
async function loadOracle() {
  const mod = await import('../src/oracleCore.js');
  return mod;
}

const PORT = parseInt(process.env.PORT || '3001', 10);
const HOST = process.env.HOST || '0.0.0.0';

// ─── Known Satellite Registry ───────────────────────────────────────────
const KNOWN_SATELLITES = {
  'ISS': {
    name: 'ISS (ZARYA)',
    tleLine1: '1 25544U 98067A   24138.54847222  .00017261  00000-0  31516-3 0  9992',
    tleLine2: '2 25544  51.6420 148.9032 0003403 249.7827 110.2962 15.49904425451604'
  },
  'CSS-TIANHE': {
    name: 'CSS (TIANHE-1)',
    tleLine1: '1 48274U 21035A   24138.57288657  .00020449  00000-0  28634-3 0  9994',
    tleLine2: '2 48274  41.4698 269.7231 0002345 313.7049  46.3392 15.61165546168894'
  }
};

// ─── Helpers ────────────────────────────────────────────────────────────
function sendJSON(res, code, data) {
  res.writeHead(code, {
    'Content-Type': 'application/json',
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Methods': 'GET, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type'
  });
  res.end(JSON.stringify(data, null, 2));
}

function parseQuery(url) {
  const q = {};
  const search = url.split('?')[1];
  if (!search) return q;
  for (const pair of search.split('&')) {
    const [k, v] = pair.split('=').map(decodeURIComponent);
    q[k] = v;
  }
  return q;
}

function resolveSat(query) {
  // Priority: explicit TLE > known satellite name
  if (query.tle1 && query.tle2) {
    return { tleLine1: query.tle1, tleLine2: query.tle2, name: 'custom' };
  }
  const satName = (query.sat || 'ISS').toUpperCase();
  const known = KNOWN_SATELLITES[satName];
  if (known) return { ...known };
  // Try case-insensitive matching
  for (const [key, val] of Object.entries(KNOWN_SATELLITES)) {
    if (key.includes(satName) || val.name.toUpperCase().includes(satName)) {
      return { ...val };
    }
  }
  return null;
}

function resolveGroundStation(query) {
  const gs = query.gs || '31.23,121.47,0';
  const parts = gs.split(',').map(Number);
  if (parts.length < 2 || isNaN(parts[0]) || isNaN(parts[1])) {
    return { lat: 31.23, lon: 121.47, alt: 0 };
  }
  return { lat: parts[0], lon: parts[1], alt: parts[2] || 0 };
}

// ─── Routes ─────────────────────────────────────────────────────────────

async function handleHealth(req, res) {
  sendJSON(res, 200, {
    status: 'ok',
    service: 'satellite-channel-sim-link-state-api',
    version: '1.0.0',
    uptime: process.uptime(),
    knownSatellites: Object.keys(KNOWN_SATELLITES),
    endpoints: [
      'GET /api/v1/health',
      'GET /api/v1/predict/now?sat=ISS&gs=31.23,121.47,0',
      'GET /api/v1/predict/window?sat=ISS&gs=31.23,121.47,0&hours=24',
      'GET /api/v1/predict/mods?sat=ISS&gs=31.23,121.47,0',
      'GET /api/v1/satellites',
      'WS  /api/v1/predict/stream'
    ]
  });
}

async function handlePredictNow(req, res, oracle) {
  const query = parseQuery(req.url);
  const sat = resolveSat(query);
  if (!sat) return sendJSON(res, 400, { error: 'Unknown satellite', known: Object.keys(KNOWN_SATELLITES) });
  
  const gs = resolveGroundStation(query);
  
  try {
    const result = oracle.predictLinkStateNow(sat, gs.lat, gs.lon, gs.alt);
    if (!result) {
      return sendJSON(res, 200, { 
        status: 'no_contact',
        message: `Satellite ${sat.name} is not currently visible from ground station`,
        satellite: sat.name,
        groundStation: { lat: gs.lat, lon: gs.lon, alt: gs.alt }
      });
    }
    sendJSON(res, 200, { status: 'ok', result });
  } catch (e) {
    sendJSON(res, 500, { error: e.message });
  }
}

async function handlePredictWindow(req, res, oracle) {
  const query = parseQuery(req.url);
  const sat = resolveSat(query);
  if (!sat) return sendJSON(res, 400, { error: 'Unknown satellite', known: Object.keys(KNOWN_SATELLITES) });
  
  const gs = resolveGroundStation(query);
  const hours = Math.min(72, Math.max(1, parseInt(query.hours || '24') || 24));
  
  try {
    const predictions = oracle.predictLinkStateWindow(sat, gs.lat, gs.lon, gs.alt, hours);
    sendJSON(res, 200, {
      status: 'ok',
      satellite: sat.name,
      groundStation: { lat: gs.lat, lon: gs.lon, alt: gs.alt },
      lookaheadHours: hours,
      passCount: predictions.length,
      predictions
    });
  } catch (e) {
    sendJSON(res, 500, { error: e.message });
  }
}

async function handlePredictMods(req, res, oracle) {
  const query = parseQuery(req.url);
  const sat = resolveSat(query);
  if (!sat) return sendJSON(res, 400, { error: 'Unknown satellite', known: Object.keys(KNOWN_SATELLITES) });
  
  const gs = resolveGroundStation(query);
  const hours = Math.min(72, Math.max(1, parseInt(query.hours || '24') || 24));
  
  try {
    const predictions = oracle.predictLinkStateWindow(sat, gs.lat, gs.lon, gs.alt, hours);
    
    // Extract MODCOD recommendations for each pass
    const modcodTimeline = [];
    for (const pred of predictions) {
      for (const state of pred.linkStates) {
        if (state.elevation_deg > 0) {
          const modcod = oracle.recommendMODCOD(state.snr.db);
          modcodTimeline.push({
            time: state.time,
            snr_dB: state.snr.db,
            elevation_deg: state.elevation_deg,
            ...modcod
          });
        }
      }
    }
    
    sendJSON(res, 200, {
      status: 'ok',
      satellite: sat.name,
      groundStation: { lat: gs.lat, lon: gs.lon, alt: gs.alt },
      lookaheadHours: hours,
      modcodTimeline,
      totalSamples: modcodTimeline.length
    });
  } catch (e) {
    sendJSON(res, 500, { error: e.message });
  }
}

async function handleSatellites(req, res) {
  sendJSON(res, 200, {
    status: 'ok',
    count: Object.keys(KNOWN_SATELLITES).length,
    satellites: Object.entries(KNOWN_SATELLITES).map(([id, data]) => ({
      id,
      name: data.name
    })),
    note: 'Add custom satellites via ?tle1=...&tle2=... parameters'
  });
}

// ─── WebSocket Stream ───────────────────────────────────────────────────

function setupWebSocket(wss, oracle) {
  wss.on('connection', (ws) => {
    console.log('[ws] client connected');
    
    ws.send(JSON.stringify({ 
      type: 'connected', 
      message: 'Link State Prediction Stream active',
      endpoints: ['now', 'window', 'mods']
    }));
    
    ws.on('message', async (data) => {
      try {
        const msg = JSON.parse(data.toString());
        const { sat: satId, gs: gsStr, hours } = msg;
        
        const sat = KNOWN_SATELLITES[satId?.toUpperCase()] || KNOWN_SATELLITES['ISS'];
        const gsParts = (gsStr || '31.23,121.47,0').split(',').map(Number);
        const gs = { lat: gsParts[0], lon: gsParts[1], alt: gsParts[2] || 0 };
        const lookahead = Math.min(72, Math.max(1, parseInt(hours || '24') || 24));
        
        const predictions = oracle.predictLinkStateWindow(sat, gs.lat, gs.lon, gs.alt, lookahead);
        
        ws.send(JSON.stringify({
          type: 'prediction',
          satellite: sat.name,
          groundStation: { lat: gs.lat, lon: gs.lon, alt: gs.alt },
          lookaheadHours: lookahead,
          passCount: predictions.length,
          predictions
        }));
      } catch (e) {
        ws.send(JSON.stringify({ type: 'error', message: e.message }));
      }
    });
    
    ws.on('close', () => console.log('[ws] client disconnected'));
  });
}

// ─── Main ───────────────────────────────────────────────────────────────

async function main() {
  console.log('[api] Loading Oracle Core...');
  const oracle = await loadOracle();
  console.log('[api] Oracle Core loaded successfully');

  const server = createServer(async (req, res) => {
    // CORS preflight
    if (req.method === 'OPTIONS') {
      res.writeHead(204, {
        'Access-Control-Allow-Origin': '*',
        'Access-Control-Allow-Methods': 'GET, OPTIONS',
        'Access-Control-Allow-Headers': 'Content-Type'
      });
      return res.end();
    }

    const parsed = parseUrl(req.url, true);
    const path = parsed.pathname;

    try {
      if (path === '/api/v1/health') {
        await handleHealth(req, res);
      } else if (path === '/api/v1/predict/now') {
        await handlePredictNow(req, res, oracle);
      } else if (path === '/api/v1/predict/window') {
        await handlePredictWindow(req, res, oracle);
      } else if (path === '/api/v1/predict/mods') {
        await handlePredictMods(req, res, oracle);
      } else if (path === '/api/v1/satellites') {
        await handleSatellites(req, res);
      } else if (path === '/' || path === '') {
        await handleHealth(req, res);
      } else {
        sendJSON(res, 404, { error: 'Not found', availableEndpoints: [
          '/api/v1/health',
          '/api/v1/predict/now',
          '/api/v1/predict/window',
          '/api/v1/predict/mods',
          '/api/v1/satellites'
        ]});
      }
    } catch (e) {
      console.error('[api] Unhandled error:', e);
      sendJSON(res, 500, { error: 'Internal server error' });
    }
  });

  // WebSocket on the same server
  const wss = new WebSocketServer({ server, path: '/api/v1/predict/stream' });
  setupWebSocket(wss, oracle);

  server.listen(PORT, HOST, () => {
    console.log('');
    console.log('🛰️  Link State Prediction API');
    console.log('═══════════════════════════════════════');
    console.log(`  Local:   http://localhost:${PORT}`);
    
    // Show LAN IPs
    const nets = networkInterfaces();
    for (const [name, addrs] of Object.entries(nets)) {
      for (const addr of addrs || []) {
        if (addr.family === 'IPv4' && !addr.internal) {
          console.log(`  LAN:     http://${addr.address}:${PORT}`);
        }
      }
    }
    
    console.log('───────────────────────────────────────');
    console.log('  Endpoints:');
    console.log(`  GET  ${'http://localhost:' + PORT}/api/v1/health`);
    console.log(`  GET  ${'http://localhost:' + PORT}/api/v1/predict/now?sat=ISS&gs=31.23,121.47,0`);
    console.log(`  GET  ${'http://localhost:' + PORT}/api/v1/predict/window?sat=ISS&gs=31.23,121.47,0&hours=12`);
    console.log(`  GET  ${'http://localhost:' + PORT}/api/v1/predict/mods?sat=ISS&gs=31.23,121.47,0`);
    console.log(`  WS   ws://localhost:${PORT}/api/v1/predict/stream`);
    console.log('═══════════════════════════════════════');
    console.log('');
  });
}

main().catch(err => {
  console.error('[api] Fatal error:', err);
  process.exit(1);
});
