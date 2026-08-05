const decoder = new TextDecoder('utf-8', { fatal: true });
const encoder = new TextEncoder();
const MPDB_SAMPLE_COMPARISON_MODEL_VERSION = 'mpdb-statistical-comparison/v2';

export const MPDB_SAMPLE_COMPARISON_OPTIONS = Object.freeze({
  realizationCount: 32,
  statisticalParameters: Object.freeze({
    environment: 'suburban',
    tec_TECU: 50,
    scatterPowerOffset_dB: 0,
  }),
});

function parseJsonFile(file) {
  try {
    return JSON.parse(decoder.decode(file.data));
  } catch {
    return null;
  }
}

function copyBytes(data) {
  return new Uint8Array(data);
}

export function renameSampleFiles(files) {
  let configIndex = 0;
  return files.map((file) => {
    const config = parseJsonFile(file);
    const name = config?.nodeGroup
      ? `renamed-config-${String.fromCharCode(97 + configIndex++)}.json`
      : 'renamed-result.bin';
    return { name, data: copyBytes(file.data) };
  });
}

export function buildMismatchedConfigFiles(files) {
  return files.map((file) => {
    const config = parseJsonFile(file);
    if (config?.nodeGroup !== 'terminal') {
      return { name: file.name, data: copyBytes(file.data) };
    }

    const mismatched = structuredClone(config);
    const window = mismatched.simulation?.simulationWindow;
    if (!window || !Number.isFinite(Number(window.endTime))) {
      throw new Error('接收端配置缺少有效的 simulation.simulationWindow.endTime');
    }
    window.endTime = Number(window.endTime) + 1_000;
    return {
      name: 'mismatched-terminal-config.json',
      data: encoder.encode(JSON.stringify(mismatched)),
    };
  });
}

export function assertExpectedMpdbSample(scenario) {
  const checks = [
    ['frameCount', scenario?.time?.frameCount, 179],
    ['rayCount', scenario?.rayTracing?.delay_s?.length, 465_512],
    ['frequency_Hz', scenario?.carrier?.frequency_Hz, 24_950_000_000],
  ];
  for (const [name, actual, expected] of checks) {
    if (actual !== expected) {
      throw new Error(`MPDB 样本验收失败: ${name}=${actual}, expected ${expected}`);
    }
  }

  const residual = scenario?.coordinateReference?.alignmentRmsResidual_m;
  if (!Number.isFinite(residual) || residual >= 0.05) {
    throw new Error(
      `MPDB 样本验收失败: alignmentRmsResidual_m=${residual}, expected < 0.05`,
    );
  }
}

export function assertExpectedReceiverTrackMotion(summary) {
  const expectedFrameCount = 179;
  const expectedMovingFrameCount = 108;
  const expectedStationaryFrameCount = 70;
  const counts = [
    ['frameCount', summary?.frameCount],
    ['movingFrameCount', summary?.movingFrameCount],
    ['stationaryFrameCount', summary?.stationaryFrameCount],
  ];
  for (const [name, value] of counts) {
    if (!Number.isInteger(value) || value < 0) {
      throw new Error(`MPDB 接收机运动验收失败: ${name}=${value}, expected non-negative integer`);
    }
  }
  if (summary.frameCount !== expectedFrameCount) {
    throw new Error(
      `MPDB 接收机运动验收失败: frameCount=${summary.frameCount}, expected ${expectedFrameCount}`,
    );
  }
  const intervalCount = summary.movingFrameCount + summary.stationaryFrameCount;
  if (intervalCount !== summary.frameCount - 1) {
    throw new Error(
      `MPDB 接收机运动验收失败: interval count=${intervalCount}, expected ${summary.frameCount - 1}`,
    );
  }
  if (summary.movingFrameCount <= 0) {
    throw new Error('MPDB 接收机运动验收失败: movingFrameCount must be positive');
  }
  if (summary.stationaryFrameCount <= 0) {
    throw new Error('MPDB 接收机运动验收失败: stationaryFrameCount must be positive');
  }
  if (summary.movingFrameCount !== expectedMovingFrameCount) {
    throw new Error(
      `MPDB 接收机运动验收失败: movingFrameCount=${summary.movingFrameCount}, expected ${expectedMovingFrameCount}`,
    );
  }
  if (summary.stationaryFrameCount !== expectedStationaryFrameCount) {
    throw new Error(
      `MPDB 接收机运动验收失败: stationaryFrameCount=${summary.stationaryFrameCount}, expected ${expectedStationaryFrameCount}`,
    );
  }
  if (!Number.isFinite(summary.totalDistance_m) || summary.totalDistance_m <= 0) {
    throw new Error(
      `MPDB 接收机运动验收失败: totalDistance_m=${summary.totalDistance_m}, expected finite positive`,
    );
  }
}

