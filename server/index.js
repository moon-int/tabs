const config = require('./config'); // first: reads .env
const os = require('os');
const fs = require('fs');
const path = require('path');
const http = require('http');
const express = require('express');
const compression = require('compression');
const next = require('next');
const { WebSocketServer } = require('ws');
const { RoomStore, parseSong } = require('./rooms');
const { loadExamples, describeExample, startExample } = require('./examples');
const auth = require('./auth');
const { Library } = require('./library');
const { controlRoutes } = require('./control');

const PORT = config.port;
const dev = !process.argv.includes('--prod') && process.env.NODE_ENV !== 'production';
const root = config.root;
const open = !config.auth; // no sign-in set up: everyone who reaches the server may do everything

const store = new RoomStore({ prefix: config.roomPrefix });
store.live = null; // the session the control api acts on
const examples = loadExamples(path.join(root, 'example'));
// the library is on with sign-in (the platform), or on request for the open lan server
const library = config.auth || process.env.TABS_LIBRARY === '1' ? new Library(config.dataDir).load() : null;
// the shows this server comes with are simply shows in the library — no separate "demo"
if (library && config.seedShows) library.seedShows([...examples.values()]);
const nextApp = next({ dev, dir: root });
const handle = nextApp.getRequestHandler();

// ---- rest api ---------------------------------------------------------------

const api = express.Router();
api.use(auth.attachUser);
api.use('/auth', auth.routes());
api.use('/control', controlRoutes({ store, library, onLive: room => { store.live = room.id; } }));
api.use(express.json({ limit: '25mb' })); // base64-encoded tab files can be a few mb

// bigger general midi sound banks for everyone: put .sf2/.sf3 files into <TABS_DATA>/soundfonts
const soundfontDir = path.join(config.dataDir, 'soundfonts');
function soundfonts() {
  try {
    return fs.readdirSync(soundfontDir).filter(f => /\.sf[23]$/i.test(f)).sort()
      .map(f => ({ name: f.replace(/\.sf[23]$/i, ''), url: `${config.basePath}/soundfonts/${encodeURIComponent(f)}`, size: fs.statSync(path.join(soundfontDir, f)).size }));
  } catch {
    return [];
  }
}

/** what the pages need to know about this server and who is looking */
api.get('/config', (req, res) => res.json({
  server: true,
  auth: config.auth,
  library: !!library,
  user: req.user,
  appUrl: config.appUrl || null,
  beatsUrl: config.beatsUrl || null,
  soundfonts: soundfonts(),
  control: { key: !!config.controlKey, live: store.live && store.get(store.live) ? store.live : null },
}));

/** the control api's key — for admins, to put into mo-tion time's cues (/control shows it) */
api.get('/control-key', auth.requireLevel('admin'), (req, res) => res.json({ key: config.controlKey || null }));

/** a session opened by someone signed in belongs to them (and becomes the live one for the control api) */
function claim(room, req) {
  room.owner = req.user ? req.user.id : null;
  if (req.user || open) store.live = room.id;
  return room;
}

api.post('/rooms', auth.requireLevel('host'), (req, res) => {
  const room = claim(store.create(), req);
  res.status(201).json({ roomId: room.id, hostToken: room.hostToken });
});

// joining is open to anyone with the code — but guessing codes is slowed down
const misses = new Map();
function guessGuard(req) {
  const now = Date.now();
  const m = misses.get(req.ip);
  if (m && now < m.reset && m.count >= 40) return false;
  return true;
}
function countMiss(req) {
  const now = Date.now();
  const m = misses.get(req.ip);
  if (!m || now > m.reset) misses.set(req.ip, { count: 1, reset: now + 10 * 60 * 1000 });
  else m.count++;
}

function findRoom(req, res, nextFn) {
  if (!guessGuard(req)) return res.status(429).json({ error: 'too_many_attempts' });
  const room = store.get(req.params.roomId);
  if (!room) { countMiss(req); return res.status(404).json({ error: 'room_not_found' }); }
  req.room = room;
  nextFn();
}

