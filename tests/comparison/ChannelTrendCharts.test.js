// @vitest-environment happy-dom
/* global document */
import * as React from 'react';
import { createRoot } from 'react-dom/client';
import { afterEach, describe, expect, it, vi } from 'vitest';
import ChannelTrendCharts from '../../src/features/channel-comparison/ChannelTrendCharts.jsx';

const { act, createElement } = React;
globalThis.IS_REACT_ACT_ENVIRONMENT = true;
vi.mock('react-chartjs-2', () => ({
  Line: ({ data, 'aria-label': label }) => createElement('div', {
    'data-label': label,
    'data-sources': data.datasets.map((dataset) => dataset.source).join(','),
  }),
}));
let root;
let container;
afterEach(() => { if (root) act(() => root.unmount()); container?.remove(); });

describe('ChannelTrendCharts', () => {
  it('keeps statistical trends without RT and uses the same active cursor', () => {
    container = document.createElement('div'); document.body.append(container); root = createRoot(container);
    const frames = [0, 1].map((position) => ({ analytics: {
      statistical: { loss: { totalPropagationLoss_dB: 180 + position }, doppler: { geometric_Hz: 10 + position } },
      rt: { availability: { status: 'not-imported' } },
    } }));
    act(() => root.render(createElement(ChannelTrendCharts, { frames, activePosition: 1 })));
    const charts = [...container.querySelectorAll('[data-sources]')];
    expect(charts[0].dataset.sources).toContain('statistical-total-loss');
    expect(charts[1].dataset.sources).toContain('statistical-doppler');
    expect(charts.every((chart) => chart.dataset.sources.includes('active-frame-cursor'))).toBe(true);
    expect(container.textContent).not.toContain('RT Doppler centroid');
  });
});
