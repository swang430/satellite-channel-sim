const decoder = new TextDecoder('utf-8', { fatal: true });
const encoder = new TextEncoder();

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