const tokenOf = req => {
  const h = req.get('authorization') || '';
  return (h.startsWith('Bearer ') ? h.slice(7) : null) || req.get('x-host-token') || req.query.token;
};

/** the session's host token — or, signed in, its owner or an admin */
const mayHost = (room, user) => !!user && (user.admin || (user.canHost && room.owner === user.id));

function requireHost(req, res, nextFn) {
  if (req.room.isHostToken(tokenOf(req)) || mayHost(req.room, req.user)) return nextFn();
  res.status(401).json({ error: 'invalid_host_token' });
}

/** files a signed-in host brings into a session land in their library too */
function remember(req, songs) {
  if (!library || (config.auth && !req.user?.canHost)) return;
  for (const s of songs) {
    try { library.addTab(req.user, { data: s.data, name: s.name }); } catch { /* not every upload must make it */ }
  }
}

const ok = (res, room) => res.json({ ok: true, ...room.summary() });

api.get('/rooms/:roomId', findRoom, (req, res) => res.json({ ...req.room.summary(), youHost: mayHost(req.room, req.user) }));
api.get('/rooms/:roomId/state', findRoom, (req, res) => res.json(req.room.summary()));

api.post('/rooms/:roomId/file', findRoom, requireHost, (req, res) => {
  const song = parseSong(req.body);
  if (!song) return res.status(400).json({ error: 'data (base64 string) is required' });
  req.room.loadAdHoc(song.data, song.name);
  remember(req, [song]);
  ok(res, req.room);
});

for (const action of ['play', 'pause', 'stop', 'seek', 'speed', 'loop', 'range', 'countIn', 'cue', 'countdown', 'show', 'groove', 'transpose']) {
  api.post(`/rooms/:roomId/${action.toLowerCase()}`, findRoom, requireHost, (req, res) => {
    if (!req.room.request(action, req.body || {})) return res.status(400).json({ error: `invalid payload for ${action}` });
    ok(res, req.room);
  });
}

api.get('/rooms/:roomId/setlist', findRoom, (req, res) => res.json({ roomId: req.room.id, setlist: req.room.setlistSummary() }));

api.post('/rooms/:roomId/setlist', findRoom, requireHost, (req, res) => {
  const raw = req.body && req.body.songs;
  if (!Array.isArray(raw)) return res.status(400).json({ error: 'songs (array of { data, name?, title? }) is required' });
  const songs = raw.map(parseSong);
  if (songs.some(s => !s)) return res.status(400).json({ error: 'every song needs data (base64 string)' });
  req.room.setSetlist(songs);
  if (req.body.autoStart && songs.length) req.room.goto(0);
  remember(req, songs);
  ok(res, req.room);
});

api.post('/rooms/:roomId/setlist/songs', findRoom, requireHost, (req, res) => {
  const song = parseSong(req.body);
  if (!song) return res.status(400).json({ error: 'data (base64 string) is required' });
  if (!req.room.addSong(song)) return res.status(409).json({ error: 'setlist_full' });
  remember(req, [song]);
  ok(res, req.room);
});

api.patch('/rooms/:roomId/setlist/songs/:index', findRoom, requireHost, (req, res) => {
  if (!req.room.updateSong(Number(req.params.index), req.body)) return res.status(400).json({ error: 'index out of range' });
  ok(res, req.room);
});

api.delete('/rooms/:roomId/setlist/songs/:index', findRoom, requireHost, (req, res) => {
  if (!req.room.removeSong(Number(req.params.index))) return res.status(400).json({ error: 'index out of range' });
  ok(res, req.room);
});

api.post('/rooms/:roomId/setlist/move', findRoom, requireHost, (req, res) => {
  const { from, to } = req.body || {};
  if (!req.room.moveSong(Number(from), Number(to))) return res.status(400).json({ error: 'from/to out of range' });
  ok(res, req.room);
});

api.post('/rooms/:roomId/setlist/next', findRoom, requireHost, (req, res) => {
  if (!req.room.goto(req.room.setlistIndex + 1)) return res.status(400).json({ error: 'no_next_song' });
  ok(res, req.room);
});

