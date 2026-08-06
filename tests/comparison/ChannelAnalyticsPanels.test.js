// @vitest-environment happy-dom
/* global document */
import * as React from 'react';
import { createRoot } from 'react-dom/client';
import { afterEach, describe, expect, it } from 'vitest';
import ChannelAnalyticsPanels from '../../src/features/channel-comparison/ChannelAnalyticsPanels.jsx';

globalThis.IS_REACT_ACT_ENVIRONMENT = true;
const { act, createElement } = React;
let root;
let container;

afterEach(() => {
  if (root) act(() => root.unmount());
  container?.remove();
});

function render(rt) {
  container = document.createElement('div');
  document.body.append(container);
  root = createRoot(container);
  act(() => root.render(createElement(ChannelAnalyticsPanels, { analytics: {
    frameId: 4,
    timestampUtc: '2026-08-05T00:00:04Z',
    geometry: { elevation_deg: 45, slantRange_m: 700_000 },
    statistical: {
      loss: { fspl_dB: 177, totalPropagationLoss_dB: 180, components_dB: {
        rain: 1, gas: 1, cloud: 0.5, shadow: 0.2, faraday: 0.1,
        pointing: 0.1, scan: 0, multipath: 0, scintillation: 0.1,
      } },
      link: { rxPower_dBm: -90, noisePower_dBm: -110, snr_dB: 20 },
      delay: { rmsDelaySpread_s: 8e-9, coherenceBandwidth_Hz: 25e6 },
      doppler: { geometric_Hz: 12_000 },
    },
    rt,
  } })));
}

describe('ChannelAnalyticsPanels', () => {
  it('always renders statistical loss and frame details when RT is absent', () => {
    render({ availability: { status: 'not-imported' } });
    expect(container.textContent).toContain('Statistical Total Loss 180.000 dB');
    expect(container.textContent).toContain('Stat Doppler 12000.000 Hz');
    expect(container.textContent).toContain('RT 未导入');
  });

  it('adds synthesized RT metrics and the absolute path-loss warning', () => {
    render({
      availability: { status: 'available' },
      relativeGain: { relativeToWindowPeak_dB: -2, relativeToFirstFrame_dB: 1 },
      doppler: { centroid_Hz: 10_000, rmsSpread_Hz: 300, dominantPath_Hz: 10_100, dominantPowerShare: 0.8 },
      pathCount: 20,
    });
    expect(container.textContent).toContain('RT Doppler Centroid 10000.000 Hz');
    expect(container.textContent).toContain('RT_ABSOLUTE_PATH_LOSS_UNAVAILABLE');
  });
});
