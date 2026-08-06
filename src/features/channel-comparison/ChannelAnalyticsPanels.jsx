import React from 'react';

const panel = {
  padding: '12px',
  background: 'rgba(255,255,255,0.035)',
  border: '1px solid rgba(255,255,255,0.1)',
  borderRadius: '6px',
};

const rows = {
  display: 'grid',
  gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))',
  gap: '6px 12px',
  fontFamily: 'monospace',
  fontSize: '0.76em',
};

function value(number, digits = 3, unit = '') {
  return Number.isFinite(number) ? `${number.toFixed(digits)}${unit}` : '不可用';
}

function Item({ label, children }) {
  return <span><span style={{ color: '#85aaa5' }}>{label}</span> {children}</span>;
}

const LOSS_LABELS = Object.freeze({
  rain: 'Rain',
  gas: 'Gas',
  cloud: 'Cloud',
  shadow: 'Shadow/LMS',
  faraday: 'Faraday',
  pointing: 'Pointing',
  scan: 'Scan',
  multipath: 'Multipath',
  scintillation: 'Scintillation',
});

export default function ChannelAnalyticsPanels({ analytics }) {
  const statistical = analytics?.statistical ?? {};
  const loss = statistical.loss;
  const link = statistical.link;
  const delay = statistical.delay;
  const doppler = statistical.doppler;
  const rt = analytics?.rt;
  const rtImported = rt?.availability?.status === 'available';
  return (
    <div style={{ display: 'grid', gap: '10px', marginTop: '12px' }}>
      <section style={panel} aria-label="Loss Breakdown">
        <strong style={{ color: '#53dfc3' }}>Loss Breakdown · 统计模型始终保留</strong>
        <div style={{ ...rows, marginTop: '8px' }}>
          <Item label="Statistical Total Loss">{value(loss?.totalPropagationLoss_dB, 3, ' dB')}</Item>
          <Item label="FSPL">{value(loss?.fspl_dB, 3, ' dB')}</Item>
          {Object.entries(LOSS_LABELS).map(([key, label]) => (
            <Item key={key} label={label}>{value(loss?.components_dB?.[key], 3, ' dB')}</Item>
          ))}
        </div>
      </section>

      <section style={panel} aria-label="Frame Details">
        <strong style={{ color: '#53dfc3' }}>Frame Details</strong>
        <div style={{ ...rows, marginTop: '8px' }}>
          <Item label="Frame">{analytics?.frameId ?? '不可用'}</Item>
          <Item label="UTC">{analytics?.timestampUtc ?? '不可用'}</Item>
          <Item label="Elevation">{value(analytics?.geometry?.elevation_deg, 3, '°')}</Item>
          <Item label="Range">{value(analytics?.geometry?.slantRange_m / 1e3, 3, ' km')}</Item>
          <Item label="Rx Power">{value(link?.rxPower_dBm, 3, ' dBm')}</Item>
          <Item label="Noise">{value(link?.noisePower_dBm, 3, ' dBm')}</Item>
          <Item label="SNR">{value(link?.snr_dB, 3, ' dB')}</Item>
          <Item label="Stat Doppler">{value(doppler?.geometric_Hz, 3, ' Hz')}</Item>
          <Item label="Stat RMS Delay">{value(delay?.rmsDelaySpread_s * 1e9, 3, ' ns')}</Item>
          <Item label="Coherence BW">{value(delay?.coherenceBandwidth_Hz / 1e6, 3, ' MHz')}</Item>
        </div>
      </section>

      <section style={panel} aria-label="RT Advanced">
        <details open={rtImported}>
          <summary style={{ color: '#ff9b96', cursor: 'pointer' }}>RT Advanced</summary>
          {!rtImported ? (
            <div style={{ marginTop: '7px', color: '#a9aaa9' }}>RT 未导入；统计分析与播放不受影响。</div>
          ) : (
            <div style={{ ...rows, marginTop: '8px' }}>
              <Item label="RT Relative Gain / Peak">{value(rt.relativeGain?.relativeToWindowPeak_dB, 3, ' dB')}</Item>
              <Item label="RT Relative Gain / First">{value(rt.relativeGain?.relativeToFirstFrame_dB, 3, ' dB')}</Item>
              <Item label="RT Doppler Centroid">{value(rt.doppler?.centroid_Hz, 3, ' Hz')}</Item>
              <Item label="RT Doppler RMS Spread">{value(rt.doppler?.rmsSpread_Hz, 3, ' Hz')}</Item>
              <Item label="RT Dominant Path Doppler">{value(rt.doppler?.dominantPath_Hz, 3, ' Hz')}</Item>
              <Item label="Dominant Share">{value(rt.doppler?.dominantPowerShare * 100, 2, '%')}</Item>
              <Item label="RT Path Count">{rt.pathCount ?? '不可用'}</Item>
            </div>
          )}
        </details>
        {rtImported && (
          <div role="alert" style={{ color: '#ffc890', marginTop: '8px', fontSize: '0.76em' }}>
            RT_ABSOLUTE_PATH_LOSS_UNAVAILABLE：MPDB 未定义 H 的绝对归一化，只显示相对合成增益。
          </div>
        )}
      </section>
    </div>
  );
}
