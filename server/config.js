const fs = require('fs');
const path = require('path');

/**
 * Settings of a tabs server, from the environment — and from a `.env` file next to package.json,
 * so `start.bat` on the NUC needs nothing but that file (variables already set win over it).
 *
 * Without the HAVOC_* settings tabs runs as it always did: open to everyone who can reach it (the
 * laptop in the rehearsal room). With them it becomes the band platform: sign-in with Havoc, a
 * library and shows on disk, guests only with a session code.
 */

const root = path.join(__dirname, '..');

function loadEnvFile(file) {
  let text;
  try { text = fs.readFileSync(file, 'utf8'); } catch { return; }
  for (const line of text.split(/\r?\n/)) {
    const m = line.match(/^\s*(?:export\s+)?([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*?)\s*$/);
    if (!m || line.trim().startsWith('#')) continue;
    let value = m[2];
    if (/^(['"]).*\1$/.test(value)) value = value.slice(1, -1);
    else value = value.replace(/\s+#.*$/, '');
    if (process.env[m[1]] === undefined) process.env[m[1]] = value;
  }
}

loadEnvFile(path.join(root, '.env'));

const env = (key, fallback = '') => (process.env[key] ?? '').trim() || fallback;
const trimSlash = url => url.replace(/\/+$/, '');

const ROLE_RANK = { viewer: 0, contributor: 1, editor: 2, admin: 3 };

const config = {
  root,
  port: Number(env('PORT')) || 3000,
  /** under a path next to other apps — '/tabs' on jam.geyser.at; '' at the root */
  basePath: env('BASE_PATH').replace(/\/+$/, '').replace(/^(?=[^/])/, '/'),
  /** the public address, with the path — e.g. https://jam.geyser.at/tabs: invite links, the sign-in callback */
  appUrl: trimSlash(env('APP_URL')),
  havoc: {
    url: trimSlash(env('HAVOC_URL')),
    /** how this server itself reaches Havoc, if the public name doesn't resolve inside the lan */
    internalUrl: trimSlash(env('HAVOC_INTERNAL_URL') || env('HAVOC_URL')),
    clientId: env('HAVOC_CLIENT_ID'),
    clientSecret: env('HAVOC_CLIENT_SECRET'),
  },
  sessionSecret: env('SESSION_SECRET'),
  /** lowest Havoc project role that may start sessions, upload and build shows */
  hostRole: ROLE_RANK[env('TABS_HOST_ROLE', 'contributor')] !== undefined ? env('TABS_HOST_ROLE', 'contributor') : 'contributor',
  /** a Havoc group whose members count as admins, besides the project's admins */
  adminGroup: env('TABS_ADMIN_GROUP'),
  dataDir: path.resolve(root, env('TABS_DATA', 'data')),
  /** key for the control api (mo-tion Time cues, scripts, a stream deck) */
  controlKey: env('TABS_CONTROL_KEY'),
  /** origins allowed to call the control api from a browser (Time runs in one); * = any */
  controlOrigins: env('TABS_CONTROL_ORIGINS', '*').split(',').map(s => s.trim()).filter(Boolean),
  /** where mo-tion beats lives — "edit in beats" links */
  beatsUrl: trimSlash(env('BEATS_URL')),
  /** jam: the band's own name and look (lib/brand.ts) — the build reads it, the server only says so at startup */
  brand: env('TABS_BRAND') === 'jam' ? (env('TABS_BRAND_NAME') || 'jam') : 'tabs',
  /** every session code starts with this ("lg") — tabs.mo-tion.at forwards such codes here */
  roomPrefix: env('TABS_ROOM_PREFIX'),
  /** put the example shows (example/*\/show.json) into the library as shared shows, once */
  seedShows: env('TABS_SEED_SHOWS', '1') !== '0',
  /** proxies whose X-Forwarded-* headers count (nginx proxy manager in front of the NUC) */
  trustProxy: env('TRUST_PROXY', 'loopback, uniquelocal'),
};

/**
 * The server's own secrets — the key that seals sign-in cookies and the control api's key — don't
 * have to be typed in: missing in .env, they're made once and kept in <TABS_DATA>/secrets.json.
 * Only what havoc hands out (client id and secret) has to come from outside. Only where the server
 * keeps data (sign-in set up, or a library) — the open laptop server stays without files.
 */
function ownSecrets() {
  const wanted = (config.havoc.clientId || process.env.TABS_LIBRARY === '1') && (!config.sessionSecret || !config.controlKey);
  if (!wanted) return;
  const file = path.join(config.dataDir, 'secrets.json');
  let kept = {};
  try { kept = JSON.parse(fs.readFileSync(file, 'utf8')); } catch {}
  const make = () => require('crypto').randomBytes(32).toString('base64url');
  const next = { sessionSecret: kept.sessionSecret || make(), controlKey: kept.controlKey || make() };
  if (next.sessionSecret !== kept.sessionSecret || next.controlKey !== kept.controlKey) {
    try {
      fs.mkdirSync(config.dataDir, { recursive: true });
      fs.writeFileSync(file, JSON.stringify(next, null, 1));
    } catch (err) {
      console.warn(`could not keep the server's secrets in ${file}: ${err.message}`);
    }
  }
  if (!config.sessionSecret) config.sessionSecret = next.sessionSecret;
  if (!config.controlKey) config.controlKey = next.controlKey;
}
ownSecrets();

config.auth = !!(config.havoc.url && config.havoc.clientId && config.havoc.clientSecret && config.sessionSecret);
config.ROLE_RANK = ROLE_RANK;

/** what's missing for sign-in, for a clear message at startup */
config.authProblems = () => {
  const missing = [];
  if (!config.havoc.url) missing.push('HAVOC_URL');
  if (!config.havoc.clientId) missing.push('HAVOC_CLIENT_ID');
  if (!config.havoc.clientSecret) missing.push('HAVOC_CLIENT_SECRET');
  if (!config.sessionSecret) missing.push('SESSION_SECRET');
  else if (config.sessionSecret.length < 32) missing.push('SESSION_SECRET (at least 32 characters)');
  if (!config.appUrl) missing.push('APP_URL');
  return missing;
};

module.exports = config;
