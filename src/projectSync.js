export function createTaskId() {
  if (globalThis.crypto?.randomUUID) {
    return globalThis.crypto.randomUUID();
  }
  return `task-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
}

export function buildSimulationProjectManifest({
  taskId = createTaskId(),
  timestamp = new Date().toISOString(),
  satellite = {},
  groundStation = {},
  trajectory = {},
  linkParams = {}
} = {}) {
  return {
    schema: 'satellite-channel-sim/project-manifest/v1',
    Task_ID: taskId,
    generatedAt: timestamp,
    satellite: {
      name: satellite.name || 'Unknown',
      noradId: satellite.noradId || '',
      tleLine1: satellite.tleLine1 || '',
      tleLine2: satellite.tleLine2 || '',
      params: satellite.params || {}
    },
    groundStation: {
      lat: groundStation.lat ?? 0,
      lon: groundStation.lon ?? 0,
      alt: groundStation.alt ?? 0
    },
    trajectory: {
      file: trajectory.file || 'trajectory.csv',
      startTime: trajectory.startTime || timestamp,
      durationMs: trajectory.durationMs ?? 0,
      stepMs: trajectory.stepMs ?? 0,
      sampleCount: trajectory.sampleCount ?? 0
    },
    linkParams: { ...linkParams }
  };
}

export function buildTrajectoryCsv(points) {
  const header = [
    'Timestamp',
    'SatLat_deg',
    'SatLon_deg',
    'SatAlt_km',
    'Azimuth_deg',
    'Elevation_deg',
    'SlantRange_km'
  ].join(',');

  const rows = (points || []).map((point) => {
    return [
      point.time || '',
      formatNumber(point.satLat, 6),
      formatNumber(point.satLon, 6),
      formatNumber(point.satAlt, 3),
      formatNumber(point.azimuth, 3),
      formatNumber(point.elevation, 3),
      formatNumber(point.range, 3)
    ].join(',');
  });

  return [header, ...rows].join('\n');
}

export function parseTrajectoryCsv(csvText) {
  if (!csvText) return [];

  const lines = csvText.split(/\r?\n/).map((line) => line.trim()).filter(Boolean);
  if (lines.length < 2) return [];

  const header = lines[0].split(',').map((item) => item.trim().toLowerCase());
  const getIndex = (names) => names.map((name) => header.indexOf(name)).find((index) => index >= 0) ?? -1;

  const timestampIdx = getIndex(['timestamp', 'time']);
  const latIdx = getIndex(['satlat_deg', 'latitude (deg)', 'latitude_deg']);
  const lonIdx = getIndex(['satlon_deg', 'longitude (deg)', 'longitude_deg']);
  const altIdx = getIndex(['satalt_km', 'altitude (km)', 'altitude_km']);
  const azIdx = getIndex(['azimuth_deg', 'azimuth (deg)']);
  const elevIdx = getIndex(['elevation_deg', 'elevation (deg)']);
  const rangeIdx = getIndex(['slantrange_km', 'range_km', 'slant range (km)']);

  return lines.slice(1).map((line, index) => {
    const cols = line.split(',').map((item) => item.trim());
    return {
      index,
      time: cols[timestampIdx] || '',
      satLat: parseNumber(cols[latIdx]),
      satLon: parseNumber(cols[lonIdx]),
      satAlt: parseNumber(cols[altIdx]),
      azimuth: parseNumber(cols[azIdx]),
      elevation: parseNumber(cols[elevIdx]),
      slantRange: parseNumber(cols[rangeIdx])
    };
  }).filter((point) => Number.isFinite(point.satLat) && Number.isFinite(point.satLon));
}

function formatNumber(value, digits) {
  return Number.isFinite(value) ? value.toFixed(digits) : '';
}

function parseNumber(value) {
  const parsed = Number.parseFloat(value);
  return Number.isFinite(parsed) ? parsed : NaN;
}
