"use client";
import React from 'react';
import type { SongInfo } from '../lib/player';
import { tuningLabel } from '../lib/tuning';

const RANGE = Array.from({ length: 25 }, (_, i) => 12 - i); // +12 … −12

/** the tuning guitarists know the song by: the first 6-string guitar, else any stringed track */
export function referenceTuning(song: SongInfo | null): number[] | null {
  if (!song) return null;
  const strung = song.tracks.filter(t => t.tuning.length);
  return (strung.find(t => t.part === 'guitar' && t.tuning.length === 6) ?? strung.find(t => t.part === 'guitar') ?? strung[0])?.tuning ?? null;
}

export const shiftLabel = (n: number) => (n === 0 ? 'original' : `${n > 0 ? '+' : '−'}${Math.abs(n)} st`);

/** "−2 st · whole step down (d)" — what your guitar has to be tuned to */
export function transposeOption(n: number, ref: number[] | null) {
  return ref ? `${shiftLabel(n)} · ${tuningLabel(ref.map(t => t + n))}` : shiftLabel(n);
}

type Props = {
  song: SongInfo | null;
  /** the guitar role's tuning when the server knows it (setlist songs) — same name everywhere */
  reference?: number[] | null;
  value: number; host: boolean; disabled?: boolean; onChange: (n: number) => void;
};

/**
 * Moves the whole song up or down — the tabs keep their frets, so you play
 * it exactly as written on a guitar tuned that much lower or higher.
 */
export default function Transpose({ song, reference, value, host, disabled, onChange }: Props) {
  const ref = reference ?? referenceTuning(song);
  if (!host) {
    return value ? <span className="chip mint" title="the host moved the whole song — tune your guitar to this">play in {transposeOption(value, ref)}</span> : null;
  }
  return (
    <label className="transpose" title="move the whole song up or down — the tab stays the same, tune your guitar to match">
      <span className="field-label">play in</span>
      <select className={`btn sm ${value ? 'on' : ''}`} value={value} disabled={disabled} onChange={e => onChange(Number(e.target.value))} aria-label="transpose the song">
        {RANGE.map(n => <option key={n} value={n}>{transposeOption(n, ref)}</option>)}
      </select>
    </label>
  );
}
