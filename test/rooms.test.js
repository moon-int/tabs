const test = require('node:test');
const assert = require('node:assert/strict');
const { RoomStore, parseSong, ROOM_TTL_MS } = require('../server/rooms');

// minimal stand-in for a ws socket
function fakeSocket() {
  return { readyState: 1, sent: [], send(raw) { this.sent.push(JSON.parse(raw)); }, last() { return this.sent[this.sent.length - 1]; } };
}

const song = (n) => ({ data: Buffer.from(`song ${n}`).toString('base64'), name: `song-${n}.gp`, title: null });

test('rooms get readable lowercase ids and a host token', () => {
  const store = new RoomStore();
  const room = store.create();
  assert.match(room.id, /^[a-z2-9]{6}$/);
  assert.equal(store.get(room.id.toUpperCase()), room);
  assert.ok(room.isHostToken(room.hostToken));
  assert.ok(!room.isHostToken('nope'));
  assert.ok(!room.isHostToken(undefined));
});

test('join sends init and tells everyone else about peers', () => {
  const room = new RoomStore().create();
  const host = fakeSocket(), listener = fakeSocket();
  room.join(host, true);
  assert.equal(host.last().type, 'init');
  assert.equal(host.last().role, 'host');
  room.join(listener, false);
  assert.equal(listener.last().role, 'listener');
  assert.deepEqual(host.last(), { type: 'peers', hostConnected: true, listeners: 1 });
});

test('host actions update state and skip the sender', () => {
  const room = new RoomStore().create();
  const host = fakeSocket(), listener = fakeSocket();
  room.join(host, true);
  room.join(listener, false);
  const before = host.sent.length;

  assert.ok(room.apply('play', { tick: 960 }, host));
  assert.deepEqual(listener.last(), { type: 'play', tick: 960 });
  assert.equal(host.sent.length, before);
  assert.equal(room.playback.playing, true);

  assert.ok(room.apply('speed', { speed: 0.75 }, host));
  assert.equal(room.playback.speed, 0.75);
  assert.ok(!room.apply('speed', { speed: 0 }, host));
  assert.ok(!room.apply('seek', { tick: 'x' }, host));
  assert.ok(!room.apply('bogus', {}, host));

  assert.ok(room.apply('range', { range: { startTick: 100, endTick: 50 } }, host) === false);
  assert.ok(room.apply('range', { range: { startTick: 100, endTick: 500 } }, host));
  assert.ok(room.apply('stop', {}, host));
  assert.equal(room.playback.tick, 100, 'stop rewinds to the range start');
});

test('a count-in reaches everyone else and holds the room at its start tick', () => {
  const room = new RoomStore().create();
  const host = fakeSocket(), listener = fakeSocket();
  room.join(host, true);
  room.join(listener, false);
  const before = host.sent.length;
  assert.ok(room.apply('countoff', { tick: 1920, beats: 4, beatMs: 500 }, host));
  assert.deepEqual(listener.last(), { type: 'countoff', tick: 1920, beats: 4, beatMs: 500 });
  assert.equal(host.sent.length, before);
  assert.equal(room.playback.playing, false);
  assert.equal(room.playback.tick, 1920);
  assert.ok(!room.apply('countoff', { tick: 0, beats: 0, beatMs: 500 }, host));
  assert.ok(!room.apply('countoff', { tick: 0, beats: 4, beatMs: 10 }, host));
  assert.ok(!room.apply('countoff', { beats: 4, beatMs: 500 }, host));
});

test('host api playback goes through the host page while it is open', () => {
  const room = new RoomStore().create();
  const host = fakeSocket(), listener = fakeSocket();
  room.join(host, true);
  room.join(listener, false);
  const heard = listener.sent.length;

  assert.ok(room.request('play', {}));
  assert.deepEqual(host.last(), { type: 'remote', action: 'play' });
  assert.equal(listener.sent.length, heard, 'listeners follow the host player, not the api call');
  assert.equal(room.playback.playing, false);

  assert.ok(room.request('seek', { tick: 960 }));
  assert.deepEqual(host.last(), { type: 'remote', action: 'seek', tick: 960 });
  assert.ok(room.request('speed', { speed: 0.8 }));
  assert.deepEqual(host.last(), { type: 'remote', action: 'speed', speed: 0.8 });
  assert.ok(!room.request('seek', {}));
  assert.ok(!room.request('speed', { speed: 9 }));
  assert.ok(!room.request('range', { range: { startTick: 5, endTick: 1 } }));

  // not playback: applied right away, as before
  assert.ok(room.request('cue', { text: 'outro' }));
  assert.equal(listener.last().type, 'cue');

  // no host page: the room is driven directly
  room.leave(host);
  assert.ok(room.request('play', { tick: 480 }));
  assert.equal(room.playback.playing, true);
  assert.deepEqual(listener.last(), { type: 'play', tick: 480 });
});

