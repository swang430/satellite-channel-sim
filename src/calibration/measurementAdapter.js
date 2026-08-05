const METRIC_FIELDS = [
  'cn0_dBHz',
  'cn_dB',
  'snr_dB',
  'rssi_dBm',
  'xpd_dB',
  'attenuation_dB',
  'scatterPower_dB',
];

function finiteOrUndefined(value, path) {
  if (value == null) return undefined;
  const number = typeof value === 'number' ? value : Number(value);
  if (!Number.isFinite(number)) throw new TypeError(`${path} must be finite`);
  return number;
}

function normalizeTimestamp(value, path) {
  if (value == null) return undefined;
  if (typeof value !== 'string' || Number.isNaN(Date.parse(value))) {
    throw new TypeError(`${path} must be an ISO-8601 timestamp`);
  }
  return new Date(value).toISOString();
}

function normalizeMeasurement(raw, index, diagnostics) {
  if (!raw || typeof raw !== 'object') {
    throw new TypeError(`measurements[${index}] must be an object`);
  }
  const measurement = {
    timestamp: normalizeTimestamp(raw.timestamp, `measurements[${index}].timestamp`),
    frameId: finiteOrUndefined(raw.frameId, `measurements[${index}].frameId`),
    elevation_deg: finiteOrUndefined(raw.elevation_deg ?? raw.elevation, `measurements[${index}].elevation_deg`),
    slantRange_km: finiteOrUndefined(raw.slantRange_km ?? raw.slantRange, `measurements[${index}].slantRange_km`),
    rainRate_mmph: finiteOrUndefined(raw.rainRate_mmph ?? raw.rainRate, `measurements[${index}].rainRate_mmph`),
    cn0_dBHz: finiteOrUndefined(raw.cn0_dBHz, `measurements[${index}].cn0_dBHz`),
    cn_dB: finiteOrUndefined(raw.cn_dB, `measurements[${index}].cn_dB`),
    snr_dB: finiteOrUndefined(raw.snr_dB, `measurements[${index}].snr_dB`),
    rssi_dBm: finiteOrUndefined(raw.rssi_dBm ?? raw.measuredRSSI_dBm, `measurements[${index}].rssi_dBm`),
    xpd_dB: finiteOrUndefined(raw.xpd_dB ?? raw.measuredXPD_dB, `measurements[${index}].xpd_dB`),
    attenuation_dB: finiteOrUndefined(
      raw.attenuation_dB ?? raw.measuredAttenuation_dB ?? raw.measuredLoss,
      `measurements[${index}].attenuation_dB`,
    ),
    scatterPower_dB: finiteOrUndefined(raw.scatterPower_dB, `measurements[${index}].scatterPower_dB`),
  };

  if (raw.measuredCN0_dB != null && measurement.cn0_dBHz == null) {
    measurement.cn0_dBHz = finiteOrUndefined(raw.measuredCN0_dB, `measurements[${index}].measuredCN0_dB`);
    diagnostics.push({
      code: 'LEGACY_CN0_ASSUMED_DBHZ',
      severity: 'warning',
      path: `measurements[${index}].measuredCN0_dB`,
      message: 'Legacy measuredCN0_dB was interpreted as C/N0 in dB-Hz.',
    });
  }

  if (!METRIC_FIELDS.some((field) => measurement[field] != null)) {
    throw new TypeError(`measurements[${index}] must include at least one typed calibration metric`);
  }
  return Object.fromEntries(Object.entries(measurement).filter(([, value]) => value !== undefined));
}

export function parseCalibrationDataset(input) {
  const source = Array.isArray(input) ? { measurements: input } : input;
  if (!source || typeof source !== 'object' || !Array.isArray(source.measurements)) {
    throw new TypeError('calibration dataset must be an array or contain measurements');
  }
  const diagnostics = [];
  const rawMetadata = source.metadata && typeof source.metadata === 'object' ? source.metadata : {};
  const metadata = {
    ...rawMetadata,
    tec_TECU: finiteOrUndefined(rawMetadata.tec_TECU ?? rawMetadata.tec, 'metadata.tec_TECU'),
  };
  if (metadata.tec_TECU === undefined) delete metadata.tec_TECU;

  return {
    schemaVersion: 'satellite-channel-sim/calibration-measurements-v1',
    metadata,
    measurements: source.measurements.map((measurement, index) => (
      normalizeMeasurement(measurement, index, diagnostics)
    )),
    diagnostics,
  };
}

export function groundStationDistanceKm(calibrationStation, currentStation) {
  for (const [name, station] of [['calibrationStation', calibrationStation], ['currentStation', currentStation]]) {
    if (!station || !Number.isFinite(station.lat) || !Number.isFinite(station.lon)) {
      throw new TypeError(`${name} must contain finite lat/lon`);
    }
  }
  const toRadians = (degrees) => degrees * Math.PI / 180;
  const latitudeDelta = toRadians(calibrationStation.lat - currentStation.lat);
  const longitudeDelta = toRadians(calibrationStation.lon - currentStation.lon);
  const latitudeA = toRadians(currentStation.lat);
  const latitudeB = toRadians(calibrationStation.lat);
  const haversine = Math.sin(latitudeDelta / 2) ** 2
    + Math.cos(latitudeA) * Math.cos(latitudeB) * Math.sin(longitudeDelta / 2) ** 2;
  return 6371.0088 * 2 * Math.atan2(Math.sqrt(haversine), Math.sqrt(1 - haversine));
}
