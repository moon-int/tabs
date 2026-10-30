import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createRequire } from 'node:module';
import ts from 'typescript';

const require = createRequire(import.meta.url);
const { analyzeSong } = require('../server/rig.js');

// transpile lib/changeover.ts + lib/tuning.ts into a temp folder of .mjs modules
const root = new URL('../lib/', import.meta.url);
const out = fs.mkdtempSync(path.join(os.tmpdir(), 'tabs-changeover-'));
for (const file of ['changeover.ts', 'tuning.ts']) {
  const js = ts.transpileModule(fs.readFileSync(new URL(file, root), 'utf8'), { compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 } }).outputText
    .replace(/from '(\.{1,2}\/[^']+)'/g, "from '$1.mjs'");
  fs.writeFileSync(path.join(out, file.replace(/\.ts$/, '.mjs')), js);
}
const { changeovers, describeChange, setupOf, forRole } = await import(`file://${path.join(out, 'changeover.mjs').replace(/\\/g, '/')}`);
test.after(() => fs.rmSync(out, { recursive: true, force: true }));

const dir = new URL('../example/wts/', import.meta.url);
// the public repository comes without the example tab files — these tests need them
const NO_EXAMPLES = !fs.existsSync(new URL('show.json', dir)) && 'the example tab files are not part of the public repository';
const show = NO_EXAMPLES ? { songs: [] } : JSON.parse(fs.readFileSync(new URL('show.json', dir), 'utf8'));
const songs = show.songs.map(s => ({ title: s.title, rig: s.rig, roles: analyzeSong(fs.readFileSync(new URL(s.file, dir)).toString('base64')) }));

test('each role\'s tuning comes out of the tab files like on s.geyser.at', { skip: NO_EXAMPLES }, () => {
  const guitar = songs.map(s => setupOf(s).find(x => x.role === 'guitar').tuning);
  assert.deepEqual(guitar, ['drop c#', 'drop c#', 'drop c#', 'drop b', 'standard (e)', 'standard (e)', 'standard (e)', 'standard (e)', 'standard (e)']);
  const bass = songs.map(s => setupOf(s).find(x => x.role === 'bass').tuning);
  assert.equal(bass[0], 'drop c#');
  assert.equal(bass[3], '5-string standard (b)', 'going under needs the 5-string');
  assert.equal(bass[4], 'standard (e)');
});

test('changeovers appear exactly where the set retunes', { skip: NO_EXAMPLES }, () => {
  const steps = songs.slice(1).map((s, i) => changeovers(songs[i], s).filter(c => c.tuning).map(describeChange));
  assert.deepEqual(steps[0], [], 'caraphernelia → still into you: same tuning');
  assert.deepEqual(steps[2], ['guitar: drop c# → drop b · Katana Brown/Lead', 'bass: drop c# → 5-string standard (b)'], 'break stuff → going under');
  assert.deepEqual(steps[3], ['guitar: drop b → standard (e) · Katana Clean/Crunch', 'bass: 5-string standard (b) → standard (e)'], 'going under → teen spirit');
  assert.deepEqual(steps.slice(4).flat(), [], 'the standard e block needs nothing');
});

test('rig changes for a role show up too, and my role comes first', { skip: NO_EXAMPLES }, () => {
  const c = changeovers(songs[0], songs[1]);
  assert.deepEqual(c.map(describeChange), ['guitar: Katana Crunch']);
  const goingUnder = changeovers(songs[2], songs[3]);
  assert.equal(describeChange(goingUnder[0]), 'guitar: drop c# → drop b · Katana Brown/Lead');
  assert.deepEqual(forRole(goingUnder, 'bass').map(x => x.role), ['bass', 'guitar']);
});

test('transposing a song moves its tunings', { skip: NO_EXAMPLES }, () => {
  const lower = { ...songs[4], transpose: -2 };
  assert.equal(setupOf(lower).find(x => x.role === 'guitar').tuning, 'whole step down (d)');
});
