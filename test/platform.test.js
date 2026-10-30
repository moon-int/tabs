const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const http = require('http');

// the control api reads its key from the environment when it's loaded
process.env.TABS_CONTROL_KEY = 'test-key-123';
process.env.SESSION_SECRET = 'x'.repeat(40);

const express = require('express');
const { RoomStore } = require('../server/rooms');
const { Library, SHARED } = require('../server/library');
const { loadExamples } = require('../server/examples');
const { controlRoutes } = require('../server/control');
const { seal, unseal, levelOf, safeNext } = require('../server/auth');

const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'tabs-lib-'));
test.after(() => fs.rmSync(dir, { recursive: true, force: true }));
const file = name => fs.readFileSync(path.join(__dirname, '..', 'example', 'wts', name)).toString('base64');
// the public repository comes without the example tab files — these tests need them
const NO_EXAMPLES = !fs.existsSync(path.join(__dirname, '..', 'example', 'wts', 'show.json')) && 'the example tab files are not part of the public repository';

const me = { id: 'u1', name: 'Lorenz', admin: false, canHost: true };
const other = { id: 'u2', name: 'Someone', admin: false, canHost: true };
const admin = { id: 'u3', name: 'Admin', admin: true, canHost: true };

test('the library keeps each file once, reads title, artist and tunings, and survives a restart', { skip: NO_EXAMPLES }, async () => {
  const lib = new Library(dir).load();
  const creep = lib.addTab(me, { data: file('Radiohead-Creep.gp'), name: 'Radiohead-Creep.gp' });
  assert.equal(creep.title, 'Creep');
  assert.ok(creep.roles.guitar, 'the guitar tuning comes out of the file');
  assert.ok(creep.tracks.length > 1);
  assert.equal(lib.addTab(me, { data: file('Radiohead-Creep.gp'), name: 'again.gp' }), creep, 'same file, same entry');
  const theirs = lib.addTab(other, { data: file('Radiohead-Creep.gp'), name: 'Radiohead-Creep.gp' });
  assert.notEqual(theirs.id, creep.id, 'everyone has their own entry');
  assert.equal(fs.readdirSync(path.join(dir, 'files')).length, 1, 'but the file is stored once');
  assert.throws(() => lib.addTab(me, { data: Buffer.from('not a tab').toString('base64'), name: 'x.gp' }), /tab file/);

  assert.deepEqual(lib.visible(lib.db.tabs, me, false, false).map(t => t.id), [creep.id], 'you see your own');
  assert.equal(lib.visible(lib.db.tabs, me, false, true).length, 1, '"all" is for admins only');
  assert.equal(lib.visible(lib.db.tabs, admin, false, true).length, 2);
  assert.throws(() => lib.tabFor(other, creep.id, false), /tab_not_found/);
  assert.equal(lib.tabFor(admin, creep.id, false), creep);

  await lib.save();
  const again = new Library(dir).load();
  assert.equal(again.db.tabs.length, 2);
});

test('a set holds songs with their live settings and turns into a setlist', { skip: NO_EXAMPLES }, async () => {
  const lib = new Library(dir).load();
  const creep = lib.db.tabs.find(t => t.owner === me.id);
  const welle = lib.addTab(me, { data: file('Juli-Perfekte Welle.gp'), name: 'Juli-Perfekte Welle.gp' });
  const set = lib.addSet(me, { name: 'gig', countIn: true, songs: [{ tab: creep.id, speed: 0.9, notes: 'capo 2' }, { tab: welle.id, autoNext: true }] });
  assert.equal(set.songs.length, 2);
  assert.equal(set.songs[0].speed, 0.9);
  const theirs = lib.db.tabs.find(t => t.owner === other.id);
  lib.updateSet(me, set, { songs: [...set.songs, { tab: theirs.id }] });
  assert.equal(set.songs.length, 2, "someone else's tab can't sneak into your set");

  const songs = lib.songsOf(set);
  assert.equal(songs.length, 2);
  assert.equal(songs[0].notes, 'capo 2');
  assert.ok(songs[0].data.length > 100, 'with the file data');
  assert.equal(lib.describeSet(set).songs[1].tabTitle, welle.title);

  lib.removeTab(welle);
  assert.equal(set.songs.length, 1, 'a deleted tab drops out of its sets');
  await lib.save();
});

function serve(store, library) {
  const app = express();
  app.use((req, res, next) => { req.user = null; next(); });
  app.use('/api/control', controlRoutes({ store, library, onLive: room => { store.live = room.id; } }));
  return new Promise(resolve => {
    const server = http.createServer(app).listen(0, () => resolve({ server, base: `http://127.0.0.1:${server.address().port}/api/control` }));
  });
}

