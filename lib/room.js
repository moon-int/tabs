// The session logic, shared by the server (server/rooms.js) and the browser, which runs
// a solo session without any server (lib/local.ts). Plain CommonJS on purpose: node requires it as is.

/**
 * One session.
 *
 * One shared tab file per room, broadcast to every participant. Playback
 * (play/pause/stop/seek/tempo/loop/count-in) is driven by the host and
 * mirrored by every listener's own alphaTab player, so the cursor runs in
 * sync inside everyone's notation. Which tracks are shown, muted or how loud
 * they are is a purely local choice per person and never synced.
 *
 * For live use a room also carries stage cues, a between-songs countdown, a
 * show clock, per-song setlist settings and a member list (who is connected,
 * loaded and in sync) so the host can check the band before counting in.
 *
 * Nothing is written to disk: rooms vanish on server restart (server/rooms.js
 * drops rooms that stay empty for a while), a solo session with the page.
 */

const MAX_SETLIST = 100;
const PARTS = new Set(['guitar', 'bass', 'drums', 'keys', 'vocals', 'other']);

// count-in and transpose are band habits, not song properties — they carry over to the next song
const freshPlayback = (countIn = false, transpose = 0) => ({ playing: false, tick: 0, speed: 1, loop: false, range: null, countIn, transpose });
const str = (v, max) => (typeof v === 'string' && v.trim() ? v.trim().slice(0, max) : null);
const num = (v, min, max) => (typeof v === 'number' && Number.isFinite(v) ? Math.min(max, Math.max(min, v)) : null);

class Room {
  constructor(id, hostToken) {
    this.id = id;
    this.hostToken = hostToken;
    /** @type {Set<import('ws').WebSocket & { isHost?: boolean, memberId?: number, status?: object }>} */
    this.clients = new Set();
    this.file = null; // { data: base64, name: string | null, version: number }
    this.playback = freshPlayback();
    this.setlist = []; // [{ data, name, title, notes, speed, countIn, autoNext, autoStart, gap }]
    this.setlistIndex = -1;
    this.fileVersion = 0;
    this.cue = null; // { text, seconds, at }
    this.showStart = null; // epoch ms the host started the show clock
    this.groove = null; // a beats drum pattern everyone hears with the song, see parseGroove
    this.nextMemberId = 1;
    this.membersTimer = null;
    this.lastActive = Date.now();
  }

  isHostToken(token) {
    if (typeof token !== 'string' || token.length !== this.hostToken.length) return false;
    // constant time, without node's crypto — this class runs in the browser too (solo sessions)
    let diff = 0;
    for (let i = 0; i < token.length; i++) diff |= token.charCodeAt(i) ^ this.hostToken.charCodeAt(i);
    return diff === 0;
  }

  get hostConnected() {
    for (const c of this.clients) if (c.isHost) return true;
    return false;
  }

  get listenerCount() {
    let n = 0;
    for (const c of this.clients) if (!c.isHost) n++;
    return n;
  }

  // ---- messaging -------------------------------------------------------

  send(ws, msg) {
    if (ws.readyState === 1) ws.send(JSON.stringify(msg));
  }

  broadcast(msg, except) {
    const raw = JSON.stringify(msg);
    for (const c of this.clients) if (c !== except && c.readyState === 1) c.send(raw);
  }

  // ---- snapshots ---------------------------------------------------------

  setlistSummary() {
    return {
      songs: this.setlist.map(s => ({
        name: s.name,
        title: s.title || stripExt(s.name) || 'untitled',
        notes: s.notes,
        speed: s.speed,
        countIn: s.countIn,
        transpose: s.transpose ?? null,
        autoNext: s.autoNext,
        autoStart: s.autoStart,
        gap: s.gap,
        groove: s.groove ?? null,
        roles: s.roles ?? null,
        rig: s.rig ?? null,
      })),
      index: this.setlistIndex,
    };
  }

  peers() {
    return { hostConnected: this.hostConnected, listeners: this.listenerCount };
  }

  members() {
    return [...this.clients].map(c => ({ id: c.memberId, host: !!c.isHost, ...(c.status || {}) }));
  }

  activeCue(now = Date.now()) {
    const c = this.cue;
    if (!c) return null;
    if (c.seconds && now - c.at > c.seconds * 1000) { this.cue = null; return null; }
    return { text: c.text, seconds: c.seconds, elapsed: now - c.at };
  }

