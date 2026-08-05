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
import { networkInterfaces } from 'node:os';
import { WebSocketServer } from 'ws';
import { ORBIT_SATELLITES, getOrbitSatellite } from '../src/knownSatellites.js';
import { diagnoseTleAge, withTleDiagnostics } from '../src/orbit/tle.js';
import {
  InputValidationError,
  WS_MAX_REQUEST_BYTES,
  assertWsRequestAllowed,
  extractLinkParams,
  parseGroundStation,
  parseHours,
  parseWsRequest,
  resolveServerHost,
  validateTle,
} from './inputValidation.js';

// Dynamic import so Vite doesn't try to bundle this during `npm run build`
async function loadOracle() {
  const mod = await import('../src/oracleCore.js');
  return mod;
}

const PORT = parseInt(process.env.PORT || '3001', 10);
const HOST = resolveServerHost(process.env);

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
  return Object.fromEntries(new URL(url, 'http://localhost').searchParams.entries());
}

function resolveSat(query) {
  // Priority: explicit TLE > known satellite name
  if (query.tle1 && query.tle2) {
    const custom = { ...validateTle(query.tle1, query.tle2), name: 'custom' };
    return { ...custom, tleDiagnostics: diagnoseTleAge(custom) };
  }
  const satName = query.sat || 'ISS';
  const known = getOrbitSatellite(satName);
  if (known) return { ...known, tleDiagnostics: diagnoseTleAge(known) };
  // Try case-insensitive matching
  const normalizedName = satName.toUpperCase();
  for (const [key, val] of Object.entries(ORBIT_SATELLITES)) {
    if (key.includes(normalizedName) || val.name.toUpperCase().includes(normalizedName)) {
      return { ...val, tleDiagnostics: diagnoseTleAge(val) };
    }
  }
  return null;
}

function resolveGroundStation(query) {
  return parseGroundStation(query.gs);
}

// ─── Routes ─────────────────────────────────────────────────────────────

async function handleHealth(req, res) {
  sendJSON(res, 200, {
    status: 'ok',
    service: 'satellite-channel-sim-link-state-api',
    version: '1.0.0',
    uptime: process.uptime(),
    knownSatellites: Object.keys(ORBIT_SATELLITES),
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
  if (!sat) return sendJSON(res, 400, { error: 'Unknown satellite', known: Object.keys(ORBIT_SATELLITES) });
  
  const gs = resolveGroundStation(query);
  const linkParams = extractLinkParams(query);
  
  try {
    const result = oracle.predictLinkStateNow(sat, gs.lat, gs.lon, gs.alt, linkParams);
    if (!result) {
      return sendJSON(res, 200, withTleDiagnostics({
        status: 'no_contact',
        message: `Satellite ${sat.name} is not currently visible from ground station`,
        satellite: sat.name,
        groundStation: { lat: gs.lat, lon: gs.lon, alt: gs.alt }
      }, sat));
    }
    sendJSON(res, 200, { status: 'ok', tleDiagnostics: sat.tleDiagnostics, result });
  } catch (e) {
    sendJSON(res, 500, { error: e.message });
  }
}

async function handlePredictWindow(req, res, oracle) {
  const query = parseQuery(req.url);
  const sat = resolveSat(query);
  if (!sat) return sendJSON(res, 400, { error: 'Unknown satellite', known: Object.keys(ORBIT_SATELLITES) });
  
  const gs = resolveGroundStation(query);
  const hours = parseHours(query.hours);
  const linkParams = extractLinkParams(query);
  
  try {
    const predictions = oracle.predictLinkStateWindow(sat, gs.lat, gs.lon, gs.alt, hours, linkParams);
    sendJSON(res, 200, {
      status: 'ok',
      satellite: sat.name,
      tleDiagnostics: sat.tleDiagnostics,
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
  if (!sat) return sendJSON(res, 400, { error: 'Unknown satellite', known: Object.keys(ORBIT_SATELLITES) });
  
  const gs = resolveGroundStation(query);
  const hours = parseHours(query.hours);
  const linkParams = extractLinkParams(query);
  
  try {
    const predictions = oracle.predictLinkStateWindow(sat, gs.lat, gs.lon, gs.alt, hours, linkParams);
    
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
      tleDiagnostics: sat.tleDiagnostics,
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
    count: Object.keys(ORBIT_SATELLITES).length,
    satellites: Object.entries(ORBIT_SATELLITES).map(([id, data]) => ({
      id,
      name: data.name,
      tleDiagnostics: diagnoseTleAge(data)
    })),
    note: 'Add custom satellites via ?tle1=...&tle2=... parameters'
  });
}

// ─── WebSocket Stream ───────────────────────────────────────────────────

function setupWebSocket(wss, oracle) {
  wss.on('connection', (ws) => {
    console.log('[ws] client connected');
    let lastRequestAt = null;
    
    ws.send(JSON.stringify({ 
      type: 'connected', 
      message: 'Link State Prediction Stream active',
      endpoints: ['now', 'window', 'mods']
    }));
    
    ws.on('message', async (data) => {
      try {
        const now = Date.now();
        assertWsRequestAllowed(lastRequestAt, now);
        lastRequestAt = now;
        const request = parseWsRequest(data);
        const sat = getOrbitSatellite(request.sat);
        if (!sat) throw new InputValidationError('UNKNOWN_SATELLITE', `Unknown satellite: ${request.sat}`, 'sat');
        const gs = request.groundStation;
        
        const predictions = oracle.predictLinkStateWindow(
          sat,
          gs.lat,
          gs.lon,
          gs.alt,
          request.hours,
          request.linkParams,
        );
        
        ws.send(JSON.stringify({
          type: 'prediction',
          satellite: sat.name,
          tleDiagnostics: diagnoseTleAge(sat),
          groundStation: { lat: gs.lat, lon: gs.lon, alt: gs.alt },
          lookaheadHours: request.hours,
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

    const path = new URL(req.url, 'http://localhost').pathname;

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
      if (e instanceof InputValidationError) {
        sendJSON(res, 400, { error: e.message, code: e.code, path: e.path });
      } else {
        console.error('[api] Unhandled error:', e);
        sendJSON(res, 500, { error: 'Internal server error' });
      }
    }
  });

  // WebSocket on the same server
  const wss = new WebSocketServer({
    server,
    path: '/api/v1/predict/stream',
    maxPayload: WS_MAX_REQUEST_BYTES,
  });
  setupWebSocket(wss, oracle);

  server.listen(PORT, HOST, () => {
    console.log('');
    console.log('🛰️  Link State Prediction API');
    console.log('═══════════════════════════════════════');
    console.log(`  Local:   http://localhost:${PORT}`);
    
    // Show LAN IPs
    if (HOST === '0.0.0.0' || HOST === '::') {
      const nets = networkInterfaces();
      for (const addrs of Object.values(nets)) {
        for (const addr of addrs || []) {
          if (addr.family === 'IPv4' && !addr.internal) {
            console.log(`  LAN:     http://${addr.address}:${PORT}`);
          }
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
