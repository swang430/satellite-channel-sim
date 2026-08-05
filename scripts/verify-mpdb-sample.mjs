import { readFile } from 'node:fs/promises';
import { basename } from 'node:path';
import { importMpdbBundle } from '../src/importers/mpdb/importMpdbBundle.js';
import {
  assertExpectedMpdbSample,
  buildMismatchedConfigFiles,
  renameSampleFiles,
} from './mpdbSampleVerification.js';

const paths = process.argv.slice(2);
if (paths.length !== 3) {
  console.error('用法: node scripts/verify-mpdb-sample.mjs <MPDB.zip> <发射端配置.json> <接收端配置.json>');
  process.exitCode = 2;
} else {
  const files = await Promise.all(paths.map(async (path) => ({
    name: basename(path),
    data: new Uint8Array(await readFile(path)),
  })));
  const scenario = await importMpdbBundle(files);
  assertExpectedMpdbSample(scenario);

  const renamedScenario = await importMpdbBundle(renameSampleFiles(files));
  assertExpectedMpdbSample(renamedScenario);
  if (renamedScenario.scenarioId !== scenario.scenarioId) {
    throw new Error('MPDB 样本验收失败: 文件改名后 scenarioId 发生变化');
  }

  let mismatchedError = null;
  try {
    await importMpdbBundle(buildMismatchedConfigFiles(files));
  } catch (error) {
    mismatchedError = error;
  }
  if (!mismatchedError) {
    throw new Error('MPDB 样本验收失败: 不一致的收发端配置未被拒绝');
  }
  if (mismatchedError.code !== 'CONFIG_SIMULATION_WINDOW_MISMATCH') {
    throw new Error(
      `MPDB 样本验收失败: 配置不一致返回 ${mismatchedError.code ?? mismatchedError.name}`,
    );
  }

  const report = {
    scenarioId: scenario.scenarioId,
    frameCount: scenario.time.frameCount,
    rayCount: scenario.rayTracing.delay_s.length,
    frequency_Hz: scenario.carrier.frequency_Hz,
    bandwidth_Hz: scenario.carrier.bandwidth_Hz,
    alignmentRmsResidual_m: scenario.coordinateReference.alignmentRmsResidual_m,
    alignmentMaxResidual_m: scenario.coordinateReference.alignmentMaxResidual_m,
    groundCandidateCount: scenario.groundCandidates.length,
    groundSelection: scenario.groundSelection,
    warnings: scenario.diagnostics.warnings,
    renamedImport: {
      status: 'passed',
      scenarioIdStable: true,
    },
    mismatchedConfig: {
      status: 'rejected',
      code: mismatchedError.code,
    },
  };
  console.log(JSON.stringify(report, null, 2));
}
