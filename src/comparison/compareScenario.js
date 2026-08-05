import { DomainValidationError } from '../domain/validation.js';
import { scenarioFrameGeometry } from '../geometry/scenarioGeometry.js';
import { comparePdpMetrics, summarizeRtPathStatistics } from './comparisonMetrics.js';
import { classifyScenarioFrames } from './frameAlignment.js';
import { rtFrameToPdp } from './rtChannelAdapter.js';
import { runStatisticalEnsemble } from './statisticalEnsemble.js';

export const COMPARISON_MODEL_VERSION = 'mpdb-statistical-comparison/v1';

function ensembleMedianPdp(ensemble) {
  return {
    binWidth_s: ensemble.binWidth_s,
    bins: ensemble.binIndices.map((binIndex, index) => ({
      binIndex,
      excessDelay_s: ensemble.excessDelay_s[index],
      coherentPower_linear: ensemble.summary.median[index],
    })),
  };
}

export async function compareScenario(scenario, {
  realizationCount = 32,
  includeApproximate = false,
  environment = 'suburban',
  signal,
  onProgress,
} = {}) {
  if (!scenario?.groundSelection || scenario.groundSelection.selectedBy !== 'user') {
    throw new DomainValidationError(
      'GROUND_FRAME_REQUIRED',
      'Select and confirm a ground frame before comparison',
    );
  }
  const alignment = classifyScenarioFrames(scenario);
  const selected = includeApproximate
    ? [...alignment.exact, ...alignment.approximate]
    : alignment.exact;
  const frames = [];
  for (let index = 0; index < selected.length; index += 1) {
    if (signal?.aborted) {
      throw new DomainValidationError('COMPARISON_CANCELLED', 'Comparison was cancelled');
    }
    const frame = selected[index];
    const geometry = scenarioFrameGeometry(scenario, frame.frameId);
    const rt = rtFrameToPdp(scenario, frame.frameId);
    const statistical = runStatisticalEnsemble({
      scenarioId: scenario.scenarioId,
      frameId: frame.frameId,
      geometry,
      carrier: scenario.carrier,
      environment,
      realizationCount,
    });
    frames.push({
      ...frame,
      geometry,
      rt: {
        pdp: rt.pdp,
        metrics: rt.metrics,
        absolutePower: rt.absolutePower,
        pathStatistics: summarizeRtPathStatistics(rt.view),
      },
      statistical,
      metrics: comparePdpMetrics(rt.pdp, ensembleMedianPdp(statistical)),
    });
    onProgress?.((index + 1) / selected.length);
    await Promise.resolve();
  }
  return {
    scenarioId: scenario.scenarioId,
    comparisonRevision: scenario.comparisonRevision,
    modelVersion: COMPARISON_MODEL_VERSION,
    realizationCount,
    seedScheme: 'scenario/frame/realization',
    groundSelection: scenario.groundSelection,
    provenance: scenario.source,
    frameCounts: {
      exact: alignment.exact.length,
      approximate: alignment.approximate.length,
      compared: frames.length,
    },
    frames,
    approximateFrames: alignment.approximate,
    diagnostics: [{
      code: 'RT_ABSOLUTE_POWER_UNAVAILABLE',
      severity: 'warning',
      reason: 'UNDEFINED_H_NORMALIZATION',
    }],
  };
}

