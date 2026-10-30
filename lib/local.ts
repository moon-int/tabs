import { Room, parseSong } from './room';
import { analyzeBytes } from './rig';
import { base64ToBytes, bytesToBase64, type Conn, type HostMsg, type ServerMsg, type SongMeta } from './sync';
import { at } from './base';

/**
 * Solo sessions: the very same room logic as the server (lib/room.js), run
 * inside the page — for hosts without a tabs server (the vercel deployment).
 * You are the host, nobody else can join, nothing leaves the browser. The
 * room lives as long as the page does, so it survives the step from the
 * landing page into /room/solo but not a reload.
 */

export const LOCAL_ROOM = 'solo';
export const LOCAL_TOKEN = 'solo';

let room: InstanceType<typeof Room> | null = null;

/** the one solo room of this page; fresh drops whatever was loaded before */
export function localRoom(fresh = false) {
  if (!room || fresh) room = new Room(LOCAL_ROOM, LOCAL_TOKEN);
  return room;
}

// each role's tuning, read with the page's alphaTab — without it the changeovers just stay empty
const analyze = (base64: string) => (window.alphaTab ? analyzeBytes(window.alphaTab, base64ToBytes(base64)) : null);

type Song = NonNullable<ReturnType<typeof parseSong>>;
const songOf = (raw: unknown): Song => {
  const song = parseSong(raw, analyze);
  if (!song) throw new Error('every song needs data (base64 string)');
  return song;
};

/** a SyncClient stand-in: the room "sends" to a fake socket that hands every message straight to the page */
export class LocalSync {
  onMessage?: (msg: ServerMsg) => void;
  onConn?: (conn: Conn) => void;
  latency = 0;

  private socket = {
    readyState: 1,
    // async like a real socket, so the page sees the same ordering as with the server
    send: (raw: string) => { window.setTimeout(() => { if (this.socket.readyState === 1) this.onMessage?.(JSON.parse(raw)); }); },
  };

  connect() {
    this.onConn?.('connecting');
    window.setTimeout(() => {
      if (this.socket.readyState !== 1) return;
      this.onConn?.('open');
      localRoom().join(this.socket, true);
    });
  }

  send(msg: HostMsg) {
    const r = localRoom();
    if (msg.type === 'status') r.setStatus(this.socket, msg);
    else r.apply(msg.type, msg, this.socket);
  }

  close() {
    this.socket.readyState = 3;
    localRoom().leave(this.socket);
  }
}

/** the host api of server/index.js, answered by the solo room */
export async function localCall(path: string, body?: unknown, method = 'POST') {
  const r = localRoom();
  const b = (body ?? {}) as Record<string, unknown>;
  const ok = (done: boolean, error: string) => {
    if (!done) throw new Error(error);
    return { ok: true, ...r.summary() };
  };

  if (path === '/file') {
    const song = songOf(b);
    r.loadAdHoc(song.data, song.name);
    return ok(true, '');
  }
  if (path === '/setlist') {
    if (!Array.isArray(b.songs)) throw new Error('songs (array of { data, name?, title? }) is required');
    const songs = b.songs.map(songOf);
    r.setSetlist(songs);
    if (b.autoStart && songs.length) r.goto(0);
    return ok(true, '');
  }
  if (path === '/setlist/songs') return ok(r.addSong(songOf(b)), 'setlist full');
  const song = path.match(/^\/setlist\/songs\/(\d+)$/);
  if (song && method === 'PATCH') return ok(r.updateSong(Number(song[1]), b as Partial<SongMeta>), 'index out of range');
  if (song && method === 'DELETE') return ok(r.removeSong(Number(song[1])), 'index out of range');
  if (path === '/setlist/move') return ok(r.moveSong(Number(b.from), Number(b.to)), 'from/to out of range');
  if (path === '/setlist/next') return ok(r.goto(r.setlistIndex + 1), 'no next song');
  if (path === '/setlist/prev') return ok(r.goto(r.setlistIndex === -1 ? -1 : r.setlistIndex - 1), 'no previous song');
  if (path === '/setlist/goto') return ok(r.goto(Number(b.index)), 'index out of range');
  throw new Error('not available in a solo session');
}

// ---- example shows, prebuilt into public/examples by scripts/build-examples.js ----------

export type StaticShow = { id: string; countIn: boolean; songs: { file: string; name: string; roles?: unknown; [meta: string]: unknown }[] };

/** fetches an example show's files and loads it into a fresh solo room, first song up — like POST /api/examples/:id */
export async function startLocalExample(id: string) {
  const res = await fetch(at(`/examples/${encodeURIComponent(id)}/show.json`));
  if (!res.ok) throw new Error('example show not found');
  const show = (await res.json()) as StaticShow;
  const songs = await Promise.all(show.songs.map(async ({ file, ...meta }) => {
    const f = await fetch(file.startsWith('/') ? at(file) : file);
    if (!f.ok) throw new Error(`could not load ${meta.name}`);
    return { ...meta, data: bytesToBase64(new Uint8Array(await f.arrayBuffer())) };
  }));
  const r = localRoom(true);
  if (show.countIn) r.apply('countIn', { countIn: true });
  // the roles were read at build time — no need to wait for alphaTab here
  r.setSetlist(songs.map(s => parseSong(s, () => s.roles ?? null)).filter(Boolean));
  r.goto(0);
}
