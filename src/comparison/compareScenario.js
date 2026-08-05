import { assertScenarioReadyForComparison } from '../domain/scenario.js';
import { DomainValidationError } from '../domain/validation.js';
import { scenarioFrameGeometry } from '../geometry/scenarioGeometry.js';
import { comparePdpMetrics, summarizeRtPathStatistics } from './comparisonMetrics.js';
import { rtFrameToPdp } from './rtChannelAdapter.js';
import {
  normalizeStatisticalEnsembleParameters,
  runStatisticalEnsemble,
} from './statisticalEnsemble.js';

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

function throwIfComparisonAborted(signal) {
  if (signal?.aborted) {
    throw new DomainValidationError('COMPARISON_CANCELLED', 'Comparison was cancelled');
  }
}

async function yieldToHost() {
  const schedulerYield = globalThis.scheduler?.yield;
  if (typeof schedulerYield === 'function') {
    await schedulerYield.call(globalThis.scheduler);
    return;
  }
  await new Promise((resolve) => globalThis.setTimeout(resolve, 0));
}

export async function compareScenario(scenario, {
  realizationCount = 32,
  statisticalParameters = {},
  signal,
  onProgress,
} = {}) {
  assertScenarioReadyForComparison(scenario);
  const normalizedEnsembleParameters = normalizeStatisticalEnsembleParameters({
    realizationCount,
    environment: statisticalParameters?.environment,
    tec_TECU: statisticalParameters?.tec_TECU,
    scatterPowerOffset_dB: statisticalParameters?.scatterPowerOffset_dB,
  });
  const normalizedStatisticalParameters = {
    environment: normalizedEnsembleParameters.environment,
    tec_TECU: normalizedEnsembleParameters.tec_TECU,
    scatterPowerOffset_dB: normalizedEnsembleParameters.scatterPowerOffset_dB,
  };
  const frames = [];
  for (let frameId = 0; frameId < scenario.time.frameCount; frameId += 1) {
    throwIfComparisonAborted(signal);
    const geometry = scenarioFrameGeometry(scenario, frameId);
    const receiverPoint = scenario.receiver.track[frameId];
    const rt = rtFrameToPdp(scenario, frameId);
    const statistical = runStatisticalEnsemble({
      scenarioId: scenario.scenarioId,
      frameId,
      geometry,
      carrier: scenario.carrier,
      ...normalizedStatisticalParameters,
      realizationCount: normalizedEnsembleParameters.realizationCount,
    });
    frames.push({
      frameId,
      timestampUtc: geometry.timestampUtc,
      receiver: {
        ...receiverPoint,
        projectedPosition_m: { ...receiverPoint.projectedPosition_m },
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
    await yieldToHost();
    throwIfComparisonAborted(signal);
  }
  return {
    scenarioId: scenario.scenarioId,
    modelVersion: COMPARISON_MODEL_VERSION,
    realizationCount: normalizedEnsembleParameters.realizationCount,
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