  showElapsed(now = Date.now()) {
    return this.showStart === null ? null : now - this.showStart;
  }

  summary() {
    return {
      roomId: this.id,
      file: this.file ? { name: this.file.name, version: this.file.version } : null,
      playback: this.playback,
      setlist: this.setlistSummary(),
      cue: this.activeCue(),
      show: this.showElapsed(),
      groove: this.groove,
      members: this.members(),
      ...this.peers(),
    };
  }

  // ---- connections -------------------------------------------------------

  join(ws, isHost) {
    ws.isHost = isHost;
    ws.memberId = this.nextMemberId++;
    this.clients.add(ws);
    this.lastActive = Date.now();
    this.send(ws, {
      type: 'init',
      role: isHost ? 'host' : 'listener',
      memberId: ws.memberId,
      file: this.file,
      playback: this.playback,
      setlist: this.setlistSummary(),
      cue: this.activeCue(),
      show: this.showElapsed(),
      groove: this.groove,
      members: this.members(),
      ...this.peers(),
    });
    this.broadcast({ type: 'peers', ...this.peers() }, ws);
    this.queueMembers();
  }

  leave(ws) {
    this.clients.delete(ws);
    this.lastActive = Date.now();
    // without a conductor nobody can pause, so stop the band where it is
    if (ws.isHost && !this.hostConnected && this.playback.playing) {
      this.playback.playing = false;
      this.broadcast({ type: 'pause', tick: this.playback.tick });
    }
    this.broadcast({ type: 'peers', ...this.peers() });
    this.queueMembers();
  }

  /** member status reports arrive every few seconds from everyone — batch the fan-out */
  queueMembers() {
    if (this.membersTimer) return;
    this.membersTimer = setTimeout(() => {
      this.membersTimer = null;
      this.broadcast({ type: 'members', members: this.members() });
    }, 250);
    this.membersTimer.unref?.();
  }

  setStatus(ws, raw) {
    if (!raw || typeof raw !== 'object') return false;
    const part = typeof raw.part === 'string' && PARTS.has(raw.part) ? raw.part : null;
    ws.status = {
      name: str(raw.name, 40),
      part,
      ready: !!raw.ready,
      playing: !!raw.playing,
      drift: num(raw.drift, -60000, 60000),
      latency: num(raw.latency, 0, 60000),
    };
    this.queueMembers();
    return true;
  }

  // ---- host actions --------------------------------------------------------

