import React, { useEffect, useMemo, useRef, useState } from 'react';
import {
  createImportState,
  transitionImportState,
} from './importState.js';
import {
  canCompareScenario,
  selectGroundFrame,
  suggestGroundFrames,
} from './groundSelection.js';
import { MPDB_IMPORT_REQUEST } from '../../workers/mpdbImportProtocol.js';

const panelStyle = {
  background: 'linear-gradient(135deg, rgba(5,18,29,0.96), rgba(14,35,43,0.92))',
  border: '1px solid rgba(78,205,196,0.38)',
  borderRadius: '8px',
  padding: '14px',
  marginBottom: '15px',
  boxShadow: 'inset 3px 0 0 #4ecdc4, 0 10px 28px rgba(0,0,0,0.18)',
};

const chipStyle = {
  display: 'inline-block',
  padding: '2px 7px',
  border: '1px solid rgba(136,204,255,0.35)',
  borderRadius: '3px',
  color: '#b9ddff',
  background: 'rgba(40,90,120,0.18)',
  fontFamily: 'monospace',
  fontSize: '0.76em',
};

const statusLabel = {
  idle: '等待三个输入文件',
  parsing: '解析 MPDB',
  validating: '校验实体、帧和坐标',
  ready: '场景已就绪',
  error: '导入失败',
};

function formatCoordinate(value, digits = 6) {
  return Number.isFinite(value) ? value.toFixed(digits) : '—';
}

