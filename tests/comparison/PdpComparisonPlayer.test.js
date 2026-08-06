// @vitest-environment happy-dom
/* global document, window */

import * as React from 'react';
import { createRoot } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import PdpComparisonPlayer from '../../src/features/channel-comparison/PdpComparisonPlayer.jsx';

const { act, createElement } = React;
globalThis.React = React;

vi.mock('react-chartjs-2', () => ({
  Line: ({ data, role, 'aria-label': ariaLabel }) => createElement('div', {
    role,
    'aria-label': ariaLabel,
    'data-sources': data.datasets.map((dataset) => dataset.source).join(','),
  }),
}));

globalThis.IS_REACT_ACT_ENVIRONMENT = true;

function comparisonFrameFixture({
  frameId,
  timestampUtc,
  receiverX_m,
  longitude_deg = 116.3,
  latitude_deg = 39.9,
} = {}) {
  return {
    frameId,
    timestampUtc,
    receiver: {
      frameId,
      timestampUtc,
      longitude_deg,
      latitude_deg,
      altitude_m: 50,
      projectedPosition_m: { x: receiverX_m, y: 0, z: 0 },
      source: 'rayTracing.rxPosition',
    },
    geometry: {
      frameId,
      timestampUtc,
      receiverPosition_m: { x: receiverX_m, y: 0, z: 0 },
      transmitterPosition_m: { x: 2_000, y: 0, z: 700_000 },
      elevation_deg: 89.5,
      slantRange_m: 700_003,
    },
    rt: {
      pdp: {
        binWidth_s: 10e-9,
        bins: [
          { binIndex: 0, excessDelay_s: 0, relativePower_dB: 0 },
          { binIndex: 1, excessDelay_s: 10e-9, relativePower_dB: -6 },
        ],
      },
      absolutePower: { available: false, reason: 'UNDEFINED_H_NORMALIZATION' },
    },
    statistical: {
      realizationCount: 32,
      binWidth_s: 10e-9,
      binIndices: [0, 1],
      excessDelay_s: [0, 10e-9],
      summary: {
        median: [1, 0.1],
        p5: [0.5, 0.05],
        p95: [1, 0.2],
      },
      metricSummary: {
        rmsDelaySpread_s: { median: 8e-9, p5: 7e-9, p95: 9e-9 },
        coherenceBandwidth_Hz: { median: 25e6, p5: 20e6, p95: 30e6 },
      },
    },
    metrics: {
      jsDivergence_bits: 0.125,
      rmsDelaySpreadDifference_s: -2e-9,
      weightedDelayDistance_s: 4e-9,
    },
  };
}

function comparisonReportFixture({ firstFrameId = 3, secondFrameId = 8 } = {}) {
  return {
    scenarioId: `sha256:${firstFrameId}-${secondFrameId}`,
    modelVersion: 'mpdb-statistical-comparison/v2',
    receiverGeometry: {
      mode: 'mpdb-track',
      source: 'rayTracing.rxPosition',
      frameCount: 2,
    },
    diagnostics: [{
      code: 'RT_ABSOLUTE_POWER_UNAVAILABLE',
      severity: 'warning',
      reason: 'UNDEFINED_H_NORMALIZATION',
    }],
    frames: [
      comparisonFrameFixture({
        frameId: firstFrameId,
        timestampUtc: '2026-08-05T00:00:03.000Z',
        receiverX_m: 0,
      }),
      comparisonFrameFixture({
        frameId: secondFrameId,
        timestampUtc: '2026-08-05T00:00:08.000Z',
        receiverX_m: 1,
        longitude_deg: 116.30001,
        latitude_deg: 39.90001,
      }),
    ],
  };
}

function statisticalReportFixture() {
  const report = comparisonReportFixture();
  report.modelVersion = 'statistical-playback/v1';
  report.receiverGeometry = { mode: 'fixed-ground-station', frameCount: 2 };
  report.timeWindow = {
    source: 'selected-pass',
    startTimeUtc: '2026-08-05T00:00:03.000Z',
    endTimeUtc: '2026-08-05T00:00:08.000Z',
    sampleInterval_s: 5,
    frameCount: 2,
  };
  report.diagnostics = [];
  report.frames.forEach((frame, index) => {
    delete frame.rt;
    delete frame.metrics;
    frame.link = { rxPower_dBm: -91 + index, snr_dB: 12 + index };
  });
  return report;
}

function chartSources(container) {
  return container.querySelector('[role="img"]')?.dataset.sources.split(',') ?? [];
}

function click(element) {
  act(() => element.click());
}

function advance(milliseconds) {
  act(() => vi.advanceTimersByTime(milliseconds));
}

