import { DomainValidationError } from '../../domain/validation.js';
import { classifyLauraycsConfig } from './configClassifier.js';

function finiteNumber(value, path) {
  const number = typeof value === 'string' ? Number(value) : value;
  if (typeof number !== 'number' || !Number.isFinite(number)) {
    throw new DomainValidationError('CONFIG_NUMBER_INVALID', `${path} must be a finite number`);
  }
  return number;
}

function mhzToHz(value, path) {
  return finiteNumber(value, path) * 1e6;
}

function adaptAntenna(antenna, path) {
  if (!antenna) {
    throw new DomainValidationError('CONFIG_ANTENNA_MISSING', `${path} is required`);
  }
  return {
    id: antenna.id ?? null,
    name: antenna.name ?? null,
    pattern: antenna.pattern ?? null,
    fileUrl: antenna.fileUrl ?? null,
    gain_dBi: finiteNumber(antenna.gain_dbi, `${path}.gain_dbi`),
    beamwidth_deg: finiteNumber(antenna.beamwidth, `${path}.beamwidth`),
    polarization: antenna.polarization ?? null,
    configuredCenterFrequency_Hz: mhzToHz(
      antenna.centerFrequency,
      `${path}.centerFrequency`,
    ),
    rotationMatrix: antenna.rotationMatrix ?? null,
    azimuth_deg: finiteNumber(antenna.azimuth ?? 0, `${path}.azimuth`),
    elevation_deg: finiteNumber(antenna.elevation ?? 0, `${path}.elevation`),
    twist_deg: finiteNumber(antenna.twist ?? 0, `${path}.twist`),
  };
}

function pickSingleNode(config, role) {
  if (!Array.isArray(config.nodes) || config.nodes.length !== 1) {
    throw new DomainValidationError(
      'CONFIG_NODE_COUNT_INVALID',
      `${role} must contain exactly one node`,
    );
  }
  return config.nodes[0];
}

function assertEqual(left, right, code, message) {
  if (left !== right) throw new DomainValidationError(code, message);
}

function getSimulationInterval(config, role) {
  return finiteNumber(
    config.simulation?.simulationConfig?.timeSampleInterval
      ?? config.simulation?.globalParams?.timeSampleInterval,
    `${role}.simulation.timeSampleInterval`,
  );
}

function adaptSatelliteTrack(transmitterConfig, expectedFrameCount, interval_s) {
  const tracks = transmitterConfig.simulation?.satelliteUtmTracks;
  if (!Array.isArray(tracks) || tracks.length !== 1) {
    throw new DomainValidationError(
      'CONFIG_SATELLITE_TRACK_MISSING',
      'Exactly one satellite UTM track is required',
    );
  }
  const track = tracks[0];
  if (!Array.isArray(track.points) || track.points.length !== expectedFrameCount) {
    throw new DomainValidationError(
      'CONFIG_TRACK_FRAME_COUNT_MISMATCH',
      `Expected ${expectedFrameCount} satellite points`,
    );
  }

  return track.points.map((point, frameId) => {
    const timestampMs = finiteNumber(point.time, `satelliteTrack[${frameId}].time`);
    if (frameId > 0) {
      const previousMs = finiteNumber(track.points[frameId - 1].time, `satelliteTrack[${frameId - 1}].time`);
      if (timestampMs - previousMs !== interval_s * 1_000) {
        throw new DomainValidationError(
          'CONFIG_TRACK_SAMPLE_INTERVAL_MISMATCH',
          `Satellite point ${frameId} does not follow the configured interval`,
        );
      }
    }
    return {
      frameId,
      timestampUtc: new Date(timestampMs).toISOString(),
      longitude_deg: finiteNumber(point.lng, `satelliteTrack[${frameId}].lng`),
      latitude_deg: finiteNumber(point.lat, `satelliteTrack[${frameId}].lat`),
      projectedPosition_m: {
        x: finiteNumber(point.x, `satelliteTrack[${frameId}].x`),
        y: finiteNumber(point.y, `satelliteTrack[${frameId}].y`),
        z: finiteNumber(point.z, `satelliteTrack[${frameId}].z`),
      },
      projectedEpsg: finiteNumber(point.epsg, `satelliteTrack[${frameId}].epsg`),
    };
  });
}