  /**
   * Applies one host-driven action and mirrors it to everyone else. Shared
   * by the websocket (room UI) and the REST host API, so both surfaces drive
   * exactly the same state. Returns false for malformed input.
   * @param {string} type
   * @param {any} [payload]
   * @param {object | null} [except] the socket the action came from — it already applied it
   */
  apply(type, payload = {}, except = null) {
    const p = this.playback;
    const tick = Number(payload.tick);
    const hasTick = Number.isFinite(tick) && tick >= 0;
    this.lastActive = Date.now();

    switch (type) {
      case 'play':
        p.playing = true;
        if (hasTick) p.tick = tick;
        this.broadcast({ type: 'play', tick: p.tick }, except);
        return true;
      case 'pause':
        p.playing = false;
        if (hasTick) p.tick = tick;
        this.broadcast({ type: 'pause', tick: p.tick }, except);
        return true;
      case 'stop':
        p.playing = false;
        p.tick = p.range ? p.range.startTick : 0;
        this.broadcast({ type: 'stop' }, except);
        return true;
      case 'seek':
      case 'position':
        if (!hasTick) return false;
        p.tick = tick;
        this.broadcast({ type, tick }, except);
        return true;
      case 'speed': {
        const speed = Number(payload.speed);
        if (!Number.isFinite(speed) || speed < 0.1 || speed > 4) return false;
        p.speed = speed;
        this.broadcast({ type: 'speed', speed }, except);
        return true;
      }
      case 'loop':
        p.loop = !!payload.loop;
        this.broadcast({ type: 'loop', loop: p.loop }, except);
        return true;
      case 'transpose': {
        // whole song up/down in semitones — tabs keep their frets, so a band tuned down plays it as written
        const t = Number(payload.transpose);
        if (!Number.isInteger(t) || t < -12 || t > 12) return false;
        p.transpose = t;
        this.broadcast({ type: 'transpose', transpose: t }, except);
        return true;
      }
      case 'countIn':
        p.countIn = !!payload.countIn;
        this.broadcast({ type: 'countIn', countIn: p.countIn }, except);
        return true;
      case 'range': {
        const r = payload.range;
        if (r === null || r === undefined) p.range = null;
        else {
          const startTick = Number(r.startTick), endTick = Number(r.endTick);
          if (!Number.isFinite(startTick) || !Number.isFinite(endTick) || endTick <= startTick || startTick < 0) return false;
          p.range = { startTick, endTick };
        }
        this.broadcast({ type: 'range', range: p.range }, except);
        return true;
      }
      case 'cue': {
        const text = str(payload.text, 140);
        this.cue = text ? { text, seconds: num(Number(payload.seconds) || 0, 0, 600) || 0, at: Date.now() } : null;
        this.broadcast({ type: 'cue', cue: this.activeCue() });
        return true;
      }
      case 'countdown': {
        const seconds = num(Number(payload.seconds), 0, 120);
        if (seconds === null) return false;
        this.broadcast({ type: 'countdown', seconds, label: str(payload.label, 140) });
        return true;
      }
      case 'countoff': {
        // the host is counting in from `tick`: everyone counts the same bar, then starts together
        const beats = Number(payload.beats), beatMs = Number(payload.beatMs);
        if (!hasTick || !Number.isInteger(beats) || beats < 1 || beats > 16 || !Number.isFinite(beatMs) || beatMs < 60 || beatMs > 5000) return false;
        p.playing = false;
        p.tick = tick;
        this.broadcast({ type: 'countoff', tick, beats, beatMs }, except);
        return true;
      }
      case 'groove': {
        // null switches it off; anything else must be a valid pattern
        const groove = payload.groove == null ? null : parseGroove(payload.groove);
        if (payload.groove != null && !groove) return false;
        this.groove = groove;
        this.broadcast({ type: 'groove', groove });
        return true;
      }
      case 'show': {
        if (payload.action === 'start') this.showStart = Date.now();
        else if (payload.action === 'reset') this.showStart = null;
        else return false;
        this.broadcast({ type: 'show', show: this.showElapsed() });
        return true;
      }
      default:
        return false;
    }
  }

  /**
   * A playback command from the REST host api (a script, a footswitch, a lighting desk). While the
   * host's page is open its player is the source of truth, so the command goes to that page, which
   * runs it like a click on its own transport (count-in included) and the result reaches everyone
   * the usual way. Without a host page it applies to the room directly.
   */
  request(type, payload = {}) {
    if (!DRIVEN.has(type) || !this.hostConnected) return this.apply(type, payload);
    const msg = remoteCommand(type, payload);
    if (!msg) return false;
    return this.remote(msg);
  }

  /** hands a { type: 'remote', … } command to the host's page(s); false when none is open */
  remote(msg) {
    this.lastActive = Date.now();
    let sent = false;
    for (const c of this.clients) if (c.isHost) { this.send(c, msg); sent = true; }
    return sent;
  }

  /** sets the active file (ad-hoc upload or setlist entry) and resets playback */
  setFile(data, name, overrides = {}) {
    this.file = { data, name: name || null, version: ++this.fileVersion };
    // count-in is a band habit, not a song property — it survives song changes
    this.playback = { ...freshPlayback(this.playback.countIn, this.playback.transpose), ...overrides };
    this.lastActive = Date.now();
    this.broadcast({ type: 'file', file: this.file, playback: this.playback });
  }

  /** an upload outside the setlist drops out of "currently on song x" */
  loadAdHoc(data, name) {
    this.setFile(data, name);
    if (this.setlistIndex !== -1) {
      this.setlistIndex = -1;
      this.broadcastSetlist();
    }
  }

  // ---- setlist -------------------------------------------------------------

  broadcastSetlist() {
    this.broadcast({ type: 'setlist', setlist: this.setlistSummary() });
  }

