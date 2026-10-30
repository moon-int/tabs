"use client";
import React from 'react';
import { calm } from '../lib/calm';
import Knob from './Knob';
import { BAND_GROOVES, BEATS_GROOVES, decodeBeatsLink, grooveFromDef, kitName, type Groove } from '../lib/groove';

type Props = {
  groove: Groove | null;
  host: boolean;
  level: number;
  onLevel: (v: number) => void;
  onGroove: (g: Groove | null) => void;
  onError: (msg: string) => void;
};

/** pick the def a running groove came from, so the select shows it */
const currentId = (g: Groove | null) =>
  !g ? 'off' : [...BAND_GROOVES, ...BEATS_GROOVES].find(d => d.name === g.name && d.rows.join() === g.rows.join())?.id ?? 'current';

/**
 * A mo-tion beats drum pattern running with the song — for rehearsing
 * without a drummer or songs without a drum track. The host chooses it for
 * everyone; the level is yours.
 */
function GrooveStrip({ groove, host, level, onLevel, onGroove, onError }: Props) {
  const on = !!groove?.on;
  const value = currentId(groove);

  const pick = (v: string) => {
    if (v === 'off') return onGroove(null);
    if (v === 'current') return;
    if (v === 'paste') {
      const text = window.prompt('paste a share link from mo-tion beats (share link button)');
      if (!text) return;
      const g = decodeBeatsLink(text);
      if (!g) return onError('that is not a beats share link with a pattern in it');
      return onGroove(g);
    }
    const def = [...BAND_GROOVES, ...BEATS_GROOVES].find(d => d.id === v);
    if (def) onGroove(grooveFromDef(def));
  };

  return (
    <div className={`strip groove-strip ${on ? 'shown' : 'silent'}`}>
      <div className="strip-label" title="drum groove from mo-tion beats, locked to the song">groove</div>
      <div className="strip-sub">{on ? `beats · ${kitName(groove!.kit)}${groove!.swing ? ` · swing ${groove!.swing}` : ''}` : 'beats'}</div>
      {host ? (
        <select className={`btn xs tuning-select ${on ? 'on' : ''}`} value={value} onChange={e => pick(e.target.value)} aria-label="groove">
          <option value="off">off</option>
          {value === 'current' && groove && <option value="current">{groove.name}</option>}
          <optgroup label="band">
            {BAND_GROOVES.map(d => <option key={d.id} value={d.id}>{d.name}</option>)}
          </optgroup>
          <optgroup label="beats presets">
            {BEATS_GROOVES.map(d => <option key={d.id} value={d.id}>{d.name}</option>)}
          </optgroup>
          <option value="paste">paste beats link…</option>
        </select>
      ) : (
        <div className="groove-name">{on ? groove!.name : 'off'}</div>
      )}
      <Knob label="level" value={level} min={0} max={1} step={0.01} defaultValue={0.8} size={40} onChange={onLevel} format={v => `${Math.round(v * 100)}%`} />
    </div>
  );
}

export default calm(GrooveStrip);
