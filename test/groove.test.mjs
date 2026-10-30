import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import ts from 'typescript';

// transpile lib/groove.ts and the beats files it imports into a temp folder of .mjs modules
const root = new URL('../lib/', import.meta.url);
const out = fs.mkdtempSync(path.join(os.tmpdir(), 'tabs-groove-'));
for (const file of ['groove.ts', 'beats/kits.ts', 'beats/patterns.ts']) {
  const src = fs.readFileSync(new URL(file, root), 'utf8');
  const js = ts.transpileModule(src, { compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 } }).outputText
    .replace(/from '(\.{1,2}\/[^']+)'/g, "from '$1.mjs'");
  const dest = path.join(out, file.replace(/\.ts$/, '.mjs'));
  fs.mkdirSync(path.dirname(dest), { recursive: true });
  fs.writeFileSync(dest, js);
}
const { decodeBeatsLink, encodeBeatsLink, grooveMatrix, GROOVES } = await import(`file://${path.join(out, 'groove.mjs').replace(/\\/g, '/')}`);
test.after(() => fs.rmSync(out, { recursive: true, force: true }));

// exactly what beats' encodeShare() produces (app/page.tsx in mo-tion/Beats)
function beatsLink(state) {
  const compact = {
    b: state.bpm, w: state.swing, v: 0.8, k: state.kit, s: state.slot,
    p: state.patterns.map(p => p.map(r => r.join('')).join('.')),
    t: state.tracks.map(t => [t.gain, t.pan, t.tune, t.decay, +t.mute, +t.solo]),
  };
  return 'http://localhost:3001/#s=' + Buffer.from(JSON.stringify(compact)).toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

const empty = () => Array.from({ length: 8 }, () => Array(16).fill(0));

test('a beats share link becomes the groove of its active pattern slot', () => {
  const b = empty();
  b[0][0] = 2; b[0][8] = 1; b[1][4] = 1; b[1][12] = 2; b[3] = b[3].map((_, i) => (i % 2 ? 0 : 1));
  const patterns = [empty(), b, empty(), empty()];
  const tracks = Array.from({ length: 8 }, (_, i) => ({ gain: 0.5, pan: i === 3 ? -1 : 0, tune: 0, decay: 1, mute: false, solo: false }));
  const g = decodeBeatsLink(beatsLink({ bpm: 120, swing: 40, kit: 2, slot: 1, patterns, tracks }));
  assert.ok(g);
  assert.equal(g.kit, 2);
  assert.equal(g.swing, 40);
  assert.equal(g.name, 'beats · pattern b');
  assert.equal(g.rows[0], 'X.......x.......');
  assert.equal(g.rows[1], '....x.......X...');
  assert.equal(g.rows[3], 'x.x.x.x.x.x.x.x.');
  assert.deepEqual(g.mix[3], [0.5, -1, 0, 1, 0, 0]);
  assert.deepEqual(grooveMatrix(g.rows)[0].slice(0, 9), [2, 0, 0, 0, 0, 0, 0, 0, 1]);
});

test('a link with several patterns keeps them all for live switching, and goes back to beats', () => {
  const a = empty(); a[0][0] = 2;
  const c = empty(); c[1][4] = 1;
  const g = decodeBeatsLink(beatsLink({ bpm: 98, swing: 0, kit: 1, slot: 2, patterns: [a, empty(), c, empty()], tracks: [] }));
  assert.ok(g);
  assert.equal(g.slots.length, 2, 'empty slots are left out');
  assert.equal(g.slot, 1, 'slot c is the second pattern kept');
  assert.equal(g.rows[1], '....x...........');
  assert.equal(g.bpm, 98);
  const back = decodeBeatsLink(encodeBeatsLink('https://beats.example', g));
  assert.deepEqual(back.slots, g.slots);
  assert.equal(back.slot, g.slot);
  assert.equal(back.kit, 1);
  assert.equal(back.bpm, 98);
});

test('the bare code works too, junk and empty patterns do not', () => {
  const p = empty(); p[0][0] = 1;
  const link = beatsLink({ bpm: 100, swing: 0, kit: 0, slot: 0, patterns: [p], tracks: [] });
  assert.ok(decodeBeatsLink(link.split('#s=')[1]));
  assert.equal(decodeBeatsLink('hello'), null);
  assert.equal(decodeBeatsLink(beatsLink({ bpm: 100, swing: 0, kit: 0, slot: 0, patterns: [empty()], tracks: [] })), null);
});

test('every built-in groove is a full 8 × 16 pattern', () => {
  assert.ok(GROOVES.length >= 15);
  for (const g of GROOVES) {
    assert.equal(g.rows.length, 8, g.name);
    for (const r of g.rows) assert.match(r, /^[Xx.]{16}$/, `${g.name}: ${r}`);
    assert.ok(g.rows.some(r => /[Xx]/.test(r)), g.name);
  }
});