  goto(index) {
    if (!Number.isInteger(index) || index < 0 || index >= this.setlist.length) return false;
    const song = this.setlist[index];
    const overrides = {};
    if (song.speed) overrides.speed = song.speed;
    if (song.countIn !== null) overrides.countIn = song.countIn;
    if (song.transpose !== null && song.transpose !== undefined) overrides.transpose = song.transpose;
    this.setlistIndex = index;
    this.setFile(song.data, song.name, overrides);
    // a song can bring its own groove (or switch it off); without one the current groove keeps going
    if (song.groove) {
      this.groove = song.groove;
      this.broadcast({ type: 'groove', groove: this.groove });
    }
    this.broadcastSetlist();
    return true;
  }

  setSetlist(songs) {
    this.setlist = songs.slice(0, MAX_SETLIST);
    this.setlistIndex = -1;
    this.broadcastSetlist();
  }

  addSong(song) {
    if (this.setlist.length >= MAX_SETLIST) return false;
    this.setlist.push(song);
    this.broadcastSetlist();
    return true;
  }

  updateSong(index, patch) {
    const song = this.setlist[index];
    if (!song || !patch || typeof patch !== 'object') return false;
    const next = { ...song, ...songMeta({ ...metaOf(song), ...patch }) };
    if ('title' in patch) next.title = str(patch.title, 200);
    this.setlist[index] = next;
    this.broadcastSetlist();
    return true;
  }

  removeSong(index) {
    if (!Number.isInteger(index) || index < 0 || index >= this.setlist.length) return false;
    this.setlist.splice(index, 1);
    if (this.setlistIndex === index) this.setlistIndex = -1;
    else if (this.setlistIndex > index) this.setlistIndex--;
    this.broadcastSetlist();
    return true;
  }

  moveSong(from, to) {
    const n = this.setlist.length;
    if (![from, to].every(i => Number.isInteger(i) && i >= 0 && i < n)) return false;
    const [song] = this.setlist.splice(from, 1);
    this.setlist.splice(to, 0, song);
    const cur = this.setlistIndex;
    if (cur === from) this.setlistIndex = to;
    else if (from < cur && to >= cur) this.setlistIndex--;
    else if (from > cur && to <= cur) this.setlistIndex++;
    this.broadcastSetlist();
    return true;
  }
}

/** playback the host's page drives — see Room.request */
const DRIVEN = new Set(['play', 'pause', 'stop', 'seek', 'speed', 'loop', 'range', 'countIn', 'transpose']);

/** validates a host api playback command and turns it into a { type: 'remote', action, … } message */
function remoteCommand(type, payload) {
  const tick = Number(payload.tick);
  const hasTick = payload.tick !== undefined && payload.tick !== null && Number.isFinite(tick) && tick >= 0;
  switch (type) {
    case 'play':
    case 'pause':
      return { type: 'remote', action: type, ...(hasTick ? { tick } : {}) };
    case 'stop':
      return { type: 'remote', action: type };
    case 'seek':
      return hasTick ? { type: 'remote', action: type, tick } : null;
    case 'speed': {
      const speed = Number(payload.speed);
      return Number.isFinite(speed) && speed >= 0.1 && speed <= 4 ? { type: 'remote', action: type, speed } : null;
    }
    case 'loop':
      return { type: 'remote', action: type, loop: !!payload.loop };
    case 'countIn':
      return { type: 'remote', action: type, countIn: !!payload.countIn };
    case 'transpose': {
      const t = Number(payload.transpose);
      return Number.isInteger(t) && t >= -12 && t <= 12 ? { type: 'remote', action: type, transpose: t } : null;
    }
    case 'range': {
      const r = payload.range;
      if (r === null || r === undefined) return { type: 'remote', action: type, range: null };
      const startTick = Number(r.startTick), endTick = Number(r.endTick);
      if (!Number.isFinite(startTick) || !Number.isFinite(endTick) || endTick <= startTick || startTick < 0) return null;
      return { type: 'remote', action: type, range: { startTick, endTick } };
    }
    default:
      return null;
  }
}

function stripExt(name) {
  return name ? String(name).replace(/\.[^./\\]+$/, '') : '';
}

const metaOf = s => ({ notes: s.notes, speed: s.speed, countIn: s.countIn, transpose: s.transpose, autoNext: s.autoNext, autoStart: s.autoStart, gap: s.gap, groove: s.groove, rig: s.rig });

const ROLES = new Set(['guitar', 'bass', 'drums', 'keys', 'vocals', 'other']);

