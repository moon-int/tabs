"use client";
import React, { useEffect, useState } from 'react';
import { Brand } from '../../components/Logo';
import AccountChip from '../../components/AccountChip';
import { api, signInUrl, useServerConfig, type LibrarySet } from '../../lib/account';
import { at } from '../../lib/base';

type Status = { live: string | null; playing?: boolean; song?: string | null; index?: number; songs?: number; next?: string | null; hostConnected?: boolean; listeners?: number };
type Cue = { label: string; action: string; body?: Record<string, unknown> };

/** the cues worth having in mo-tion time — each one http request to the control api */
const CUES: Cue[] = [
  { label: 'doors · show clock starts', action: 'show', body: { action: 'start' } },
  { label: 'band: 5 minutes', action: 'cue', body: { text: 'stage in 5 minutes', seconds: 60 } },
  { label: 'go — countdown, then play', action: 'go', body: { seconds: 8 } },
  { label: 'next song', action: 'next' },
  { label: 'pause', action: 'pause' },
  { label: 'stop', action: 'stop' },
  { label: 'groove on (between songs)', action: 'groove', body: { on: true } },
  { label: 'groove: pattern b', action: 'groove', body: { slot: 2 } },
  { label: 'groove off', action: 'groove', body: { off: true } },
];

/** run the live session from here — and wire mo-tion time's cues to it */
export default function ControlPage() {
  const server = useServerConfig();
  const [status, setStatus] = useState<Status | null>(null);
  const [sets, setSets] = useState<LibrarySet[]>([]);
  const [cue, setCue] = useState('');
  const [key, setKey] = useState<string | null>(null);
  const [showKey, setShowKey] = useState(false);
  const [toast, setToast] = useState<{ msg: string; error?: boolean } | null>(null);
  const allowed = !!server && (!server.auth || !!server.user?.canHost);
  const base = server?.appUrl || (typeof window !== 'undefined' ? window.location.origin : '');

  const flash = (msg: string, error = false) => {
    setToast({ msg, error });
    window.setTimeout(() => setToast(t => (t?.msg === msg ? null : t)), error ? 3600 : 1600);
  };

  useEffect(() => {
    if (!allowed) return;
    const poll = () => api<Status>('/control/status').then(setStatus).catch(() => {});
    poll();
    const t = window.setInterval(poll, 2500);
    if (server?.library) api<{ sets: LibrarySet[] }>('/library').then(l => setSets(l.sets)).catch(() => {});
    // admins see the key the cues need (the server makes it itself, data/secrets.json)
    if (!server?.auth || server.user?.admin) api<{ key: string | null }>('/control-key').then(k => setKey(k.key)).catch(() => {});
    return () => window.clearInterval(t);
  }, [allowed, server?.library]);

  const send = (action: string, body: Record<string, unknown> = {}) =>
    api<Status & { ok?: boolean }>(`/control/${action}`, body)
      .then(() => { flash(`${action} ✓`); api<Status>('/control/status').then(setStatus).catch(() => {}); })
      .catch(e => flash((e as Error).message, true));

  /** a cue in mo-tion time's format — paste it into time's schedule (import) or copy the fields over */
  const timeCue = (c: Cue) => ({
    time: '20:00',
    label: `tabs · ${c.label}`,
    method: 'POST',
    url: `${base}/api/control/${c.action}`,
    headers: `Content-Type: application/json\nX-Tabs-Key: ${key ?? '<the control key - an admin sees it here>'}`,
    body: JSON.stringify(c.body ?? {}),
    auto: false,
    repeat: 'once',
  });

  const copy = async (text: string, what: string) => {
    try { await navigator.clipboard.writeText(text); flash(`${what} copied`); } catch { window.prompt('copy this', text); }
  };

  return (
    <div className="container">
      <header className="header">
        <Brand />
        <div className="spacer" />
        <div className="header-info">
          <a className="btn sm ghost" href={at('/')}>sessions</a>
          {server?.library && <a className="btn sm ghost" href={at('/library')}>library</a>}
          {server?.auth && <AccountChip user={server.user} />}
        </div>
      </header>

      {server === undefined ? null : !server ? (
        <section className="panel empty-state"><h2>no tabs server here</h2><p className="muted">the control api needs the tabs server (start.bat / npm start).</p></section>
      ) : !allowed ? (
        <section className="panel empty-state">
          <h2>sign in first</h2>
          <p className="muted">only hosts control the live session.</p>
          {!server.user && <a className="btn primary" href={signInUrl('/control')}>sign in with havoc</a>}
        </section>
      ) : (
        <>
          <section className="panel deck">
            <div className="deck-song">
              <div className="song-text">
                <div className="song-kicker">
                  <span className={`chip ${status?.live ? 'mint' : ''}`}>{status?.live ? <>live · <strong className="mono">{status.live}</strong></> : 'no live session'}</span>
                  {status?.live && <span className="song-meta">{status.hostConnected ? 'host page open' : 'no host page — commands apply directly'} · {status.listeners ?? 0} listening</span>}
                </div>
                <h1 className="song-title">{status?.song || (status?.live ? 'no song loaded' : 'open a session, or start a show')}</h1>
                {status?.live && (status.songs ?? 0) > 0 && (
                  <div className="song-meta">song {(status.index ?? -1) + 1} of {status.songs}{status.next ? ` · next: ${status.next}` : ''}{status.playing ? ' · playing' : ''}</div>
                )}
              </div>
              <div className="deck-actions">
                {status?.live && <a className="btn sm" href={at(`/room/${status.live}`)} target="_blank" rel="noreferrer">open session ↗</a>}
              </div>
            </div>

            <div className="control-grid">
              <button className="btn primary" onClick={() => send('go', { seconds: 4 })} disabled={!status?.live}>go in 4</button>
              <button className="btn" onClick={() => send('play')} disabled={!status?.live}>play</button>
              <button className="btn" onClick={() => send('pause')} disabled={!status?.live}>pause</button>
              <button className="btn" onClick={() => send('stop')} disabled={!status?.live}>stop</button>
              <button className="btn" onClick={() => send('prev')} disabled={!status?.live}>‹ prev</button>
              <button className="btn" onClick={() => send('next')} disabled={!status?.live}>next ›</button>
              <button className="btn" onClick={() => send('show', { action: 'start' })} disabled={!status?.live}>show clock</button>
              <button className="btn" onClick={() => send('groove', { on: true })} disabled={!status?.live}>groove on</button>
              <button className="btn" onClick={() => send('groove', { off: true })} disabled={!status?.live}>groove off</button>
              {[1, 2, 3, 4].map(n => <button key={n} className="btn sm" onClick={() => send('groove', { slot: n })} disabled={!status?.live}>pattern {'abcd'[n - 1]}</button>)}
            </div>
            <form className="row" onSubmit={e => { e.preventDefault(); if (cue.trim()) { send('cue', { text: cue.trim(), seconds: 10 }); setCue(''); } }}>
              <input className="input" style={{ flex: 1 }} value={cue} onChange={e => setCue(e.target.value)} placeholder="cue to every screen…" maxLength={140} aria-label="cue" />
              <button className="btn" type="submit" disabled={!status?.live || !cue.trim()}>send cue</button>
            </form>
          </section>

          {sets.length > 0 && (
            <section className="panel">
              <div className="section-head"><h2>load a show into the live session</h2><span className="hint-inline">the band stays in — same code</span></div>
              <div className="set-cards">
                {sets.map(s => (
                  <div key={s.id} className="set-card">
                    <div className="set-card-text"><strong>{s.name}</strong><span className="muted">{s.songs.length} songs</span></div>
                    <div className="row">
                      <button className="btn sm primary" onClick={() => send('load', { set: s.id })}>load</button>
                      <button className="btn sm ghost" onClick={() => copy(JSON.stringify(timeCue({ label: `load ${s.name}`, action: 'load', body: { set: s.name } }), null, 2), 'time cue')}>time cue</button>
                    </div>
                  </div>
                ))}
              </div>
            </section>
          )}

          <section className="panel">
            <div className="section-head">
              <h2>mo-tion time</h2>
              <span className="hint-inline">each cue in time sends one request at its time — copy a cue, paste the fields into time</span>
            </div>
            {key ? (
              <div className="row control-key">
                <span className="field-label">control key</span>
                <code className="mono">{showKey ? key : '•'.repeat(16)}</code>
                <button className="btn sm ghost" onClick={() => setShowKey(v => !v)}>{showKey ? 'hide' : 'show'}</button>
                <button className="btn sm" onClick={() => copy(key, 'control key')}>copy</button>
                <span className="hint-inline">already in every cue you copy below</span>
              </div>
            ) : !server.control.key ? (
              <div className="banner warn">no control key on this server — only signed-in hosts can control.</div>
            ) : (
              <p className="hint">the cues need the server&apos;s control key — an admin sees it on this page.</p>
            )}
            <div className="cue-templates">
              {CUES.map(c => (
                <div key={c.label} className="cue-template">
                  <div className="cue-template-text">
                    <strong>{c.label}</strong>
                    <code className="mono">POST {base}/api/control/{c.action}{c.body ? ` ${JSON.stringify(c.body)}` : ''}</code>
                  </div>
                  <button className="btn sm" onClick={() => copy(JSON.stringify(timeCue(c), null, 2), 'time cue')}>copy cue</button>
                </div>
              ))}
            </div>
            <p className="hint">
              every request needs the key: header <span className="mono">X-Tabs-Key</span>, or <span className="mono">?key=</span> in the url.
              time can call tabs straight from the browser (cors is open for the control api) or through its relay.
              <span className="mono"> GET {base}/api/control/status</span> tells what&apos;s live.
            </p>
          </section>
        </>
      )}

      <div className={`toast ${toast?.error ? 'error' : ''} ${toast ? 'show' : ''}`} role="status">{toast?.msg}</div>
    </div>
  );
}
