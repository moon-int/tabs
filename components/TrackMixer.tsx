"use client";
import React from 'react';
import Knob from './Knob';
import type { TrackInfo, TrackMix } from '../lib/player';
import { TUNINGS, describeTuning, findPreset, parseTuning, sameTuning, tuningLabel } from '../lib/tuning';

type Props = {
  tracks: TrackInfo[];
  mix: TrackMix[];
  audible: boolean[]; // after monitor mix, mute and solo
  mine: number[];
  onChange: (index: number, patch: Partial<TrackMix>) => void;
  onShowOnly: (index: number) => void;
  onTuning: (index: number, tuning: number[] | null) => void;
  children?: React.ReactNode; // extra strips at the end (the groove)
};

const Eye = ({ open }: { open: boolean }) => (
  <svg viewBox="0 0 16 16" width="13" height="13" aria-hidden="true" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round">
    <path d="M1.5 8s2.4-4.5 6.5-4.5S14.5 8 14.5 8 12.1 12.5 8 12.5 1.5 8 1.5 8z" />
    {open ? <circle cx="8" cy="8" r="2" fill="currentColor" /> : <path d="M3 13 13 3" />}
  </svg>
);

/** re-frets the tab for the tuning your guitar is in — the sound stays the original */
function TuningSelect({ track, current, onTuning }: { track: TrackInfo; current: number[] | null; onTuning: (t: number[] | null) => void }) {
  const presets = (TUNINGS[track.tuning.length] ?? []).filter(p => !sameTuning(p.tunings, track.tuning));
  const value = !current ? 'orig' : findPreset(current)?.id ?? 'current';
  const pick = (v: string) => {
    if (v === 'orig') return onTuning(null);
    if (v === 'custom') {
      const text = window.prompt('your tuning, low string first — e.g. d a d g b e', describeTuning(current ?? track.tuning));
      if (!text) return;
      const t = parseTuning(text, track.tuning);
      if (!t) { window.alert(`that needs ${track.tuning.length} notes, like "${describeTuning(track.tuning)}"`); return; }
      return onTuning(sameTuning(t, track.tuning) ? null : t);
    }
    const p = presets.find(x => x.id === v);
    if (p) onTuning(p.tunings);
  };
  return (
    <select className={`btn xs tuning-select ${current ? 'on' : ''}`} value={value} onChange={e => pick(e.target.value)} aria-label={`tuning for ${track.name}`} title="re-fret the tab for your tuning">

      <option value="orig">{tuningLabel(track.tuning)} · as written</option>
      {value === 'current' && current && <option value="current">{describeTuning(current)}</option>}
      {presets.map(p => <option key={p.id} value={p.id}>{p.name}</option>)}
      <option value="custom">custom…</option>
    </select>
  );
}

type StripProps = {
  track: TrackInfo; mix: TrackMix; silent: boolean; isMine: boolean;
  onChange: Props['onChange']; onShowOnly: Props['onShowOnly']; onTuning: Props['onTuning'];
};

/** one instrument — redrawn only when its own state changes, not on every tick of the song */
const Strip = React.memo(function Strip({ track: t, mix: m, silent, isMine, onChange, onShowOnly, onTuning }: StripProps) {
  const sub = [t.part, t.strings && !t.percussion ? `${t.strings} str` : ''].filter(Boolean).join(' · ');
  return (
    <div className={`strip ${m.visible ? 'shown' : ''} ${silent ? 'silent' : ''} ${isMine ? 'mine' : ''}`}>
      <button className="strip-label" onClick={() => onShowOnly(t.index)} title={`${t.name} — click to show only this track`}>
        {t.name}
      </button>
      <div className="strip-sub">{isMine ? <span className="mine-tag">you</span> : null}{sub}</div>
      <div className="strip-ms">
        <button
          className={`ms ${m.visible ? 'show-on' : ''}`}
          onClick={() => onChange(t.index, { visible: !m.visible })}
          aria-pressed={m.visible}
          aria-label={`show ${t.name} in the notation`}
          title="show in notation"
        ><Eye open={m.visible} /></button>
        <button className={`ms ${m.mute ? 'mute-on' : ''}`} onClick={() => onChange(t.index, { mute: !m.mute })} aria-pressed={m.mute} aria-label={`mute ${t.name}`} title="mute">m</button>
        <button className={`ms ${m.solo ? 'solo-on' : ''}`} onClick={() => onChange(t.index, { solo: !m.solo })} aria-pressed={m.solo} aria-label={`solo ${t.name}`} title="solo (in full mix)">s</button>
      </div>
      {t.tuning.length > 0 && <TuningSelect track={t} current={m.tuning} onTuning={tu => onTuning(t.index, tu)} />}
      <Knob
        label="level" value={m.volume} min={0} max={2} step={0.01} defaultValue={1} size={40}
        onChange={v => onChange(t.index, { volume: v })}
        format={v => `${Math.round(v * 100)}%`}
      />
    </div>
  );
});

/** per-listener instrument strips: what you see and what you hear, never synced */
export default function TrackMixer({ tracks, mix, audible, mine, onChange, onShowOnly, onTuning, children }: Props) {
  return (
    <div className="tracks">
      {tracks.map(t => {
        const m = mix[t.index];
        if (!m) return null;
        return (
          <Strip
            key={t.index} track={t} mix={m} silent={audible.length ? !audible[t.index] : m.mute} isMine={mine.includes(t.index)}
            onChange={onChange} onShowOnly={onShowOnly} onTuning={onTuning}
          />
        );
      })}
      {children}
    </div>
  );
}
