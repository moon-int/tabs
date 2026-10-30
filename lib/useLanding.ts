"use client";
import { useEffect, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import { freshKey, hostCall, hostTokenKey, readTabFile, saveHostToken } from './sync';
import { VENDOR, loadAlphaTab } from './alphatab';
import { LOCAL_ROOM, localCall, localRoom } from './local';
import { REMOTES, remoteRoom } from './remotes';
import { api, loadConfig, type LibrarySet, type LibraryTab, type ServerConfig } from './account';
import { at } from './base';

export type Recent = { id: string; title: string | null; listeners: number };

/**
 * Everything a home page does, whatever it looks like: find out what kind of server this is and who
 * is signed in, start / join sessions, open shows and tabs. The tabs and jam home pages
 * (components/home) only differ in how they present it.
 */
export function useLanding() {
  const router = useRouter();
  const [busy, setBusy] = useState<string | null>(null);
  const [toast, setToast] = useState<string | null>(null);
  const [recent, setRecent] = useState<Recent[]>([]);
  const [sets, setSets] = useState<LibrarySet[]>([]);
  const [tabs, setTabs] = useState<LibraryTab[]>([]);
  // with the tabs server (npm start / start.bat) sessions are shared; where only next.js answers (vercel) everything runs solo
  // the solo build knows there's no server: its home page is complete in the static html, no wait
  const [server, setServer] = useState<ServerConfig | null | undefined>(process.env.TABS_SOLO === '1' ? null : undefined);
  const serverRef = useRef<Promise<ServerConfig | null>>(Promise.resolve(null));

  const fail = (msg: string) => {
    setToast(msg);
    window.setTimeout(() => setToast(t => (t === msg ? null : t)), 3600);
  };

  useEffect(() => {
    const c = loadConfig();
    serverRef.current = c;
    c.then(cfg => {
      setServer(cfg);
      if (!cfg || (cfg.auth && !cfg.user?.canHost)) return;
      // the shows the server came with are in the library like any other show
      if (cfg.library) api<{ tabs: LibraryTab[]; sets: LibrarySet[] }>('/library').then(l => { setSets(l.sets); setTabs(l.tabs); }).catch(() => {});
    });
    // a failed sign-in comes back here with a reason
    const reason = new URLSearchParams(window.location.search).get('signin');
    if (reason) { fail(`sign-in failed: ${reason}`); window.history.replaceState(null, '', '/'); }
  }, []);

  // warm everything a session needs while you're still choosing: the session page, alphaTab itself
  // (kept in this document, so it's instant after navigating) and its font & soundfont (http cache)
  useEffect(() => {
    const warm = () => {
      router.prefetch('/room/warmup');
      loadAlphaTab().catch(() => {});
      for (const f of ['soundfont/sonivox.sf3', 'font/Bravura.woff2']) fetch(VENDOR + f).catch(() => {});
    };
    const w = window as Window & { requestIdleCallback?: (cb: () => void, o?: { timeout: number }) => number };
    // idle callbacks can wait forever in a busy or background tab, hence the timeout
    if (w.requestIdleCallback) w.requestIdleCallback(warm, { timeout: 1200 }); else window.setTimeout(warm, 600);
  }, [router]);

  // sessions this browser hosts and that the server still knows about
  useEffect(() => {
    if (process.env.TABS_SOLO === '1') return;
    let keys: string[] = [];
    try { keys = Object.keys(localStorage).filter(k => k.startsWith(hostTokenKey(''))); } catch {}
    Promise.all(keys.map(async k => {
      const id = k.slice(hostTokenKey('').length);
      const res = await fetch(at(`/api/rooms/${encodeURIComponent(id)}`)).catch(() => null);
      if (!res?.ok) {
        if (res?.status === 404) try { localStorage.removeItem(k); } catch {}
        return null;
      }
      const s = await res.json();
      return { id, title: s.file?.name?.replace(/\.[^.]+$/, '') ?? null, listeners: s.listeners ?? 0 } as Recent;
    })).then(list => setRecent(list.filter((r): r is Recent => !!r)));
  }, []);

  const solo = server === null;
  const signedOut = !!server?.auth && !server.user;
  const canHost = solo || (!!server && (!server.auth || !!server.user?.canHost));

  const enter = (roomId: string, hostToken: string | null, query = '') => {
    if (hostToken) saveHostToken(roomId, hostToken);
    try { sessionStorage.setItem(freshKey(roomId), '1'); } catch {}
    router.push(`/room/${roomId}${query}`);
  };

  const run = async (key: string, fn: () => Promise<void>) => {
    if (busy) return;
    setBusy(key);
    try { await fn(); } catch (err) { fail((err as Error).message); setBusy(null); }
  };

  /** a new session with these files (one: loaded; several: the setlist) — solo in this page without a server */
  const start = (files: File[]) => run(files.length ? 'uploading…' : 'creating…', async () => {
    if (!(await serverRef.current)) {
      // alphaTab reads each role's tuning out of the files; the page has it warm already
      const [songs] = await Promise.all([Promise.all(files.map(readTabFile)), loadAlphaTab().catch(() => null)]);
      localRoom(true);
      if (songs.length === 1) await localCall('/file', songs[0]);
      else if (songs.length > 1) await localCall('/setlist', { songs, autoStart: true });
      enter(LOCAL_ROOM, null);
      return;
    }
    const created = fetch(at('/api/rooms'), { method: 'POST' }).then(async res => {
      if (res.status === 401) throw new Error('sign in to start a session');
      if (!res.ok) throw new Error('could not create a session');
      return res.json() as Promise<{ roomId: string; hostToken: string }>;
    });
    // reading the files and creating the room don't depend on each other
    const [{ roomId, hostToken }, songs] = await Promise.all([created, Promise.all(files.map(readTabFile))]);
    saveHostToken(roomId, hostToken);
    if (songs.length === 1) await hostCall(roomId, hostToken, '/file', songs[0]);
    else if (songs.length > 1) await hostCall(roomId, hostToken, '/setlist', { songs, autoStart: true });
    enter(roomId, hostToken);
  });

  const startSet = (set: LibrarySet) => run(set.id, async () => {
    const { roomId, hostToken } = await api<{ roomId: string; hostToken: string }>(`/library/sets/${set.id}/start`, {});
    enter(roomId, hostToken);
  });

  const openTab = (tab: LibraryTab) => run(tab.id, async () => {
    const { roomId, hostToken } = await api<{ roomId: string; hostToken: string }>(`/library/tabs/${tab.id}/open`, {});
    enter(roomId, hostToken);
  });

  /**
   * a bare code or a pasted link — another server's code (lg… on tabs.mo-tion.at) goes straight
   * there; false if it doesn't look like a code (or there's no server for it)
   */
  const join = (code: string) => {
    const m = code.trim().toLowerCase().match(/([a-z0-9]{4,12})\/?$/);
    if (!m) { fail('that does not look like a session code'); return false; }
    const remote = remoteRoom(m[1]);
    if (remote) { setBusy('joining…'); window.location.assign(remote); return true; }
    if (server === null) { fail('no session with that code here'); return false; }
    router.push(`/room/${m[1]}`);
    return true;
  };

  /** can a code be entered here at all? (a solo build only knows other servers' codes) */
  const canJoin = server !== null || REMOTES.length > 0;

  return { server, solo, signedOut, canHost, canJoin, busy, toast, recent, sets, tabs, start, startSet, openTab, join, fail };
}
