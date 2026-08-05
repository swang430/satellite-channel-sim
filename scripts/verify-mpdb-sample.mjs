import { readFile } from 'node:fs/promises';
import { basename } from 'node:path';
import { compareScenario } from '../src/comparison/compareScenario.js';
import { summarizeReceiverTrack } from '../src/features/mpdb-import/receiverTrack.js';
import { importMpdbBundle } from '../src/importers/mpdb/importMpdbBundle.js';
import {
  assertDynamicComparisonReport,
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

  const comparisonStartedAt_ms = performance.now();
  const comparisonReport = await compareScenario(scenario);
  const comparisonElapsed_ms = performance.now() - comparisonStartedAt_ms;
  assertDynamicComparisonReport(comparisonReport, scenario.time.frameCount);
  const receiverTrackSummary = summarizeReceiverTrack(scenario.receiver.track);

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
    warnings: scenario.diagnostics.warnings,
    dynamicComparison: {
      status: 'passed',
      receiverGeometryMode: comparisonReport.receiverGeometry.mode,
      comparedFrameCount: comparisonReport.frameCounts.compared,
      realizationCount: comparisonReport.realizationCount,
      initialFrameCount: receiverTrackSummary.frameCount > 0 ? 1 : 0,
      movingFrameCount: receiverTrackSummary.movingFrameCount,
      stationaryFrameCount: receiverTrackSummary.stationaryFrameCount,
      totalDistance_m: receiverTrackSummary.totalDistance_m,
      elapsed_ms: comparisonElapsed_ms,
    },
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
