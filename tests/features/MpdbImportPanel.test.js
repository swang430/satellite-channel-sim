// @vitest-environment happy-dom
/* global document */

import * as React from 'react';
import { createRoot } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import MpdbImportPanel from '../../src/features/mpdb-import/MpdbImportPanel.jsx';

const { act, createElement } = React;
globalThis.React = React;
globalThis.IS_REACT_ACT_ENVIRONMENT = true;

class WorkerStub {
  addEventListener = vi.fn();
  postMessage = vi.fn();
  terminate = vi.fn();
}

describe('MpdbImportPanel import lifecycle', () => {
  let container;
  let root;
  let originalWorker;

  beforeEach(() => {
    originalWorker = globalThis.Worker;
    globalThis.Worker = WorkerStub;
    container = document.createElement('div');
    document.body.append(container);
    root = createRoot(container);
  });

  afterEach(() => {
    if (root) act(() => root.unmount());
    container.remove();
    globalThis.Worker = originalWorker;
  });

  it('clears the parent scenario as soon as a valid re-import starts', async () => {
    const onScenarioChange = vi.fn();
    act(() => root.render(createElement(MpdbImportPanel, { onScenarioChange })));
    const input = container.querySelector('input[type="file"]');
    const files = ['sample.mpdb', 'tx.json', 'rx.json'].map((name) => ({
      name,
      arrayBuffer: vi.fn().mockResolvedValue(new ArrayBuffer(1)),
    }));
    Object.defineProperty(input, 'files', { configurable: true, value: files });

    await act(async () => {
      input.dispatchEvent(new Event('change', { bubbles: true }));
      await Promise.resolve();
    });

    expect(onScenarioChange).toHaveBeenCalledWith(null);
  });
});
