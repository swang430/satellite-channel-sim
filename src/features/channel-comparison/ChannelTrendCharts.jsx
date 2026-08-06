import React from 'react';
import { Line } from 'react-chartjs-2';

const options = {
  responsive: true,
  maintainAspectRatio: false,
  animation: false,
  parsing: false,
  scales: {
    x: { type: 'linear', title: { display: true, text: '播放位置' } },
    y: { type: 'linear' },
  },
  plugins: { legend: { labels: { color: '#ddd' } } },
};

function points(frames, pick) {
  return frames.map((frame, x) => ({ x, y: pick(frame.analytics) }))
    .filter((point) => Number.isFinite(point.y));
}

function cursor(activePosition) {
  return {
    label: '当前帧',
    data: [{ x: activePosition, y: 0 }],
    pointRadius: 5,
    borderColor: '#ffd60a',
    backgroundColor: '#ffd60a',
    showLine: false,
    source: 'active-frame-cursor',
  };
}

export default function ChannelTrendCharts({ frames, activePosition }) {
  const lossDatasets = [{
    label: 'Statistical Total Loss',
    source: 'statistical-total-loss',
    data: points(frames, (item) => item?.statistical?.loss?.totalPropagationLoss_dB),
    borderColor: '#53dfc3',
    pointRadius: 0,
  }];
  const rtGain = points(frames, (item) => item?.rt?.relativeGain?.relativeToWindowPeak_dB);
  if (rtGain.length) lossDatasets.push({
    label: 'RT Relative Gain / Peak',
    source: 'rt-relative-gain',
    data: rtGain,
    borderColor: '#ff665f',
    pointRadius: 0,
  });
  lossDatasets.push(cursor(activePosition));

  const dopplerDatasets = [{
    label: 'Stat geometric Doppler',
    source: 'statistical-doppler',
    data: points(frames, (item) => item?.statistical?.doppler?.geometric_Hz),
    borderColor: '#53dfc3',
    pointRadius: 0,
  }];
  const centroid = points(frames, (item) => item?.rt?.doppler?.centroid_Hz);
  if (centroid.length) {
    dopplerDatasets.push({
      label: 'RT Doppler centroid',
      source: 'rt-doppler-centroid',
      data: centroid,
      borderColor: '#ff665f',
      pointRadius: 0,
    }, {
      label: 'RT centroid + RMS',
      source: 'rt-doppler-upper',
      data: points(frames, (item) => {
        const value = item?.rt?.doppler;
        return Number.isFinite(value?.centroid_Hz) && Number.isFinite(value?.rmsSpread_Hz)
          ? value.centroid_Hz + value.rmsSpread_Hz : null;
      }),
      borderColor: 'rgba(255,102,95,0.35)',
      backgroundColor: 'rgba(255,102,95,0.12)',
      pointRadius: 0,
      fill: '+1',
    }, {
      label: 'RT centroid - RMS',
      source: 'rt-doppler-lower',
      data: points(frames, (item) => {
        const value = item?.rt?.doppler;
        return Number.isFinite(value?.centroid_Hz) && Number.isFinite(value?.rmsSpread_Hz)
          ? value.centroid_Hz - value.rmsSpread_Hz : null;
      }),
      borderColor: 'rgba(255,102,95,0.35)',
      pointRadius: 0,
    });
  }
  dopplerDatasets.push(cursor(activePosition));

  return (
    <section aria-label="同步信道趋势" style={{ marginTop: '12px' }}>
      <strong style={{ color: '#53dfc3' }}>同步窗口趋势</strong>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(320px, 1fr))', gap: '10px', marginTop: '8px' }}>
        <div style={{ height: '220px' }}><Line data={{ datasets: lossDatasets }} options={options} aria-label="总路损与 RT 相对增益趋势" /></div>
        <div style={{ height: '220px' }}><Line data={{ datasets: dopplerDatasets }} options={options} aria-label="统计与 RT Doppler 趋势" /></div>
      </div>
    </section>
  );
}
