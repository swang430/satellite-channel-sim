import { useEffect, useRef, useState } from 'react';
import { compareScenario } from '../../comparison/compareScenario.js';
import { validateScenario } from '../../domain/scenario.js';
import { COMPARISON_REALIZATION_COUNT } from './comparisonReportState.js';

const panelStyle = {
  marginBottom: '15px',
  padding: '14px',
  background: 'rgba(8,18,29,0.92)',
  border: '1px solid rgba(255,180,65,0.38)',
  borderRadius: '8px',
};

function scenarioCanRun(scenario, requestKey) {
  return Boolean(scenario)
    && typeof requestKey === 'string'
    && requestKey.length > 0
    && validateScenario(scenario).length === 0;
}

export default function ChannelComparisonPanel({
  scenario,
  requestKey,
  statisticalParameters,
  onReportChange,
}) {
  const [summaryReport, setSummaryReport] = useState(null);
  const [running, setRunning] = useState(false);
  const [progress, setProgress] = useState(0);
  const [error, setError] = useState('');
  const abortRef = useRef(null);
  const runVersionRef = useRef(0);
  const onReportChangeRef = useRef(onReportChange);
  onReportChangeRef.current = onReportChange;

  useEffect(() => {
    setSummaryReport(null);
    setRunning(false);
    setError('');
    setProgress(0);
    return () => {
      runVersionRef.current += 1;
      abortRef.current?.abort();
      abortRef.current = null;
    };
  }, [requestKey, scenario, statisticalParameters]);

  function cancelComparison() {
    if (!abortRef.current) return;
    runVersionRef.current += 1;
    abortRef.current.abort();
    abortRef.current = null;
    setRunning(false);
    setSummaryReport(null);
    onReportChangeRef.current?.(null);
  }

  async function runComparison() {
    abortRef.current?.abort();
    const controller = new AbortController();
    const runVersion = runVersionRef.current + 1;
    runVersionRef.current = runVersion;
    abortRef.current = controller;
    setRunning(true);
    setProgress(0);
    setError('');
    setSummaryReport(null);
    onReportChangeRef.current?.(null);

    try {
      const engineReport = await compareScenario(scenario, {
        realizationCount: COMPARISON_REALIZATION_COUNT,
        statisticalParameters,
        signal: controller.signal,
        onProgress: (nextProgress) => {
          if (runVersionRef.current === runVersion && !controller.signal.aborted) {
            setProgress(nextProgress);
          }
        },
      });
      if (runVersionRef.current !== runVersion || controller.signal.aborted) return;
      const keyedReport = { ...engineReport, requestKey };
      setSummaryReport(keyedReport);
      onReportChangeRef.current?.(keyedReport);
    } catch (caught) {
      if (runVersionRef.current !== runVersion) return;
      setSummaryReport(null);
      onReportChangeRef.current?.(null);
      if (caught?.code !== 'COMPARISON_CANCELLED') {
        setError(caught instanceof Error ? caught.message : String(caught));
      }
    } finally {
      if (runVersionRef.current === runVersion) {
        setRunning(false);
        abortRef.current = null;
      }
    }
  }

  if (!scenario) return null;
  const enabled = scenarioCanRun(scenario, requestKey);
  return (
    <section style={panelStyle} aria-label="RT / 统计信道对比计算">
      <div style={{ display: 'flex', gap: '10px', alignItems: 'center', flexWrap: 'wrap' }}>
        <strong style={{ color: '#ffc56d', letterSpacing: '0.04em' }}>RT / 统计信道对比</strong>
        <button
          type="button"
          disabled={!enabled || running}
          onClick={runComparison}
          style={{
            padding: '6px 12px',
            cursor: enabled && !running ? 'pointer' : 'not-allowed',
            background: enabled ? '#674919' : '#333',
            border: '1px solid #b78132',
            borderRadius: '4px',
            color: '#fff',
          }}
        >
          {running
            ? `计算中 ${Math.round(progress * 100)}%`
            : `运行 ${COMPARISON_REALIZATION_COUNT} 次确定性统计集合`}
        </button>
        {running && <button type="button" onClick={cancelComparison}>取消</button>}
        <span style={{ color: enabled ? '#67e6ad' : '#ffb3b3', fontSize: '0.8em' }}>
          {enabled ? 'MPDB 接收机轨迹已就绪' : 'MPDB 场景尚未满足逐帧比较条件'}
        </span>
      </div>
      <div style={{ marginTop: '7px', color: '#d6aa6c', fontSize: '0.76em' }}>
        相对 PDP 对比；RT 绝对功率不可用（UNDEFINED_H_NORMALIZATION）。
      </div>
      {error && <div role="alert" style={{ color: '#ff9e9e', marginTop: '8px' }}>{error}</div>}
      {summaryReport && (
        <div style={{ display: 'flex', gap: '10px', marginTop: '12px', flexWrap: 'wrap', fontFamily: 'monospace', fontSize: '0.78em' }}>
          <span>total {summaryReport.frameCounts.total}</span>
          <span>compared {summaryReport.frameCounts.compared}</span>
          <span>realization {summaryReport.realizationCount}</span>
          <span>model {summaryReport.modelVersion}</span>
          <span>receiver mode {summaryReport.receiverGeometry.mode}</span>
        </div>
      )}
    </section>
  );
}
