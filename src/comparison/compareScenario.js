import { assertScenarioReadyForComparison } from '../domain/scenario.js';
import { DomainValidationError } from '../domain/validation.js';
import { scenarioFrameGeometry } from '../geometry/scenarioGeometry.js';
import { comparePdpMetrics, summarizeRtPathStatistics } from './comparisonMetrics.js';
import { rtFrameToPdp } from './rtChannelAdapter.js';
import { runStatisticalEnsemble } from './statisticalEnsemble.js';

export const COMPARISON_MODEL_VERSION = 'mpdb-statistical-comparison/v2';

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
  statisticalParameters = {},
  signal,
  onProgress,
} = {}) {
  assertScenarioReadyForComparison(scenario);
  const normalizedStatisticalParameters = {
    environment: statisticalParameters?.environment ?? 'suburban',
    tec_TECU: statisticalParameters?.tec_TECU ?? 50,
    scatterPowerOffset_dB: statisticalParameters?.scatterPowerOffset_dB ?? 0,
  };
  const frames = [];
  for (let frameId = 0; frameId < scenario.time.frameCount; frameId += 1) {
    if (signal?.aborted) {
      throw new DomainValidationError('COMPARISON_CANCELLED', 'Comparison was cancelled');
    }
    const geometry = scenarioFrameGeometry(scenario, frameId);
    const receiverPoint = scenario.receiver.track[frameId];
    const rt = rtFrameToPdp(scenario, frameId);
    const statistical = runStatisticalEnsemble({
      scenarioId: scenario.scenarioId,
      frameId,
      geometry,
      carrier: scenario.carrier,
      ...normalizedStatisticalParameters,
      realizationCount,
    });
    frames.push({
      frameId,
      timestampUtc: geometry.timestampUtc,
      receiver: {
        ...receiverPoint,
        source: 'rayTracing.rxPosition',
      },
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
    onProgress?.((frameId + 1) / scenario.time.frameCount);
    await Promise.resolve();
  }
  return {
    scenarioId: scenario.scenarioId,
    comparisonRevision: scenario.comparisonRevision,
    modelVersion: COMPARISON_MODEL_VERSION,
    realizationCount,
    seedScheme: 'scenario/frame/realization',
    provenance: scenario.source,
    receiverGeometry: {
      mode: 'mpdb-track',
      source: 'rayTracing.rxPosition',
      frameCount: scenario.time.frameCount,
    },
    statisticalParameters: normalizedStatisticalParameters,
    frameCounts: {
      total: scenario.time.frameCount,
      compared: frames.length,
    },
    frames,
    diagnostics: [{
      code: 'RT_ABSOLUTE_POWER_UNAVAILABLE',
      severity: 'warning',
      reason: 'UNDEFINED_H_NORMALIZATION',
    }],
  };
}
