const START_TIME_MS = 1_785_778_610_000;
const FRAME_COUNT = 179;

function simulationBlock() {
  return {
    simulationType: 'sat_sim',
    globalParams: {
      timeSampleInterval: '1',
      downlinkCenterFrequency: '2600',
      downlinkBandwidth: '100',
    },
    simulationConfig: { timeSampleInterval: 1 },
    systemSimulationConfig: {
      enabled: false,
      communication: {
        linkDirection: 'downlink',
        bandwidthMHz: 100,
      },
    },
    simulationWindow: {
      startTime: START_TIME_MS,
      endTime: START_TIME_MS + (FRAME_COUNT - 1) * 1_000,
    },
    satelliteUtmTracks: [{
      satelliteId: '47641',
      points: Array.from({ length: FRAME_COUNT }, (_, frameId) => ({
        time: START_TIME_MS + frameId * 1_000,
        lng: 100 + frameId * 0.01,
        lat: 32 + frameId * 0.01,
        x: 300_000 + frameId * 7_000,
        y: 3_800_000 + frameId * 4_000,
        z: 235_000 + frameId * 10,
        epsg: 32649,
      })),
    }],
  };
}

function antenna(centerFrequency) {
  return {
    id: 14,
    name: '1102',
    pattern: '1102',
    fileUrl: '/api/object/antenna/1102.txt',
    gain_dbi: 24.9017,
    beamwidth: 66,
    polarization: 'vertical',
    centerFrequency,
    rotationMatrix: [[1, 0, 0], [0, 1, 0], [0, 0, 1]],
    azimuth: 0,
    elevation: 0,
    twist: 0,
  };
}

export function buildLauraycsConfigFixtures() {
  const transmitterConfig = {
    type: 'lauraycs-simulation-node-config',
    version: 1,
    exportedAt: '2026-08-05T10:49:31.240Z',
    nodeGroup: 'baseStation',
    nodeGroupName: '卫星星历',
    simulation: simulationBlock(),
    nodes: [{
      id: '47641',
      name: 'STARLINK-2019',
      type: 'satellite',
      motionType: 'mobile',
      txPower: 23,
      power: '23',
      tx: antenna(25_000),
      rx: antenna(25_000),
    }],
  };

  const receiverConfig = {
    type: 'lauraycs-simulation-node-config',
    version: 1,
    exportedAt: '2026-08-05T10:49:31.229Z',
    nodeGroup: 'terminal',
    nodeGroupName: '地面终端',
    simulation: simulationBlock(),
    nodes: [{
      id: 'terminal-route-1785827004804',
      name: '终端轨迹',
      type: '终端',
      motionType: 'mobile',
      txPower: 23,
      power: '23',
      coordinateMode: 'geo',
      altitudeMode: 'relative',
      route: [{
        speed: 1,
        alt: 2,
        lng: 109.47306315218879,
        lat: 34.53676375752006,
      }],
      tx: antenna(2_500),
      rx: antenna(2_500),
    }],
  };

  return { transmitterConfig, receiverConfig };
}
