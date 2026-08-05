import { useEffect, useMemo, useState } from 'react';
import { Line } from 'react-chartjs-2';
import {
  buildComparisonPlaybackFrames,
  nextComparisonPosition,
} from './comparisonViewModel.js';

const PLAYBACK_FPS_OPTIONS = Object.freeze([1, 2, 5, 10]);

const CHART_OPTIONS = Object.freeze({
  responsive: true,
  maintainAspectRatio: false,
  parsing: false,
  animation: false,
  interaction: { mode: 'nearest', intersect: false },
  scales: {
    x: {
      type: 'linear',
      title: { display: true, text: '超额时延 (ns)', color: '#aaa' },
      ticks: { color: '#aaa' },
      grid: { color: 'rgba(255,255,255,0.07)' },
    },
    y: {
      type: 'linear',
      min: -120,
      max: 5,
      title: { display: true, text: '峰值归一化相对功率 (dB)', color: '#aaa' },
      ticks: { color: '#aaa' },
      grid: { color: 'rgba(255,255,255,0.07)' },
    },
  },
  plugins: {
    legend: { labels: { color: '#ddd' } },
    tooltip: { mode: 'nearest', intersect: false },
  },
});

const panelStyle = {
  padding: '14px',
  background: 'rgba(8,18,29,0.92)',
  border: '1px solid rgba(83,223,195,0.35)',
  borderRadius: '8px',
  color: '#e9f7f5',
};

const metricStyle = {
  padding: '7px 9px',
  background: 'rgba(255,255,255,0.045)',
  borderRadius: '4px',
  fontFamily: 'monospace',
  fontSize: '0.78em',
};

function motionLabel(state) {
  return {
    initial: '初始帧',
    moving: '移动',
    stationary: '静止',
  }[state] ?? state;
}

function fixed(value, digits) {
  return value.toFixed(digits);
}

