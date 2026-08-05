import React, { useMemo, useRef, useState } from 'react';
import { Line } from 'react-chartjs-2';
import { compareScenario } from '../../comparison/compareScenario.js';
import { canCompareScenario } from '../mpdb-import/groundSelection.js';
import { buildComparisonPlotData } from './comparisonViewModel.js';

export default function ChannelComparisonPanel({ scenario }) {
  const [report, setReport] = useState(null);
  const [running, setRunning] = useState(false);
  const [progress, setProgress] = useState(0);
  const [error, setError] = useState('');
  const [frameIndex, setFrameIndex] = useState(0);
  const abortRef = useRef(null);
  const frame = report?.frames?.[frameIndex] ?? null;
  const plot = useMemo(() => (frame ? buildComparisonPlotData(frame) : null), [frame]);

  async function runComparison() {
    const controller = new AbortController();
    abortRef.current = controller;
    setRunning(true);
    setProgress(0);
    setError('');
    try {
      const nextReport = await compareScenario(scenario, {
        signal: controller.signal,
        onProgress: setProgress,
      });
      setReport(nextReport);
      setFrameIndex(0);
    } catch (caught) {
      if (caught.code !== 'COMPARISON_CANCELLED') setError(caught.message);
    } finally {
      setRunning(false);
      abortRef.current = null;
    }
  }

  if (!scenario) return null;
  const enabled = canCompareScenario(scenario);
  return (
    <section style={{ marginBottom: '15px', padding: '14px', background: 'rgba(8,18,29,0.92)', border: '1px solid rgba(255,180,65,0.38)', borderRadius: '8px' }}>
      <div style={{ display: 'flex', gap: '10px', alignItems: 'center', flexWrap: 'wrap' }}>
        <strong style={{ color: '#ffc56d', letterSpacing: '0.04em' }}>RT / 统计信道对比</strong>
        <button type="button" disabled={!enabled || running} onClick={runComparison} style={{ padding: '6px 12px', cursor: enabled ? 'pointer' : 'not-allowed', background: enabled ? '#674919' : '#333', border: '1px solid #b78132', borderRadius: '4px', color: '#fff' }}>
          {running ? `计算中 ${Math.round(progress * 100)}%` : '运行 32 次确定性统计集合'}
        </button>
        {running && <button type="button" onClick={() => abortRef.current?.abort()}>取消</button>}
        <span style={{ color: enabled ? '#67e6ad' : '#ffb3b3', fontSize: '0.8em' }}>
          {enabled ? `FRAME ${scenario.groundSelection.selectedFrameId} 已确认` : '请先确认地面帧'}
        </span>
      </div>
      <div style={{ marginTop: '7px', color: '#d6aa6c', fontSize: '0.76em' }}>
        相对 PDP 对比；RT 绝对功率不可用（UNDEFINED_H_NORMALIZATION）。
      </div>
      {error && <div role="alert" style={{ color: '#ff9e9e', marginTop: '8px' }}>{error}</div>}
      {report && frame && plot && (
        <>
          <div style={{ display: 'flex', gap: '10px', margin: '12px 0 8px', flexWrap: 'wrap', fontFamily: 'monospace', fontSize: '0.78em' }}>
            <span>exact {report.frameCounts.exact}</span>
            <span>approx {report.frameCounts.approximate}</span>
            <span>compared {report.frameCounts.compared}</span>
            <span>JS {frame.metrics.jsDivergence_bits.toFixed(4)} bit</span>
            <span>delay distance {(frame.metrics.weightedDelayDistance_s * 1e9).toFixed(3)} ns</span>
          </div>
          <input type="range" min={0} max={report.frames.length - 1} value={frameIndex} onChange={(event) => setFrameIndex(Number(event.target.value))} style={{ width: '100%' }} />
          <div style={{ height: '310px' }}>
            <Line
              data={{
                datasets: [
                  { label: 'RT relative PDP', data: plot.rt, borderColor: '#ff665f', pointRadius: 2 },
                  { label: 'Stat median', data: plot.statisticalMedian, borderColor: '#53dfc3', pointRadius: 1 },
                  { label: 'Stat P5', data: plot.statisticalP5, borderColor: 'rgba(83,223,195,0.35)', borderDash: [4, 4], pointRadius: 0 },
                  { label: 'Stat P95', data: plot.statisticalP95, borderColor: 'rgba(83,223,195,0.35)', borderDash: [4, 4], pointRadius: 0 },
                ],
              }}
              options={{
                responsive: true,
                maintainAspectRatio: false,
                parsing: false,
                animation: false,
                scales: {
                  x: { type: 'linear', title: { display: true, text: 'Excess delay (ns)', color: '#aaa' }, ticks: { color: '#aaa' } },
                  y: { min: -80, max: 5, title: { display: true, text: 'Relative power (dB)', color: '#aaa' }, ticks: { color: '#aaa' } },
                },
                plugins: { legend: { labels: { color: '#ddd' } } },
              }}
            />
          </div>
        </>
      )}
    </section>
  );
}