test('host leaving pauses everyone', () => {
  const room = new RoomStore().create();
  const host = fakeSocket(), listener = fakeSocket();
  room.join(host, true);
  room.join(listener, false);
  room.apply('play', { tick: 10 }, host);
  room.apply('position', { tick: 4000 }, host);
  room.leave(host);
  assert.equal(room.playback.playing, false);
  const pause = listener.sent.find(m => m.type === 'pause');
  assert.deepEqual(pause, { type: 'pause', tick: 4000 });
  assert.deepEqual(listener.last(), { type: 'peers', hostConnected: false, listeners: 1 });
});

test('new file resets playback and bumps the version', () => {
  const room = new RoomStore().create();
  const listener = fakeSocket();
  room.join(listener, false);
  room.apply('speed', { speed: 1.5 });
  room.loadAdHoc('AAAA', 'a.gp');
  assert.equal(room.file.version, 1);
  assert.equal(room.playback.speed, 1);
  room.loadAdHoc('BBBB', 'b.gp');
  assert.equal(listener.last().file.version, 2);
});

test('setlist goto / remove / move keep the current index right', () => {
  const room = new RoomStore().create();
  room.setSetlist([song(0), song(1), song(2), song(3)]);
  assert.ok(room.goto(2));
  assert.equal(room.file.name, 'song-2.gp');
  assert.ok(!room.goto(4));

  room.moveSong(2, 0); // current moves along
  assert.equal(room.setlistIndex, 0);
  room.moveSong(3, 0); // something jumps in front of current
  assert.equal(room.setlistIndex, 1);
  assert.equal(room.setlist[1].name, 'song-2.gp');
  room.removeSong(0);
  assert.equal(room.setlistIndex, 0);
  room.removeSong(0);
  assert.equal(room.setlistIndex, -1, 'removing the current song drops the marker');

  room.goto(0);
  room.loadAdHoc('CCCC', 'adhoc.gp');
  assert.equal(room.setlistIndex, -1, 'ad-hoc uploads leave the setlist');
  assert.equal(room.setlist.length, 2);
});

test('parseSong accepts both field spellings and rejects junk', () => {
  assert.deepEqual(parseSong({ fileData: 'QUJD', fileName: 'x.gp' }), {
    data: 'QUJD', name: 'x.gp', title: null, roles: null,
    notes: null, speed: null, countIn: null, autoNext: false, autoStart: false, gap: 5, transpose: null, groove: null, rig: null,
  });
  assert.equal(parseSong({ data: 'QUJD', title: '  live  ' }).title, 'live');
  assert.equal(parseSong({ data: '<script>' }), null);
  assert.equal(parseSong({}), null);
  assert.equal(parseSong(null), null);
});

test('sweep removes only long-empty rooms', () => {
  const store = new RoomStore();
  const idle = store.create();
  const busy = store.create();
  busy.join(fakeSocket(), false);
  store.sweep(Date.now() + ROOM_TTL_MS + 1);
  assert.equal(store.get(idle.id), undefined);
  assert.equal(store.get(busy.id), busy);
});

test('count-in is synced and survives song changes, song meta overrides it', () => {
  const room = new RoomStore().create();
  const listener = fakeSocket();
  room.join(listener, false);
  assert.ok(room.apply('countIn', { countIn: true }));
  assert.deepEqual(listener.last(), { type: 'countIn', countIn: true });
  room.loadAdHoc('AAAA', 'a.gp');
  assert.equal(room.playback.countIn, true);
  assert.equal(listener.last().type, 'file');
  assert.equal(listener.last().playback.countIn, true, 'file message carries the playback to start from');

  room.setSetlist([{ ...song(0), speed: 0.8, countIn: false }, song(1)]);
  room.goto(0);
  assert.equal(room.playback.speed, 0.8, 'per-song tempo applies on load');
  assert.equal(room.playback.countIn, false, 'per-song count-in wins');
  room.goto(1);
  assert.equal(room.playback.speed, 1);
});

test('song meta can be edited and is validated', () => {
  const { parseSong } = require('../server/rooms');
  const room = new RoomStore().create();
  room.setSetlist([parseSong({ data: 'QUJD', name: 'a.gp' })]);
  assert.equal(room.setlist[0].gap, 5);
  assert.ok(room.updateSong(0, { notes: ' capo 2 ', speed: 9, autoNext: true, gap: -3, title: 'opener' }));
  const s = room.setlistSummary().songs[0];
  assert.equal(s.notes, 'capo 2');
  assert.equal(s.speed, 2.5, 'speed is clamped');
  assert.equal(s.gap, 0);
  assert.equal(s.autoNext, true);
  assert.equal(s.title, 'opener');
  assert.equal(room.setlist[0].data, 'QUJD', 'the file stays');
  assert.ok(!room.updateSong(3, {}));
});