function changeInput(input, value) {
  act(() => {
    const setValue = Object.getOwnPropertyDescriptor(
      window.HTMLInputElement.prototype,
      'value',
    ).set;
    setValue.call(input, value);
    input.dispatchEvent(new Event('input', { bubbles: true }));
  });
}

describe('PdpComparisonPlayer', () => {
  let container;
  let root;

  beforeEach(() => {
    vi.useFakeTimers();
    container = document.createElement('div');
    document.body.append(container);
    root = createRoot(container);
  });

  afterEach(() => {
    if (root) act(() => root.unmount());
    vi.clearAllTimers();
    vi.useRealTimers();
    container.remove();
    vi.restoreAllMocks();
  });

  function render(report, props = {}) {
    act(() => root.render(createElement(PdpComparisonPlayer, { report, ...props })));
  }

  it('shows RT by default and keeps all statistical datasets when RT is disabled', () => {
    render(comparisonReportFixture());

    const overlay = container.querySelector('input[aria-label="RT 叠加"]');
    expect(overlay.checked).toBe(true);
    expect(chartSources(container)).toEqual([
      'statistical-median',
      'statistical-p5-p95',
      'rt',
    ]);
    expect(container.querySelector('[role="img"]').getAttribute('aria-label'))
      .toContain('RT PDP 已显示');

    click(overlay);

    expect(overlay.checked).toBe(false);
    expect(chartSources(container)).toEqual([
      'statistical-median',
      'statistical-p5-p95',
    ]);
    expect(container.querySelector('[role="img"]').getAttribute('aria-label'))
      .toContain('RT PDP 已隐藏');
  });

  it('keeps the statistical PDP visible while a scene-parameter refresh disables RT', () => {
    render(comparisonReportFixture(), {
      rtAvailable: false,
      isRefreshing: true,
    });

    const overlay = container.querySelector('input[aria-label="RT 叠加"]');
    expect(overlay.disabled).toBe(true);
    expect(overlay.checked).toBe(false);
    expect(chartSources(container)).toEqual([
      'statistical-median',
      'statistical-p5-p95',
    ]);
    expect(container.textContent).toContain('统计 PDP 正在根据新的场景参数自动刷新');
    expect(container.textContent).not.toContain('JS divergence');
    expect(container.textContent).not.toContain('RMS 时延扩展差');
    expect(container.textContent).not.toContain('UNDEFINED_H_NORMALIZATION');
  });

  it('presents the selected pass as a first-class statistical PDP playback window', () => {
    render(statisticalReportFixture());

    expect(container.querySelector('input[aria-label="RT 叠加"]')).toBeNull();
    expect(chartSources(container)).toEqual([
      'statistical-median',
      'statistical-p5-p95',
    ]);
    expect(container.textContent).toContain('已选过顶窗口');
    expect(container.textContent).toContain('2026-08-05T00:00:03.000Z');
    expect(container.textContent).toContain('2 帧');
    expect(container.textContent).toContain('统计 RMS 时延扩展 8.000 ns');
    expect(container.textContent).toContain('统计相干带宽 25.000 MHz');
    expect(container.textContent).toContain('Rx -91.00 dBm');
    expect(container.textContent).not.toContain('MPDB 接收机轨迹');
  });

  it('advances non-contiguous frame IDs at the default FPS and stays still while paused', () => {
    render(comparisonReportFixture());
    click(container.querySelector('button[aria-label="播放 PDP 对比"]'));

    advance(500);
    expect(container.textContent).toContain('MPDB FRAME 8');

    click(container.querySelector('button[aria-label="暂停 PDP 对比播放"]'));
    advance(1_000);
    expect(container.textContent).toContain('MPDB FRAME 8');
  });

  it('publishes the active playback position for trajectory synchronization', () => {
    const onPositionChange = vi.fn();
    render(statisticalReportFixture(), { onPositionChange });

    expect(onPositionChange).toHaveBeenLastCalledWith({
      position: 0,
      frameId: 3,
      timestampUtc: '2026-08-05T00:00:03.000Z',
    });

    click(container.querySelector('button[aria-label="播放 PDP 对比"]'));
    advance(500);
    expect(onPositionChange).toHaveBeenLastCalledWith({
      position: 1,
      frameId: 8,
      timestampUtc: '2026-08-05T00:00:08.000Z',
    });
  });

  it('accepts any integer FPS from 1 through 60 and advances at 37 FPS', () => {
    const clearIntervalSpy = vi.spyOn(window, 'clearInterval');
    const setIntervalSpy = vi.spyOn(window, 'setInterval');
    render(comparisonReportFixture());
    const speed = container.querySelector('input[aria-label="播放速度"]');
    expect(speed).not.toBeNull();
    expect(speed.type).toBe('number');
    expect(speed.min).toBe('1');
    expect(speed.max).toBe('60');
    expect(speed.step).toBe('1');
    expect(speed.value).toBe('2');

    changeInput(speed, '37');
    click(container.querySelector('button[aria-label="播放 PDP 对比"]'));

    advance(26);
    expect(container.textContent).toContain('MPDB FRAME 3');
    advance(1);
    expect(container.textContent).toContain('MPDB FRAME 8');

    changeInput(speed, '60');
    expect(clearIntervalSpy).toHaveBeenCalled();
    expect(setIntervalSpy).toHaveBeenLastCalledWith(expect.any(Function), 1000 / 60);
    changeInput(speed, '1');
    expect(setIntervalSpy).toHaveBeenLastCalledWith(expect.any(Function), 1_000);
  });

  it.each(['0', '61', '1.5', ''])('ignores invalid playback FPS %j', (invalidFps) => {
    const setIntervalSpy = vi.spyOn(window, 'setInterval');
    render(comparisonReportFixture());
    const speed = container.querySelector('input[aria-label="播放速度"]');
    changeInput(speed, '1');
    click(container.querySelector('button[aria-label="播放 PDP 对比"]'));
    expect(setIntervalSpy).toHaveBeenLastCalledWith(expect.any(Function), 1_000);
    const callCount = setIntervalSpy.mock.calls.length;

    changeInput(speed, invalidFps);

    expect(setIntervalSpy).toHaveBeenCalledTimes(callCount);
    advance(999);
    expect(container.textContent).toContain('MPDB FRAME 3');
    advance(1);
    expect(container.textContent).toContain('MPDB FRAME 8');
  });

  it('resets and stops for a new report or a replacement frames array', () => {
    const report = comparisonReportFixture();
    render(report);
    click(container.querySelector('button[aria-label="播放 PDP 对比"]'));
    advance(500);
    expect(container.textContent).toContain('MPDB FRAME 8');

    const replacementReport = comparisonReportFixture({
      firstFrameId: 13,
      secondFrameId: 18,
    });
    render(replacementReport);
    expect(container.textContent).toContain('MPDB FRAME 13');
    expect(container.querySelector('button[aria-label="播放 PDP 对比"]')).not.toBeNull();
    advance(1_000);
    expect(container.textContent).toContain('MPDB FRAME 13');

    replacementReport.frames = comparisonReportFixture({
      firstFrameId: 21,
      secondFrameId: 28,
    }).frames;
    render(replacementReport);
    expect(container.textContent).toContain('MPDB FRAME 21');
    expect(container.querySelector('button[aria-label="播放 PDP 对比"]')).not.toBeNull();
    advance(1_000);
    expect(container.textContent).toContain('MPDB FRAME 21');
  });

  it('keeps the timestamp position when statistical parameters refresh the same window', () => {
    const report = statisticalReportFixture();
    render(report);
    click(container.querySelector('button[aria-label="播放 PDP 对比"]'));
    advance(500);
    expect(container.textContent).toContain('FRAME 8');

    const refreshed = statisticalReportFixture();
    refreshed.statisticalParameters = { environment: 'urban', tec_TECU: 60 };
    refreshed.frames[1].statistical.summary.median = [1, 0.2];
    render(refreshed);

    expect(container.textContent).toContain('FRAME 8');
    expect(container.querySelector('button[aria-label="播放 PDP 对比"]')).not.toBeNull();
    advance(1_000);
    expect(container.textContent).toContain('FRAME 8');
  });

  it('cleans the playback interval on unmount without leaking a state update', () => {
    const clearIntervalSpy = vi.spyOn(window, 'clearInterval');
    const consoleErrorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    render(comparisonReportFixture());
    click(container.querySelector('button[aria-label="播放 PDP 对比"]'));

    act(() => root.unmount());
    root = null;
    advance(1_000);

    expect(clearIntervalSpy).toHaveBeenCalled();
    expect(consoleErrorSpy).not.toHaveBeenCalled();
  });

  it('renders a structured alert for an invalid report instead of throwing', () => {
    expect(() => render({ diagnostics: [], frames: [] })).not.toThrow();

    const alert = container.querySelector('[role="alert"]');
    expect(alert).not.toBeNull();
    expect(alert.textContent).toContain('COMPARISON_PLOT_DATA_INVALID');
  });

  it('renders a structured alert for a sparse report instead of crashing', () => {
    const report = comparisonReportFixture();
    report.frames.push(structuredClone(report.frames[1]));
    delete report.frames[1];

    expect(() => render(report)).not.toThrow();

    const alert = container.querySelector('[role="alert"]');
    expect(alert).not.toBeNull();
    expect(alert.textContent).toContain('frames[1]');
    expect(alert.textContent).toContain('COMPARISON_PLOT_DATA_INVALID');
  });
});
