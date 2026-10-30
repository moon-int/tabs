"use client";
import React from 'react';
import type { Beat } from '../lib/click';

/** one light per beat of the current bar; the downbeat glows brighter */
export default function BeatLights({ beat, size = 'sm', fallback = 4 }: { beat: Beat | null; size?: 'sm' | 'lg'; fallback?: number }) {
  const beats = Math.min(16, beat?.beats ?? fallback);
  return (
    <div className={`beats beats-${size}`} aria-hidden="true">
      {Array.from({ length: beats }, (_, i) => {
        const on = beat?.beat === i;
        return (
          <span
            // re-keying restarts the flash animation on every beat
            key={on ? `${i}-${beat!.bar}-on` : i}
            className={`beat-light ${on ? 'on' : ''} ${i === 0 ? 'one' : ''}`}
          />
        );
      })}
    </div>
  );
}
