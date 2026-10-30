"use client";
import React, { useEffect, useMemo, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import { Brand } from '../../components/Logo';
import AccountChip from '../../components/AccountChip';
import { ACCEPT, freshKey, readTabFile, saveHostToken } from '../../lib/sync';
import { setupOf } from '../../lib/changeover';
import { api, signInUrl, useServerConfig, type LibrarySet, type LibraryTab } from '../../lib/account';
import { at } from '../../lib/base';

type View = 'tabs' | 'shows';

const day = (ms: number) => new Date(ms).toLocaleDateString(undefined, { day: 'numeric', month: 'short', year: 'numeric' });
const size = (b: number) => (b > 1024 * 1024 ? `${(b / 1024 / 1024).toFixed(1)} mb` : `${Math.max(1, Math.round(b / 1024))} kb`);

/** your tabs and shows on the tabs server — admins can look at everyone's */
export default function LibraryPage() {
  const router = useRouter();
  const server = useServerConfig();
  const [tabs, setTabs] = useState<LibraryTab[]>([]);
  const [sets, setSets] = useState<LibrarySet[]>([]);
  const [view, setView] = useState<View>('tabs');
  const [all, setAll] = useState(false);
  const [query, setQuery] = useState('');
  const [busy, setBusy] = useState<string | null>(null);
  const [editing, setEditing] = useState<string | null>(null);
  const [toast, setToast] = useState<{ msg: string; error?: boolean } | null>(null);
  const [drag, setDrag] = useState(false);
  const input = useRef<HTMLInputElement>(null);

  const flash = (msg: string, error = false) => {
    setToast({ msg, error });
    window.setTimeout(() => setToast(t => (t?.msg === msg ? null : t)), error ? 3600 : 2000);
  };
  const fail = (e: unknown) => flash((e as Error).message, true);

  const allowed = !!server && server.library && (!server.auth || !!server.user?.canHost);
  // shared tabs and shows (the server's own) are for everyone to play — only admins change them
  const mayEdit = (x: { shared?: boolean }) => !x.shared || !server?.auth || !!server.user?.admin;
  const reload = () => api<{ tabs: LibraryTab[]; sets: LibrarySet[] }>(`/library${all ? '?all=1' : ''}`).then(l => { setTabs(l.tabs); setSets(l.sets); }).catch(fail);
  useEffect(() => { if (allowed) reload(); }, [allowed, all]); // eslint-disable-line react-hooks/exhaustive-deps

  const shown = useMemo(() => {
    const q = query.trim().toLowerCase();
    const list = tabs.slice().sort((a, b) => (a.artist || '').localeCompare(b.artist || '') || a.title.localeCompare(b.title));
    return q ? list.filter(t => `${t.title} ${t.artist} ${t.name} ${t.ownerName}`.toLowerCase().includes(q)) : list;
  }, [tabs, query]);

  const enter = (roomId: string, hostToken: string | null) => {
    if (hostToken) saveHostToken(roomId, hostToken);
    try { sessionStorage.setItem(freshKey(roomId), '1'); } catch {}
    router.push(`/room/${roomId}`);
  };

  const upload = async (files: File[]) => {
    if (!files.length) return;
    setBusy('upload');
    let added = 0;
    for (const f of files) {
      try { await api('/library/tabs', await readTabFile(f)); added++; } catch (e) { flash(`${f.name}: ${(e as Error).message}`, true); }
    }
    setBusy(null);
    if (added) flash(`${added} tab${added === 1 ? '' : 's'} added`);
    reload();
  };

  const openTab = async (tab: LibraryTab) => {
    setBusy(tab.id);
    try {
      const { roomId, hostToken } = await api<{ roomId: string; hostToken: string }>(`/library/tabs/${tab.id}/open`, {});
      enter(roomId, hostToken);
    } catch (e) { fail(e); setBusy(null); }
  };

  const removeTab = async (tab: LibraryTab) => {
    if (!window.confirm(`delete “${tab.title}” from the library? shows that use it lose this song.`)) return;
    await api(`/library/tabs/${tab.id}`, undefined, 'DELETE').then(() => { flash('deleted'); reload(); }).catch(fail);
  };

  const saveTab = (tab: LibraryTab, patch: Partial<Pick<LibraryTab, 'title' | 'artist' | 'notes'>>) =>
    api<LibraryTab>(`/library/tabs/${tab.id}`, patch, 'PATCH').then(t => setTabs(list => list.map(x => (x.id === t.id ? t : x)))).catch(fail);

  const addToSet = async (tab: LibraryTab, setId: string) => {
    if (setId === 'new') {
      const name = window.prompt('name of the new show', 'new show');
      if (!name) return;
      const set = await api<LibrarySet>('/library/sets', { name, songs: [{ tab: tab.id }] }).catch(fail);
      if (set) { flash(`“${tab.title}” is the first song of “${set.name}”`); reload(); }
      return;
    }
    const set = sets.find(s => s.id === setId);
    if (!set) return;
    const songs = [...set.songs.map(s => ({ ...s })), { tab: tab.id }];
    await api(`/library/sets/${set.id}`, { songs }, 'PATCH').then(() => { flash(`added to “${set.name}”`); reload(); }).catch(fail);
  };

  const newSet = async () => {
    const name = window.prompt('name of the show', 'new show');
    if (!name) return;
    const set = await api<LibrarySet>('/library/sets', { name }).catch(fail);
    if (set) router.push(`/sets/${set.id}`);
  };

  const startSet = async (set: LibrarySet) => {
    setBusy(set.id);
    try {
      const { roomId, hostToken } = await api<{ roomId: string; hostToken: string }>(`/library/sets/${set.id}/start`, {});
      enter(roomId, hostToken);
    } catch (e) { fail(e); setBusy(null); }
  };

  const removeSet = async (set: LibrarySet) => {
    if (!window.confirm(`delete the show “${set.name}”? the tabs stay in the library.`)) return;
    await api(`/library/sets/${set.id}`, undefined, 'DELETE').then(() => { flash('show deleted'); reload(); }).catch(fail);
  };

  return (
    <div className="container wide">
      <header className="header">
        <Brand />
        <div className="spacer" />
        <div className="header-info">
          <a className="btn sm ghost" href={at('/')}>sessions</a>
          {server?.auth && <AccountChip user={server.user} />}
        </div>
      </header>

      {server === undefined ? null : !server || !server.library ? (
        <section className="panel empty-state">
          <h2>no library here</h2>
          <p className="muted">the library lives on a tabs server with sign-in (like jam.geyser.at/tabs) — this one doesn&apos;t keep files.</p>
          <a className="btn" href={at('/')}>back</a>
        </section>
      ) : !allowed ? (
        <section className="panel empty-state">
          <h2>{server.user ? 'not for your role' : 'sign in first'}</h2>
          <p className="muted">{server.user ? 'the library needs the contributor role (or more) in tabs’ havoc project.' : 'your tabs and shows are behind your havoc account.'}</p>
          {!server.user && <a className="btn primary" href={signInUrl('/library')}>sign in with havoc</a>}
        </section>
      ) : (
        <section className="panel workspace">
          <div className="tabs" role="tablist" aria-label="library">
            <button role="tab" aria-selected={view === 'tabs'} className={view === 'tabs' ? 'active' : ''} onClick={() => setView('tabs')}>
              tabs<span className="tab-count mono">{tabs.length}</span>
            </button>
            <button role="tab" aria-selected={view === 'shows'} className={view === 'shows' ? 'active' : ''} onClick={() => setView('shows')}>
              shows<span className="tab-count mono">{sets.length}</span>
            </button>
            <div className="spacer" />
            {server.user?.admin && (
              <label className="check tabs-check" title="as admin you can see and manage everyone’s tabs and shows">
                <input type="checkbox" checked={all} onChange={e => setAll(e.target.checked)} /> everyone&apos;s
              </label>
            )}
          </div>

          {view === 'tabs' ? (
            <div className="tab-body">
              <div className="section-head">
                <input className="input lib-search" value={query} onChange={e => setQuery(e.target.value)} placeholder="search title, artist, file…" aria-label="search" />
                <div className="spacer" />
                <button className="btn sm primary" onClick={() => input.current?.click()} disabled={busy === 'upload'}>{busy === 'upload' ? 'adding…' : '+ add tabs'}</button>
                <input ref={input} type="file" accept={ACCEPT} multiple hidden onChange={e => { const f = Array.from(e.target.files ?? []); e.target.value = ''; upload(f); }} />
              </div>
              <div
                className={`lib-list ${drag ? 'drag-over' : ''}`}
                onDragOver={e => { e.preventDefault(); setDrag(true); }}
                onDragLeave={() => setDrag(false)}
                onDrop={e => { e.preventDefault(); setDrag(false); upload(Array.from(e.dataTransfer.files)); }}
              >
                {shown.length === 0 && (
                  <div className="empty-line">{tabs.length ? 'nothing matches.' : 'no tabs yet — drop guitar pro or musicxml files here. files you open in a session land here by themselves.'}</div>
                )}
                {shown.map(t => (
                  <div key={t.id} className="lib-row">
                    {editing === t.id ? (
                      <form className="lib-edit" onSubmit={e => {
                        e.preventDefault();
                        const f = new FormData(e.currentTarget);
                        saveTab(t, { title: String(f.get('title')), artist: String(f.get('artist')) }).then(() => setEditing(null));
                      }}>
                        <input className="input" name="title" defaultValue={t.title} aria-label="title" autoFocus />
                        <input className="input" name="artist" defaultValue={t.artist} aria-label="artist" placeholder="artist" />
                        <button className="btn sm primary" type="submit">save</button>
                        <button className="btn sm ghost" type="button" onClick={() => setEditing(null)}>cancel</button>
                      </form>
                    ) : (
                      <div className="lib-main">
                        <span className="lib-title">{t.title}{t.shared && <span className="badge shared-badge">shared</span>}</span>
                        <span className="lib-sub">
                          {[t.artist, t.tempo ? `${t.tempo} bpm` : '', `${t.tracks.length} track${t.tracks.length === 1 ? '' : 's'}`, ...setupOf({ roles: t.roles }).filter(x => x.tuning).map(x => `${x.role} ${x.tuning}`)].filter(Boolean).join(' · ')}
                        </span>
                        <span className="lib-meta mono">{day(t.addedAt)} · {size(t.size)} · {t.ext}{all && t.ownerName ? ` · ${t.ownerName}` : ''}</span>
                      </div>
                    )}
                    <div className="lib-actions">
                      <button className="btn sm primary" onClick={() => openTab(t)} disabled={!!busy} title="a new session with this song — you are the host">{busy === t.id ? 'opening…' : 'play'}</button>
                      <select className="btn sm" value="" onChange={e => { addToSet(t, e.target.value); e.target.value = ''; }} aria-label={`add ${t.title} to a show`}>
                        <option value="">+ show…</option>
                        {sets.filter(mayEdit).map(s => <option key={s.id} value={s.id}>{s.name}</option>)}
                        <option value="new">new show…</option>
                      </select>
                      <a className="icon-btn" href={at(`/api/library/tabs/${t.id}/file`)} download title="download the original file" aria-label={`download ${t.title}`}>
                        <svg viewBox="0 0 16 16" width="13" height="13" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round"><path d="M8 2v8M4.5 6.5 8 10l3.5-3.5M3 13h10" /></svg>
                      </a>
                      {mayEdit(t) && (
                        <>
                          <button className="icon-btn" onClick={() => setEditing(t.id)} title="rename" aria-label={`rename ${t.title}`}>
                            <svg viewBox="0 0 16 16" width="13" height="13" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round"><path d="M11 2.5l2.5 2.5L6 12.5H3.5V10z" /></svg>
                          </button>
                          <button className="icon-btn warn" onClick={() => removeTab(t)} title="delete" aria-label={`delete ${t.title}`}>
                            <svg viewBox="0 0 16 16" width="13" height="13" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round"><path d="M4 4l8 8M12 4l-8 8" /></svg>
                          </button>
                        </>
                      )}
                    </div>
                  </div>
                ))}
              </div>
            </div>
          ) : (
            <div className="tab-body">
              <div className="section-head">
                <span className="hint-inline">a show is a setlist with every song&apos;s live settings — start it and the band joins with the code</span>
                <div className="spacer" />
                <button className="btn sm primary" onClick={newSet}>+ new show</button>
              </div>
              {sets.length === 0 && <div className="empty-line">no shows yet. build one here, or save a session&apos;s setlist with “save as show”.</div>}
              <div className="set-cards">
                {sets.slice().sort((a, b) => b.updatedAt - a.updatedAt).map(set => (
                  <div key={set.id} className="set-card">
                    <div className="set-card-text">
                      <a className="set-card-name" href={at(`/sets/${set.id}`)}>{set.name}{set.shared && <span className="badge shared-badge">shared</span>}</a>
                      <span className="muted">
                        {set.songs.length} song{set.songs.length === 1 ? '' : 's'}{set.date ? ` · ${set.date}` : ''} · changed {day(set.updatedAt)}{all && set.ownerName ? ` · ${set.ownerName}` : ''}
                      </span>
                    </div>
                    <div className="row">
                      <button className="btn sm primary" onClick={() => startSet(set)} disabled={!!busy || !set.songs.length}>{busy === set.id ? 'opening…' : 'start'}</button>
                      <a className="btn sm" href={at(`/sets/${set.id}`)}>{mayEdit(set) ? 'edit' : 'open'}</a>
                      {mayEdit(set) && (
                        <button className="icon-btn warn" onClick={() => removeSet(set)} aria-label={`delete ${set.name}`} title="delete">
                          <svg viewBox="0 0 16 16" width="13" height="13" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round"><path d="M4 4l8 8M12 4l-8 8" /></svg>
                        </button>
                      )}
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}
        </section>
      )}

      <div className={`toast ${toast?.error ? 'error' : ''} ${toast ? 'show' : ''}`} role="status">{toast?.msg}</div>
    </div>
  );
}
