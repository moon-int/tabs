const crypto = require('crypto');
const express = require('express');
const config = require('./config');

/**
 * "Sign in with Havoc": OAuth 2.0 authorization code flow with PKCE against havoc.geyser.at,
 * the same flow every mo-tion app uses (see Havoc's packages/havoc-js/src/oauth.ts).
 *
 *   /api/auth/login     → Havoc's sign-in page (skips the password while Havoc's own sign-in lasts)
 *   /api/auth/callback  → code for tokens, our session cookie, back to where you were
 *   /api/auth/logout    → revoke, end Havoc's sign-in too, back to tabs
 *   /api/auth/me        → who is signed in
 *
 * The session lives in an AES-256-GCM sealed, http-only cookie — no session store on the server.
 * Who may do what follows the role in the Havoc project tabs is registered in:
 *   admin  — project admins (and TABS_ADMIN_GROUP): host in every session, everyone's library
 *   host   — from TABS_HOST_ROLE up (default contributor): start sessions, own library and shows
 *   member — signed in, but only joins sessions like a guest
 */

const SESSION_COOKIE = 'tabs_session';
const OAUTH_COOKIE = 'tabs_oauth';
const SESSION_DAYS = 30;
const REFRESH_EARLY_MS = 60 * 1000;

const key = () => crypto.createHash('sha256').update(`tabs-session:${config.sessionSecret}`).digest();
const b64url = buf => Buffer.from(buf).toString('base64url');

function seal(value) {
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv('aes-256-gcm', key(), iv);
  const body = Buffer.concat([cipher.update(JSON.stringify(value), 'utf8'), cipher.final()]);
  return `${b64url(iv)}.${b64url(body)}.${b64url(cipher.getAuthTag())}`;
}

function unseal(token) {
  try {
    const [iv, body, tag] = String(token).split('.').map(s => Buffer.from(s, 'base64url'));
    const decipher = crypto.createDecipheriv('aes-256-gcm', key(), iv);
    decipher.setAuthTag(tag);
    return JSON.parse(Buffer.concat([decipher.update(body), decipher.final()]).toString('utf8'));
  } catch {
    return null;
  }
}

function parseCookies(header) {
  const out = {};
  for (const part of String(header || '').split(';')) {
    const i = part.indexOf('=');
    if (i < 0) continue;
    const name = part.slice(0, i).trim();
    if (name) out[name] = decodeURIComponent(part.slice(i + 1).trim());
  }
  return out;
}

const secure = () => config.appUrl.startsWith('https://');
// next to other apps on one host (jam.geyser.at/tabs) our cookies stay on our path
const home = () => `${config.basePath}/`;
const authPath = () => `${config.basePath}/api/auth`;

function setCookie(res, name, value, { maxAge, path = config.basePath || '/' }) {
  const parts = [`${name}=${encodeURIComponent(value)}`, `Path=${path}`, 'HttpOnly', 'SameSite=Lax', `Max-Age=${Math.floor(maxAge / 1000)}`];
  if (secure()) parts.push('Secure');
  res.append('Set-Cookie', parts.join('; '));
}

const clearCookie = (res, name, path = config.basePath || '/') => setCookie(res, name, '', { maxAge: 0, path });

// ---- havoc ---------------------------------------------------------------------------

const redirectUri = () => `${config.appUrl}/api/auth/callback`;

