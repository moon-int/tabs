"use client";
import { useEffect, useState } from 'react';
import type { Part } from './prefs';
import type { Groove } from './groove';
import { at } from './base';

/** who is signed in (with havoc) — see server/auth.js */
export type Me = { id: string; name: string; email: string; role: string; level: 'admin' | 'host' | 'member'; admin: boolean; canHost: boolean };

/** what the tabs server tells its pages (GET /api/config) — null where there is none (the solo build on vercel) */
export type ServerConfig = {
  server: true;
  auth: boolean;
  library: boolean;
  user: Me | null;
  appUrl: string | null;
  beatsUrl: string | null;
  soundfonts: { name: string; url: string; size: number }[];
  control: { key: boolean; live: string | null };
};

export async function loadConfig(): Promise<ServerConfig | null> {
  if (process.env.TABS_SOLO === '1') return null;
  try {
    const r = await fetch(at('/api/config'), { cache: 'no-store' });
    if (!r.ok || !(r.headers.get('content-type') ?? '').includes('json')) return null;
    const c = await r.json();
    return c && c.server ? (c as ServerConfig) : null;
  } catch {
    return null;
  }
}

/** undefined while asking, null without a server */
export function useServerConfig() {
  const [config, setConfig] = useState<ServerConfig | null | undefined>(undefined);
  useEffect(() => { loadConfig().then(setConfig); }, []);
  return config;
}

/** sign in, then back to `next` (an app path like "/library"; default: this page) */
export const signInUrl = (next?: string) =>
  at(`/api/auth/login?next=${encodeURIComponent(next !== undefined ? at(next) : typeof window !== 'undefined' ? window.location.pathname + window.location.search : at('/'))}`);
export const SIGN_OUT_URL = at('/api/auth/logout');

// ---- library (server/library.js) --------------------------------------------------------

export type RoleTuningInfo = { strings: number; tuning: number[] };
export type LibraryTab = {
  id: string; owner: string; ownerName: string; name: string; ext: string; size: number;
  title: string; artist: string; tempo: number | null; bars: number; tracks: string[];
  roles: Partial<Record<Part, RoleTuningInfo>> | null; notes: string;
  addedAt: number; updatedAt: number; usedAt: number;
  shared?: boolean; // the server's own — every host plays it, admins manage it
};
export type SetSong = {
  tab: string; title: string; tabTitle?: string; name?: string | null; artist?: string; missing?: boolean; roles?: LibraryTab['roles'];
  notes: string | null; speed: number | null; countIn: boolean | null; transpose: number | null;
  autoNext: boolean; autoStart: boolean; gap: number; groove: Groove | null; rig: Partial<Record<Part, string>> | null;
};
export type LibrarySet = {
  id: string; owner: string; ownerName: string; name: string; subtitle: string; date: string; notes: string;
  countIn: boolean; transpose: number; songs: SetSong[]; createdAt: number; updatedAt: number;
  shared?: boolean;
};

export async function api<T = unknown>(path: string, body?: unknown, method?: string): Promise<T> {
  const res = await fetch(at(`/api${path}`), {
    method: method ?? (body === undefined ? 'GET' : 'POST'),
    headers: body === undefined ? undefined : { 'Content-Type': 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const json = await res.json().catch(() => ({}));
  if (!res.ok) {
    const err = new Error(json.error ? String(json.error).replace(/_/g, ' ') : `request failed (${res.status})`) as Error & { status?: number };
    err.status = res.status;
    throw err;
  }
  return json as T;
}
