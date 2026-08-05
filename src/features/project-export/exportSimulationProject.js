import {
  extractGoldenTrajectory,
  generateTrajectoryExport,
  predictPasses,
} from '../../model.js';
import {
  buildSimulationProjectManifest,
  buildTrajectoryCsv,
} from '../../projectSync.js';

function safeSatelliteName(satellite) {
  return (satellite.name || satellite.noradId || 'satellite').replace(/[^a-zA-Z0-9._-]+/g, '_');
}

function fileTimestamp(date) {
  return date.toISOString().replace(/:/g, '-').slice(0, 19);
}

function buildManifest({ satellite, groundStation, trajectory, linkParams }) {
  return buildSimulationProjectManifest({
    satellite: {
      name: satellite.name,
      noradId: satellite.noradId,
      tleLine1: satellite.tleLine1,
      tleLine2: satellite.tleLine2,
      params: { ...satellite.params },
    },
    groundStation,
    trajectory,
    linkParams,
  });
}

async function createZipArtifact({ csv, manifest, filename }) {
  const { default: JSZip } = await import('jszip');
  const zip = new JSZip();
  zip.file('trajectory.csv', csv);
  zip.file('manifest.json', JSON.stringify(manifest, null, 2));
  return {
    blob: await zip.generateAsync({ type: 'blob' }),
    filename,
    manifest,
  };
}

export function downloadProjectArtifact({ blob, filename }) {
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = filename;
  document.body.appendChild(anchor);
  anchor.click();
  document.body.removeChild(anchor);
  URL.revokeObjectURL(url);
}

export function buildGoldenTrajectoryCsv(points, applyEffectiveAltitude) {
  const header = 'Timestamp,Latitude (deg),Longitude (deg),Altitude (km),Azimuth (deg),Elevation (deg),Slant Range (km),Effective Altitude (km),Feature,Description\n';
  const rows = points.map((point) => {
    const timestamp = point.time || point.timestamp || '';
    const elevationRad = Math.max(0, point.elevation || 0) * Math.PI / 180;
    const effectiveAltitude = (point.range || 0) * Math.sin(elevationRad);
    const altitude = applyEffectiveAltitude
      ? effectiveAltitude.toFixed(3)
      : (point.satAlt || 0).toFixed(3);
    return `${timestamp},${(point.satLat || 0).toFixed(6)},${(point.satLon || 0).toFixed(6)},${altitude},${(point.azimuth || 0).toFixed(2)},${(point.elevation || 0).toFixed(2)},${(point.range || 0).toFixed(2)},${effectiveAltitude.toFixed(3)},"${point.feature || ''}","${point.description || ''}"`;
  });
  return header + rows.join('\n');
}

export async function createWgs84ProjectExport({
  satellite,
  groundStation,
  startTimeText,
  durationMinutes,
  stepMs,
  linkParams,
}) {
  let startTime = startTimeText?.trim() ? new Date(startTimeText.trim()) : new Date();
  if (Number.isNaN(startTime.getTime())) startTime = new Date();

  let durationMs = durationMinutes > 0 ? durationMinutes * 60_000 : null;
  if (durationMs === null) {
    const passes = predictPasses(
      satellite.tleLine1,
      satellite.tleLine2,
      groundStation.lat,
      groundStation.lon,
      groundStation.alt,
      72,
      0,
    );
    if (passes.length > 0) {
      const bestPass = passes.reduce(
        (best, candidate) => candidate.maxElev > best.maxElev ? candidate : best,
        passes[0],
      );
      startTime = new Date(bestPass.aos.getTime() - 2 * 60_000);
      durationMs = bestPass.los.getTime() + 2 * 60_000 - startTime.getTime();
    } else {
      durationMs = 10 * 60_000;
    }
  }

  const trajectoryConfig = { startTime, durationMs, stepMs };
  const trajectory = generateTrajectoryExport(
    satellite.tleLine1,
    satellite.tleLine2,
    groundStation.lat,
    groundStation.lon,
    groundStation.alt,
    trajectoryConfig,
  );
  if (trajectory.length === 0) {
    throw new Error('Failed to export WGS84 trajectory. Please verify the current TLE lines.');
  }

  const manifest = buildManifest({
    satellite,
    groundStation,
    trajectory: {
      file: 'trajectory.csv',
      startTime: startTime.toISOString(),
      durationMs,
      stepMs,
      sampleCount: trajectory.length,
    },
    linkParams,
  });
  return createZipArtifact({
    csv: buildTrajectoryCsv(trajectory),
    manifest,
    filename: `${safeSatelliteName(satellite)}_simulation_project_${fileTimestamp(startTime)}.zip`,
  });
}

export async function createGoldenProjectExport({
  satellite,
  groundStation,
  linkParams,
  specificPass,
  streetAzimuth,
  applyEffectiveAltitude,
}) {
  let bestPass = specificPass?.aos && specificPass?.los ? specificPass : null;
  if (!bestPass) {
    const passes = predictPasses(
      satellite.tleLine1,
      satellite.tleLine2,
      groundStation.lat,
      groundStation.lon,
      groundStation.alt,
      72,
      0,
    );
    if (passes.length === 0) {
      throw new Error('No visible passes found in the next 72h. Cannot generate Golden RT trajectory.');
    }
    bestPass = passes.reduce(
      (best, candidate) => candidate.maxElev > best.maxElev ? candidate : best,
      passes[0],
    );
  }

  const startTime = new Date(bestPass.aos.getTime() - 2 * 60_000);
  const durationMs = bestPass.los.getTime() + 2 * 60_000 - startTime.getTime();
  const stepMs = 1_000;
  const trajectory = generateTrajectoryExport(
    satellite.tleLine1,
    satellite.tleLine2,
    groundStation.lat,
    groundStation.lon,
    groundStation.alt,
    { startTime, durationMs, stepMs },
  );
  if (trajectory.length === 0) {
    throw new Error('Failed to generate dense trajectory for RT Golden Export. Check TLE.');
  }

  const goldenPoints = extractGoldenTrajectory(trajectory, streetAzimuth);
  if (goldenPoints.length === 0) {
    throw new Error('Failed to extract golden points. Maybe satellite never visible?');
  }

  const manifest = buildManifest({
    satellite,
    groundStation,
    trajectory: {
      file: 'trajectory.csv',
      startTime: startTime.toISOString(),
      durationMs,
      stepMs,
      sampleCount: goldenPoints.length,
      type: 'golden_rt',
      streetAzimuth,
    },
    linkParams,
  });
  return createZipArtifact({
    csv: buildGoldenTrajectoryCsv(goldenPoints, applyEffectiveAltitude),
    manifest,
    filename: `${safeSatelliteName(satellite)}_GoldenRT_${fileTimestamp(startTime)}.zip`,
  });
}
