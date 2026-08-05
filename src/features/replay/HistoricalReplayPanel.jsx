import { Line } from 'react-chartjs-2';

export default function HistoricalReplayPanel({
  replay,
  startTime,
  onStartTimeChange,
  minutesAhead,
  onMinutesAheadChange,
  onGenerate,
  onExport,
}) {
  const frames = replay.frames;
  const frame = frames[replay.index];

  return (
    <div style={{ padding: '15px', border: '1px solid #555', borderRadius: '5px', marginBottom: '20px', background: '#1a1a2e', color: '#eee', textAlign: 'left' }}>
      <h3 style={{ margin: '0 0 10px 0' }}>⏱️ Historical Replay & Channel Analysis</h3>
      <div style={{ display: 'flex', gap: '10px', alignItems: 'center', flexWrap: 'wrap', marginBottom: '10px' }}>
        <label>Start Time:
          <input type="datetime-local" value={startTime} onChange={(event) => onStartTimeChange(event.target.value)} style={{ marginLeft: '4px' }} />
        </label>
        <label>Duration (min):
          <input type="number" min="5" max="120" value={minutesAhead} onChange={(event) => onMinutesAheadChange(parseInt(event.target.value, 10) || 20)} style={{ width: '50px', marginLeft: '4px' }} />
        </label>
        <button onClick={onGenerate} style={{ padding: '4px 12px', background: '#6f42c1', color: 'white', border: 'none', borderRadius: '4px', fontWeight: 'bold', cursor: 'pointer' }}>
          📊 Generate Timeline
        </button>
        {frames.length > 0 && (
          <>
            <button onClick={() => (replay.isPlaying ? replay.stop() : replay.start())} style={{ padding: '4px 12px', background: replay.isPlaying ? '#dc3545' : '#28a745', color: 'white', border: 'none', borderRadius: '4px', fontWeight: 'bold', cursor: 'pointer' }}>
              {replay.isPlaying ? '⏸ Pause' : '▶️ Play'}
            </button>
            <label style={{ fontSize: '0.85em' }}>Speed:
              <select value={replay.speed} onChange={(event) => replay.setSpeed(parseInt(event.target.value, 10))} style={{ marginLeft: '4px' }}>
                {[1, 2, 5, 10, 20].map((speed) => <option key={speed} value={speed}>{speed}x</option>)}
              </select>
            </label>
            <button onClick={onExport} style={{ padding: '4px 12px', background: '#17a2b8', color: 'white', border: 'none', borderRadius: '4px', fontWeight: 'bold', cursor: 'pointer' }}>
              💾 Export CSV
            </button>
          </>
        )}
      </div>

      {frames.length > 0 && (
        <>
          <div style={{ display: 'flex', gap: '10px', alignItems: 'center', marginBottom: '8px' }}>
            <input type="range" min={0} max={frames.length - 1} value={replay.index} onChange={(event) => replay.seek(parseInt(event.target.value, 10))} style={{ flex: 1 }} />
            <span style={{ fontFamily: 'monospace', fontSize: '0.85em', minWidth: '180px' }}>
              {frame?.timeLabel} | El: {frame?.elevation.toFixed(1)}° | Loss: {frame?.totalLoss.toFixed(1)}dB
            </span>
          </div>

          <div style={{ background: 'rgba(0,0,0,0.3)', borderRadius: '5px', padding: '10px' }}>
            <Line
              data={{
                labels: frames.map((item) => item.timeLabel),
                datasets: [
                  {
                    label: 'Elevation (°)',
                    data: frames.map((item) => item.elevation),
                    borderColor: '#28a745',
                    backgroundColor: 'rgba(40,167,69,0.1)',
                    fill: true,
                    yAxisID: 'y1',
                    tension: 0.3,
                    pointRadius: 0,
                  },
                  {
                    label: 'Total Path Loss (dB)',
                    data: frames.map((item) => item.totalLoss),
                    borderColor: '#dc3545',
                    yAxisID: 'y2',
                    tension: 0.3,
                    pointRadius: 0,
                  },
                  {
                    label: 'FSPL Δ (dB)',
                    data: frames.map((item) => item.deltaFspl),
                    borderColor: '#00e5ff',
                    borderDash: [5, 3],
                    yAxisID: 'y2',
                    tension: 0.3,
                    pointRadius: 0,
                  },
                ],
              }}
              options={{
                responsive: true,
                interaction: { mode: 'index', intersect: false },
                plugins: { legend: { position: 'top', labels: { color: '#ccc', font: { size: 11 } } }, title: { display: true, text: '⏱️ Replay: Elevation & Channel Loss vs Time', color: '#fff', font: { size: 13 } } },
                scales: {
                  x: { display: true, title: { display: true, text: 'Time', color: '#ccc' }, ticks: { maxTicksLimit: 12, color: '#aaa' }, grid: { color: 'rgba(255,255,255,0.05)' } },
                  y1: { type: 'linear', position: 'left', title: { display: true, text: 'Elevation (°)', color: '#ccc' }, grid: { drawOnChartArea: false }, ticks: { color: '#aaa' } },
                  y2: { type: 'linear', position: 'right', title: { display: true, text: 'Loss (dB)', color: '#ccc' }, grid: { color: 'rgba(255,255,255,0.08)' }, ticks: { color: '#aaa' } },
                },
              }}
            />
          </div>
          <small style={{ color: '#888', marginTop: '4px', display: 'block' }}>{frames.length} frames | 10s/frame | {minutesAhead} min window</small>
        </>
      )}
    </div>
  );
}
