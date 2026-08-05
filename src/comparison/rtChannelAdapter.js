import { DomainValidationError } from '../domain/validation.js';
import { calculateChannelMetrics } from '../channel/channelMetrics.js';
import { buildPdp } from '../channel/pdp.js';

const FRAME_COLUMNS = [
  'delay_s',
  'hReal',
  'hImag',
  'channelType',
  'aoa_deg',
  'zoa_deg',
  'aod_deg',
  'zod_deg',
  'pathLength_m',
  'doppler_Hz',
];

export function getRtFrameView(scenario, frameId) {
  const offsets = scenario?.rayTracing?.frameOffsets;
  if (!Number.isInteger(frameId) || frameId < 0 || !offsets || frameId + 1 >= offsets.length) {
    throw new DomainValidationError('RT_FRAME_OUT_OF_RANGE', `RT frame ${frameId} is invalid`);
  }
  const start = offsets[frameId];
  const end = offsets[frameId + 1];
  const view = { frameId, rayStart: start, rayEnd: end, rayCount: end - start };
  for (const column of FRAME_COLUMNS) {
    if (scenario.rayTracing[column]) {
      view[column] = scenario.rayTracing[column].subarray(start, end);
    }
  }
  return view;
}

export function rtFrameToPdp(scenario, frameId) {
  const view = getRtFrameView(scenario, frameId);
  if (view.rayCount === 0) {
    throw new DomainValidationError('RT_FRAME_EMPTY', `RT frame ${frameId} contains no rays`);
  }
  const paths = Array.from({ length: view.rayCount }, (_, index) => ({
    absoluteDelay_s: view.delay_s[index],
    complexAmplitude: { real: view.hReal[index], imag: view.hImag[index] },
  }));
  const pdp = buildPdp(paths, { bandwidth_Hz: scenario.carrier.bandwidth_Hz });
  return {
    view,
    pdp,
    metrics: calculateChannelMetrics(pdp),
    absolutePower: {
      status: 'unavailable',
      reason: 'UNDEFINED_H_NORMALIZATION',
    },
  };
}

