"use client";
import React, { useEffect, useState } from 'react';
import { calm } from '../lib/calm';
import { formatTime } from '../lib/format';
import type { Countdown, Counting, CueState } from '../lib/useSession';
import type { Member } from '../lib/sync';

/** re-renders every `ms` while active — for clocks and countdowns */
export function useNow(active: boolean, ms = 250) {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    if (!active) return;
    setNow(Date.now());
    const t = window.setInterval(() => setNow(Date.now()), ms);
    return () => window.clearInterval(t);
  }, [active, ms]);
  return now;
}

export function cueVisible(cue: CueState, now: number) {
  return !!cue && (!cue.seconds || now - cue.since < cue.seconds * 1000);
}

// ---- what everyone sees ------------------------------------------------------------

export function CueBanner({ cue, big, host, onClear }: { cue: CueState; big?: boolean; host: boolean; onClear: () => void }) {
  const now = useNow(!!cue?.seconds);
  if (!cue || !cueVisible(cue, now)) return null;
  const left = cue.seconds ? Math.max(0, Math.ceil(cue.seconds - (now - cue.since) / 1000)) : null;
  return (
    <div className={`cue ${big ? 'cue-big' : ''}`} role="alert">
      <span className="cue-tag">cue</span>
      <span className="cue-text">{cue.text}</span>
      {left !== null && <span className="cue-left mono">{left}s</span>}
      {host && <button className="btn sm" onClick={onClear}>clear</button>}
    </div>
  );
}

export function CountdownOverlay({ countdown, host, onCancel }: { countdown: Countdown; host: boolean; onCancel: () => void }) {
  const now = useNow(!!countdown, 100);
  if (!countdown) return null;
  const left = Math.max(0, Math.ceil((countdown.endsAt - now) / 1000));
  return (
    <div className="countdown" role="timer" aria-live="assertive">
      <div className="countdown-label">{countdown.label ? <>up next · <strong>{countdown.label}</strong></> : 'get ready'}</div>
      <div className="countdown-num mono" key={left}>{left || 'go'}</div>
      {host && <button className="btn" onClick={onCancel}>cancel</button>}
    </div>
  );
}

/** the count-in bar, big over the notation on every screen — the music starts after the last number */
export function CountInOverlay({ counting }: { counting: Counting }) {
  if (!counting) return null;
  const { beat, beats } = counting;
  return (
    <div className="count-in" role="timer" aria-live="assertive" aria-label={beat >= 0 ? `count-in ${beat + 1} of ${beats}` : 'count-in'}>
      <div className="count-in-num mono" key={beat}>{beat >= 0 ? beat + 1 : ''}</div>
      <div className="count-in-dots" aria-hidden="true">
        {Array.from({ length: beats }, (_, i) => <span key={i} className={`${i <= beat ? 'on' : ''} ${i === 0 ? 'one' : ''}`} />)}
      </div>
    </div>
  );
}

// ---- host: cues, countdown, show clock -------------------------------------------------

const QUICK_CUES = ['2× chorus', 'one more time', 'to the bridge', 'outro', 'break — stop on 1', 'build up', 'quieter', 'watch me', 'tempo up', 'last time'];
const DURATIONS: [number, string][] = [[0, 'until cleared'], [5, '5 s'], [10, '10 s'], [30, '30 s']];

export const LivePanel = calm(function LivePanel({ showStart, countIn, ready, playing, onCue, onShow, onGo }: {
  showStart: number | null;
  countIn: boolean;
  ready: boolean;
  playing: boolean;
  onCue: (text: string | null, seconds: number) => void;
  onShow: (a: 'start' | 'reset') => void;
  onGo: (seconds: number) => void;
}) {
  const [text, setText] = useState('');
  const [seconds, setSeconds] = useState(10);
  const [go, setGo] = useState(4);
  const now = useNow(showStart !== null, 1000);

  return (
    <div className="live-grid">
      <div className="live-block">
        <span className="field-label">start together</span>
        <div className="row">
          <button className="btn primary" onClick={() => onGo(go)} disabled={!ready || playing} title={`big countdown on every screen, then play${countIn ? ' after a count-in bar' : ''} (g)`}>go in {go}</button>
          <div className="segmented" aria-label="countdown length">
            {[2, 4, 8].map(s => <button key={s} className={go === s ? 'active' : ''} onClick={() => setGo(s)}>{s}s</button>)}
          </div>
        </div>
        <span className="field-label" style={{ marginTop: 12 }}>show clock</span>
        <div className="row">
          <span className="lcd show-lcd"><span className="lcd-value">{showStart === null ? '--:--' : formatTime(now - showStart)}</span></span>
          {showStart === null
            ? <button className="btn" onClick={() => onShow('start')}>start show</button>
            : <button className="btn ghost" onClick={() => { if (window.confirm('reset the show clock for everyone?')) onShow('reset'); }}>reset</button>}
        </div>
      </div>

      <div className="live-block">
        <span className="field-label">cue everyone</span>
        <div className="cue-buttons">
          {QUICK_CUES.map(q => <button key={q} className="btn sm" onClick={() => onCue(q, seconds)}>{q}</button>)}
        </div>
        <form className="row" onSubmit={e => { e.preventDefault(); if (text.trim()) { onCue(text.trim(), seconds); setText(''); } }}>
          <input className="input" value={text} onChange={e => setText(e.target.value)} placeholder="custom cue…" maxLength={140} aria-label="custom cue" />
          <select className="btn" value={seconds} onChange={e => setSeconds(Number(e.target.value))} aria-label="cue duration">
            {DURATIONS.map(([v, l]) => <option key={v} value={v}>{l}</option>)}
          </select>
          <button className="btn" type="submit" disabled={!text.trim()}>send</button>
          <button className="btn ghost" type="button" onClick={() => onCue(null, 0)}>clear</button>
        </form>
      </div>
    </div>
  );
});

// ---- band monitor ---------------------------------------------------------------------

export const Members = calm(function Members({ members, me }: { members: Member[]; me: number | null }) {
  const listeners = members.filter(m => !m.host);
  const ready = members.filter(m => m.ready).length;
  return (
    <>
      <div className="section-head">
        <span className="hint-inline">{ready} of {members.length} loaded{listeners.length ? '' : ' · share the invite link to bring people in'}</span>
      </div>
      <div className="members">
        {members.map(m => {
          const drift = m.drift ?? null;
          const state = !m.ready ? 'wait' : m.playing && drift !== null && Math.abs(drift) > 150 ? 'bad' : 'ok';
          const title = !m.ready ? 'loading…' : state === 'bad' ? `drifting ${drift} ms — re-syncing` : 'loaded & in sync';
          return (
            <div key={m.id} className={`member ${m.id === me ? 'me' : ''}`} title={title}>
              <span className={`dot ${state}`} />
              <span className="member-name">{m.name || `guest ${m.id}`}{m.id === me ? ' (you)' : ''}</span>
              {m.host && <span className="member-tag">host</span>}
              {m.part && <span className="member-part">{m.part}</span>}
              {!m.host && m.latency !== null && m.latency !== undefined && <span className="member-meta mono">{m.latency} ms</span>}
              {!m.host && m.playing && drift !== null && <span className="member-meta mono">{drift > 0 ? '+' : ''}{drift}</span>}
            </div>
          );
        })}
      </div>
    </>
  );
});