export function adaptLauraycsConfigs(configs) {
  const byRole = new Map();
  for (const config of configs) {
    const classified = classifyLauraycsConfig(config);
    if (byRole.has(classified.role)) {
      throw new DomainValidationError(
        'CONFIG_ROLE_DUPLICATED',
        `Duplicate ${classified.role}`,
      );
    }
    byRole.set(classified.role, config);
  }

  const transmitterConfig = byRole.get('transmitter-config');
  const receiverConfig = byRole.get('receiver-config');
  if (!transmitterConfig || !receiverConfig) {
    throw new DomainValidationError(
      'CONFIG_ROLE_MISSING',
      'Both transmitter and receiver Lauraycs configs are required',
    );
  }

  assertEqual(
    transmitterConfig.simulation?.simulationType,
    receiverConfig.simulation?.simulationType,
    'CONFIG_SIMULATION_TYPE_MISMATCH',
    'Lauraycs simulation types do not match',
  );
  const transmitterWindow = transmitterConfig.simulation?.simulationWindow;
  const receiverWindow = receiverConfig.simulation?.simulationWindow;
  if (transmitterWindow?.startTime !== receiverWindow?.startTime
    || transmitterWindow?.endTime !== receiverWindow?.endTime) {
    throw new DomainValidationError(
      'CONFIG_SIMULATION_WINDOW_MISMATCH',
      'Lauraycs simulation windows do not match',
    );
  }

  const transmitterInterval_s = getSimulationInterval(transmitterConfig, 'transmitter');
  const receiverInterval_s = getSimulationInterval(receiverConfig, 'receiver');
  assertEqual(
    transmitterInterval_s,
    receiverInterval_s,
    'CONFIG_SAMPLE_INTERVAL_MISMATCH',
    'Lauraycs sample intervals do not match',
  );
  if (transmitterInterval_s <= 0) {
    throw new DomainValidationError(
      'CONFIG_SAMPLE_INTERVAL_INVALID',
      'Lauraycs sample interval must be positive',
    );
  }

  const startTimeMs = finiteNumber(transmitterWindow?.startTime, 'simulationWindow.startTime');
  const endTimeMs = finiteNumber(transmitterWindow?.endTime, 'simulationWindow.endTime');
  const frameCount = ((endTimeMs - startTimeMs) / (transmitterInterval_s * 1_000)) + 1;
  if (!Number.isInteger(frameCount) || frameCount <= 0) {
    throw new DomainValidationError(
      'CONFIG_FRAME_COUNT_INVALID',
      'Simulation window is not divisible by the sample interval',
    );
  }

  const transmitterNode = pickSingleNode(transmitterConfig, 'transmitter-config');
  const receiverNode = pickSingleNode(receiverConfig, 'receiver-config');
  const direction = transmitterConfig.simulation?.systemSimulationConfig?.communication?.linkDirection
    ?? receiverConfig.simulation?.systemSimulationConfig?.communication?.linkDirection;
  assertEqual(
    direction,
    receiverConfig.simulation?.systemSimulationConfig?.communication?.linkDirection,
    'CONFIG_LINK_DIRECTION_MISMATCH',
    'Lauraycs link directions do not match',
  );

  const satelliteTrack = adaptSatelliteTrack(
    transmitterConfig,
    frameCount,
    transmitterInterval_s,
  );
  if (satelliteTrack[0].projectedEpsg !== satelliteTrack.at(-1).projectedEpsg) {
    throw new DomainValidationError(
      'CONFIG_EPSG_MISMATCH',
      'Satellite track changes projected coordinate system',
    );
  }

  const txAntenna = adaptAntenna(transmitterNode.tx, 'transmitter.tx');
  const rxAntenna = adaptAntenna(receiverNode.rx, 'receiver.rx');
  const bandwidth_Hz = mhzToHz(
    transmitterConfig.simulation?.globalParams?.downlinkBandwidth
      ?? transmitterConfig.simulation?.systemSimulationConfig?.communication?.bandwidthMHz,
    'simulation.downlinkBandwidth',
  );

  return {
    link: {
      direction,
      transmitterId: String(transmitterNode.id),
      receiverId: String(receiverNode.id),
    },
    time: {
      startTimeUtc: new Date(startTimeMs).toISOString(),
      endTimeUtc: new Date(endTimeMs).toISOString(),
      sampleInterval_s: transmitterInterval_s,
      frameCount,
    },
    timestampsUtc: satelliteTrack.map((point) => point.timestampUtc),
    carrier: {
      frequency_Hz: null,
      bandwidth_Hz,
      frequencyCandidates: [
        {
          source: 'transmitter.tx.centerFrequency',
          frequency_Hz: txAntenna.configuredCenterFrequency_Hz,
        },
        {
          source: 'receiver.rx.centerFrequency',
          frequency_Hz: rxAntenna.configuredCenterFrequency_Hz,
        },
        {
          source: 'simulation.globalParams.downlinkCenterFrequency',
          frequency_Hz: mhzToHz(
            transmitterConfig.simulation?.globalParams?.downlinkCenterFrequency,
            'simulation.globalParams.downlinkCenterFrequency',
          ),
        },
      ],
    },
    coordinateReference: {
      geographicEpsg: 4326,
      projectedEpsg: satelliteTrack[0].projectedEpsg,
    },
    transmitter: {
      id: String(transmitterNode.id),
      name: transmitterNode.name ?? null,
      type: transmitterNode.type ?? null,
      txPower_dBm: finiteNumber(
        transmitterNode.txPower ?? transmitterNode.power,
        'transmitter.txPower',
      ),
      txAntenna,
    },
    receiver: {
      id: String(receiverNode.id),
      name: receiverNode.name ?? null,
      type: receiverNode.type ?? null,
      rxAntenna,
    },
    satelliteTrack,
    diagnostics: {
      warnings: [],
      assumptions: [{
        code: 'INFERRED_POWER_UNIT',
        severity: 'warning',
        path: 'transmitter.txPower_dBm',
        message: 'Lauraycs power has no explicit unit; interpreted as dBm by adapter rule',
        source: 'transmitter-config',
      }],
    },
  };
}
