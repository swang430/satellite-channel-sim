const HEADER = 'Time,Elevation,Azimuth,SlantRange_km,TotalLoss_dB,DeltaFSPL_dB,AtmLoss_dB,SkyNoise_K';

export function buildReplayCsv(frames) {
  const rows = frames.map((frame) => [
    frame.timeLabel,
    frame.elevation.toFixed(2),
    frame.azimuth.toFixed(1),
    frame.slantRange.toFixed(1),
    frame.totalLoss.toFixed(2),
    frame.deltaFspl.toFixed(2),
    frame.totalAtmosphericLoss.toFixed(2),
    frame.tSky.toFixed(1),
  ].join(','));
  return [HEADER, ...rows].join('\n');
}

export function downloadReplayCsv(frames, satelliteName) {
  if (frames.length === 0) return;
  const blob = new Blob([buildReplayCsv(frames)], { type: 'text/csv' });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = `replay_${satelliteName || 'sat'}_${new Date().toISOString().slice(0, 16)}.csv`;
  anchor.click();
  URL.revokeObjectURL(url);
}
