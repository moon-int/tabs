"use client";
import React from 'react';
import { Brand } from '../Logo';
import AccountChip from '../AccountChip';
import { DropZone, FORMATS, JoinForm, Toast } from './parts';
import { useLanding } from '../../lib/useLanding';
import { signInUrl } from '../../lib/account';
import { at } from '../../lib/base';

/**
 * tabs by mo-tion — the public home (tabs.mo-tion.at). One thing up front: open a tab file. Next to
 * it: join with a code — codes of the band's own server (lg…) go straight there.
 */
export default function TabsHome() {
  const h = useLanding();
  const { server, solo, signedOut, canHost, busy } = h;

  return (
    <div className="container home">
      <header className="header">
        <Brand />
        <div className="spacer" />
        <div className="header-info">
          {server?.library && canHost && <a className="btn sm" href={at('/library')}>library & shows</a>}
          {server && canHost && <a className="btn sm ghost" href={at('/control')}>control</a>}
          {server?.auth
            ? <AccountChip user={server.user} />
            : <a className="btn ghost sm" href="https://github.com/CoderLine/alphaTab" target="_blank" rel="noreferrer">powered by alphaTab</a>}
        </div>
      </header>

      <section className="home-hero">
        <h1>play tabs <em>together</em>, in sync.</h1>
        <p>open a guitar pro or musicxml file — notation, playback, click and your own mix. alone, or with your whole band following the same cursor.</p>
      </section>

      {server === undefined ? null : !canHost ? (
        <div className="home-grid">
          <section className="panel home-card">
            <h2>join a session</h2>
            <p className="muted">got a code or a link from your host?</p>
            <JoinForm onJoin={h.join} autoFocus />
          </section>
          <section className="panel home-card">
            <h2>{signedOut ? 'band members' : `signed in as ${server?.user?.name}`}</h2>
            <p className="muted">{signedOut ? 'sign in to start sessions and keep your tabs.' : 'starting sessions needs the contributor role in havoc.'}</p>
            {signedOut && <a className="btn primary" href={signInUrl('/')}>sign in with havoc</a>}
          </section>
        </div>
      ) : (
        <div className={h.canJoin ? 'home-grid' : 'home-single'}>
          <section className="panel home-card home-start">
            <DropZone big onFiles={h.start} busy={busy && !h.sets.some(s => s.id === busy) ? busy : null} title="open a tab file" hint={FORMATS} />
            <div className="home-start-row">
              <button className="btn" onClick={() => h.start([])} disabled={!!busy}>empty session</button>
            </div>
          </section>

          {h.canJoin && (
            <section className="panel home-card">
              <h2>join a session</h2>
              <p className="muted">got a code or a link from your band? enter it here.</p>
              <JoinForm onJoin={h.join} />
              {h.recent.length > 0 && (
                <div className="recent">
                  {h.recent.map(r => (
                    <a key={r.id} className="chip" href={at(`/room/${r.id}`)} title="rejoin as host">
                      <span className="dot ok" /> <strong className="mono">{r.id}</strong>{r.title && <span>· {r.title}</span>}
                    </a>
                  ))}
                </div>
              )}
            </section>
          )}
        </div>
      )}

      {server?.library && canHost && h.sets.length > 0 && (
        <section className="panel">
          <div className="section-head">
            <h2>your shows</h2>
            <span className="hint-inline">start one — the band joins with the code</span>
            <div className="spacer" />
            <a className="btn sm" href={at('/library')}>manage</a>
          </div>
          <div className="set-cards">
            {h.sets.slice().sort((a, b) => b.updatedAt - a.updatedAt).slice(0, 6).map(set => (
              <div key={set.id} className="set-card">
                <div className="set-card-text">
                  <a className="set-card-name" href={at(`/sets/${set.id}`)}>{set.name}</a>
                  <span className="muted">{set.songs.length} song{set.songs.length === 1 ? '' : 's'}{set.date ? ` · ${set.date}` : ''}</span>
                </div>
                <button className="btn sm primary" onClick={() => h.startSet(set)} disabled={!!busy || !set.songs.length}>{busy === set.id ? 'opening…' : 'start'}</button>
              </div>
            ))}
          </div>
        </section>
      )}

      {solo && (
        <section className="home-points">
          <div><strong>in your browser</strong><span>nothing is uploaded — notation, playback, click, tunings and setlists run right here.</span></div>
          <div><strong>your mix</strong><span>mute, solo and level every instrument, retune the tab to your guitar, slow it down, loop a part.</span></div>
          <details>
            <summary><strong>as a band</strong><span>everyone in sync, one cursor — run tabs on a laptop in the rehearsal room.</span></summary>
            <code className="cmd">npm install &amp;&amp; npm run build &amp;&amp; npm start</code>
            <span className="muted">the band joins in the same wifi with the session&apos;s code or qr code — no internet needed.</span>
          </details>
        </section>
      )}

      <footer className="footer">
        <span className="footer-credit">notation & synth by alphaTab · <a href="https://mo-tion.at" target="_blank" rel="noreferrer">mo-tion.at</a> · <a href="https://github.com/moon-int/tabs" target="_blank" rel="noreferrer">open source on github</a></span>
      </footer>
      <Toast msg={h.toast} />
    </div>
  );
}
