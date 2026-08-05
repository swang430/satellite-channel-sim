// @vitest-environment happy-dom
/* global document */

import * as React from 'react';
import { createRoot } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createScenarioDraft } from '../../src/domain/scenario.js';
import ChannelComparisonPanel from '../../src/features/channel-comparison/ChannelComparisonPanel.jsx';

const { act, createElement } = React;
globalThis.React = React;
globalThis.IS_REACT_ACT_ENVIRONMENT = true;

const { compareScenarioMock } = vi.hoisted(() => ({
  compareScenarioMock: vi.fn(),
}));

vi.mock('../../src/comparison/compareScenario.js', () => ({
  compareScenario: compareScenarioMock,
}));

function scenarioFixture(scenarioId = 'sha256:scenario-a') {
  return createScenarioDraft({
    scenarioId,
    source: { format: 'lauraycs-mpdb', files: [] },
    link: {
      direction: 'downlink',
      transmitterId: 'satellite-1',
      receiverId: 'terminal-1',
    },
    time: {
      startTimeUtc: '2026-08-05T00:00:00.000Z',
      sampleInterval_s: 1,
      frameCount: 1,
    },
    carrier: { frequency_Hz: 25e9, bandwidth_Hz: 100e6 },
    receiver: {
      id: 'terminal-1',
      track: [{
        frameId: 0,
        timestampUtc: '2026-08-05T00:00:00.000Z',
        longitude_deg: 116.3,
        latitude_deg: 39.9,
        altitude_m: 50,
        projectedPosition_m: { x: 0, y: 0, z: 0 },
      }],
    },
  });
}

function reportFixture(scenarioId = 'sha256:scenario-a') {
  return {
    scenarioId,
    modelVersion: 'mpdb-statistical-comparison/v2',
    realizationCount: 32,
    receiverGeometry: { mode: 'mpdb-track', frameCount: 1 },
    frameCounts: { total: 1, compared: 1 },
    frames: [{}],
  };
}

function deferred() {
  let resolve;
  let reject;
  const promise = new Promise((resolvePromise, rejectPromise) => {
    resolve = resolvePromise;
    reject = rejectPromise;
  });
  return { promise, resolve, reject };
}

async function flush() {
  await act(async () => {
    await Promise.resolve();
    await Promise.resolve();
  });
}

describe('ChannelComparisonPanel', () => {
  let container;
  let root;

  beforeEach(() => {
    compareScenarioMock.mockReset();
    container = document.createElement('div');
    document.body.append(container);
    root = createRoot(container);
  });

  afterEach(() => {
    if (root) act(() => root.unmount());
    container.remove();
  });

  function render(props = {}) {
    const defaults = {
      scenario: scenarioFixture(),
      requestKey: 'request-a',
      statisticalParameters: {
        environment: 'urban',
        tec_TECU: 20,
        scatterPowerOffset_dB: -2,
      },
      onReportChange: vi.fn(),
    };
    const nextProps = { ...defaults, ...props };
    act(() => root.render(createElement(ChannelComparisonPanel, nextProps)));
    return nextProps;
  }

  it('runs a receiver-track scenario with the keyed statistical request and only renders controls/summary', async () => {
    compareScenarioMock.mockResolvedValue(reportFixture());
    const { onReportChange, statisticalParameters } = render();

    expect(container.textContent).toContain('MPDB 接收机轨迹');
    expect(container.querySelector('input[type="range"]')).toBeNull();
    expect(container.querySelector('[role="img"]')).toBeNull();

    act(() => container.querySelector('button').click());
    expect(onReportChange).toHaveBeenLastCalledWith(null);
    await flush();

    expect(compareScenarioMock).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({
      realizationCount: 32,
      statisticalParameters,
    }));
    expect(onReportChange).toHaveBeenLastCalledWith(expect.objectContaining({
      scenarioId: 'sha256:scenario-a',
      requestKey: 'request-a',
    }));
    expect(container.textContent).toContain('total 1');
    expect(container.textContent).toContain('compared 1');
    expect(container.textContent).toContain('mpdb-statistical-comparison/v2');
  });

  it('does not publish an old promise after request props change', async () => {
    const first = deferred();
    const second = deferred();
    compareScenarioMock
      .mockReturnValueOnce(first.promise)
      .mockReturnValueOnce(second.promise);
    const onReportChange = vi.fn();
    render({ onReportChange });
    act(() => container.querySelector('button').click());

    render({
      requestKey: 'request-b',
      statisticalParameters: {
        environment: 'urban',
        tec_TECU: 21,
        scatterPowerOffset_dB: -2,
      },
      onReportChange,
    });
    act(() => container.querySelector('button').click());

    first.resolve(reportFixture());
    await flush();
    expect(onReportChange).not.toHaveBeenCalledWith(expect.objectContaining({
      requestKey: 'request-a',
    }));

    second.resolve(reportFixture());
    await flush();
    expect(onReportChange).toHaveBeenLastCalledWith(expect.objectContaining({
      requestKey: 'request-b',
    }));
  });

  it('clears the parent report on failure and cancellation', async () => {
    compareScenarioMock.mockRejectedValueOnce(new Error('engine failed'));
    const onReportChange = vi.fn();
    render({ onReportChange });
    act(() => container.querySelector('button').click());
    await flush();

    expect(container.querySelector('[role="alert"]').textContent).toContain('engine failed');
    expect(onReportChange).toHaveBeenLastCalledWith(null);

    const pending = deferred();
    compareScenarioMock.mockReturnValueOnce(pending.promise);
    act(() => container.querySelector('button').click());
    const signal = compareScenarioMock.mock.calls.at(-1)[1].signal;
    const cancel = [...container.querySelectorAll('button')]
      .find((button) => button.textContent === '取消');
    act(() => cancel.click());

    expect(signal.aborted).toBe(true);
    expect(onReportChange).toHaveBeenLastCalledWith(null);
    expect([...container.querySelectorAll('button')]
      .some((button) => button.textContent === '取消')).toBe(false);
    expect(container.querySelector('button').disabled).toBe(false);
  });

  it('shows a parameter error and disables comparison when request derivation failed', () => {
    render({
      requestKey: 'request-must-not-run',
      parameterError: {
        code: 'STATISTICAL_CIR_INPUT_INVALID',
        message: 'tec_TECU must be finite',
      },
    });

    expect(container.querySelector('button').disabled).toBe(true);
    expect(container.querySelector('[role="alert"]').textContent)
      .toContain('tec_TECU must be finite');
  });
});
