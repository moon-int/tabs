import type { Range } from './player';
import type { Groove } from './groove';
import type { Part } from './prefs';
import type { RoleTuning } from './changeover';
import { at } from './base';

export type Role = 'host' | 'listener';
export type Playback = { playing: boolean; tick: number; speed: number; loop: boolean; range: Range; countIn: boolean; transpose: number };
export type RoomFile = { data: string; name: string | null; version: number };
export type SongMeta = {
  notes: string | null;
  speed: number | null; // null = the song's own tempo
  countIn: boolean | null; // null = keep the room's setting
  transpose: number | null; // semitones, null = keep the room's
  autoNext: boolean;
  autoStart: boolean;
  gap: number;
  groove: Groove | null; // null = keep the running groove
};
export type SetlistSong = {
  name: string | null;
  title: string;
  roles: Partial<Record<Part, RoleTuning>> | null; // each role's tuning, read from the file by the server
  rig: Partial<Record<Part, string>> | null; // what else a role changes for this song ("Katana Brown")
} & SongMeta;
export type Setlist = { songs: SetlistSong[]; index: number };
export type Cue = { text: string; seconds: number; elapsed: number } | null;
export type Member = {
  id: number; host: boolean;
  name?: string | null; part?: string | null;
  ready?: boolean; playing?: boolean; drift?: number | null; latency?: number | null;
};
export type Conn = 'connecting' | 'open' | 'closed' | 'gone';
/** a playback command from the REST host api, handed to the host's page to run (lib/room.js request) */
export type RemoteCommand =
  | { action: 'play' | 'pause'; tick?: number }
  | { action: 'stop' }
  | { action: 'seek'; tick: number }
  | { action: 'speed'; speed: number }
  | { action: 'loop'; loop: boolean }
  | { action: 'range'; range: Range }
  | { action: 'countIn'; countIn: boolean }
  | { action: 'transpose'; transpose: number }
  | { action: 'go'; seconds: number }; // big countdown, then play — from the control api

export type ServerMsg =
  | { type: 'init'; role: Role; memberId: number; file: RoomFile | null; playback: Playback; setlist: Setlist; cue: Cue; show: number | null; groove: Groove | null; members: Member[]; hostConnected: boolean; listeners: number }
  | { type: 'file'; file: RoomFile; playback: Playback }
  | { type: 'setlist'; setlist: Setlist }
  | { type: 'peers'; hostConnected: boolean; listeners: number }
  | { type: 'play' | 'pause'; tick: number }
  | { type: 'stop' }
  | { type: 'seek' | 'position'; tick: number }
  | { type: 'speed'; speed: number }
  | { type: 'loop'; loop: boolean }
  | { type: 'range'; range: Range }
  | { type: 'countIn'; countIn: boolean }
  | { type: 'transpose'; transpose: number }
  | { type: 'cue'; cue: Cue }
  | { type: 'countdown'; seconds: number; label: string | null }
  | { type: 'countoff'; tick: number; beats: number; beatMs: number }
  | ({ type: 'remote' } & RemoteCommand)
  | { type: 'show'; show: number | null }
  | { type: 'members'; members: Member[] }
  | { type: 'groove'; groove: Groove | null }
  | { type: 'pong'; t: number }
  | { type: 'error'; error: string };

export type HostMsg =
  | { type: 'play' | 'pause'; tick: number }
  | { type: 'stop' }
  | { type: 'seek' | 'position'; tick: number }
  | { type: 'speed'; speed: number }
  | { type: 'loop'; loop: boolean }
  | { type: 'range'; range: Range }
  | { type: 'countIn'; countIn: boolean }
  | { type: 'transpose'; transpose: number }
  | { type: 'cue'; text: string | null; seconds?: number }
  | { type: 'countdown'; seconds: number; label?: string | null }
  | { type: 'countoff'; tick: number; beats: number; beatMs: number }
  | { type: 'show'; action: 'start' | 'reset' }
  | { type: 'groove'; groove: Groove | null }
  | { type: 'status'; name: string | null; part: string | null; ready: boolean; playing: boolean; drift: number | null; latency: number | null };

/**
 * One websocket per room with automatic reconnect (backoff up to 8 s) and a
 * running round-trip estimate, used to nudge mirrored positions forward by
 * the time a message spent on the wire.
 */