api.post('/rooms/:roomId/setlist/prev', findRoom, requireHost, (req, res) => {
  const i = req.room.setlistIndex;
  // "previous" from an ad-hoc file (index -1) has nowhere to go
  if (!req.room.goto(i === -1 ? -1 : i - 1)) return res.status(400).json({ error: 'no_previous_song' });
  ok(res, req.room);
});

api.post('/rooms/:roomId/setlist/goto', findRoom, requireHost, (req, res) => {
  if (!req.room.goto(Number(req.body && req.body.index))) return res.status(400).json({ error: 'index out of range' });
  ok(res, req.room);
});

/** the session's setlist (with its live settings) as a set in the library */
api.post('/rooms/:roomId/save-set', findRoom, requireHost, auth.requireLevel('host'), (req, res) => {
  if (!library) return res.status(404).json({ error: 'library_off' });
  const songs = req.room.setlist.length ? req.room.setlist : req.room.file ? [{ data: req.room.file.data, name: req.room.file.name }] : [];
  if (!songs.length) return res.status(400).json({ error: 'nothing to save yet' });
  const entries = songs.map(s => {
    const tab = library.addTab(req.user, { data: s.data, name: s.name });
    const { data: _d, name: _n, roles: _r, ...meta } = s;
    return { ...meta, tab: tab.id, title: s.title || '' };
  });
  const set = library.addSet(req.user, { name: req.body?.name || 'saved set', countIn: req.room.playback.countIn, songs: entries });
  res.status(201).json(library.describeSet(set));
});

/** makes this session the one the control api (mo-tion Time) acts on */
api.post('/rooms/:roomId/live', findRoom, requireHost, (req, res) => {
  store.live = req.room.id;
  res.json({ ok: true, live: store.live });
});

// ---- library: your tabs and sets ---------------------------------------------------------

const lib = express.Router();
lib.use((req, res, nextFn) => (library ? nextFn() : res.status(404).json({ error: 'library_off' })));
lib.use(auth.requireLevel('host'));

lib.get('/', (req, res) => {
  const all = req.query.all === '1';
  res.json({
    tabs: library.visible(library.db.tabs, req.user, open, all).map(t => library.describeTab(t)),
    sets: library.visible(library.db.sets, req.user, open, all).map(s => library.describeSet(s)),
  });
});

lib.post('/tabs', (req, res) => {
  const tab = library.addTab(req.user, req.body || {});
  res.status(201).json(library.describeTab(tab));
});

lib.patch('/tabs/:id', (req, res) => res.json(library.describeTab(library.updateTab(library.tabFor(req.user, req.params.id, open, true), req.body))));

lib.delete('/tabs/:id', (req, res) => {
  library.removeTab(library.tabFor(req.user, req.params.id, open, true));
  res.json({ ok: true });
});

lib.get('/tabs/:id/file', (req, res) => {
  const tab = library.tabFor(req.user, req.params.id, open);
  res.attachment(tab.name);
  res.type('application/octet-stream');
  res.send(library.tabBytes(tab));
});

/** a new session with this tab loaded — you are its host */
lib.post('/tabs/:id/open', (req, res) => {
  const tab = library.tabFor(req.user, req.params.id, open);
  library.touch(tab);
  const room = claim(store.create(), req);
  room.loadAdHoc(library.tabData(tab), tab.name);
  res.status(201).json({ roomId: room.id, hostToken: room.hostToken });
});

lib.post('/sets', (req, res) => res.status(201).json(library.describeSet(library.addSet(req.user, req.body || {}))));
lib.get('/sets/:id', (req, res) => res.json(library.describeSet(library.setFor(req.user, req.params.id, open))));
lib.patch('/sets/:id', (req, res) => res.json(library.describeSet(library.updateSet(req.user, library.setFor(req.user, req.params.id, open, true), req.body || {}))));
lib.delete('/sets/:id', (req, res) => {
  library.removeSet(library.setFor(req.user, req.params.id, open, true));
  res.json({ ok: true });
});

