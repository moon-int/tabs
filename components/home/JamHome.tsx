"use client";
import React, { useEffect, useState } from 'react';
import Logo, { Brand } from '../Logo';
import AccountChip from '../AccountChip';
import { DropZone, FORMATS, JoinForm, Toast } from './parts';
import { useLanding } from '../../lib/useLanding';
import { signInUrl } from '../../lib/account';
import { setupOf } from '../../lib/changeover';
import { BRAND } from '../../lib/brand';
import { at } from '../../lib/base';

const greeting = (h: number) => (h < 5 ? 'late night' : h < 11 ? 'morning' : h < 17 ? 'hey' : h < 22 ? 'evening' : 'late night');

/**
 * jam — the band's own room (jam.geyser.at/tabs). At the door: a code to get in, or sign in.
 * Inside: start a jam, your shows (the ones the server came with among them), what you played lately.
 */
export default function JamHome() {
  const h = useLanding();
  const { server, canHost, busy } = h;
  const [hello, setHello] = useState('hey');
  useEffect(() => { setHello(greeting(new Date().getHours())); }, []);
  const first = server?.user?.name?.split(/\s+/)[0];
  const lately = h.tabs.slice().sort((a, b) => b.usedAt - a.usedAt).slice(0, 8);
  const shows = h.sets.slice().sort((a, b) => b.updatedAt - a.updatedAt).slice(0, 6);
  const quietBusy = busy && (h.sets.some(s => s.id === busy) || h.tabs.some(t => t.id === busy)) ? null : busy;

  if (server === undefined) return <div className="container home jam" />;

  // ---- at the door: guests get in with a code, the band signs in ---------------------------
  if (!canHost) {
    return (
      <div className="jam-door-wrap">
        <section className="jam-door">
          <Logo size={76} />
          <h1 className="jam-name">{BRAND.name}</h1>
          {BRAND.by && <p className="jam-tagline">{BRAND.by}</p>}
          <JoinForm onJoin={h.join} big autoFocus />
          <p className="jam-door-foot">
            {server?.user
              ? <>signed in as <strong>{server.user.name}</strong> — your havoc role can join with a code. <a href={at('/api/auth/logout')}>sign out</a></>
              : <>in the band? <a href={signInUrl('/')}>sign in with havoc</a></>}
          </p>
        </section>
        <Toast msg={h.toast} />
      </div>
    );
  }

  // ---- inside --------------------------------------------------------------------------------
  return (
    <div className="container home jam">
      <header className="header">
        <Brand />
        <div className="spacer" />
        <nav className="header-info">
          {server?.library && <a className="btn sm" href={at('/library')}>library</a>}
          {server && <a className="btn sm ghost" href={at('/control')}>control</a>}
          {server?.auth && <AccountChip user={server.user} />}
        </nav>
      </header>

      <section className="jam-hello">
        <h1>{hello}{first ? `, ${first}` : ''}.</h1>
        <p className="muted">
          {server?.library ? `${h.sets.length} show${h.sets.length === 1 ? '' : 's'} · ${h.tabs.length} song${h.tabs.length === 1 ? '' : 's'} in your library` : 'ready when you are.'}
        </p>
      </section>

      <div className="home-grid">
        <section className="panel home-card">
          <h2>start a jam</h2>
          <DropZone onFiles={h.start} busy={quietBusy} title="drop tab files — or click" hint={FORMATS} />
          <div className="home-start-row">
            <button className="btn" onClick={() => h.start([])} disabled={!!busy}>empty session</button>
          </div>
        </section>
        <section className="panel home-card">
          <h2>join</h2>
          <JoinForm onJoin={h.join} />
          {h.recent.length > 0 && (
            <>
              <p className="muted home-sub">running now</p>
              <div className="recent">
                {h.recent.map(r => (
                  <a key={r.id} className="chip" href={at(`/room/${r.id}`)} title="back in as host">
                    <span className="dot ok" /> <strong className="mono">{r.id}</strong>{r.title && <span>· {r.title}</span>}{r.listeners > 0 && <span>· {r.listeners} in</span>}
                  </a>
                ))}
              </div>
            </>
          )}
        </section>
      </div>

      {server?.library && (
        <section className="panel">
          <div className="section-head">
            <h2>your shows</h2>
            <div className="spacer" />
            <a className="btn sm ghost" href={at('/library')}>{shows.length ? 'all shows' : '+ build one'}</a>
          </div>
          {shows.length === 0
            ? <div className="empty-line">no shows yet — put songs in order in the library, or save a jam&apos;s setlist as a show.</div>
            : (
              <div className="set-cards">
                {shows.map(set => (
                  <div key={set.id} className="set-card">
                    <div className="set-card-text">
                      <a className="set-card-name" href={at(`/sets/${set.id}`)}>{set.name}</a>
                      <span className="muted">{set.songs.length} song{set.songs.length === 1 ? '' : 's'}{set.date ? ` · ${set.date}` : ''}</span>
                    </div>
                    <button className="btn sm primary" onClick={() => h.startSet(set)} disabled={!!busy || !set.songs.length}>{busy === set.id ? 'opening…' : 'start'}</button>
                  </div>
                ))}
              </div>
            )}
        </section>
      )}

      {lately.length > 0 && (
        <section className="panel">
          <div className="section-head"><h2>played lately</h2><div className="spacer" /><a className="btn sm ghost" href={at('/library')}>library</a></div>
          <div className="lately">
            {lately.map(t => (
              <button key={t.id} className="lately-item" onClick={() => h.openTab(t)} disabled={!!busy} title="play it in a new session">
                <span className="lately-title">{busy === t.id ? 'opening…' : t.title}</span>
                <span className="lately-sub">{[t.artist, ...setupOf({ roles: t.roles }).filter(x => x.tuning).slice(0, 1).map(x => x.tuning)].filter(Boolean).join(' · ')}</span>
              </button>
            ))}
          </div>
        </section>
      )}

      <footer className="footer jam-footer">
        <span className="footer-credit">{BRAND.name} runs on tabs by <a href="https://mo-tion.at" target="_blank" rel="noreferrer">mo-tion</a> · notation & synth by alphaTab</span>
      </footer>
      <Toast msg={h.toast} />
    </div>
  );
}