test('the control api needs its key and acts on the live session', { skip: NO_EXAMPLES }, async t => {
  const store = new RoomStore();
  const lib = new Library(dir).load();
  const { server, base } = await serve(store, lib);
  t.after(() => server.close());

  assert.equal((await fetch(`${base}/status`)).status, 401, 'no key, no control');
  const status = await (await fetch(`${base}/status?key=test-key-123`)).json();
  assert.deepEqual(status, { live: null });

  // time sends its body as text — that works too
  const set = lib.db.sets.find(s => s.name === 'gig');
  const load = await fetch(`${base}/load`, { method: 'POST', headers: { 'X-Tabs-Key': 'test-key-123', 'Content-Type': 'text/plain' }, body: JSON.stringify({ set: 'GIG' }) });
  assert.equal(load.status, 200);
  const { live } = await load.json();
  const room = store.get(live);
  assert.ok(room, 'a show loaded without a session opens one');
  assert.equal(room.setlistIndex, 0);
  assert.equal(room.playback.countIn, true, "the show's count-in comes along");

  const cue = await fetch(`${base}/cue`, { method: 'POST', headers: { Authorization: 'Bearer test-key-123', 'Content-Type': 'application/json' }, body: JSON.stringify({ text: 'outro', seconds: 5 }) });
  assert.equal(cue.status, 200);
  assert.equal(room.cue.text, 'outro');

  // no host page open: play applies to the session directly
  assert.equal((await fetch(`${base}/play?key=test-key-123`, { method: 'POST' })).status, 200);
  assert.equal(room.playback.playing, true);

  const pre = await fetch(`${base}/play`, { method: 'OPTIONS', headers: { Origin: 'https://time.example', 'Access-Control-Request-Method': 'POST' } });
  assert.equal(pre.status, 204);
  assert.equal(pre.headers.get('access-control-allow-origin'), '*', 'mo-tion time may call it from the browser');
  assert.equal((await fetch(`${base}/nonsense?key=test-key-123`)).status, 404);
});

test('sessions are sealed, roles map to what you may do, redirects stay home', () => {
  const s = { uid: 'u1', name: 'L', role: 'contributor', groups: [], since: Date.now() };
  const token = seal(s);
  assert.deepEqual(unseal(token), s);
  assert.equal(unseal(token.slice(0, -2) + 'xx'), null, 'tampering breaks the seal');
  assert.equal(levelOf({ ...s, role: 'admin' }), 'admin');
  assert.equal(levelOf(s), 'host');
  assert.equal(levelOf({ ...s, role: 'viewer' }), 'member');
  assert.equal(levelOf({ ...s, guest: true }), 'member');
  assert.equal(safeNext('/library'), '/library');
  assert.equal(safeNext('//evil.example'), '/');
  assert.equal(safeNext('https://evil.example'), '/');
});

test('the shows a server comes with become shared shows — once, and only admins change them', { skip: NO_EXAMPLES }, async () => {
  const seedDir = fs.mkdtempSync(path.join(os.tmpdir(), 'tabs-seed-'));
  try {
    const lib = new Library(seedDir).load();
    const shows = [...loadExamples(path.join(__dirname, '..', 'example')).values()];
    assert.equal(lib.seedShows(shows), shows.length);
    const set = lib.db.sets.find(s => s.seed === 'wts');
    assert.ok(set && set.owner === SHARED, 'an ordinary show, owned by nobody in particular');
    assert.equal(set.songs.length, 9);
    assert.equal(set.countIn, true);
    assert.ok(set.songs.every(s => s.rig && s.rig.guitar), 'every song keeps its rig line');
    assert.ok(!/demo/i.test(set.name), 'not called a demo');

    assert.ok(lib.visible(lib.db.sets, me, false, false).includes(set), 'every host sees it');
    assert.equal(lib.setFor(me, set.id, false), set, 'and may start it');
    assert.throws(() => lib.setFor(me, set.id, false, true), /admin/, 'but not change it');
    assert.equal(lib.setFor(admin, set.id, false, true), set);
    const mine = lib.addSet(me, { name: 'with a shared song', songs: [{ tab: set.songs[0].tab }] });
    assert.equal(mine.songs.length, 1, 'shared songs may go into your own shows');

    lib.removeSet(set);
    assert.equal(lib.seedShows(shows), 0, 'a deleted show does not come back');
    await lib.save();
    assert.equal(new Library(seedDir).load().seedShows(shows), 0, 'not even after a restart');
  } finally {
    fs.rmSync(seedDir, { recursive: true, force: true });
  }
});

test('session codes carry the server prefix, other servers forward them', async () => {
  const store = new RoomStore({ prefix: 'LG' });
  const id = store.create().id;
  assert.match(id, /^lg[a-z2-9]{6}$/);
  assert.ok(store.get(id.toUpperCase()), 'typed in capitals still found');
  assert.ok(!/l/.test(id.slice(2)), 'the random part never has an l, so the prefix is unmistakable');

  // tabs.mo-tion.at: the prefix table and the redirects next.js serves
  process.env.VERCEL = '1';
  delete process.env.TABS_REMOTES;
  const config = (await import(`../next.config.mjs?vercel=${Date.now()}`)).default;
  assert.equal(config.env.TABS_REMOTES, 'lg=https://jam.geyser.at/tabs');
  const [redirect] = await config.redirects();
  assert.equal(redirect.destination, 'https://jam.geyser.at/tabs/room/:code');
  const pattern = new RegExp(`^${redirect.source.match(/\((.*)\)$/)[1]}$`);
  assert.ok(pattern.test('lg7k2m9q') && pattern.test('LG7K2M9Q'), 'lg codes, any case');
  assert.ok(!pattern.test('k7m2qa'), 'other codes stay');
});