/** per role, what else changes for this song besides the tuning — "Katana: Brown" for the guitarist */
function parseRig(raw) {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null;
  const out = {};
  for (const [role, value] of Object.entries(raw)) {
    const v = str(value, 80);
    if (ROLES.has(role) && v) out[role] = v;
  }
  return Object.keys(out).length ? out : null;
}

/** per-song live settings: cue notes, tempo, count-in, auto-advance */
function songMeta(raw = {}) {
  return {
    notes: str(raw.notes, 500),
    speed: num(raw.speed, 0.25, 2.5), // null = the song's own tempo
    countIn: typeof raw.countIn === 'boolean' ? raw.countIn : null, // null = keep the room's setting
    autoNext: !!raw.autoNext, // load the next song when this one ends
    autoStart: !!raw.autoStart, // start this song by itself after a countdown when auto-advanced into
    gap: num(raw.gap, 0, 120) ?? 5, // countdown seconds
    transpose: Number.isInteger(raw.transpose) && raw.transpose >= -12 && raw.transpose <= 12 ? raw.transpose : null, // null = keep the room's
    groove: raw.groove ? parseGroove(raw.groove) : null, // null = keep whatever groove is running
    rig: parseRig(raw.rig),
  };
}

/**
 * validates { data|fileData, name|fileName, title, ...meta } coming from the api;
 * analyze(base64) reads each role's tuning from the file (alphaTab in node or in the browser)
 */
function parseSong(raw, analyze) {
  if (!raw || typeof raw !== 'object') return null;
  const data = raw.data ?? raw.fileData;
  if (typeof data !== 'string' || !data.length || !/^[A-Za-z0-9+/=\s]+$/.test(data.slice(0, 256))) return null;
  const name = raw.name ?? raw.fileName;
  return {
    data,
    name: typeof name === 'string' ? name.slice(0, 200) : null,
    title: str(raw.title, 200),
    // each role's tuning, read from the file — the setlist derives its changeovers from it
    roles: analyze ? analyze(data) : null,
    ...songMeta(raw),
  };
}

/**
 * A mo-tion beats pattern: 8 tracks × 16 steps (X accent, x hit, . rest),
 * one of beats' three kits, swing, optional beats mixer. on: false keeps the
 * pattern but silences it (a song in the setlist can switch the groove off).
 */
function parseGroove(raw) {
  if (!raw || typeof raw !== 'object' || !Array.isArray(raw.rows)) return null;
  const cleanRows = list => Array.from({ length: 8 }, (_, i) => {
    const r = Array.isArray(list) && typeof list[i] === 'string' ? list[i] : '';
    return r.replace(/[^Xx.]/g, '.').padEnd(16, '.').slice(0, 16);
  });
  // a beats link carries up to four patterns (slots a–d); the dj switches between them on the downbeat
  const slots = Array.isArray(raw.slots) ? raw.slots.slice(0, 4).filter(Array.isArray).map(cleanRows) : [];
  const slot = slots.length && Number.isInteger(raw.slot) && raw.slot >= 0 && raw.slot < slots.length ? raw.slot : 0;
  const rows = slots.length ? slots[slot] : cleanRows(raw.rows);
  const mutes = Array.isArray(raw.mutes) && raw.mutes.some(Boolean) ? Array.from({ length: 8 }, (_, i) => !!raw.mutes[i]) : undefined;
  const bpm = num(Number(raw.bpm), 40, 240);
  const mix = Array.isArray(raw.mix)
    ? raw.mix.slice(0, 8).map(t => (Array.isArray(t) ? t.slice(0, 6).map(v => (Number.isFinite(Number(v)) ? Number(v) : 0)) : [0.8, 0, 0, 1, 0, 0]))
    : undefined;
  return {
    on: raw.on !== false,
    name: str(raw.name, 60) || 'groove',
    kit: Number.isInteger(raw.kit) && raw.kit >= 0 && raw.kit <= 2 ? raw.kit : 0,
    swing: num(Number(raw.swing) || 0, 0, 100),
    rows,
    ...(slots.length > 1 ? { slots, slot } : {}),
    ...(mutes ? { mutes } : {}),
    ...(bpm ? { bpm: Math.round(bpm) } : {}),
    // runs on its own tempo while no song plays — the dj's backing between songs
    ...(raw.free === true ? { free: true } : {}),
    ...(mix ? { mix } : {}),
  };
}

module.exports = { Room, parseSong, parseGroove, songMeta };
