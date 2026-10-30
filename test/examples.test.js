const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('path');
const { RoomStore } = require('../server/rooms');
const { loadExamples, describeExample, startExample } = require('../server/examples');

const examples = loadExamples(path.join(__dirname, '..', 'example'));
// the public repository comes without the example tab files — these tests need them
const NO_EXAMPLES = !examples.has('wts') && 'the example tab files are not part of the public repository';

test('S/CAPE is found with the running order of s.geyser.at', { skip: NO_EXAMPLES }, () => {
  const wts = examples.get('wts');
  assert.ok(wts, 'example/wts/show.json loads');
  const d = describeExample(wts);
  assert.equal(d.name, 'S/CAPE · Watch Them Slaughter');
  assert.deepEqual(d.songs.map(s => s.title), [
    'Caraphernelia', 'Still Into You', 'Break Stuff', 'Going Under', 'Smells Like Teen Spirit',
    'Pretty Fly (for a White Guy)', 'Creep', 'Famous Last Words', 'Perfekte Welle',
  ]);
  assert.ok(d.songs.every(s => /^Katana /.test(s.rig.guitar)), 'every song names the guitar amp preset');
  assert.ok(d.songs.every(s => s.roles && s.roles.guitar && s.roles.bass), 'tunings come from the files');
  assert.ok(d.songs.every(s => !s.notes), 'no prose — only what changes for a role');
  assert.deepEqual(d.rig.map(r => r.name), ['Clean', 'Crunch', 'Brown', 'Lead']);
  assert.equal(d.source, 'https://s.geyser.at');
  assert.ok(!('data' in d.songs[0]), 'the listing carries no file data');
});

test('starting it gives a ready session: setlist, opener loaded, count-in', { skip: NO_EXAMPLES }, () => {
  const store = new RoomStore();
  const room = startExample(store, examples.get('wts'));
  assert.equal(store.get(room.id), room);
  assert.equal(room.setlistIndex, 0);
  assert.equal(room.file.name, 'Pierce The Veil-Caraphernelia.gp');
  assert.ok(room.file.data.length > 1000);
  assert.equal(room.playback.countIn, true);
  const songs = room.setlistSummary().songs;
  assert.ok(songs.every(s => !s.autoNext && !s.autoStart), 'the band talks between songs — no auto-advance');
  assert.deepEqual(songs[3].roles.guitar.tuning, [61, 56, 52, 47, 42, 35], 'going under: drop b, read from the file');
  assert.equal(songs[3].roles.bass.strings, 5);
});

test('each start is its own session', { skip: NO_EXAMPLES }, () => {
  const store = new RoomStore();
  const a = startExample(store, examples.get('wts'));
  const b = startExample(store, examples.get('wts'));
  assert.notEqual(a.id, b.id);
  a.goto(3);
  assert.equal(b.setlistIndex, 0);
});

test('unsafe source links are dropped', { skip: NO_EXAMPLES }, () => {
  const fs = require('fs'), os = require('os');
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'tabs-ex-'));
  fs.mkdirSync(path.join(dir, 'x'));
  fs.copyFileSync(path.join(__dirname, '..', 'example', 'wts', 'Radiohead-Creep.gp'), path.join(dir, 'x', 'a.gp'));
  fs.writeFileSync(path.join(dir, 'x', 'show.json'), JSON.stringify({ name: 'x', source: 'javascript:alert(1)', songs: [{ file: 'a.gp' }, { file: '../../etc/passwd' }] }));
  const ex = loadExamples(dir).get('x');
  assert.equal(ex.source, '');
  assert.equal(ex.songs.length, 1, 'files outside the folder are ignored');
  fs.rmSync(dir, { recursive: true, force: true });
});
