"use client";
import React, { useEffect, useMemo, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import { Brand } from '../../../components/Logo';
import AccountChip from '../../../components/AccountChip';
import { ChangeoverLine, SongEditor } from '../../../components/Setlist';
import { changeovers, forRole, setupOf } from '../../../lib/changeover';
import { freshKey, saveHostToken, type SetlistSong } from '../../../lib/sync';
import { loadPrefs, type Part } from '../../../lib/prefs';
import { api, signInUrl, useServerConfig, type LibrarySet, type LibraryTab, type SetSong } from '../../../lib/account';
import { at } from '../../../lib/base';

const RIG_ROLES: Part[] = ['guitar', 'bass', 'keys'];

/** only what a set stores per song (server/library.js applySet) */
const stored = (s: SetSong) => ({
  tab: s.tab, title: s.title, notes: s.notes, speed: s.speed, countIn: s.countIn, transpose: s.transpose,
  autoNext: s.autoNext, autoStart: s.autoStart, gap: s.gap, groove: s.groove, rig: s.rig,
});

const blankSong = (tab: LibraryTab): SetSong => ({
  tab: tab.id, title: '', tabTitle: tab.title, artist: tab.artist, name: tab.name, roles: tab.roles,
  notes: null, speed: null, countIn: null, transpose: null, autoNext: false, autoStart: false, gap: 5, groove: null, rig: null,
});

/** build a show: songs from your library, in order, each with its live settings */
export default function SetEditor({ params }: { params: { id: string } }) {
  const router = useRouter();
  const server = useServerConfig();
  const [set, setSet] = useState<LibrarySet | null>(null);
  const [tabs, setTabs] = useState<LibraryTab[]>([]);
  const [missing, setMissing] = useState(false);
  const [open, setOpen] = useState<number | null>(null);
  const [query, setQuery] = useState('');
  const [status, setStatus] = useState<'saved' | 'saving' | 'unsaved' | 'error'>('saved');
  const [busy, setBusy] = useState(false);
  const [myPart, setMyPart] = useState<Part | null>(null);
  const timer = useRef<number | undefined>(undefined);
  const latest = useRef<LibrarySet | null>(null);

  const allowed = !!server && server.library && (!server.auth || !!server.user?.canHost);
  useEffect(() => { setMyPart(loadPrefs().part); }, []);
  useEffect(() => {
    if (!allowed) return;
    api<LibrarySet>(`/library/sets/${params.id}`).then(s => { setSet(s); latest.current = s; }).catch(() => setMissing(true));
    api<{ tabs: LibraryTab[] }>('/library?all=1').then(l => setTabs(l.tabs)).catch(() => {});
  }, [allowed, params.id]);

  // a shared show (the server's own) is played by everyone, changed only by admins — others copy it
  const readOnly = !!set?.shared && !!server?.auth && !server.user?.admin;

  const copyToMine = async () => {
    if (!set) return;
    try {
      const copy = await api<LibrarySet>('/library/sets', {
        name: set.name, subtitle: set.subtitle, date: set.date, notes: set.notes, countIn: set.countIn, transpose: set.transpose,
        songs: set.songs.map(stored),
      });
      router.push(`/sets/${copy.id}`);
    } catch (e) {
      window.alert((e as Error).message);
    }
  };

  /** every change saves itself a moment later */
  const change = (fn: (s: LibrarySet) => LibrarySet) => {
    if (readOnly) return;
    setSet(prev => {
      if (!prev) return prev;
      const next = fn(prev);
      latest.current = next;
      return next;
    });
    setStatus('unsaved');
    window.clearTimeout(timer.current);
    timer.current = window.setTimeout(save, 700);
  };

  const save = async () => {
    const s = latest.current;
    if (!s) return;
    setStatus('saving');
    try {
      await api(`/library/sets/${s.id}`, {
        name: s.name, subtitle: s.subtitle, date: s.date, notes: s.notes, countIn: s.countIn, transpose: s.transpose,
        songs: s.songs.map(stored),
      }, 'PATCH');
      setStatus(latest.current === s ? 'saved' : 'unsaved');
    } catch {
      setStatus('error');
    }
  };
  useEffect(() => () => window.clearTimeout(timer.current), []);

  const setSong = (i: number, patch: Partial<SetSong>) => change(s => ({ ...s, songs: s.songs.map((x, j) => (j === i ? { ...x, ...patch } : x)) }));
  const move = (from: number, to: number) => change(s => {
    if (to < 0 || to >= s.songs.length) return s;
    const songs = s.songs.slice();
    const [x] = songs.splice(from, 1);
    songs.splice(to, 0, x);
    return { ...s, songs };
  });

  const start = async () => {
    if (!set) return;
    window.clearTimeout(timer.current);
    setBusy(true);
    try {
      await save();
      const { roomId, hostToken } = await api<{ roomId: string; hostToken: string }>(`/library/sets/${set.id}/start`, {});
      saveHostToken(roomId, hostToken);
      try { sessionStorage.setItem(freshKey(roomId), '1'); } catch {}
      router.push(`/room/${roomId}`);
    } catch (e) {
      setBusy(false);
      window.alert((e as Error).message);
    }
  };

  const picker = useMemo(() => {
    const q = query.trim().toLowerCase();
    const mine = tabs.filter(t => !server?.auth || t.owner === set?.owner || server.user?.admin);
    const list = mine.slice().sort((a, b) => b.usedAt - a.usedAt);
    return (q ? list.filter(t => `${t.title} ${t.artist} ${t.name}`.toLowerCase().includes(q)) : list).slice(0, 40);
  }, [tabs, query, set?.owner, server]);

  if (server === undefined) return null;
  if (!allowed) {
    return (
      <div className="container">
        <header className="header"><Brand /></header>
        <section className="panel empty-state">
          <h2>sign in first</h2>
          <p className="muted">shows live in your library on the tabs server.</p>
          {server?.auth && !server.user ? <a className="btn primary" href={signInUrl()}>sign in with havoc</a> : <a className="btn" href={at('/')}>back</a>}
        </section>
      </div>
    );
  }
  if (missing) {
    return (
      <div className="container">
        <header className="header"><Brand /></header>
        <section className="panel empty-state"><h2>show not found</h2><a className="btn" href={at('/library')}>to the library</a></section>
      </div>
    );
  }
  if (!set) return null;

  return (
    <div className="container wide">
      <header className="header">
        <Brand />
        <div className="spacer" />
        <div className="header-info">
          <a className="btn sm ghost" href={at('/library')}>library</a>
          {server?.auth && <AccountChip user={server.user} />}
        </div>
      </header>

      <section className="panel deck">
        <div className="deck-song">
          <div className="song-text">
            <div className="song-kicker">
              <span className="chip mono">show</span>
              <span className={`song-meta save-${status}`}>{status === 'saving' ? 'saving…' : status === 'unsaved' ? 'changes…' : status === 'error' ? 'could not save — check the connection' : 'saved'}</span>
            </div>
            <input className="input set-name" readOnly={readOnly} value={set.name} maxLength={120} aria-label="name of the show" onChange={e => { const name = e.target.value; change(s => ({ ...s, name })); }} />
          </div>
          <div className="deck-actions">
            <button className="btn primary" onClick={start} disabled={busy || !set.songs.length}>{busy ? 'opening…' : `start the show · ${set.songs.length} songs`}</button>
            {readOnly && <button className="btn sm" onClick={copyToMine} title="your own copy, to change as you like">copy to my shows</button>}
          </div>
        </div>
        {readOnly && <div className="banner">a shared show — everyone can start it; to change it, copy it to your shows.</div>}
        <fieldset className="plain-fieldset" disabled={readOnly}>
        <div className="set-fields">
          <label className="field"><span className="field-label">subtitle</span>
            <input className="input" value={set.subtitle} maxLength={200} onChange={e => { const subtitle = e.target.value; change(s => ({ ...s, subtitle })); }} placeholder="venue, tour, occasion…" />
          </label>
          <label className="field"><span className="field-label">date</span>
            <input className="input" value={set.date} maxLength={80} onChange={e => { const date = e.target.value; change(s => ({ ...s, date })); }} placeholder="20. juni 2026" />
          </label>
          <label className="field"><span className="field-label">count-in</span>
            <select className="btn" value={set.countIn ? 'on' : 'off'} onChange={e => { const countIn = e.target.value === 'on'; change(s => ({ ...s, countIn })); }}>
              <option value="on">on for the whole show</option>
              <option value="off">off</option>
            </select>
          </label>
          <label className="field"><span className="field-label">play in</span>
            <select className="btn" value={set.transpose} onChange={e => { const transpose = Number(e.target.value); change(s => ({ ...s, transpose })); }}>
              {[2, 1, 0, -1, -2, -3, -4, -5].map(n => <option key={n} value={n}>{n === 0 ? 'original pitch' : `${n > 0 ? '+' : '−'}${Math.abs(n)} semitone${Math.abs(n) === 1 ? '' : 's'}`}</option>)}
            </select>
          </label>
          <label className="field set-notes"><span className="field-label">notes for the band</span>
            <textarea className="input" rows={2} value={set.notes} maxLength={1000} onChange={e => { const notes = e.target.value; change(s => ({ ...s, notes })); }} placeholder="soundcheck 18:00 · in-ears · …" />
          </label>
        </div>
        </fieldset>
      </section>

      <fieldset className="plain-fieldset set-layout" disabled={readOnly}>
        <section className="panel">
          <div className="section-head"><h2>running order</h2><span className="hint-inline">changeovers come from the tabs themselves</span></div>
          {set.songs.length === 0 && <div className="empty-line">add songs from your library →</div>}
          <div className="setlist">
            {set.songs.map((s, i) => {
              const song = { ...s, name: s.name ?? null, title: s.title || s.tabTitle || '' } as unknown as SetlistSong;
              const shift = s.transpose ?? set.transpose;
              const setup = setupOf({ roles: s.roles, rig: s.rig, transpose: shift });
              return (
                <React.Fragment key={`${i}-${s.tab}`}>
                  {i > 0 && <ChangeoverLine changes={forRole(changeovers({ ...set.songs[i - 1], transpose: set.songs[i - 1].transpose ?? set.transpose }, { ...s, transpose: shift }), myPart)} myPart={myPart} />}
                  <div className="song-item">
                    <div className="song-row">
                      <span className="num">{String(i + 1).padStart(2, '0')}</span>
                      <div className="title-wrap">
                        <button className="title" onClick={() => setOpen(open === i ? null : i)}>{s.title || s.tabTitle}{s.missing ? ' (missing)' : ''}</button>
                        <span className="song-notes">{[s.artist, ...setup.map(x => `${x.role} ${[x.tuning, x.rig].filter(Boolean).join(' · ')}`)].filter(Boolean).join(' · ')}</span>
                      </div>
                      <span className="badges">
                        {s.speed && <span className="badge">{Math.round(s.speed * 100)}%</span>}
                        {s.countIn !== null && <span className="badge">count-in {s.countIn ? 'on' : 'off'}</span>}
                        {s.transpose !== null && s.transpose !== set.transpose && <span className="badge">{s.transpose > 0 ? '+' : '−'}{Math.abs(s.transpose)} st</span>}
                        {s.groove && <span className="badge">{s.groove.on ? `♪ ${s.groove.name}` : 'no groove'}</span>}
                        {s.autoNext && <span className="badge">→</span>}
                        {s.autoStart && <span className="badge">auto {s.gap}s</span>}
                      </span>
                      <span className="row-actions">
                        <button className={`icon-btn ${open === i ? 'active' : ''}`} onClick={() => setOpen(open === i ? null : i)} aria-label="song settings" aria-expanded={open === i}>
                          <svg viewBox="0 0 16 16" width="12" height="12" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round"><path d="M3 5h10M3 11h10M6 3v4M10 9v4" /></svg>
                        </button>
                        <button className="icon-btn" onClick={() => move(i, i - 1)} disabled={i === 0} aria-label="move up"><svg viewBox="0 0 16 16" width="12" height="12" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round"><path d="M8 13V3M4 7l4-4 4 4" /></svg></button>
                        <button className="icon-btn" onClick={() => move(i, i + 1)} disabled={i === set.songs.length - 1} aria-label="move down"><svg viewBox="0 0 16 16" width="12" height="12" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round"><path d="M8 3v10M4 9l4 4 4-4" /></svg></button>
                        <button className="icon-btn warn" onClick={() => change(x => ({ ...x, songs: x.songs.filter((_, j) => j !== i) }))} aria-label="remove"><svg viewBox="0 0 16 16" width="12" height="12" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round"><path d="M4 4l8 8M12 4l-8 8" /></svg></button>
                      </span>
                    </div>
                    {open === i && (
                      <>
                        <SongEditor key={`${i}-${s.tab}`} song={song} onUpdate={patch => setSong(i, patch as Partial<SetSong>)} />
                        <div className="song-editor rig-editor">
                          <span className="field-label">rig per role — shown only to that role, e.g. an amp preset</span>
                          <div className="editor-row">
                            {RIG_ROLES.map(role => (
                              <label key={role} className="field">
                                <span className="field-label">{role}</span>
                                <input
                                  className="input" maxLength={80} defaultValue={s.rig?.[role] ?? ''} placeholder="—"
                                  onBlur={e => {
                                    const v = e.target.value.trim();
                                    if (v === (s.rig?.[role] ?? '')) return;
                                    const rig = { ...(s.rig ?? {}) } as Partial<Record<Part, string>>;
                                    if (v) rig[role] = v; else delete rig[role];
                                    setSong(i, { rig: Object.keys(rig).length ? rig : null });
                                  }}
                                />
                              </label>
                            ))}
                          </div>
                        </div>
                      </>
                    )}
                  </div>
                </React.Fragment>
              );
            })}
          </div>
        </section>

        <section className="panel">
          <div className="section-head"><h2>add songs</h2><div className="spacer" /><a className="btn sm ghost" href={at('/library')}>+ upload in the library</a></div>
          <input className="input lib-search" value={query} onChange={e => setQuery(e.target.value)} placeholder="search your tabs…" aria-label="search your tabs" />
          <div className="picker">
            {picker.length === 0 && <div className="empty-line">{tabs.length ? 'nothing matches.' : 'your library is empty — add tabs there first.'}</div>}
            {picker.map(t => (
              <button key={t.id} className="picker-row" onClick={() => change(s => ({ ...s, songs: [...s.songs, blankSong(t)] }))} title="add to the end of the show">
                <span className="picker-text"><strong>{t.title}</strong><span className="muted">{[t.artist, ...setupOf({ roles: t.roles }).filter(x => x.tuning).map(x => x.tuning)].filter(Boolean).join(' · ')}</span></span>
                <span className="picker-add">+</span>
              </button>
            ))}
          </div>
        </section>
      </fieldset>
    </div>
  );
}
