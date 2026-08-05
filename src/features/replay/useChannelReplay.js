import { useCallback, useEffect, useRef, useState } from 'react';
import { parseReplayJson } from '../../replay/replaySchema.js';

export function createReplayController({
  onFrame = () => {},
  onFinish = () => {},
  setIntervalFn = setInterval,
  clearIntervalFn = clearInterval,
} = {}) {
  let frames = [];
  let index = 0;
  let status = 'idle';
  let timer = null;

  const clearTimer = () => {
    if (timer != null) clearIntervalFn(timer);
    timer = null;
  };
  const stop = () => {
    clearTimer();
    if (status !== 'disposed' && status !== 'complete') status = frames.length ? 'stopped' : 'idle';
  };
  const tick = () => {
    if (index >= frames.length) {
      clearTimer();
      status = 'complete';
      onFinish();
      return;
    }
    onFrame(frames[index], index);
    index += 1;
    if (index >= frames.length) {
      clearTimer();
      status = 'complete';
      onFinish();
    }
  };

  return {
    load(nextFrames) {
      if (status === 'disposed') throw new Error('replay controller is disposed');
      clearTimer();
      frames = Array.isArray(nextFrames) ? [...nextFrames] : [];
      index = 0;
      status = frames.length ? 'ready' : 'idle';
    },
    start(intervalMs = 1000) {
      if (status === 'disposed') throw new Error('replay controller is disposed');
      if (timer != null || frames.length === 0) return;
      if (!Number.isFinite(intervalMs) || intervalMs <= 0) throw new TypeError('replay interval must be positive');
      if (index >= frames.length) index = 0;
      status = 'playing';
      timer = setIntervalFn(tick, intervalMs);
    },
    stop,
    dispose() {
      clearTimer();
      status = 'disposed';
    },
    getState() {
      return { frames: [...frames], index, status };
    },
  };
}

export function useChannelReplay({ onFrame, onComplete, defaultSpeed = 1 } = {}) {
  const [frames, setFrames] = useState([]);
  const [index, setIndex] = useState(0);
  const [isPlaying, setIsPlaying] = useState(false);
  const [speed, setSpeedState] = useState(defaultSpeed);
  const [status, setStatus] = useState('idle');
  const [diagnostics, setDiagnostics] = useState([]);
  const onFrameRef = useRef(onFrame);
  const onCompleteRef = useRef(onComplete);
  useEffect(() => {
    onFrameRef.current = onFrame;
  }, [onFrame]);
  useEffect(() => {
    onCompleteRef.current = onComplete;
  }, [onComplete]);

  const stop = useCallback(() => {
    setIsPlaying(false);
    setStatus((current) => current === 'complete' ? current : 'stopped');
  }, []);

  const loadFrames = useCallback((nextFrames, nextDiagnostics = []) => {
    if (!Array.isArray(nextFrames)) throw new TypeError('replay frames must be an array');
    setIsPlaying(false);
    setFrames([...nextFrames]);
    setIndex(0);
    setDiagnostics([...nextDiagnostics]);
    setStatus(nextFrames.length ? 'ready' : 'empty');
  }, []);

  const loadText = useCallback((text) => {
    const parsed = parseReplayJson(text);
    loadFrames(parsed.frames, parsed.diagnostics);
    return parsed;
  }, [loadFrames]);

  const start = useCallback(() => {
    if (frames.length === 0) {
      setStatus('empty');
      return;
    }
    setIndex((current) => current >= frames.length ? 0 : current);
    setStatus('playing');
    setIsPlaying(true);
  }, [frames.length]);

  const seek = useCallback((nextIndex) => {
    if (!Number.isInteger(nextIndex) || nextIndex < 0 || nextIndex >= frames.length) return;
    setIsPlaying(false);
    setIndex(nextIndex);
    setStatus('stopped');
    onFrameRef.current?.(frames[nextIndex], nextIndex);
  }, [frames]);

  const setSpeed = useCallback((nextSpeed) => {
    if (!Number.isFinite(nextSpeed) || nextSpeed <= 0) throw new TypeError('replay speed must be positive');
    setSpeedState(nextSpeed);
  }, []);

  useEffect(() => {
    if (!isPlaying || frames.length === 0) return undefined;
    const timer = setInterval(() => {
      setIndex((current) => {
        const frame = frames[current];
        if (frame) onFrameRef.current?.(frame, current);
        if (current >= frames.length - 1) {
          setIsPlaying(false);
          setStatus('complete');
          onCompleteRef.current?.();
          return current;
        }
        return current + 1;
      });
    }, 1000 / speed);
    return () => clearInterval(timer);
  }, [frames, isPlaying, speed]);

  return {
    frames,
    index,
    isPlaying,
    speed,
    status,
    diagnostics,
    loadFrames,
    loadText,
    start,
    stop,
    seek,
    setSpeed,
  };
}
