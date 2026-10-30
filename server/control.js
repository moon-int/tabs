const crypto = require('crypto');
const express = require('express');
const config = require('./config');
const { parseSong } = require('./rooms');

/**
 * The control api: one stable address per action, so mo-tion Time cues (which fire an http request
 * at a time of day), a script, a stream deck or a lighting desk can run the show:
 *
 *   POST|GET /api/control/<action>?key=…     (or header X-Tabs-Key / Authorization: Bearer …)
 *
 * Everything acts on the *live session* — the one a signed-in host opened last, or the one set with
 * `live`. Playback goes through the host's page like a press on its transport (count-in included);
 * without a host page it applies to the session directly.
 *
 * Actions: status · live {room} · load {set} · play · pause · stop · go {seconds} · next · prev ·
 * goto {index} · cue {text, seconds} · countdown {seconds, label} · show {action: start|reset} ·
 * countin {on} · tempo {speed} · transpose {semitones} · groove {on | off | slot | mute}
 */

const ACTIONS = ['status', 'live', 'load', 'play', 'pause', 'stop', 'go', 'next', 'prev', 'goto', 'cue', 'countdown', 'show', 'countin', 'tempo', 'transpose', 'groove'];

function sameKey(a, b) {
  const x = Buffer.from(String(a || '')), y = Buffer.from(String(b || ''));
  return x.length === y.length && x.length > 0 && crypto.timingSafeEqual(x, y);
}

/** who may control: the key, a signed-in host — or anyone on the open lan server without a key */
function allowed(req) {
  const auth = req.get('authorization') || '';
  const key = req.get('x-tabs-key') || (auth.startsWith('Bearer ') ? auth.slice(7) : '') || req.query.key;
  if (config.controlKey && sameKey(key, config.controlKey)) return true;
  if (req.user?.canHost) return true;
  return !config.auth && !config.controlKey;
}