export default function MpdbImportPanel({ onScenarioChange }) {
  const [importState, setImportState] = useState(createImportState);
  const [scenario, setScenario] = useState(null);
  const [draftFrameId, setDraftFrameId] = useState(0);
  const [uiError, setUiError] = useState('');
  const workerRef = useRef(null);
  const requestIdRef = useRef(null);

  useEffect(() => () => workerRef.current?.terminate(), []);

  const suggestions = useMemo(
    () => (scenario ? suggestGroundFrames(scenario).slice(0, 5) : []),
    [scenario],
  );
  const candidate = scenario?.groundCandidates?.[draftFrameId] ?? null;
  const busy = ['parsing', 'validating'].includes(importState.status);

  async function handleFiles(fileList) {
    const files = [...(fileList ?? [])];
    setUiError('');
    if (files.length !== 3) {
      setUiError('请选择且仅选择 3 个文件：MPDB、发射端配置、接收端配置。');
      return;
    }

    workerRef.current?.terminate();
    const worker = new Worker(
      new URL('../../workers/mpdbImport.worker.js', import.meta.url),
      { type: 'module' },
    );
    workerRef.current = worker;
    const requestId = globalThis.crypto.randomUUID();
    requestIdRef.current = requestId;
    setScenario(null);
    setImportState((previous) => transitionImportState(previous, { type: 'START' }));

    worker.addEventListener('message', ({ data }) => {
      if (data?.requestId !== requestIdRef.current) return;
      if (data.type === 'READY') {
        setImportState((previous) => transitionImportState(previous, data));
        setScenario(data.scenario);
        setDraftFrameId(0);
        onScenarioChange?.(data.scenario);
        return;
      }
      setImportState((previous) => transitionImportState(previous, data));
    });
    worker.addEventListener('error', (event) => {
      setImportState((previous) => transitionImportState(previous, {
        type: 'FAIL',
        error: { code: 'MPDB_WORKER_FAILED', message: event.message },
      }));
    });

    const payloadFiles = await Promise.all(files.map(async (file) => ({
      name: file.name,
      data: await file.arrayBuffer(),
    })));
    worker.postMessage({
      type: MPDB_IMPORT_REQUEST,
      requestId,
      files: payloadFiles,
    }, payloadFiles.map((file) => file.data));
  }

  function confirmGroundFrame() {
    const selectedScenario = selectGroundFrame(scenario, draftFrameId);
    setScenario(selectedScenario);
    onScenarioChange?.(selectedScenario);
  }

  return (
    <section style={panelStyle} aria-label="MPDB 射线追踪数据导入">
      <div style={{ display: 'flex', justifyContent: 'space-between', gap: '12px', flexWrap: 'wrap' }}>
        <div>
          <div style={{ color: '#4ecdc4', fontWeight: 800, letterSpacing: '0.06em' }}>
            MPDB / STAT LINK BENCH
          </div>
          <div style={{ color: '#91aeb8', fontSize: '0.8em', marginTop: '3px' }}>
            按文件内容识别，不使用文件名、帧数或 Task_ID 兜底关联
          </div>
        </div>
        <label style={{ cursor: busy ? 'wait' : 'pointer' }}>
          <span style={{ ...chipStyle, color: '#e9ffff', borderColor: '#4ecdc4' }}>
            {busy ? '处理中…' : '选择三个文件'}
          </span>
          <input
            type="file"
            multiple
            disabled={busy}
            onChange={(event) => handleFiles(event.target.files)}
            style={{ display: 'none' }}
          />
        </label>
      </div>

      <div style={{ marginTop: '12px', display: 'flex', gap: '9px', alignItems: 'center' }}>
        <span style={chipStyle}>{statusLabel[importState.status]}</span>
        <div style={{ height: '4px', flex: 1, background: 'rgba(255,255,255,0.08)' }}>
          <div style={{ height: '100%', width: `${importState.progress * 100}%`, background: '#4ecdc4', transition: 'width 180ms ease' }} />
        </div>
        <span style={{ color: '#8ba2aa', fontFamily: 'monospace', fontSize: '0.75em' }}>
          {Math.round(importState.progress * 100)}%
        </span>
      </div>

      {(uiError || importState.error) && (
        <div role="alert" style={{ marginTop: '10px', color: '#ffb3b3', fontSize: '0.82em' }}>
          {uiError || `${importState.error.code}: ${importState.error.message}`}
        </div>
      )}

      {scenario && (
        <>
          <div style={{ marginTop: '13px', display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(145px, 1fr))', gap: '7px' }}>
            <Metric label="链路" value={`${scenario.link.transmitterId} → ${scenario.link.receiverId}`} />
            <Metric label="规模" value={`${scenario.time.frameCount} 帧 / ${scenario.rayTracing.delay_s.length} 射线`} />
            <Metric label="载频" value={`${(scenario.carrier.frequency_Hz / 1e9).toFixed(3)} GHz`} />
            <Metric label="坐标残差" value={`RMS ${(scenario.coordinateReference.alignmentRmsResidual_m * 100).toFixed(2)} cm`} />
          </div>

          <div style={{ marginTop: '10px', display: 'flex', gap: '6px', flexWrap: 'wrap' }}>
            {scenario.source.files.map((file) => (
              <span key={file.role} style={chipStyle}>{file.role}: {file.originalName}</span>
            ))}
          </div>

          {scenario.diagnostics.warnings.length > 0 && (
            <div style={{ marginTop: '9px', color: '#ffd479', fontSize: '0.79em' }}>
              {scenario.diagnostics.warnings.map((warning) => (
                <div key={`${warning.code}-${warning.source}`}>△ {warning.message}</div>
              ))}
            </div>
          )}

          <div style={{ marginTop: '15px', borderTop: '1px solid rgba(78,205,196,0.2)', paddingTop: '12px' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', gap: '8px', flexWrap: 'wrap' }}>
              <strong style={{ color: '#dff' }}>地面静态点：由使用者选择 MPDB RX 帧</strong>
              <span style={{ ...chipStyle, color: canCompareScenario(scenario) ? '#66f2b2' : '#ffd479' }}>
                {canCompareScenario(scenario)
                  ? `已确认 · ${scenario.groundSelection.exactMatchFrameCount} 个精确匹配帧 · revision ${scenario.comparisonRevision}`
                  : '未确认 · 禁止比较'}
              </span>
            </div>

            <input
              aria-label="地面帧"
              type="range"
              min={0}
              max={scenario.time.frameCount - 1}
              value={draftFrameId}
              onChange={(event) => setDraftFrameId(Number(event.target.value))}
              style={{ width: '100%', margin: '12px 0 7px' }}
            />
            {candidate && (
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(130px, 1fr))', gap: '6px', fontFamily: 'monospace', fontSize: '0.78em', color: '#b8cbd0' }}>
                <span>FRAME {candidate.frameId}</span>
                <span>{candidate.timestampUtc}</span>
                <span>经度 {formatCoordinate(candidate.longitude_deg)}</span>
                <span>纬度 {formatCoordinate(candidate.latitude_deg)}</span>
                <span>高度 {formatCoordinate(candidate.altitude_m, 2)} m</span>
                <span>偏差 {candidate.groundPositionMismatch_m == null ? '待确认' : `${formatCoordinate(candidate.groundPositionMismatch_m, 3)} m`}</span>
              </div>
            )}

            <div style={{ marginTop: '10px', display: 'flex', gap: '7px', alignItems: 'center', flexWrap: 'wrap' }}>
              <button
                type="button"
                onClick={confirmGroundFrame}
                style={{ padding: '6px 12px', borderRadius: '4px', border: '1px solid #4ecdc4', background: '#143f45', color: '#eaffff', cursor: 'pointer', fontWeight: 700 }}
              >
                确认使用 FRAME {draftFrameId}
              </button>
              <span style={{ color: '#78939b', fontSize: '0.76em' }}>稳定帧建议（仅定位，不自动确认）：</span>
              {suggestions.map((suggestion) => (
                <button
                  key={suggestion.frameId}
                  type="button"
                  onClick={() => setDraftFrameId(suggestion.frameId)}
                  style={{ ...chipStyle, cursor: 'pointer' }}
                >
                  F{suggestion.frameId} · {suggestion.nearbyFrameCount} 邻近帧
                </button>
              ))}
            </div>
          </div>
        </>
      )}
    </section>
  );
}

function Metric({ label, value }) {
  return (
    <div style={{ background: 'rgba(0,0,0,0.2)', padding: '7px 9px', borderLeft: '2px solid #315f69' }}>
      <div style={{ color: '#668892', fontSize: '0.68em', letterSpacing: '0.08em' }}>{label}</div>
      <div style={{ color: '#e0f2f2', fontFamily: 'monospace', fontSize: '0.78em', marginTop: '3px', overflowWrap: 'anywhere' }}>{value}</div>
    </div>
  );
}
