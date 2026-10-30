// jam — tabs, beats and time on one machine under one address, by path. start.bat runs this.
//
//   nginx proxy manager  jam.geyser.at  ->  this machine :3000 (the router, deploy/router.js)
//       /tabs -> :3001      /beats -> :3002      /time -> :3003      / -> /tabs
//
//   node deploy/jam.mjs              the NUC: everything above; tabs' settings from Tabs\.env
//   node deploy/jam.mjs --local      the same on this machine to try it (npm run nuc): router on :3100,
//                                    apps on 3101–3103, own builds (.next-nuc) and library (data-nuc)
//   … --build                        build tabs and beats again even if nothing seems to have changed
//   … --check                        start everything, check it through the router like a browser, stop
//
// The three repositories sit side by side (…\Tabs  …\Beats  …\Time — or JAM_BEATS_DIR / JAM_TIME_DIR in
// tabs' .env say where). Beats and time need nothing of
// their own — no start.bat, no .env: their path and port come from here. Missing packages are
// installed, builds are made again whenever the code (git commit) or a setting that is built in
// (path, brand) changed, and an app that stops is started again.

import { spawn } from 'node:child_process';
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import net from 'node:net';
import { createRequire } from 'node:module';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const { createRouter } = createRequire(import.meta.url)('./router.js');

const here = path.dirname(fileURLToPath(import.meta.url));
const args = new Set(process.argv.slice(2));
const LOCAL = args.has('--local');
const DIST = LOCAL ? '.next-nuc' : '.next';
const node = process.execPath;
const isWin = process.platform === 'win32';