export class SyncClient {
  onMessage?: (msg: ServerMsg) => void;
  onConn?: (conn: Conn) => void;
  /** smoothed one-way latency in ms */
  latency = 0;

  private ws: WebSocket | null = null;
  private retry = 0;
  private timer: number | undefined;
  private pinger: number | undefined;
  private closed = false;

  constructor(private roomId: string, private token: string | null) {}

  connect() {
    if (this.closed) return;
    this.onConn?.('connecting');
    const proto = location.protocol === 'https:' ? 'wss' : 'ws';
    const qs = new URLSearchParams({ room: this.roomId });
    if (this.token) qs.set('token', this.token);
    const ws = new WebSocket(`${proto}://${location.host}${at('/ws')}?${qs}`);
    this.ws = ws;

    ws.onopen = () => {
      this.retry = 0;
      this.onConn?.('open');
      this.ping();
      window.clearInterval(this.pinger);
      this.pinger = window.setInterval(() => this.ping(), 5000);
    };
    ws.onmessage = e => {
      let msg: ServerMsg;
      try { msg = JSON.parse(e.data); } catch { return; }
      if (msg.type === 'pong') {
        const oneWay = (performance.now() - msg.t) / 2;
        this.latency = this.latency ? this.latency * 0.7 + oneWay * 0.3 : oneWay;
        return;
      }
      this.onMessage?.(msg);
    };
    ws.onclose = e => {
      window.clearInterval(this.pinger);
      if (this.ws !== ws) return;
      this.ws = null;
      if (this.closed) return;
      if (e.code === 4004) { this.onConn?.('gone'); return; }
      this.onConn?.('closed');
      const delay = Math.min(8000, 500 * 2 ** this.retry++);
      this.timer = window.setTimeout(() => this.connect(), delay);
    };
  }

  private ping() {
    if (this.ws?.readyState === WebSocket.OPEN) this.ws.send(JSON.stringify({ type: 'ping', t: performance.now() }));
  }

  send(msg: HostMsg) {
    if (this.ws?.readyState === WebSocket.OPEN) this.ws.send(JSON.stringify(msg));
  }

  close() {
    this.closed = true;
    window.clearTimeout(this.timer);
    window.clearInterval(this.pinger);
    const ws = this.ws;
    this.ws = null;
    ws?.close();
  }
}

// ---- host rest api (file uploads & setlist go over http) ------------------------

export async function hostCall(roomId: string, token: string, path: string, body?: unknown, method = 'POST') {
  const res = await fetch(at(`/api/rooms/${encodeURIComponent(roomId)}${path}`), {
    method,
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const json = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(json.error ? String(json.error).replace(/_/g, ' ') : `request failed (${res.status})`);
  return json;
}

export const hostTokenKey = (roomId: string) => `tabs.host.${roomId}`;

/** set right before a host jumps into a session they just created — it skips the extra "join" click */
export const freshKey = (roomId: string) => `tabs.fresh.${roomId}`;

export function readHostToken(roomId: string): string | null {
  try { return localStorage.getItem(hostTokenKey(roomId)); } catch { return null; }
}

export function saveHostToken(roomId: string, token: string) {
  try { localStorage.setItem(hostTokenKey(roomId), token); } catch {}
}

// ---- files ---------------------------------------------------------------------

export const ACCEPT = '.gp,.gp3,.gp4,.gp5,.gpx,.musicxml,.mxl,.xml,.capx,.tex,.atex';
export const MAX_FILE_BYTES = 15 * 1024 * 1024;

export function bytesToBase64(bytes: Uint8Array): string {
  let binary = '';
  const chunk = 0x8000;
  for (let i = 0; i < bytes.length; i += chunk) binary += String.fromCharCode.apply(null, bytes.subarray(i, i + chunk) as unknown as number[]);
  return btoa(binary);
}

export function base64ToBytes(b64: string): Uint8Array {
  const bin = atob(b64);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

export async function readTabFile(file: File): Promise<{ data: string; name: string }> {
  if (file.size > MAX_FILE_BYTES) throw new Error(`${file.name} is larger than 15 mb`);
  const buf = new Uint8Array(await file.arrayBuffer());
  return { data: bytesToBase64(buf), name: file.name };
}
