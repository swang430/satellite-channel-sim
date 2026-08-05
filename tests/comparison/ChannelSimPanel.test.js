// @vitest-environment happy-dom
/* global document, window */

import * as React from 'react';
import { createRoot } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import ChannelSimPanel from '../../src/ChannelSimPanel.jsx';

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
    predictPasses: vi.fn(() => []),
  };
});

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
  default: ({ scenario, requestKey, onReportChange }) => createElement('div', null,
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
  default: () => createElement('div', { 'data-testid': 'comparison-player' }, 'COMPARISON PLAYER'),
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

  it('clears the free-CIR interval on comparison activation and does not auto-resume', async () => {
    const clearIntervalSpy = vi.spyOn(window, 'clearInterval');
    act(() => root.render(createElement(ChannelSimPanel, {
      tleLine1: 'tle-1',
      tleLine2: 'tle-2',
      satName: 'test-sat',
      globalParams: { env: 'open', tec: 20 },
      groundStation: { lat: 31, lon: 121, alt: 10 },
    })));

    const generateButton = [...container.querySelectorAll('button')]
      .find((button) => button.textContent.includes('Generate Channel'));
    act(() => generateButton.click());
    await act(async () => {
      vi.advanceTimersByTime(50);
      await Promise.resolve();
    });

    const playButton = [...container.querySelectorAll('button')]
      .find((button) => button.textContent.includes('Play'));
    act(() => playButton.click());
    act(() => vi.advanceTimersByTime(1_000));
    expect(container.textContent).toContain('FREE-1');

    const toolsButton = [...container.querySelectorAll('button')]
      .find((button) => button.textContent.includes('加载 MPDB'));
    act(() => toolsButton.click());
    await flushLazyModules();
    act(() => container.querySelector('button[aria-label="测试导入 MPDB"]').click());
    await flushLazyModules();
    act(() => container.querySelector('button[aria-label="测试发布比较报告"]').click());

    expect(container.querySelector('[data-testid="comparison-player"]')).not.toBeNull();
    expect(clearIntervalSpy).toHaveBeenCalled();

    act(() => container.querySelector('button[aria-label="测试清除比较报告"]').click());
    expect(container.textContent).toContain('FREE-1');
    expect(container.querySelector('input[type="range"]').value).toBe('1');
    act(() => vi.advanceTimersByTime(2_000));
    expect(container.textContent).toContain('FREE-1');
    expect(container.querySelector('input[type="range"]').value).toBe('1');
  });

  it('permanently invalidates an old report across an A to B to A request transition', async () => {
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
    const generateButton = [...container.querySelectorAll('button')]
      .find((button) => button.textContent.includes('Generate Channel'));
    act(() => generateButton.click());
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
    expect(container.querySelector('[data-testid="comparison-player"]')).not.toBeNull();

    renderWithTec(21);
    expect(container.querySelector('[data-testid="comparison-player"]')).toBeNull();
    const playButton = [...container.querySelectorAll('button')]
      .find((button) => button.textContent.includes('Play'));
    act(() => playButton.click());
    act(() => vi.advanceTimersByTime(1_000));
    expect(container.querySelector('input[type="range"]').value).toBe('1');
    const pauseButton = [...container.querySelectorAll('button')]
      .find((button) => button.textContent.includes('Pause'));
    act(() => pauseButton.click());

    renderWithTec(20);
    expect(container.querySelector('[data-testid="comparison-player"]')).toBeNull();
    expect(container.querySelector('button[aria-label="测试发布比较报告"]')).not.toBeNull();

    const resumedPlayButton = [...container.querySelectorAll('button')]
      .find((button) => button.textContent.includes('Play') || button.textContent.includes('Pause'));
    expect(resumedPlayButton.textContent).toContain('Play');
    expect(container.querySelector('input[type="range"]').value).toBe('1');
    act(() => vi.advanceTimersByTime(2_000));
    expect(container.querySelector('input[type="range"]').value).toBe('1');
  });
});
