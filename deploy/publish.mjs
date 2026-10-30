// The open-source copies: github.com/moon-int/tabs, /beats, /time — MIT, a history of their own.
//
//   node deploy/publish.mjs            copy the current commit of Tabs, Beats and Time over, one commit each
//   node deploy/publish.mjs --dry      show what would go over, push nothing
//
// The private repositories (mo-tion-interactive/…) stay as they are — the NUC and vercel build from them.
// Only what is committed goes over (git archive), never the working folder: no .env, no data, no builds.
// Left out on top: the example tab files (commercial songs, not ours to publish).
// Needs the github cli (gh), signed in with rights on moon-int.

import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const parent = path.resolve(here, '..', '..');
const dry = process.argv.includes('--dry');
const ORG = 'moon-int';

const REPOS = [
  {
    dir: 'Tabs', name: 'tabs', leaveOut: ['example'],
    description: 'play guitar pro & musicxml tabs together, in sync — notation, playback, click, your own mix, setlists',
  },
  { dir: 'Beats', name: 'beats', leaveOut: [], description: 'a one-page drum machine — every sound synthesized live with web audio' },
  { dir: 'Time', name: 'time', leaveOut: [], description: 'a full-screen event clock with a live run-of-show and timed http cues' },
];

const run = (cmd, args, opts = {}) => execFileSync(cmd, args, { stdio: ['ignore', 'pipe', 'pipe'], ...opts }).toString().trim();
const git = (cwd, ...args) => run('git', args, { cwd });
const say = text => console.log(text);

function ensureRepo(r) {
  try {
    run('gh', ['repo', 'view', `${ORG}/${r.name}`, '--json', 'name']);
    return false;
  } catch {
    if (dry) { say(`  would create ${ORG}/${r.name} (public)`); return true; }
    run('gh', ['repo', 'create', `${ORG}/${r.name}`, '--public', '--description', r.description, '--homepage', `https://${r.name}.mo-tion.at`]);
    say(`  created ${ORG}/${r.name} (public)`);
    return true;
  }
}

for (const r of REPOS) {
  const src = path.join(parent, r.dir);
  say(`\n${r.dir} → ${ORG}/${r.name}`);
  if (git(src, 'status', '--porcelain')) throw new Error(`${r.dir} has uncommitted changes — commit them first (only commits go over)`);
  const head = git(src, 'rev-parse', '--short', 'HEAD');
  const fresh = ensureRepo(r);

  const work = fs.mkdtempSync(path.join(os.tmpdir(), `publish-${r.name}-`));
  try {
    if (fresh) {
      git(work, 'init', '-q', '-b', 'main');
      git(work, 'remote', 'add', 'origin', `https://github.com/${ORG}/${r.name}.git`);
    } else {
      run('git', ['clone', '-q', `https://github.com/${ORG}/${r.name}.git`, work]);
    }
    // the public copy is exactly the private commit, minus what is left out
    for (const entry of fs.readdirSync(work)) if (entry !== '.git') fs.rmSync(path.join(work, entry), { recursive: true, force: true });
    // the committed state, through a local clone — never the working folder
    const snap = fs.mkdtempSync(path.join(os.tmpdir(), `publish-${r.name}-${head}-`));
    run('git', ['clone', '-q', '--depth', '1', `file://${src.replace(/\\/g, '/')}`, snap]);
    for (const entry of fs.readdirSync(snap)) if (entry !== '.git') fs.cpSync(path.join(snap, entry), path.join(work, entry), { recursive: true });
    fs.rmSync(snap, { recursive: true, force: true });
    for (const p of r.leaveOut) fs.rmSync(path.join(work, p), { recursive: true, force: true });

    git(work, 'add', '-A');
    const changes = git(work, 'status', '--porcelain');
    if (!changes) { say('  nothing new'); continue; }
    say(`  ${changes.split('\n').length} files${r.leaveOut.length ? ` (left out: ${r.leaveOut.join(', ')})` : ''}`);
    if (dry) continue;
    const message = fresh
      ? `${r.name} — open source (MIT), from mo-tion interactive\n\nlive: https://${r.name}.mo-tion.at\n\nCo-Authored-By: Claude Opus 5.5 (1M context) <noreply@anthropic.com>`
      : `update from mo-tion interactive (${head})`;
    git(work, 'commit', '-q', '-m', message);
    git(work, 'push', '-q', '-u', 'origin', 'main');
    say(`  pushed — https://github.com/${ORG}/${r.name}`);
  } finally {
    fs.rmSync(work, { recursive: true, force: true });
  }
}
