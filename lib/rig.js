// Shared by the server (server/rig.js, alphaTab in node) and the browser's solo sessions
// (lib/local.ts, the page's alphaTab). Plain CommonJS on purpose: node requires it as is.
const { detectPart } = require('./parts');

/**
 * What each stringed role (guitar, bass) has to be tuned to for a song —
 * read straight from the tab file, so a setlist knows its changeovers
 * without anyone typing them in.
 *
 * A file often carries several tracks per role in different tunings (an
 * eb standard rhythm part next to drop c# overdubs, or two versions of the
 * same riff). The role's tuning is:
 *   1. a track that names its tuning ("Guitar (Drop B version)") — the
 *      arranger says which version to play;
 *   2. otherwise the lowest tuning that covers all of the role's real parts
 *      (string by string), so every part of the song can be played on it.
 * Tracks with less than 5 % of the main track's notes (a feedback track, a
 * few harmonics) don't count.
 */

const ROLES = ['guitar', 'bass'];
const NAMES_A_TUNING = /\b(drop\s*[a-g](#|b)?|[a-g](#|b)?\s*standard|half[\s-]*step|whole[\s-]*step|open\s*[a-g]|dadgad)\b/i;

function noteCount(track) {
  let n = 0;
  for (const staff of track.staves) for (const bar of staff.bars) for (const voice of bar.voices) for (const beat of voice.beats) n += beat.notes.length;
  return n;
}

/** { guitar: { strings, tuning }, bass: { strings, tuning } } — tuning: midi notes, highest string first */
function rolesOfScore(score) {
  const roles = {};
  const tracks = score.tracks
    .filter(t => !t.isPercussion && t.staves[0] && t.staves[0].isStringed)
    .map(t => ({ name: t.name || '', part: detectPart(t.name || '', t.playbackInfo ? t.playbackInfo.program : 0, t.isPercussion), tuning: t.staves[0].stringTuning.tunings.slice(), notes: noteCount(t) }));

  for (const role of ROLES) {
    const mine = tracks.filter(t => t.part === role && t.notes > 0);
    if (!mine.length) continue;
    const named = mine.filter(t => NAMES_A_TUNING.test(t.name)).sort((a, b) => b.notes - a.notes)[0];
    if (named) {
      roles[role] = { strings: named.tuning.length, tuning: named.tuning };
      continue;
    }
    const main = mine.slice().sort((a, b) => b.notes - a.notes)[0];
    const parts = mine.filter(t => t.tuning.length === main.tuning.length && t.notes >= main.notes * 0.05);
    const tuning = main.tuning.map((_, i) => Math.min(...parts.map(t => t.tuning[i])));
    roles[role] = { strings: tuning.length, tuning };
  }
  return roles;
}

/** reads a tab file with the given alphaTab module; null if alphaTab can't make sense of it */
function analyzeBytes(lib, bytes) {
  try {
    const settings = new lib.Settings();
    settings.core.logLevel = lib.LogLevel.None;
    lib.Logger.logLevel = lib.LogLevel.None;
    return rolesOfScore(lib.importer.ScoreLoader.loadScoreFromBytes(bytes, settings));
  } catch {
    return null;
  }
}

/** title, artist, track names and each role's tuning of a tab file — null if alphaTab can't read it */
function describeBytes(lib, bytes) {
  try {
    const settings = new lib.Settings();
    settings.core.logLevel = lib.LogLevel.None;
    lib.Logger.logLevel = lib.LogLevel.None;
    const score = lib.importer.ScoreLoader.loadScoreFromBytes(bytes, settings);
    return {
      title: (score.title || '').trim(),
      artist: (score.artist || '').trim(),
      tempo: score.tempo > 0 ? Math.round(score.tempo) : null,
      bars: score.masterBars.length,
      tracks: score.tracks.map((t, i) => (t.name || '').trim() || `track ${i + 1}`),
      roles: rolesOfScore(score),
    };
  } catch {
    return null;
  }
}

module.exports = { analyzeBytes, describeBytes, rolesOfScore };
