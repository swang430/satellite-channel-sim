import { readFile } from 'node:fs/promises';
import { basename } from 'node:path';
import { importMpdbBundle } from '../src/importers/mpdb/importMpdbBundle.js';

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
  const checks = [
    [scenario.time.frameCount === 179, `frameCount=${scenario.time.frameCount}, expected 179`],
    [scenario.rayTracing.delay_s.length === 465_512, `rayCount=${scenario.rayTracing.delay_s.length}, expected 465512`],
    [scenario.carrier.frequency_Hz === 24_950_000_000, `frequency_Hz=${scenario.carrier.frequency_Hz}, expected 24950000000`],
    [scenario.coordinateReference.alignmentRmsResidual_m < 0.05, `alignmentRmsResidual_m=${scenario.coordinateReference.alignmentRmsResidual_m}, expected < 0.05`],
  ];
  const failed = checks.find(([passed]) => !passed);
  if (failed) throw new Error(`MPDB 样本验收失败: ${failed[1]}`);
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
  };
  console.log(JSON.stringify(report, null, 2));
}
