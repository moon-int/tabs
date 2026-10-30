"use client";
import React, { useRef, useState } from 'react';
import type { Range } from '../lib/player';
import { formatTime } from '../lib/format';

type Props = {
  tick: number;
  endTick: number;
  time: number;
  endTime: number;
  range: Range;
  marks: number[]; // section starts as 0..1 fractions
  interactive: boolean;
  onSeek: (tick: number) => void;
};

export default function SeekBar({ tick, endTick, time, endTime, range, marks, interactive, onSeek }: Props) {
  const ref = useRef<HTMLDivElement>(null);
  const [drag, setDrag] = useState<number | null>(null); // 0..1 while dragging
  const enabled = interactive && endTick > 0;

  const ratioAt = (clientX: number) => {
    const r = ref.current!.getBoundingClientRect();
    return Math.min(1, Math.max(0, (clientX - r.left) / r.width));
  };

  const ratio = drag ?? (endTick ? Math.min(1, tick / endTick) : 0);
  const pct = (v: number) => `${(v * 100).toFixed(3)}%`;

  const onKeyDown = (e: React.KeyboardEvent) => {
    if (!enabled) return;
    const step = e.shiftKey ? 0.1 : 0.02;
    if (e.key === 'ArrowLeft' || e.key === 'ArrowRight') {
      e.preventDefault();
      e.stopPropagation();
      onSeek(Math.round(Math.min(1, Math.max(0, ratio + (e.key === 'ArrowRight' ? step : -step))) * endTick));
    } else if (e.key === 'Home') { e.preventDefault(); onSeek(0); }
  };

  return (
    <div className="seek">
      <span className="seek-time">{formatTime(drag !== null ? drag * endTime : time)}</span>
      <div
        ref={ref}
        className={`seek-track ${enabled ? '' : 'readonly'} ${drag !== null ? 'dragging' : ''}`}
        role="slider"
        tabIndex={enabled ? 0 : -1}
        aria-label="song position"
        aria-valuemin={0}
        aria-valuemax={Math.round(endTime / 1000)}
        aria-valuenow={Math.round(time / 1000)}
        aria-valuetext={`${formatTime(time)} of ${formatTime(endTime)}`}
        aria-disabled={!enabled}
        onPointerDown={e => {
          if (!enabled) return;
          e.currentTarget.setPointerCapture(e.pointerId);
          setDrag(ratioAt(e.clientX));
        }}
        onPointerMove={e => { if (drag !== null) setDrag(ratioAt(e.clientX)); }}
        onPointerUp={e => {
          if (drag === null) return;
          onSeek(Math.round(ratioAt(e.clientX) * endTick));
          setDrag(null);
        }}
        onPointerCancel={() => setDrag(null)}
        onKeyDown={onKeyDown}
      >
        <div className="seek-rail">
          <div className="seek-fill" style={{ width: pct(ratio) }} />
          {range && endTick > 0 && (
            <div className="seek-range" style={{ left: pct(range.startTick / endTick), width: pct((range.endTick - range.startTick) / endTick) }} />
          )}
        </div>
        <div className="seek-marks">
          {marks.map((m, i) => <span key={i} className="seek-mark" style={{ left: pct(m) }} />)}
        </div>
        {endTick > 0 && <div className="seek-handle" style={{ left: pct(ratio) }} />}
      </div>
      <span className="seek-time">{formatTime(endTime)}</span>
    </div>
  );
}