function readEnv(file) {
  const out = {};
  try {
    for (const line of fs.readFileSync(file, 'utf8').split(/\r?\n/)) {
      const m = line.match(/^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*?)\s*$/);
      if (m && !line.trim().startsWith('#')) out[m[1]] = m[2].replace(/^(['"])(.*)\1$/, '$2');
    }
  } catch {}
  return out;
}

const tabsDir = path.resolve(here, '..');
const tabsFile = readEnv(path.join(tabsDir, '.env'));
// the port nginx proxy manager talks to (3000); the apps take the next three
const ENTRY = Number(process.env.JAM_PORT || (LOCAL ? 0 : tabsFile.JAM_PORT)) || (LOCAL ? 3100 : 3000);
const PUBLIC = `http://localhost:${ENTRY}`;
/** beats and time next to tabs (any spelling), or where JAM_BEATS_DIR / JAM_TIME_DIR in tabs' .env say */
function sibling(name, setting) {
  const set = process.env[setting] || tabsFile[setting];
  if (set) return path.resolve(tabsDir, set);
  const parent = path.dirname(tabsDir);
  const found = fs.readdirSync(parent).find(d => d.toLowerCase() === name.toLowerCase() && fs.statSync(path.join(parent, d)).isDirectory());
  return path.join(parent, found || name);
}
// on the NUC tabs reads its own .env (sign-in, brand, library …); here only what this launcher decides
const tabsEnv = LOCAL
  ? {
    APP_URL: `${PUBLIC}/tabs`, BEATS_URL: `${PUBLIC}/beats`, NEXT_DIST_DIR: DIST,
    TABS_ROOM_PREFIX: 'lg', TABS_LIBRARY: '1', TABS_DATA: 'data-nuc',
    ...readEnv(path.join(here, 'nuc-local.env')), // havoc sign-in for the local try, if wanted
  }
  : {};

const APPS = [
  {
    name: 'tabs', dir: tabsDir, path: '/tabs', port: ENTRY + 1,
    env: { ...tabsEnv, BASE_PATH: '/tabs' },
    // settings that go into the build: a change means building again
    builtIn: () => {
      const e = { ...tabsFile, ...tabsEnv };
      return ['TABS_BRAND', 'TABS_BRAND_NAME', 'TABS_BRAND_TAGLINE', 'TABS_REMOTES'].map(k => e[k] || '').join('|');
    },
    build: true,
    run: port => [node, ['server/index.js', '--prod']],
  },
  {
    name: 'beats', dir: sibling('Beats', 'JAM_BEATS_DIR'), path: '/beats', port: ENTRY + 2,
    env: { BASE_PATH: '/beats', ...(LOCAL ? { NEXT_DIST_DIR: DIST } : {}) },
    builtIn: () => '',
    build: true,
    run: port => [node, ['node_modules/next/dist/bin/next', 'start', '-p', String(port)]],
  },
  {
    name: 'time', dir: sibling('Time', 'JAM_TIME_DIR'), path: '/time', port: ENTRY + 3,
    env: { BASE_PATH: '/time' },
    run: port => [node, ['server.js']],
  },
];

const colors = { tabs: 36, beats: 35, time: 33, jam: 32 };
const say = (name, text) => {
  for (const line of String(text).split(/\r?\n/)) if (line.trim()) console.log(`\x1b[${colors[name] ?? 37}m${name.padEnd(5)}\x1b[0m ${line}`);
};

const envOf = app => ({ ...process.env, ...app.env, PORT: String(app.port), NODE_ENV: 'production' });

function exec(app, cmd, cmdArgs, { shell = false } = {}) {
  const child = spawn(cmd, cmdArgs, { cwd: app.dir, env: envOf(app), stdio: ['ignore', 'pipe', 'pipe'], shell });
  child.stdout.on('data', d => say(app.name, d));
  child.stderr.on('data', d => say(app.name, d));
  return child;
}

const done = child => new Promise((resolve, reject) => child.on('exit', code => (code ? reject(new Error(`exit ${code}`)) : resolve())));
const npm = (app, ...a) => done(exec(app, isWin ? 'npm.cmd' : 'npm', a, { shell: isWin }));

function commit(dir) {
  try { return execFileSync('git', ['rev-parse', 'HEAD'], { cwd: dir, stdio: ['ignore', 'pipe', 'ignore'] }).toString().trim(); } catch { return 'local'; }
}

/** install what's missing, build what changed */
async function prepare(app) {
  if (!fs.existsSync(path.join(app.dir, 'package.json'))) {
    throw new Error(`${app.name} not found at ${app.dir} — clone it next to tabs (git clone https://github.com/mo-tion-interactive/${app.name === 'beats' ? 'Beats' : 'Time'}.git), or set JAM_${app.name.toUpperCase()}_DIR in tabs' .env`);
  }
  const pkg = JSON.parse(fs.readFileSync(path.join(app.dir, 'package.json'), 'utf8'));
  if (Object.keys(pkg.dependencies || {}).length && !fs.existsSync(path.join(app.dir, 'node_modules'))) {
    say(app.name, 'installing packages …');
    await npm(app, 'install', '--no-audit', '--no-fund');
  }
  if (!app.build) return;
  const stampFile = path.join(app.dir, DIST, 'jam-build.txt');
  const stamp = `${commit(app.dir)}|${app.env.BASE_PATH}|${app.builtIn()}`;
  let built = '';
  try { built = fs.readFileSync(stampFile, 'utf8').trim(); } catch {}
  if (!args.has('--build') && built === stamp && fs.existsSync(path.join(app.dir, DIST, 'BUILD_ID'))) return;
  say(app.name, `building for ${app.path} …`);
  await npm(app, 'run', 'build');
  fs.writeFileSync(stampFile, stamp);
}

// ---- run and keep running --------------------------------------------------------------------

let stopping = false;
const children = new Map();

function start(app) {
  const [cmd, cmdArgs] = app.run(app.port);
  const child = exec(app, cmd, cmdArgs);
  children.set(app.name, child);
  child.on('exit', code => {
    if (stopping) return;
    say(app.name, `stopped (${code}) — starting again in 3 s`);
    setTimeout(() => { if (!stopping) start(app); }, 3000);
  });
}

// the public host (from APP_URL): <name>.<its domain> — tabs.geyser.at, beats.geyser.at … — leads there
const canonical = LOCAL ? '' : (() => { try { return new URL(process.env.APP_URL || tabsFile.APP_URL).host; } catch { return ''; } })();
const router = createRouter(APPS.map(a => ({ path: a.path, port: a.port })), { canonical });

function stop(code) {
  stopping = true;
  for (const c of children.values()) c.kill();
  router.close();
  setTimeout(() => process.exit(code), 300);
}
process.on('SIGINT', () => stop(0));

async function up(app, ms = 120000) {
  const until = Date.now() + ms;
  while (Date.now() < until) {
    try { await fetch(`http://127.0.0.1:${app.port}${app.path}${app.name === 'time' ? '/' : ''}`); return true; } catch { await new Promise(r => setTimeout(r, 500)); }
  }
  return false;
}

// ---- checks through the router, like a browser would -----------------------------------------

async function check() {
  const results = [];
  const ok = (cond, what) => { results.push(cond); say('jam', `${cond ? 'ok  ' : 'FAIL'} ${what}`); };
  const get = async p => { try { const r = await fetch(`${PUBLIC}${p}`, { redirect: 'manual' }); return { status: r.status, text: await r.text(), location: r.headers.get('location') }; } catch { return { status: 0, text: '' }; } };

  const home = await get('/tabs');
  ok(home.status === 200 && home.text.includes('/tabs/_next/'), `${PUBLIC}/tabs — assets under /tabs/_next`);
  const cfg = JSON.parse((await get('/tabs/api/config')).text || '{}');
  ok(cfg.server === true, '/tabs/api/config answers');
  const room = await fetch(`${PUBLIC}/tabs/api/rooms`, { method: 'POST' }).then(r => r.json()).catch(() => ({}));
  ok(!!room.roomId, `a session opens through the router — code ${room.roomId}`);
  const wsPath = new URL(`file:///${path.join(tabsDir, 'node_modules', 'ws', 'wrapper.mjs').replace(/\\/g, '/')}`).href;
  const { default: WebSocket } = await import(wsPath);
  const init = await new Promise(resolve => {
    const ws = new WebSocket(`ws://localhost:${ENTRY}/tabs/ws?room=${room.roomId}&token=${room.hostToken}`);
    const t = setTimeout(() => { ws.terminate(); resolve(null); }, 5000);
    ws.on('message', m => { clearTimeout(t); ws.close(); resolve(JSON.parse(m)); });
    ws.on('error', () => { clearTimeout(t); resolve(null); });
  });
  ok(init?.type === 'init', 'the websocket goes through the router (/tabs/ws)');
  ok((await get('/tabs/vendor/alphatab/alphaTab.min.js')).status === 200, 'alphaTab under /tabs/vendor');
  const beats = await get('/beats');
  ok(beats.status === 200 && beats.text.includes('/beats/_next/'), `${PUBLIC}/beats`);
  const time = await get('/time');
  ok(time.status === 301 && time.location?.endsWith('/time/'), '/time → /time/');
  ok((await get('/time/')).status === 200 && (await get('/time/css/base.css')).status === 200, `${PUBLIC}/time/ with its files`);
  ok((await get('/')).location === '/tabs', `${PUBLIC}/ → /tabs`);
  return results.every(Boolean);
}

// ---- ports: free before anything is built — and if not, who holds them ----------------------

const free = port => new Promise(resolve => {
  const probe = net.createServer().once('error', () => resolve(false)).once('listening', () => probe.close(() => resolve(true)));
  probe.listen(port);
});

/** "node.exe (pid 1234): node server/index.js --prod" — what holds a port, as far as windows tells */
function holder(port) {
  if (!isWin) return null;
  try {
    const line = execFileSync('netstat', ['-ano', '-p', 'tcp'], { stdio: ['ignore', 'pipe', 'ignore'] }).toString()
      .split(/\r?\n/).find(l => /LISTENING/i.test(l) && new RegExp(`:${port}\\s`).test(l));
    const pid = line?.trim().split(/\s+/).pop();
    if (!pid) return null;
    let what = `pid ${pid}`;
    try {
      const cmd = execFileSync('powershell', ['-NoProfile', '-Command', `(Get-CimInstance Win32_Process -Filter "ProcessId=${pid}").CommandLine`], { stdio: ['ignore', 'pipe', 'ignore'] }).toString().trim();
      if (cmd) what += `: ${cmd}`;
    } catch {}
    return what;
  } catch {
    return null;
  }
}

/** is the one on our port a jam router — started before, in another window or by the autostart? */
async function jamRunning() {
  try {
    const r = await fetch(`http://127.0.0.1:${ENTRY}/`, { redirect: 'manual' });
    return r.headers.get('x-jam') === 'router';
  } catch {
    return false;
  }
}

async function portsFree() {
  if (!(await free(ENTRY)) && (await jamRunning())) {
    say('jam', `jam is running already on port ${ENTRY} (another window, or the autostart) — nothing to do: ${PUBLIC}/tabs`);
    process.exit(3);
  }
  const ports = [ENTRY, ...APPS.map(a => a.port)];
  const busy = [];
  for (const port of ports) if (!(await free(port))) busy.push(port);
  if (!busy.length) return;
  for (const port of busy) say('jam', `\x1b[31mport ${port} is in use\x1b[0m${holder(port) ? ` — ${holder(port)}` : ''}`);
  throw new Error(
    `jam needs ports ${ENTRY}-${ENTRY + 3}. an old tabs, beats or time window still running? close it (or taskkill /PID <pid> /F) — `
    + `or move jam: JAM_PORT=<port> in tabs' .env (and the same port in nginx proxy manager)`,
  );
}

// ---- go --------------------------------------------------------------------------------------

try {
  await portsFree();
  for (const app of APPS) await prepare(app);
  for (const app of APPS) start(app);
  await new Promise((resolve, reject) => router.listen(ENTRY, resolve).on('error', err => reject(
    err.code === 'EADDRINUSE' ? new Error(`port ${ENTRY} is in use — is jam (or tabs alone) running already?`) : err,
  )));
  for (const app of APPS) if (!(await up(app))) throw new Error(`${app.name} did not come up on port ${app.port}`);

  say('jam', LOCAL ? 'jam on this machine — like jam.geyser.at:' : `jam — nginx proxy manager: jam.geyser.at -> this machine, port ${ENTRY}`);
  for (const app of APPS) say('jam', `  ${PUBLIC}${app.path}${app.name === 'time' ? '/' : ''}   ->  ${app.name} on :${app.port}`);
  if (args.has('--check')) stop((await check()) ? 0 : 1);
  else say('jam', 'ctrl+c stops everything');
} catch (err) {
  say('jam', `\x1b[31m${err.message}\x1b[0m`);
  stop(1);
}
