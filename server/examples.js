const fs = require('fs');
const path = require('path');
const { parseSong } = require('./rooms');

/**
 * Example shows: every folder in example/ with a show.json becomes a
 * ready-to-play session — songs in order, with the per-song live settings
 * (notes, count-in, tempo, auto-advance, groove) from the manifest.
 *
 * show.json: { id?, name, subtitle?, date?, description?, source?, sourceLabel?, rig?: [{ name, text }], countIn?, songs: [{ file, title?, notes?, speed?,
 *              countIn?, autoNext?, autoStart?, gap?, groove? }] }
 *
 * Files are read once at startup and kept as base64, like uploaded songs.
 */
function loadExamples(dir) {
  const shows = new Map();
  let folders = [];
  try { folders = fs.readdirSync(dir, { withFileTypes: true }).filter(d => d.isDirectory()); } catch { return shows; }

  for (const folder of folders) {
    const base = path.join(dir, folder.name);
    const manifest = path.join(base, 'show.json');
    if (!fs.existsSync(manifest)) continue;
    try {
      const raw = JSON.parse(fs.readFileSync(manifest, 'utf8'));
      const songs = [];
      for (const entry of raw.songs ?? []) {
        const file = path.join(base, String(entry.file ?? ''));
        // only files inside the example folder
        if (!entry.file || path.relative(base, file).startsWith('..') || !fs.existsSync(file)) {
          console.warn(`example ${folder.name}: missing ${entry.file}`);
          continue;
        }
        const song = parseSong({ ...entry, data: fs.readFileSync(file).toString('base64'), name: path.basename(file) });
        if (song) songs.push(song);
      }
      if (!songs.length) continue;
      const id = String(raw.id || folder.name).toLowerCase().replace(/[^a-z0-9-]/g, '-');
      shows.set(id, {
        id,
        name: String(raw.name || folder.name).slice(0, 80),
        description: text(raw.description, 600),
        subtitle: text(raw.subtitle, 200),
        date: text(raw.date, 80),
        // only http(s) links make it to the page
        source: typeof raw.source === 'string' && /^https?:\/\//.test(raw.source) ? raw.source.slice(0, 200) : '',
        // what the link says on the page — the address itself is never shown
        sourceLabel: text(raw.sourceLabel, 60),
        rig: Array.isArray(raw.rig) ? raw.rig.slice(0, 8).map(r => ({ name: text(r && r.name, 40), text: text(r && r.text, 160) })).filter(r => r.name) : [],
        countIn: !!raw.countIn,
        songs,
      });
    } catch (err) {
      console.warn(`example ${folder.name}: ${err.message}`);
    }
  }
  return shows;
}

/** what the landing page lists — no file data */
function describeExample(show) {
  return {
    id: show.id,
    name: show.name,
    description: show.description,
    subtitle: show.subtitle,
    date: show.date,
    source: show.source,
    sourceLabel: show.sourceLabel,
    rig: show.rig,
    songs: show.songs.map(s => ({
      title: s.title || s.name.replace(/\.[^.]+$/, ''),
      // files are named "Artist-Title.gp"
      artist: s.name.includes('-') ? s.name.slice(0, s.name.indexOf('-')).trim() : null,
      notes: s.notes,
      roles: s.roles,
      rig: s.rig,
      transpose: s.transpose,
    })),
  };
}

/** a fresh room with the show's setlist, its first song loaded */
function startExample(store, show) {
  const room = store.create();
  if (show.countIn) room.apply('countIn', { countIn: true });
  room.setSetlist(show.songs.map(s => ({ ...s })));
  room.goto(0);
  return room;
}

const text = (v, max) => (typeof v === 'string' ? v.trim().slice(0, max) : '');

module.exports = { loadExamples, describeExample, startExample };
