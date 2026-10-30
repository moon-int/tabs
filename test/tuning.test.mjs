import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import ts from 'typescript';
import * as at from '@coderline/alphatab';

// lib/tuning.ts is typescript; transpile it on the fly so the tests run on plain node
const src = fs.readFileSync(new URL('../lib/tuning.ts', import.meta.url), 'utf8');
const js = ts.transpileModule(src, { compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 } }).outputText;
const tmp = path.join(os.tmpdir(), `tabs-tuning-${process.pid}.mjs`);
fs.writeFileSync(tmp, js);
const { retuneTrack, parseTuning, describeTuning, tuningLabel, TUNINGS, originalTuning } = await import(`file://${tmp.replace(/\\/g, '/')}`);
test.after(() => fs.rmSync(tmp, { force: true }));

const tex = String.raw`\title "t"
.
\track "Gtr"
0.6.4 3.6.4 5.5.4 (0.6 2.5 2.4).4 | 7.6.2 5.1.2`;

const load = () => at.importer.ScoreLoader.loadAlphaTex(tex, new at.Settings());
const pitches = score => {
  const staff = score.tracks[0].staves[0];
  const t = staff.stringTuning.tunings;
  return staff.bars.flatMap(b => b.voices[0].beats.flatMap(bt => bt.notes.map(n => t[t.length - n.string] + n.fret)));
};
const notes = score => score.tracks[0].staves[0].bars.flatMap(b => b.voices[0].beats.flatMap(bt => bt.notes.map(n => `${n.string}:${n.fret}`)));
const preset = id => TUNINGS[6].find(p => p.id === id).tunings;

test('re-fretting keeps every pitch', () => {
  const score = load();
  const before = pitches(score);
  for (const id of ['eb', 'dropd', 'dadgad', 'openg', 'c']) {
    assert.equal(retuneTrack(score, 0, preset(id)), 0, `${id} fits on the neck`);
    assert.deepEqual(pitches(score), before, `${id} sounds the same`);
  }
});

test('half step down moves every fret up by one', () => {
  const score = load();
  const before = notes(score);
  retuneTrack(score, 0, preset('eb'));
  assert.deepEqual(notes(score), before.map(s => { const [str, f] = s.split(':').map(Number); return `${str}:${f + 1}`; }));
});

test('drop d only touches the low string', () => {
  const score = load();
  retuneTrack(score, 0, preset('dropd'));
  const n = notes(score);
  assert.equal(n[0], '1:2', 'open low e becomes fret 2 in drop d');
  assert.ok(n.includes('5:2') || n.includes('2:2'), 'other strings unchanged');
});

test('notes below the lowest string are reported, the rest keep their pitch', () => {
  const score = load();
  // f standard (everything a semitone up): the two open low e's can't be played anymore
  const before = pitches(score);
  assert.equal(retuneTrack(score, 0, preset('e').map(x => x + 1)), 2);
  const after = pitches(score);
  assert.equal(after.filter((p, i) => p !== before[i]).length, 2);
});

test('open notes on a higher string move to a lower one', () => {
  const score = load();
  const before = pitches(score);
  // raise only the b string a semitone: the open-ish notes there shift to the g string if needed
  const t = preset('e').slice(); t[1] += 3; // b → d
  assert.equal(retuneTrack(score, 0, t), 0);
  assert.deepEqual(pitches(score), before);
});

test('back to the original restores frets, tuning and name', () => {
  const score = load();
  const staff = score.tracks[0].staves[0];
  const name = staff.stringTuning.name;
  const before = notes(score);
  retuneTrack(score, 0, preset('dadgad'));
  assert.equal(staff.stringTuning.name, 'dadgad');
  retuneTrack(score, 0, null);
  assert.deepEqual(notes(score), before);
  assert.deepEqual(staff.stringTuning.tunings, preset('e'));
  assert.equal(staff.stringTuning.name, name);
  assert.deepEqual(originalTuning(staff), preset('e'));
});

test('parsing and naming tunings', () => {
  const std = preset('e');
  assert.deepEqual(parseTuning('D A D G B E', std), preset('dropd'));
  assert.deepEqual(parseTuning('dadgad', std), preset('dadgad'));
  assert.deepEqual(parseTuning('Eb Ab Db Gb Bb Eb', std), preset('eb'));
  assert.equal(parseTuning('d a d', std), null, 'wrong string count');
  assert.equal(describeTuning(preset('openg')), 'd g d g b d');
  assert.equal(tuningLabel(preset('dropd')), 'drop d');
  assert.equal(tuningLabel([64, 59, 55, 50, 45, 41]), 'f a d g b e');
});

test('shifting the song keeps every fret and moves every pitch', () => {
  const score = load();
  const staff = score.tracks[0].staves[0];
  const frets = notes(score), before = pitches(score);
  for (const shift of [-2, -1, 3, 0]) {
    assert.equal(retuneTrack(score, 0, null, shift), 0);
    assert.deepEqual(notes(score), frets, `shift ${shift}: the tab stays`);
    assert.deepEqual(pitches(score), before.map(p => p + shift), `shift ${shift}: the song moves`);
  }
  retuneTrack(score, 0, null, -2);
  assert.equal(staff.stringTuning.name, 'whole step down (d)');
  retuneTrack(score, 0, null, 0);
  assert.deepEqual(staff.stringTuning.tunings, preset('e'));
});

test('a shift and my own tuning combine: shifted pitches, frets for my guitar', () => {
  const score = load();
  const before = pitches(score);
  // song a whole step down, my guitar in drop d
  assert.equal(retuneTrack(score, 0, preset('dropd'), -2), 0);
  assert.deepEqual(pitches(score), before.map(p => p - 2));
  assert.deepEqual(score.tracks[0].staves[0].stringTuning.tunings, preset('dropd'));
});
