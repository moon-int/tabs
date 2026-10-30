"use client";
import React, { useEffect, useRef } from 'react';

type Props = {
  label: string;
  value: number;
  min: number;
  max: number;
  step?: number;
  defaultValue: number;
  onChange: (v: number) => void;
  format?: (v: number) => string;
  bipolar?: boolean; // arc grows from the centre (pan, tune)
  size?: number;
};

const SWEEP = 135; // degrees either side of 12 o'clock

function polar(c: number, r: number, deg: number) {
  const a = ((deg - 90) * Math.PI) / 180;
  return [c + r * Math.cos(a), c + r * Math.sin(a)];
}

function arc(c: number, r: number, a0: number, a1: number) {
  if (Math.abs(a1 - a0) < 0.01) return '';
  const [from, to] = a0 < a1 ? [a0, a1] : [a1, a0];
  const [x0, y0] = polar(c, r, from);
  const [x1, y1] = polar(c, r, to);
  return `M ${x0} ${y0} A ${r} ${r} 0 ${to - from > 180 ? 1 : 0} 1 ${x1} ${y1}`;
}

export default function Knob({
  label, value, min, max, step = 0.01, defaultValue, onChange,
  format = v => v.toFixed(2), bipolar = false, size = 44,
}: Props) {
  const ref = useRef<HTMLDivElement>(null);
  const drag = useRef<{ y: number; v: number } | null>(null);
  const latest = useRef({ value, onChange });
  latest.current = { value, onChange };

  const clamp = (v: number) => {
    const snapped = Math.round(v / step) * step;
    return Math.min(max, Math.max(min, Number(snapped.toFixed(4))));
  };

  // wheel needs a non-passive listener to stop the page from scrolling
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const onWheel = (e: WheelEvent) => {
      e.preventDefault();
      const dir = e.deltaY < 0 ? 1 : -1;
      const amount = ((max - min) / (e.shiftKey ? 200 : 50)) * dir;
      latest.current.onChange(clamp(latest.current.value + Math.max(Math.abs(amount), step) * Math.sign(amount)));
    };
    el.addEventListener('wheel', onWheel, { passive: false });
    return () => el.removeEventListener('wheel', onWheel);
  });

  const onPointerDown = (e: React.PointerEvent) => {
    e.currentTarget.setPointerCapture(e.pointerId);
    drag.current = { y: e.clientY, v: value };
  };
  const onPointerMove = (e: React.PointerEvent) => {
    if (!drag.current) return;
    const range = max - min;
    const delta = ((drag.current.y - e.clientY) / (e.shiftKey ? 600 : 150)) * range;
    onChange(clamp(drag.current.v + delta));
  };
  const onPointerUp = () => { drag.current = null; };

  const onKeyDown = (e: React.KeyboardEvent) => {
    const big = (max - min) / 10;
    const map: Record<string, number> = {
      ArrowUp: step, ArrowRight: step, ArrowDown: -step, ArrowLeft: -step,
      PageUp: big, PageDown: -big,
    };
    if (e.key in map) { e.preventDefault(); onChange(clamp(value + map[e.key])); }
    else if (e.key === 'Home') { e.preventDefault(); onChange(min); }
    else if (e.key === 'End') { e.preventDefault(); onChange(max); }
  };

  const c = size / 2;
  const r = c - 4;
  const norm = (value - min) / (max - min);
  const angle = -SWEEP + norm * SWEEP * 2;
  const origin = bipolar ? 0 : -SWEEP;
  const [px, py] = polar(c, r - 7, angle);

  return (
    <div className="knob">
      <div
        ref={ref}
        className="knob-dial"
        role="slider"
        tabIndex={0}
        aria-label={label}
        aria-valuemin={min}
        aria-valuemax={max}
        aria-valuenow={value}
        aria-valuetext={format(value)}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        onPointerCancel={onPointerUp}
        onDoubleClick={() => onChange(defaultValue)}
        onKeyDown={onKeyDown}
        title={`${label}: ${format(value)} — drag, scroll, double-click to reset`}
      >
        <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`}>
          <circle cx={c} cy={c} r={r - 5} className="knob-body" />
          <path d={arc(c, r, -SWEEP, SWEEP)} className="knob-track" />
          <path d={arc(c, r, origin, angle)} className="knob-value" />
          <line x1={c} y1={c} x2={px} y2={py} className="knob-pointer" />
        </svg>
      </div>
      <div className="knob-label">{label}</div>
      <div className="knob-readout">{format(value)}</div>
    </div>
  );
}