export function assertDynamicComparisonReport(report, expectedFrameCount) {
  const frames = report?.frames;
  if (!Array.isArray(frames) || frames.length !== expectedFrameCount) {
    throw new Error(
      `MPDB 动态比较验收失败: frames.length=${frames?.length}, expected ${expectedFrameCount}`,
    );
  }

  const expectedMetadata = [
    ['modelVersion', report?.modelVersion, MPDB_SAMPLE_COMPARISON_MODEL_VERSION],
    ['receiverGeometry.mode', report?.receiverGeometry?.mode, 'mpdb-track'],
    ['receiverGeometry.frameCount', report?.receiverGeometry?.frameCount, expectedFrameCount],
    ['realizationCount', report?.realizationCount, MPDB_SAMPLE_COMPARISON_OPTIONS.realizationCount],
    ['frameCounts.total', report?.frameCounts?.total, expectedFrameCount],
    ['frameCounts.compared', report?.frameCounts?.compared, expectedFrameCount],
    [
      'statisticalParameters.environment',
      report?.statisticalParameters?.environment,
      MPDB_SAMPLE_COMPARISON_OPTIONS.statisticalParameters.environment,
    ],
    [
      'statisticalParameters.tec_TECU',
      report?.statisticalParameters?.tec_TECU,
      MPDB_SAMPLE_COMPARISON_OPTIONS.statisticalParameters.tec_TECU,
    ],
    [
      'statisticalParameters.scatterPowerOffset_dB',
      report?.statisticalParameters?.scatterPowerOffset_dB,
      MPDB_SAMPLE_COMPARISON_OPTIONS.statisticalParameters.scatterPowerOffset_dB,
    ],
  ];
  for (const [path, actual, expected] of expectedMetadata) {
    if (actual !== expected) {
      throw new Error(`MPDB 动态比较验收失败: ${path}=${actual}, expected ${expected}`);
    }
  }

  const metricNames = [
    'jsDivergence_bits',
    'weightedDelayDistance_s',
    'rmsDelaySpreadDifference_s',
  ];
  for (let frameIndex = 0; frameIndex < frames.length; frameIndex += 1) {
    if (!(frameIndex in frames)) {
      throw new Error(
        `MPDB 动态比较验收失败: frame[${frameIndex}]=<empty>, expected object`,
      );
    }
    const frame = frames[frameIndex];
    if (frame === null || typeof frame !== 'object' || Array.isArray(frame)) {
      throw new Error(
        `MPDB 动态比较验收失败: frame[${frameIndex}]=${String(frame)}, expected object`,
      );
    }
    if (frame.frameId !== frameIndex) {
      throw new Error(
        `MPDB 动态比较验收失败: frame[${frameIndex}].frameId=${frame.frameId}, expected ${frameIndex}`,
      );
    }
    for (const metricName of metricNames) {
      const value = frame.metrics?.[metricName];
      if (!Number.isFinite(value)) {
        throw new Error(
          `MPDB 动态比较验收失败: frame[${frameIndex}].metrics.${metricName}=${value}, expected finite`,
        );
      }
    }
  }
}
