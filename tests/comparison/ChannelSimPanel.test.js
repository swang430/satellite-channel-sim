// @vitest-environment happy-dom
/* global document, window */

import * as React from 'react';
import { createRoot } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import ChannelSimPanel from '../../src/ChannelSimPanel.jsx';
import { generateChannelTimeSeries, predictPasses } from '../../src/model.js';
import { buildStatisticalPlaybackReport } from '../../src/features/channel-comparison/statisticalPlaybackReport.js';

const { act, createElement } = React;
globalThis.React = React;
globalThis.IS_REACT_ACT_ENVIRONMENT = true;

vi.mock('react-chartjs-2', () => ({
  Line: () => createElement('div', { 'data-testid': 'line-chart' }),
  Bar: () => createElement('div', { 'data-testid': 'bar-chart' }),
}));

vi.mock('../../src/model.js', async () => {
  const actual = await vi.importActual('../../src/model.js');
  return {
    ...actual,
    generateChannelTimeSeries: vi.fn(() => [0, 1, 2].map((index) => ({
      time: new Date(`2026-08-05T00:00:0${index}.000Z`),
      timeLabel: `FREE-${index}`,
      elevation: 45 + index,
      azimuth: 120,
      slantRange: 700,
      absoluteFspl: 177,
      rxPowerDbm: -90 + index,
      noiseFloorDbm: -110,
      snrDb: 20 + index,
      dopplerHz: 100,
      attRain: 0,
      attGas: 0,
      attCloud: 0,
      totalAtmosphericLoss: 0,
      fadeLMS: 0,
      lossFaraday: 0,
      pointingLoss: 0,
      scintLoss: 0,
      tSky: 100,
      xpd: 20,
      capRank1: 1,
      capRank2: 1,
      groupDelayNs: 1,
      dispersionNs: 1,
      satLat: 0,
      satLon: 0,
      satAlt: 700,
      cir: {
        taps: [{ label: 'LOS', excessDelay_ns: 0, amplitude_dB: 0 }],
        rmsDelaySpread_ns: 1,
        coherenceBandwidth_MHz: 10,
        absoluteDelay_ns: 2_000_000,
      },
    }))),
    predictPasses: vi.fn(() => [
      {
        aos: new Date('2026-08-05T00:00:00.000Z'),
        los: new Date('2026-08-05T00:02:00.000Z'),
        durationSec: 120,
        maxElev: 60,
      },
      {
        aos: new Date('2026-08-05T04:00:00.000Z'),
        los: new Date('2026-08-05T04:03:00.000Z'),
        durationSec: 180,
        maxElev: 35,
      },
    ]),
  };
});

vi.mock('../../src/features/channel-comparison/statisticalPlaybackReport.js', () => ({
  buildStatisticalPlaybackReport: vi.fn(({ timeline, windowId }) => ({
    scenarioId: windowId,
    modelVersion: 'statistical-playback/v1',
    timeWindow: { source: 'selected-pass', frameCount: timeline.length },
    frames: timeline.map((frame, index) => ({ frameId: index, time: frame.time })),
  })),
}));

vi.mock('../../src/ValidationModule.js', () => ({
  SimulationValidator: class {
    runAll() {}
  },
}));

vi.mock('../../src/calibration/storage.js', () => ({
  loadCalibrationProfile: vi.fn(() => null),
  saveCalibrationProfile: vi.fn(),
}));

vi.mock('../../src/features/mpdb-import/MpdbImportPanel.jsx', () => ({
  default: ({ onScenarioChange }) => createElement('button', {
    type: 'button',
    'aria-label': '测试导入 MPDB',
    onClick: () => onScenarioChange({
      scenarioId: 'sha256:timer-test',
      source: { format: 'lauraycs-mpdb' },
    }),
  }, '测试导入 MPDB'),
}));

vi.mock('../../src/features/channel-comparison/ChannelComparisonPanel.jsx', () => ({
  default: ({ scenario, requestKey, onReportChange, autoRun, preservePreviousReport }) => createElement('div', {
    'data-testid': 'comparison-controls',
    'data-auto-run': String(Boolean(autoRun)),
    'data-preserve-preview': String(Boolean(preservePreviousReport)),
  },
    createElement('button', {
      type: 'button',
      'aria-label': '测试发布比较报告',
      onClick: () => onReportChange({
        scenarioId: scenario.scenarioId,
        requestKey,
        frames: [{}],
      }),
    }, '测试发布比较报告'),
    createElement('button', {
      type: 'button',
      'aria-label': '测试清除比较报告',
      onClick: () => onReportChange(null),
    }, '测试清除比较报告')),
}));

vi.mock('../../src/features/channel-comparison/PdpComparisonPlayer.jsx', () => ({
  default: ({ report, rtAvailable, isRefreshing }) => createElement('div', {
    'data-testid': 'comparison-player',
    'data-model-version': report.modelVersion ?? '',
    'data-window-source': report.timeWindow?.source ?? '',
    'data-rt-available': String(Boolean(rtAvailable)),
    'data-refreshing': String(Boolean(isRefreshing)),
  }, 'STATISTICAL PDP PLAYER'),
}));