async function tokenRequest(path, fields) {
  const body = new URLSearchParams({ client_id: config.havoc.clientId, client_secret: config.havoc.clientSecret, ...fields });
  let res;
  try {
    res = await fetch(`${config.havoc.internalUrl}${path}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded', Accept: 'application/json' },
      body,
    });
  } catch {
    const err = new Error('havoc is not reachable');
    err.offline = true;
    throw err;
  }
  if ([502, 503, 504].includes(res.status)) {
    const err = new Error('havoc is not reachable');
    err.offline = true;
    throw err;
  }
  const payload = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(payload.error_description || payload.error || `havoc answered ${res.status}`);
  return payload;
}

/** our session from Havoc's token response — only what tabs needs */
function sessionOf(tokens, since = Date.now()) {
  const u = tokens.user || {}, p = tokens.project || {};
  return {
    uid: String(u.id || ''),
    name: String(u.name || u.email || 'someone'),
    email: String(u.email || ''),
    guest: !!u.guest,
    role: String(p.role || 'viewer'),
    groups: Array.isArray(p.groups) ? p.groups.map(String) : [],
    project: String(p.id || ''),
    at: tokens.access_token,
    rt: tokens.refresh_token,
    exp: Date.now() + (Number(tokens.expires_in) || 3600) * 1000,
    since,
  };
}

/** admin | host | member — what this person may do in tabs */
function levelOf(s) {
  if (!s) return null;
  if (s.role === 'admin' || (config.adminGroup && s.groups.includes(config.adminGroup))) return 'admin';
  if (!s.guest && (config.ROLE_RANK[s.role] ?? -1) >= config.ROLE_RANK[config.hostRole]) return 'host';
  return 'member';
}

/** the public view of a session: no tokens */
function userOf(s) {
  if (!s) return null;
  const level = levelOf(s);
  return { id: s.uid, name: s.name, email: s.email, role: s.role, level, admin: level === 'admin', canHost: level === 'admin' || level === 'host' };
}

const fresh = s => s && s.uid && Date.now() - (s.since || 0) < SESSION_DAYS * 86400000;

/**
 * The signed-in user of a request (null when nobody is). Refreshes Havoc's tokens shortly before
 * they expire — that is also when a changed role or a removed member takes effect. If Havoc is
 * offline the session keeps working on what it knew.
 */
async function resolve(req, res) {
  if (req.session !== undefined) return req.session;
  let s = unseal(parseCookies(req.headers.cookie)[SESSION_COOKIE]);
  if (!fresh(s)) s = null;
  if (s && s.exp - REFRESH_EARLY_MS < Date.now() && s.rt) {
    try {
      s = sessionOf(await tokenRequest('/oauth/token', { grant_type: 'refresh_token', refresh_token: s.rt }), s.since);
      if (res) setCookie(res, SESSION_COOKIE, seal(s), { maxAge: SESSION_DAYS * 86400000 });
    } catch (err) {
      if (!err.offline) {
        s = null;
        if (res) clearCookie(res, SESSION_COOKIE);
      }
    }
  }
  req.session = s;
  req.user = userOf(s);
  return s;
}

/** for websocket upgrades: no response to refresh into, the cookie as it is */
function userFromCookies(cookieHeader) {
  if (!config.auth) return null;
  const s = unseal(parseCookies(cookieHeader)[SESSION_COOKIE]);
  return fresh(s) ? userOf(s) : null;
}

// ---- express ---------------------------------------------------------------------------

/** puts req.user on every api request (null when signed out or when sign-in isn't set up) */
function attachUser(req, res, next) {
  if (!config.auth) { req.user = null; next(); return; }
  resolve(req, res).then(() => next(), next);
}

/** only with sign-in set up: a signed-in user of at least `level` */
function requireLevel(level) {
  const rank = { member: 0, host: 1, admin: 2 };
  return (req, res, next) => {
    if (!config.auth) return next(); // the open lan server: everyone may
    if (!req.user) return res.status(401).json({ error: 'sign_in_required' });
    if (rank[req.user.level] < rank[level]) return res.status(403).json({ error: 'not_allowed' });
    next();
  };
}

/** a local path to return to after signing in — never another site */
const safeNext = v => (typeof v === 'string' && /^\/(?!\/)[^\s\\]*$/.test(v) ? v : home());

function routes() {
  const r = express.Router();

  r.get('/login', (req, res) => {
    if (!config.auth) return res.redirect(home());
    const verifier = b64url(crypto.randomBytes(48));
    const state = b64url(crypto.randomBytes(16));
    const challenge = b64url(crypto.createHash('sha256').update(verifier).digest());
    setCookie(res, OAUTH_COOKIE, seal({ verifier, state, next: safeNext(req.query.next) }), { maxAge: 10 * 60 * 1000, path: authPath() });
    const params = new URLSearchParams({
      response_type: 'code', client_id: config.havoc.clientId, redirect_uri: redirectUri(),
      state, code_challenge: challenge, code_challenge_method: 'S256', ui_locales: 'de en',
    });
    if (req.query.prompt === 'login') params.set('prompt', 'login');
    res.redirect(`${config.havoc.url}/oauth/authorize?${params}`);
  });

  r.get('/callback', async (req, res) => {
    const pending = unseal(parseCookies(req.headers.cookie)[OAUTH_COOKIE]);
    clearCookie(res, OAUTH_COOKIE, authPath());
    const fail = reason => res.redirect(`${home()}?signin=${encodeURIComponent(reason)}`);
    if (req.query.error) return fail(String(req.query.error_description || req.query.error));
    if (!pending || !req.query.code || req.query.state !== pending.state) return fail('the sign-in expired — please try again');
    try {
      const tokens = await tokenRequest('/oauth/token', {
        grant_type: 'authorization_code', code: String(req.query.code), redirect_uri: redirectUri(), code_verifier: pending.verifier,
      });
      setCookie(res, SESSION_COOKIE, seal(sessionOf(tokens)), { maxAge: SESSION_DAYS * 86400000 });
      res.redirect(safeNext(pending.next));
    } catch (err) {
      fail(err.message);
    }
  });

  r.get('/logout', async (req, res) => {
    const s = unseal(parseCookies(req.headers.cookie)[SESSION_COOKIE]);
    clearCookie(res, SESSION_COOKIE);
    if (!config.auth) return res.redirect(home());
    if (s?.rt) await tokenRequest('/oauth/revoke', { token: s.rt }).catch(() => {});
    const params = new URLSearchParams({ client_id: config.havoc.clientId, redirect_uri: `${config.appUrl}/` });
    res.redirect(`${config.havoc.url}/oauth/logout?${params}`);
  });

  r.get('/me', attachUser, (req, res) => res.json({ auth: config.auth, user: req.user }));
  return r;
}

module.exports = { routes, attachUser, requireLevel, userFromCookies, seal, unseal, levelOf, userOf, safeNext };