function cors(req, res, next) {
  const origin = req.get('origin');
  const any = config.controlOrigins.includes('*');
  if (origin && (any || config.controlOrigins.includes(origin))) {
    res.set('Access-Control-Allow-Origin', any ? '*' : origin);
    res.set('Vary', 'Origin');
    res.set('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
    res.set('Access-Control-Allow-Headers', 'Content-Type, X-Tabs-Key, Authorization');
    // chrome asks before a public page may call into a private network (Time in the browser → the NUC)
    if (req.get('access-control-request-private-network')) res.set('Access-Control-Allow-Private-Network', 'true');
    res.set('Access-Control-Max-Age', '600');
  }
  if (req.method === 'OPTIONS') return res.sendStatus(204);
  next();
}

/** Time sends its body as plain text — accept json in any content type, and query parameters for GET cues */
function params(req) {
  let body = req.body;
  if (typeof body === 'string') { try { body = JSON.parse(body || '{}'); } catch { body = {}; } }
  return { ...req.query, ...(body && typeof body === 'object' ? body : {}) };
}

const num = v => (v === undefined || v === null || v === '' ? undefined : Number(v));

function controlRoutes({ store, library, onLive }) {
  const r = express.Router();
  r.use(cors);
  r.use(express.json({ limit: '64kb' }));
  r.use(express.text({ type: ['text/*'], limit: '64kb' }));

  r.all('/:action', (req, res) => {
    const action = String(req.params.action).toLowerCase();
    if (!ACTIONS.includes(action)) return res.status(404).json({ error: 'unknown_action', actions: ACTIONS });
    if (!allowed(req)) return res.status(401).json({ error: 'control_key_required' });
    const p = params(req);
    let room = store.get(p.room) || store.get(store.live);

    if (action === 'status') {
      if (!room) return res.json({ live: null });
      const s = room.summary();
      const song = s.setlist.index >= 0 ? s.setlist.songs[s.setlist.index] : null;
      return res.json({
        live: room.id, playing: s.playback.playing, song: song?.title ?? s.file?.name ?? null,
        index: s.setlist.index, songs: s.setlist.songs.length, next: s.setlist.songs[s.setlist.index + 1]?.title ?? null,
        hostConnected: s.hostConnected, listeners: s.listeners,
      });
    }

    if (action === 'live') {
      const target = store.get(p.room);
      if (!target) return res.status(404).json({ error: 'room_not_found' });
      store.live = target.id;
      return res.json({ ok: true, live: target.id });
    }

    if (action === 'load') {
      if (!library) return res.status(404).json({ error: 'library_off' });
      const want = String(p.set ?? '').trim().toLowerCase();
      const set = library.db.sets.find(s => s.id === p.set) || library.db.sets.find(s => s.name.toLowerCase() === want);
      if (!set) return res.status(404).json({ error: 'set_not_found' });
      const songs = library.songsOf(set).map(parseSong).filter(Boolean);
      if (!songs.length) return res.status(400).json({ error: 'set_is_empty' });
      if (!room) { room = store.create(); onLive(room, null); }
      if (set.countIn) room.apply('countIn', { countIn: true });
      room.setSetlist(songs);
      room.goto(0);
      return res.json({ ok: true, live: room.id, set: set.name, songs: songs.length });
    }

    if (!room) return res.status(409).json({ error: 'no_live_session', hint: 'open a session (signed in) or POST /api/control/live {room}' });

    const done = ok => (ok ? res.json({ ok: true, live: room.id }) : res.status(400).json({ error: `cannot ${action} now` }));
    switch (action) {
      case 'play': return done(room.request('play', {}));
      case 'pause': return done(room.request('pause', {}));
      case 'stop': return done(room.request('stop', {}));
      case 'go': {
        const seconds = Math.min(60, Math.max(0, num(p.seconds) ?? 4));
        if (room.hostConnected) return done(room.remote({ type: 'remote', action: 'go', seconds }));
        // no host page: count down here, then start the band
        room.apply('countdown', { seconds });
        setTimeout(() => room.apply('play', {}), seconds * 1000).unref?.();
        return done(true);
      }
      case 'next': return done(room.goto(room.setlistIndex + 1));
      case 'prev': return done(room.goto(room.setlistIndex - 1));
      case 'goto': return done(room.goto((num(p.index) ?? 1) - (p.zero ? 0 : 1)));
      case 'cue': return done(room.apply('cue', { text: p.text ?? null, seconds: num(p.seconds) ?? 0 }));
      case 'countdown': return done(room.apply('countdown', { seconds: num(p.seconds) ?? 4, label: p.label }));
      case 'show': return done(room.apply('show', { action: p.action === 'reset' ? 'reset' : 'start' }));
      case 'countin': return done(room.request('countIn', { countIn: !['0', 'false', 'off'].includes(String(p.on ?? 'true')) }));
      case 'tempo': return done(room.request('speed', { speed: num(p.speed) ?? 1 }));
      case 'transpose': return done(room.request('transpose', { transpose: num(p.semitones) ?? 0 }));
      case 'groove': {
        const g = room.groove;
        if (p.off !== undefined || p.on === 'false' || p.on === false) return done(room.apply('groove', { groove: g ? { ...g, on: false } : null }));
        if (!g) return res.status(409).json({ error: 'no_groove_picked_yet' });
        const next = { ...g, on: true };
        if (num(p.slot) !== undefined) next.slot = num(p.slot) - (p.zero ? 0 : 1);
        if (num(p.mute) !== undefined) {
          const mutes = (g.mutes ?? Array(8).fill(false)).slice();
          const i = num(p.mute) - (p.zero ? 0 : 1);
          if (i >= 0 && i < 8) mutes[i] = !['0', 'false', 'off'].includes(String(p.state ?? 'toggle')) ? (p.state === undefined ? !mutes[i] : true) : false;
          next.mutes = mutes;
        }
        return done(room.apply('groove', { groove: next }));
      }
    }
    return res.status(404).json({ error: 'unknown_action' });
  });

  return r;
}

module.exports = { controlRoutes, ACTIONS };