function canvasContextStub() {
  return {
    beginPath: vi.fn(),
    arc: vi.fn(),
    fill: vi.fn(),
    fillRect: vi.fn(),
    fillText: vi.fn(),
    lineTo: vi.fn(),
    measureText: vi.fn(() => ({ width: 20 })),
    moveTo: vi.fn(),
    restore: vi.fn(),
    rotate: vi.fn(),
    save: vi.fn(),
    stroke: vi.fn(),
    translate: vi.fn(),
  };
}

async function flushLazyModules() {
  await act(async () => {
    await Promise.resolve();
    await Promise.resolve();
    await Promise.resolve();
  });
}

describe('ChannelSimPanel comparison mode transition', () => {
  let container;
  let root;
  let getContextSpy;

  beforeEach(() => {
    vi.useFakeTimers();
    getContextSpy = vi.spyOn(window.HTMLCanvasElement.prototype, 'getContext')
      .mockImplementation(canvasContextStub);
    container = document.createElement('div');
    document.body.append(container);
    root = createRoot(container);
  });

  afterEach(() => {
    if (root) act(() => root.unmount());
    getContextSpy.mockRestore();
    vi.clearAllTimers();
    vi.useRealTimers();
    container.remove();
  });

  it('auto-searches passes without choosing one and generates statistical PDP after selection', async () => {
    act(() => root.render(createElement(ChannelSimPanel, {
      tleLine1: 'tle-1',
      tleLine2: 'tle-2',
      satName: 'test-sat',
      globalParams: { env: 'open', tec: 20 },
      groundStation: { lat: 31, lon: 121, alt: 10 },
    })));

    await act(async () => Promise.resolve());

    expect(predictPasses).toHaveBeenCalledTimes(1);
    expect(container.textContent).toContain('Available Passes');
    expect(container.querySelector('[data-testid="comparison-player"]')).toBeNull();
    expect(container.textContent).toContain('请选择一个过顶窗口');

    const firstPass = [...container.querySelectorAll('button')]
      .find((button) => button.textContent.includes('Max 60'));
    act(() => firstPass.click());
    await act(async () => {
      vi.advanceTimersByTime(50);
      await Promise.resolve();
    });

    expect(generateChannelTimeSeries).toHaveBeenCalledWith(
      'tle-1',
      'tle-2',
      31,
      121,
      10,
      new Date('2026-08-05T00:00:00.000Z'),
      new Date('2026-08-05T00:02:00.000Z'),
      10,
      expect.any(Object),
    );
    expect(buildStatisticalPlaybackReport).toHaveBeenCalledTimes(1);
    const player = container.querySelector('[data-testid="comparison-player"]');
    expect(player.dataset.modelVersion).toBe('statistical-playback/v1');
    expect(player.dataset.windowSource).toBe('selected-pass');
    expect(player.dataset.rtAvailable).toBe('false');
  });

  it('keeps the statistical PDP visible and requests an automatic refresh after parameters change', async () => {
    const props = (tec) => ({
      tleLine1: 'tle-1',
      tleLine2: 'tle-2',
      satName: 'test-sat',
      globalParams: { env: 'open', tec },
      groundStation: { lat: 31, lon: 121, alt: 10 },
    });
    const renderWithTec = (tec) => act(() => root.render(
      createElement(ChannelSimPanel, props(tec)),
    ));

    renderWithTec(20);
    await act(async () => Promise.resolve());
    const firstPass = [...container.querySelectorAll('button')]
      .find((button) => button.textContent.includes('Max 60'));
    act(() => firstPass.click());
    await act(async () => {
      vi.advanceTimersByTime(50);
      await Promise.resolve();
    });

    const toolsButton = [...container.querySelectorAll('button')]
      .find((button) => button.textContent.includes('加载 MPDB'));
    act(() => toolsButton.click());
    await flushLazyModules();
    act(() => container.querySelector('button[aria-label="测试导入 MPDB"]').click());
    await flushLazyModules();
    act(() => container.querySelector('button[aria-label="测试发布比较报告"]').click());
    const activePlayer = container.querySelector('[data-testid="comparison-player"]');
    expect(activePlayer).not.toBeNull();
    expect(activePlayer.dataset.rtAvailable).toBe('true');

    renderWithTec(21);
    const refreshingPlayer = container.querySelector('[data-testid="comparison-player"]');
    expect(refreshingPlayer).not.toBeNull();
    expect(refreshingPlayer.dataset.rtAvailable).toBe('false');
    expect(refreshingPlayer.dataset.refreshing).toBe('true');
    const controls = container.querySelector('[data-testid="comparison-controls"]');
    expect(controls.dataset.autoRun).toBe('true');
    expect(controls.dataset.preservePreview).toBe('true');

    act(() => container.querySelector('button[aria-label="测试发布比较报告"]').click());
    expect(container.querySelector('[data-testid="comparison-player"]').dataset.rtAvailable)
      .toBe('true');
  });
});