/** the show: a new session with the set as its setlist, first song loaded — or into a session you host */
lib.post('/sets/:id/start', (req, res) => {
  const set = library.setFor(req.user, req.params.id, open);
  const songs = library.songsOf(set).map(parseSong).filter(Boolean);
  if (!songs.length) return res.status(400).json({ error: 'this set has no songs yet' });
  const target = req.body?.room ? store.get(req.body.room) : null;
  if (req.body?.room && (!target || !(target.isHostToken(req.body.token) || mayHost(target, req.user)))) {
    return res.status(403).json({ error: 'not your session' });
  }
  const room = target || claim(store.create(), req);
  if (set.countIn) room.apply('countIn', { countIn: true });
  if (set.transpose) room.apply('transpose', { transpose: set.transpose });
  room.setSetlist(songs);
  room.goto(0);
  store.live = room.id;
  res.status(201).json({ roomId: room.id, hostToken: target ? null : room.hostToken });
});

api.use('/library', lib);

// ---- band in the same wifi -----------------------------------------------------

/** the addresses the band can reach this machine under — a host on localhost can't invite anyone with "localhost" */
function lanUrls() {
  const urls = [];
  for (const addrs of Object.values(os.networkInterfaces())) {
    for (const a of addrs || []) if (a.family === 'IPv4' && !a.internal) urls.push(`http://${a.address}:${PORT}${config.basePath}`);
  }
  return urls;
}

api.get('/lan', auth.requireLevel('host'), (req, res) => res.json({ urls: config.appUrl ? [config.appUrl] : lanUrls() }));

// ---- example shows (example/*/show.json) -------------------------------------------

api.get('/examples', auth.requireLevel('host'), (req, res) => res.json([...examples.values()].map(describeExample)));

// a ready-made session: setlist with live settings, first song loaded, you are the host
api.post('/examples/:id', auth.requireLevel('host'), (req, res) => {
  const show = examples.get(req.params.id);
  if (!show) return res.status(404).json({ error: 'example_not_found' });
  const room = claim(startExample(store, show), req);
  res.status(201).json({ roomId: room.id, hostToken: room.hostToken });
});

api.use((req, res) => res.status(404).json({ error: 'not_found' }));
// eslint-disable-next-line no-unused-vars
api.use((err, req, res, _next) => {
  const status = err.status || err.statusCode || 500;
  if (status >= 500) console.error(err);
  const error = err.expose ? err.message : status === 413 ? 'file_too_large' : status === 400 ? 'invalid_json' : 'server_error';
  res.status(status).json({ error });
});

// ---- websocket sync -----------------------------------------------------------

const wss = new WebSocketServer({ noServer: true, maxPayload: 1024 * 1024 });
const HOST_MESSAGES = new Set(['play', 'pause', 'stop', 'seek', 'position', 'countoff', 'speed', 'loop', 'range', 'countIn', 'cue', 'countdown', 'show', 'groove', 'transpose']);

wss.on('connection', (ws, req) => {
  const url = new URL(req.url, 'http://localhost');
  const room = store.get(url.searchParams.get('room'));
  if (!room) {
    ws.send(JSON.stringify({ type: 'error', error: 'room_not_found' }));
    ws.close(4004, 'room_not_found');
    return;
  }

  ws.alive = true;
  ws.on('pong', () => { ws.alive = true; });
  // the host token — or signed in as an admin (joined with the code, in the studio) or as the session's owner
  const user = auth.userFromCookies(req.headers.cookie);
  room.join(ws, room.isHostToken(url.searchParams.get('token')) || mayHost(room, user));

  ws.on('message', raw => {
    let msg;
    try { msg = JSON.parse(raw); } catch { return; }
    if (!msg || typeof msg.type !== 'string') return;
    if (msg.type === 'ping') { room.send(ws, { type: 'pong', t: msg.t }); return; }
    // everyone reports who they are and whether they're loaded & in sync
    if (msg.type === 'status') { room.setStatus(ws, { ...msg, name: msg.name || user?.name || null }); return; }
    // only the host conducts shared playback
    if (ws.isHost && HOST_MESSAGES.has(msg.type)) room.apply(msg.type, msg, ws);
  });

  ws.on('close', () => room.leave(ws));
});