export default function PdpComparisonPlayer({ report }) {
  const [position, setPosition] = useState(0);
  const [isPlaying, setIsPlaying] = useState(false);
  const [fps, setFps] = useState(2);
  const [showRtOverlay, setShowRtOverlay] = useState(true);
  const [previousReport, setPreviousReport] = useState(report);
  const reportFrames = report?.frames;
  const [previousReportFrames, setPreviousReportFrames] = useState(reportFrames);

  if (report !== previousReport || reportFrames !== previousReportFrames) {
    setPreviousReport(report);
    setPreviousReportFrames(reportFrames);
    setPosition(0);
    setIsPlaying(false);
  }

  const precomputedPlayback = useMemo(() => {
    try {
      const playbackReport = report && typeof report === 'object'
        ? { ...report, frames: reportFrames }
        : report;
      return {
        ok: true,
        frames: buildComparisonPlaybackFrames(playbackReport, { showRtOverlay }),
      };
    } catch (error) {
      if (error?.code !== 'COMPARISON_PLOT_DATA_INVALID') throw error;
      return {
        ok: false,
        message: error.message,
        code: error.code,
      };
    }
  }, [report, reportFrames, showRtOverlay]);

  const frameCount = precomputedPlayback.ok ? precomputedPlayback.frames.length : 0;
  const activePosition = frameCount > 0
    ? Math.min(Math.max(position, 0), frameCount - 1)
    : 0;
  const activeFrame = precomputedPlayback.ok
    ? precomputedPlayback.frames[activePosition]
    : null;

  useEffect(() => {
    if (!isPlaying || !precomputedPlayback.ok || frameCount <= 1) return undefined;
    const intervalId = window.setInterval(() => {
      setPosition((currentPosition) => {
        const safePosition = Math.min(
          Math.max(currentPosition, 0),
          frameCount - 1,
        );
        return nextComparisonPosition(report, safePosition);
      });
    }, 1000 / fps);
    return () => window.clearInterval(intervalId);
  }, [fps, frameCount, isPlaying, precomputedPlayback.ok, report, reportFrames]);

  if (!precomputedPlayback.ok) {
    return (
      <section style={panelStyle} aria-label="CIR-Power Delay Profile 动态对比">
        <strong style={{ color: '#ffc56d' }}>CIR- Power Delay Profile</strong>
        <div role="alert" style={{ color: '#ff9e9e', marginTop: '8px' }}>
          无法播放对比报告：{precomputedPlayback.message}（{precomputedPlayback.code}）
        </div>
      </section>
    );
  }

  const { chartData, summary } = activeFrame;
  const canPlay = frameCount > 1;

  return (
    <section style={panelStyle} aria-label="CIR-Power Delay Profile 动态对比">
      <div style={{ display: 'flex', justifyContent: 'space-between', gap: '12px', alignItems: 'center', flexWrap: 'wrap' }}>
        <div>
          <strong style={{ color: '#ffc56d', letterSpacing: '0.04em' }}>
            CIR- Power Delay Profile
          </strong>
          <div style={{ marginTop: '4px', color: '#9bb8b4', fontSize: '0.76em' }}>
            MPDB 接收机轨迹逐帧 RT / 统计模型对比
          </div>
        </div>
        <label style={{ display: 'flex', gap: '6px', alignItems: 'center', color: '#ff9b96' }}>
          <input
            type="checkbox"
            aria-label="RT 叠加"
            checked={showRtOverlay}
            onChange={(event) => setShowRtOverlay(event.target.checked)}
          />
          RT 叠加
        </label>
      </div>

      <div style={{ display: 'flex', gap: '8px', alignItems: 'center', flexWrap: 'wrap', margin: '12px 0 8px' }}>
        <button
          type="button"
          disabled={!canPlay}
          aria-label={isPlaying ? '暂停 PDP 对比播放' : '播放 PDP 对比'}
          onClick={() => setIsPlaying((playing) => !playing)}
          style={{ padding: '6px 12px', cursor: canPlay ? 'pointer' : 'not-allowed' }}
        >
          {isPlaying ? '⏸ 暂停' : '▶ 播放'}
        </button>
        <label style={{ fontSize: '0.82em' }}>
          播放速度
          <select
            aria-label="播放速度"
            value={fps}
            onChange={(event) => setFps(Number(event.target.value))}
            style={{ marginLeft: '5px' }}
          >
            {PLAYBACK_FPS_OPTIONS.map((option) => (
              <option key={option} value={option}>{option} FPS</option>
            ))}
          </select>
        </label>
        <span style={{ marginLeft: 'auto', fontFamily: 'monospace', fontSize: '0.82em' }}>
          位置 {activePosition + 1} / {frameCount} · MPDB FRAME {summary.frameId}
        </span>
      </div>

      <label style={{ display: 'block', fontSize: '0.78em', color: '#a9c8c3' }}>
        播放位置（真实帧 {summary.frameId}）
        <input
          type="range"
          aria-label="PDP 对比播放位置"
          min={0}
          max={frameCount - 1}
          step={1}
          value={activePosition}
          disabled={!canPlay}
          onChange={(event) => {
            setPosition(Number(event.target.value));
            setIsPlaying(false);
          }}
          style={{ width: '100%', marginTop: '5px' }}
        />
      </label>

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(175px, 1fr))', gap: '6px', margin: '10px 0' }}>
        <span style={metricStyle}>UTC {summary.timestampUtc}</span>
        <span style={metricStyle}>
          RX {fixed(summary.receiverLongitude_deg, 6)}°,
          {' '}{fixed(summary.receiverLatitude_deg, 6)}°,
          {' '}{fixed(summary.receiverAltitude_m, 2)} m
        </span>
        <span style={metricStyle}>
          接收机 {motionLabel(summary.receiverMotion)} · 帧间位移 {fixed(summary.receiverDisplacement_m, 3)} m
        </span>
        <span style={metricStyle}>仰角 {fixed(summary.elevation_deg, 3)}°</span>
        <span style={metricStyle}>斜距 {fixed(summary.slantRange_m / 1e3, 3)} km</span>
        <span style={metricStyle}>JS divergence {fixed(summary.jsDivergence_bits, 5)} bit</span>
        <span style={metricStyle}>
          RMS 时延扩展差 {fixed(summary.rmsDelaySpreadDifference_s * 1e9, 3)} ns
        </span>
        <span style={metricStyle}>
          加权时延距离 {fixed(summary.weightedDelayDistance_s * 1e9, 3)} ns
        </span>
      </div>

      <div role="note" style={{ color: '#ffc890', fontSize: '0.76em', marginBottom: '8px' }}>
        {summary.rtNormalizationStatus}：RT 绝对 H / 功率归一化定义缺失；图中 RT 与统计 PDP 各自按峰值归一化，仅比较动态形状与时延结构。
      </div>

      <div style={{ height: '330px' }}>
        <Line data={chartData} options={CHART_OPTIONS} />
      </div>
    </section>
  );
}
