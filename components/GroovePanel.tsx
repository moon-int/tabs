"use client";
import React, { useRef } from 'react';
import { calm } from '../lib/calm';
import { BAND_GROOVES, BEATS_GROOVES, DRUM_TRACKS, decodeBeatsLink, encodeBeatsLink, grooveFromDef, kitName, withMute, withSlot, type Groove } from '../lib/groove';
import { kits } from '../lib/beats/kits';

type Props = {
  groove: Groove | null;
  songBpm: number | null;
  beatsUrl: string | null;
  onGroove: (g: Groove | null) => void;
  onError: (msg: string) => void;
};

const currentId = (g: Groove | null) =>
  !g ? 'off' : [...BAND_GROOVES, ...BEATS_GROOVES].find(d => d.name === g.name && d.rows.join() === g.rows.join())?.id ?? 'current';

/**
 * The host's groove desk — mo-tion beats in the band: pick or paste a pattern, switch between a
 * beats link's patterns a–d (on the next downbeat, for everyone), mute drums live, and let it run
 * free at its own tempo between songs. Everyone hears it in sync; each person sets their own level.
 */
function GroovePanel({ groove, songBpm, beatsUrl, onGroove, onError }: Props) {
  const taps = useRef<number[]>([]);
  const on = !!groove?.on;
  const bpm = groove?.bpm ?? songBpm ?? 120;
  const set = (patch: Partial<Groove>) => groove && onGroove({ ...groove, ...patch });

  const pick = (v: string) => {
    if (v === 'off') return onGroove(groove ? { ...groove, on: false } : null);
    if (v === 'current') return;
    if (v === 'paste') {
      const text = window.prompt('paste a share link from mo-tion beats ("use in tabs" / share)');
      if (!text) return;
      const g = decodeBeatsLink(text);
      if (!g) return onError('that is not a beats share link with a pattern in it');
      return onGroove({ ...g, free: groove?.free, bpm: g.bpm ?? groove?.bpm });
    }
    const def = [...BAND_GROOVES, ...BEATS_GROOVES].find(d => d.id === v);
    // a preset keeps the free-run setting and tempo, so switching grooves between songs doesn't stop the band
    if (def) onGroove({ ...grooveFromDef(def), free: groove?.free, bpm: groove?.bpm });
  };

  const tap = () => {
    const now = performance.now();
    const list = taps.current.filter(t => now - t < 2000);
    list.push(now);
    taps.current = list.slice(-5);
    if (taps.current.length >= 2) {
      const gaps = taps.current.slice(1).map((t, i) => t - taps.current[i]);
      const avg = gaps.reduce((a, b) => a + b, 0) / gaps.length;
      const next = Math.round(Math.min(240, Math.max(40, 60000 / avg)));
      if (groove) set({ bpm: next });
    }
  };

  return (
    <div className="groove-panel">
      <div className="groove-row">
        <label className="field">
          <span className="field-label">groove</span>
          <select className={`btn ${on ? 'on-soft' : ''}`} value={on ? currentId(groove) : 'off'} onChange={e => pick(e.target.value)} aria-label="groove">
            <option value="off">off</option>
            {on && currentId(groove) === 'current' && <option value="current">{groove!.name}</option>}
            <optgroup label="band">{BAND_GROOVES.map(d => <option key={d.id} value={d.id}>{d.name}</option>)}</optgroup>
            <optgroup label="beats presets">{BEATS_GROOVES.map(d => <option key={d.id} value={d.id}>{d.name}</option>)}</optgroup>
            <option value="paste">paste beats link…</option>
          </select>
        </label>
        <button className={`btn ${on ? 'on' : ''}`} onClick={() => (groove ? set({ on: !on }) : pick('rock'))} aria-pressed={on} title="start / stop the groove for everyone">
          {on ? 'on' : 'off'}
        </button>
        <label className="field">
          <span className="field-label">kit</span>
          <div className="segmented">
            {kits.map((k, i) => (
              <button key={k.name} className={groove?.kit === i ? 'active' : ''} onClick={() => set({ kit: i })} disabled={!groove}>{k.name}</button>
            ))}
          </div>
        </label>
        <label className="field groove-swing">
          <span className="field-label">swing {groove?.swing ?? 0}%</span>
          <input type="range" min={0} max={100} value={groove?.swing ?? 0} disabled={!groove} onChange={e => set({ swing: Number(e.target.value) })} />
        </label>
        <div className="spacer" />
        {beatsUrl && groove && (
          <a className="btn sm ghost" href={encodeBeatsLink(beatsUrl, groove)} target="_blank" rel="noreferrer" title="open this groove in mo-tion beats — change it, then “use in tabs” and paste the link here">
            edit in beats ↗
          </a>
        )}
      </div>

      {groove?.slots && groove.slots.length > 1 && (
        <div className="groove-row">
          <span className="field-label">pattern</span>
          <div className="segmented groove-slots">
            {groove.slots.map((_, i) => (
              <button key={i} className={groove.slot === i ? 'active' : ''} onClick={() => onGroove(withSlot(groove, i))} title="switches on the next downbeat, for everyone">
                {'abcd'[i]}
              </button>
            ))}
          </div>
          <span className="hint-inline">switches on the next downbeat</span>
        </div>
      )}

      {groove && (
        <div className="groove-row">
          <span className="field-label">drums</span>
          <div className="groove-mutes">
            {DRUM_TRACKS.map((name, i) => {
              const muted = !!groove.mutes?.[i];
              const used = /[Xx]/.test(groove.rows[i] ?? '');
              return (
                <button
                  key={name} className={`ms groove-mute ${muted ? 'mute-on' : ''} ${used ? '' : 'unused'}`}
                  onClick={() => onGroove(withMute(groove, i))} aria-pressed={muted} title={muted ? `${name} is muted — click to bring it back` : `mute ${name} for everyone`}
                >{name}</button>
              );
            })}
          </div>
        </div>
      )}

      {groove && (
        <div className="groove-row">
          <label className="check" title="keeps playing at its own tempo while no song plays — locks to the song again when one starts">
            <input type="checkbox" checked={!!groove.free} onChange={e => set({ free: e.target.checked, bpm })} />
            run free between songs
          </label>
          <div className="segmented" aria-label="free tempo">
            <button onClick={() => set({ bpm: Math.max(40, bpm - 1) })} aria-label="slower">−</button>
            <span className="groove-bpm mono">{bpm} bpm</span>
            <button onClick={() => set({ bpm: Math.min(240, bpm + 1) })} aria-label="faster">+</button>
          </div>
          <button className="btn sm" onClick={tap} title="tap the tempo (at least twice)">tap</button>
          {songBpm && <button className="btn sm ghost" onClick={() => set({ bpm: songBpm })} title="the song's current tempo">song tempo ({songBpm})</button>}
          <span className="hint-inline">{kitName(groove.kit)}{groove.swing ? ` · swing ${groove.swing}` : ''}</span>
        </div>
      )}

      {groove && (
        <div className="groove-grid" aria-hidden="true">
          {groove.rows.map((row, r) => (
            <div key={r} className={`groove-grid-row ${groove.mutes?.[r] ? 'muted' : ''}`}>
              {row.split('').map((c, i) => <span key={i} className={`${c === 'X' ? 'acc' : c === 'x' ? 'hit' : ''} ${i % 4 === 0 ? 'beat' : ''}`} />)}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

export default calm(GroovePanel);