// drop half-open connections so listener counts stay honest
const heartbeat = setInterval(() => {
  for (const ws of wss.clients) {
    if (!ws.alive) { ws.terminate(); continue; }
    ws.alive = false;
    ws.ping();
  }
}, 30000);
const sweeper = setInterval(() => {
  store.sweep();
  if (store.live && !store.get(store.live)) store.live = null;
  const now = Date.now();
  for (const [ip, m] of misses) if (now > m.reset) misses.delete(ip);
}, 60 * 60 * 1000);

// ---- boot --------------------------------------------------------------------

// `npm start` before `npm run build` would otherwise die with a long next.js stack trace
const distDir = process.env.NEXT_DIST_DIR || '.next';
if (!dev && !fs.existsSync(path.join(root, distDir, 'BUILD_ID'))) {
  console.error(`\n  no production build found in ${distDir}/ — run "npm run build" first (or "npm run dev" while developing).\n`);
  process.exit(1);
}

const problems = config.authProblems();
if (!config.auth && problems.length < 5) {
  // some sign-in settings are there, some aren't — say so instead of quietly running open
  console.warn(`\n  sign-in with havoc is NOT active — missing in .env: ${problems.join(', ')}\n  the server is open to everyone who can reach it.\n`);
} else if (config.auth && problems.length) {
  console.warn(`\n  check .env: ${problems.join(', ')}\n`);
}

nextApp.prepare().then(() => {
  const app = express();
  app.disable('x-powered-by');
  app.set('trust proxy', config.trustProxy);
  // alphaTab's 1.1 mb bundle and every api response travel gzipped — matters for phones on stage wifi
  app.use(compression());
  const base = config.basePath;
  app.use(`${base}/api`, api);
  // alphaTab's runtime assets (bravura font, soundfont, worker/worklet bundle) straight from the npm package
  // the files only change with the package version, so browsers may keep them
  app.use(`${base}/vendor/alphatab`, express.static(path.join(root, 'node_modules', '@coderline', 'alphatab', 'dist'), { maxAge: dev ? '1h' : '7d' }));
  app.use(`${base}/soundfonts`, express.static(soundfontDir, { maxAge: '30d', fallthrough: false }));
  app.use((req, res) => handle(req, res));

  const server = http.createServer(app);
  const nextUpgrade = nextApp.getUpgradeHandler();
  server.on('upgrade', (req, socket, head) => {
    const { pathname } = new URL(req.url, 'http://localhost');
    if (pathname === `${base}/ws`) wss.handleUpgrade(req, socket, head, ws => wss.emit('connection', ws, req));
    else nextUpgrade(req, socket, head); // next's hot reload in dev
  });

  server.on('error', err => {
    if (err.code === 'EADDRINUSE') {
      console.error(`\n  port ${PORT} is already in use — is tabs (or beats) running already? start on another port with PORT=3002.\n`);
      process.exit(1);
    }
    throw err;
  });
  server.listen(PORT, () => {
    console.log(`${config.brand === 'tabs' ? 'tabs — mo-tion interactive' : `${config.brand} — runs on tabs by mo-tion`} · http://localhost:${PORT}${base}${dev ? ' (dev)' : ''}`);
    if (config.appUrl) console.log(`  public · ${config.appUrl}`);
    console.log(config.auth ? `  sign-in · havoc (${config.havoc.url}), hosts from role "${config.hostRole}" up` : '  sign-in · off — open to everyone who can reach this machine');
    if (library) console.log(`  library · ${config.dataDir}`);
    if (config.controlKey) console.log('  control api · /api/control/<action> (key from .env)');
    if (!config.appUrl) for (const url of lanUrls()) console.log(`  band in the same wifi · ${url}`);
  });

  const shutdown = () => {
    clearInterval(heartbeat);
    clearInterval(sweeper);
    try { library?.flush(); } catch (err) { console.error('library: could not save', err); }
    for (const ws of wss.clients) ws.close(1001, 'server_shutdown');
    server.close(() => process.exit(0));
    setTimeout(() => process.exit(0), 2000).unref();
  };
  process.on('SIGINT', shutdown);
  process.on('SIGTERM', shutdown);
}).catch(err => {
  console.error(err);
  process.exit(1);
});