test('cues, countdowns and the show clock reach everyone', () => {
  const room = new RoomStore().create();
  const host = fakeSocket(), listener = fakeSocket();
  room.join(host, true);
  room.join(listener, false);
  assert.ok(room.apply('cue', { text: '2x chorus', seconds: 10 }, host));
  assert.equal(listener.last().cue.text, '2x chorus');
  assert.equal(host.last().type, 'cue', 'cues echo to the host too');
  const late = fakeSocket();
  room.join(late, false);
  assert.equal(late.sent[0].cue.text, '2x chorus', 'late joiners see the active cue');
  room.cue.at -= 11000;
  assert.equal(room.activeCue(), null, 'timed cues expire');

  assert.ok(room.apply('countdown', { seconds: 5, label: 'next: song b' }, host));
  assert.deepEqual(listener.last(), { type: 'countdown', seconds: 5, label: 'next: song b' });
  assert.ok(!room.apply('countdown', {}, host));

  assert.ok(room.apply('show', { action: 'start' }, host));
  assert.equal(listener.last().show, 0);
  assert.ok(room.apply('show', { action: 'reset' }, host));
  assert.equal(listener.last().show, null);
  assert.ok(!room.apply('show', { action: 'boom' }, host));
});

test('members report status and are batched to everyone', async () => {
  const room = new RoomStore().create();
  const host = fakeSocket(), listener = fakeSocket();
  room.join(host, true);
  room.join(listener, false);
  room.setStatus(listener, { name: '  Mia ', part: 'bass', ready: true, drift: 12, latency: 8, evil: '<x>' });
  room.setStatus(host, { name: 'Lo', part: 'nope' });
  await new Promise(r => setTimeout(r, 300));
  const msg = host.sent.filter(m => m.type === 'members').pop();
  assert.ok(msg, 'members are broadcast');
  const mia = msg.members.find(m => m.name === 'Mia');
  assert.deepEqual(mia, { id: listener.memberId, host: false, name: 'Mia', part: 'bass', ready: true, playing: false, drift: 12, latency: 8 });
  assert.equal(msg.members.find(m => m.host).part, null, 'unknown parts are dropped');
});

test('grooves are validated, synced and can come with a setlist song', () => {
  const { parseGroove } = require('../server/rooms');
  const room = new RoomStore().create();
  const host = fakeSocket(), listener = fakeSocket();
  room.join(host, true);
  room.join(listener, false);

  const rock = { name: 'rock', kit: 1, swing: 0, rows: ['X.......x.x.....', '....X.......X...'] };
  assert.ok(room.apply('groove', { groove: rock }, host));
  const sent = listener.last();
  assert.equal(sent.type, 'groove');
  assert.equal(sent.groove.rows.length, 8, 'missing rows are filled with rests');
  assert.equal(sent.groove.rows[7], '................');
  assert.equal(sent.groove.on, true);
  assert.equal(host.last().type, 'groove', 'the host hears its own groove change too');
  assert.ok(!room.apply('groove', { groove: { name: 'x' } }, host), 'no rows, no groove');
  assert.equal(parseGroove({ rows: ['ab<script>'], kit: 9, swing: 500 }).rows[0], '................');
  assert.equal(parseGroove({ rows: [], kit: 9, swing: 500 }).kit, 0);
  assert.equal(parseGroove({ rows: [], swing: 500 }).swing, 100);

  const late = fakeSocket();
  room.join(late, false);
  assert.equal(late.sent[0].groove.name, 'rock', 'late joiners get the groove');

  room.setSetlist([{ ...song(0), groove: parseGroove({ name: 'shuffle', rows: ['X.....x.X.....x.'], swing: 70 }) }, { ...song(1), groove: null }]);
  room.goto(0);
  assert.equal(room.groove.name, 'shuffle', 'a song brings its groove');
  room.goto(1);
  assert.equal(room.groove.name, 'shuffle', 'a song without one keeps the groove running');
  assert.ok(room.apply('groove', { groove: null }, host));
  assert.equal(room.groove, null);
});

test('transpose is synced, carries over to the next song and can be set per song', () => {
  const room = new RoomStore().create();
  const host = fakeSocket(), listener = fakeSocket();
  room.join(host, true);
  room.join(listener, false);
  assert.equal(room.playback.transpose, 0);
  assert.ok(room.apply('transpose', { transpose: -2 }, host));
  assert.deepEqual(listener.last(), { type: 'transpose', transpose: -2 });
  assert.ok(!room.apply('transpose', { transpose: 1.5 }, host));
  assert.ok(!room.apply('transpose', { transpose: 13 }, host));

  room.loadAdHoc('AAAA', 'next.gp');
  assert.equal(room.playback.transpose, -2, 'a tuned-down band stays tuned down');

  const { parseSong } = require('../server/rooms');
  room.setSetlist([parseSong({ data: 'QUJD', name: 'a.gp', transpose: 3 }), parseSong({ data: 'QUJD', name: 'b.gp' })]);
  room.goto(0);
  assert.equal(room.playback.transpose, 3, 'a song can bring its own');
  room.goto(1);
  assert.equal(room.playback.transpose, 3, 'without one the current stays');
  const summary = room.setlistSummary().songs;
  assert.equal(summary[0].transpose, 3);
  assert.equal(summary[1].transpose, null);
  assert.ok('groove' in summary[0], 'the summary carries song grooves too');
});
