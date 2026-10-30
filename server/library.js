const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { describeSong } = require('./rig');
const { songMeta, parseGroove } = require('../lib/room');

/**
 * The library: every tab file someone signed in has used, and the sets (shows) built from them.
 * Lives on the server's disk (TABS_DATA, default ./data), unlike sessions:
 *
 *   data/tabs.json        { version, tabs: [Tab], sets: [Set] }
 *   data/files/<sha256>   the files themselves, each stored once however often it is used
 *
 * Everyone sees and manages their own tabs and sets; admins see everyone's. On the open lan server
 * (no sign-in) there is one shared library.
 */

const MAX_TABS = 5000;
const MAX_SETS = 500;
const MAX_SET_SONGS = 100;
const EXT = /\.(gp|gp3|gp4|gp5|gpx|musicxml|mxl|xml|capx|tex|atex)$/i;

const str = (v, max) => (typeof v === 'string' ? v.trim().slice(0, max) : '');
const newId = () => crypto.randomBytes(9).toString('base64url');
/** owner of what the server itself brings along — every host sees it, admins manage it */
const SHARED = '*';

class Library {
  constructor(dir) {
    this.dir = dir;
    this.files = path.join(dir, 'files');
    this.dbFile = path.join(dir, 'tabs.json');
    this.db = { version: 1, tabs: [], sets: [], seeded: [] };
    this.saving = null;
    this.dirty = false;
  }

  load() {
    fs.mkdirSync(this.files, { recursive: true });
    try {
      const raw = JSON.parse(fs.readFileSync(this.dbFile, 'utf8'));
      this.db = {
        version: 1,
        tabs: Array.isArray(raw.tabs) ? raw.tabs : [],
        sets: Array.isArray(raw.sets) ? raw.sets : [],
        seeded: Array.isArray(raw.seeded) ? raw.seeded : [],
      };
    } catch (err) {
      if (err.code !== 'ENOENT') {
        // never overwrite a library we couldn't read — keep it aside and start empty
        const aside = `${this.dbFile}.unreadable-${Date.now()}`;
        try { fs.renameSync(this.dbFile, aside); } catch {}
        console.warn(`library: could not read ${this.dbFile} (${err.message}) — kept as ${path.basename(aside)}`);
      }
    }
    return this;
  }

  /** write-behind: a burst of changes becomes one write, always to a temp file first */
  save() {
    this.dirty = true;
    if (this.saving) return this.saving;
    this.saving = new Promise(resolve => setTimeout(resolve, 50)).then(async () => {
      while (this.dirty) {
        this.dirty = false;
        const tmp = `${this.dbFile}.tmp`;
        await fs.promises.writeFile(tmp, JSON.stringify(this.db, null, 1));
        await fs.promises.rename(tmp, this.dbFile);
      }
    }).catch(err => console.error('library: save failed', err)).finally(() => { this.saving = null; });
    return this.saving;
  }

  flush() {
    if (!this.dirty && !this.saving) return;
    const tmp = `${this.dbFile}.tmp`;
    fs.writeFileSync(tmp, JSON.stringify(this.db, null, 1));
    fs.renameSync(tmp, this.dbFile);
    this.dirty = false;
  }

  // ---- who sees what -------------------------------------------------------------------

  static owner(user) { return user ? user.id : 'local'; }
  /** shared items (the shows the server brings along) are there for every host to play */
  static sees(user, item, open) { return open || !user || user.admin || item.owner === user.id || item.owner === SHARED; }
  /** … but only their owner — and admins — change or delete anything */
  static edits(user, item, open) { return open || !user || user.admin || item.owner === user.id; }

  /** your items — everyone's for an admin who asks for all; the open lan server has one shared library */
  visible(list, user, open, all) {
    if (open || !user) return list;
    if (all && user.admin) return list;
    return list.filter(x => x.owner === user.id || x.owner === SHARED);
  }

  // ---- tabs ------------------------------------------------------------------------------

  /** adds a tab file (base64) for `user`; the same file twice gives the existing entry back */
  addTab(user, { data, name }, ownerOverride) {
    if (typeof data !== 'string' || !data) throw httpError(400, 'data (base64 string) is required');
    const bytes = Buffer.from(data, 'base64');
    if (!bytes.length) throw httpError(400, 'empty file');
    const hash = crypto.createHash('sha256').update(bytes).digest('hex');
    const owner = ownerOverride || Library.owner(user);
    const existing = this.db.tabs.find(t => t.owner === owner && t.hash === hash);
    if (existing) return existing;
    if (this.db.tabs.length >= MAX_TABS) throw httpError(409, 'library_full');

    const info = describeSong(bytes);
    if (!info) throw httpError(400, 'this does not look like a tab file tabs can read');
    const fileName = str(name, 200) || 'song.gp';
    const ext = (fileName.match(EXT)?.[1] || 'gp').toLowerCase();
    const file = path.join(this.files, hash);
    if (!fs.existsSync(file)) fs.writeFileSync(file, bytes);

    const fromName = fileName.replace(/\.[^.]+$/, '');
    const dash = fromName.indexOf('-');
    const tab = {
      id: newId(),
      owner,
      ownerName: user ? user.name : '',
      name: fileName,
      ext,
      hash,
      size: bytes.length,
      title: info.title || (dash > 0 ? fromName.slice(dash + 1).trim() : fromName),
      artist: info.artist || (dash > 0 ? fromName.slice(0, dash).trim() : ''),
      tempo: info.tempo,
      bars: info.bars,
      tracks: info.tracks.slice(0, 64),
      roles: info.roles,
      notes: '',
      addedAt: Date.now(),
      updatedAt: Date.now(),
      usedAt: Date.now(),
    };
    this.db.tabs.push(tab);
    this.save();
    return tab;
  }

  tab(id) { return this.db.tabs.find(t => t.id === id) || null; }

  /** a tab the user may see, or an http error */
  tabFor(user, id, open, write = false) {
    const tab = this.tab(id);
    if (!tab || !Library.sees(user, tab, open)) throw httpError(404, 'tab_not_found');
    if (write && !Library.edits(user, tab, open)) throw httpError(403, 'only an admin can change a shared tab');
    return tab;
  }

  tabData(tab) {
    return fs.readFileSync(path.join(this.files, tab.hash)).toString('base64');
  }

  tabBytes(tab) {
    return fs.readFileSync(path.join(this.files, tab.hash));
  }

  touch(tab) {
    tab.usedAt = Date.now();
    this.save();
  }

  updateTab(tab, patch = {}) {
    if (typeof patch.title === 'string') tab.title = str(patch.title, 200) || tab.title;
    if (typeof patch.artist === 'string') tab.artist = str(patch.artist, 200);
    if (typeof patch.notes === 'string') tab.notes = str(patch.notes, 500);
    tab.updatedAt = Date.now();
    this.save();
    return tab;
  }

  removeTab(tab) {
    this.db.tabs = this.db.tabs.filter(t => t !== tab);
    // sets keep their order; the missing song just drops out
    for (const set of this.db.sets) {
      const before = set.songs.length;
      set.songs = set.songs.filter(s => s.tab !== tab.id);
      if (set.songs.length !== before) set.updatedAt = Date.now();
    }
    if (!this.db.tabs.some(t => t.hash === tab.hash)) fs.rm(path.join(this.files, tab.hash), { force: true }, () => {});
    this.save();
  }

  // ---- sets (shows) --------------------------------------------------------------------------

  setFor(user, id, open, write = false) {
    const set = this.db.sets.find(s => s.id === id);
    if (!set || !Library.sees(user, set, open)) throw httpError(404, 'set_not_found');
    if (write && !Library.edits(user, set, open)) throw httpError(403, 'only an admin can change a shared show');
    return set;
  }

  /**
   * The shows the server comes with (example/*\/show.json) become ordinary shows in the library —
   * shared, so every host finds them under their shows. Once: one an admin deletes stays deleted.
   */
  seedShows(shows) {
    let added = 0;
    for (const show of shows) {
      if (this.db.seeded.includes(show.id)) continue;
      try {
        const songs = show.songs.map(s => {
          const tab = this.addTab(null, { data: s.data, name: s.name }, SHARED);
          const { data: _d, name: _n, roles: _r, title, ...meta } = s;
          return { ...meta, tab: tab.id, title: title || '' };
        });
        const set = this.addSet(null, {
          name: show.name, subtitle: show.subtitle || '', date: show.date || '',
          notes: [show.description, ...(show.rig || []).map(r => `${r.name}: ${r.text}`)].filter(Boolean).join('\n'),
          countIn: !!show.countIn, songs,
        }, SHARED);
        set.seed = show.id;
        this.db.seeded.push(show.id);
        added++;
      } catch (err) {
        console.warn(`library: could not add the show ${show.id} (${err.message})`);
      }
    }
    if (added) this.save();
    return added;
  }

  /** a new set; `songs` may come along (e.g. "save this setlist as a show") */
  addSet(user, raw = {}, ownerOverride) {
    if (this.db.sets.length >= MAX_SETS) throw httpError(409, 'too_many_sets');
    const set = {
      id: newId(),
      owner: ownerOverride || Library.owner(user),
      ownerName: user ? user.name : '',
      name: str(raw.name, 120) || 'new set',
      subtitle: '', date: '', notes: '', countIn: false, transpose: 0,
      songs: [],
      createdAt: Date.now(),
      updatedAt: Date.now(),
    };
    this.applySet(user, set, raw);
    this.db.sets.push(set);
    this.save();
    return set;
  }

  updateSet(user, set, patch) {
    this.applySet(user, set, patch);
    set.updatedAt = Date.now();
    this.save();
    return set;
  }

  applySet(user, set, raw = {}) {
    if (typeof raw.name === 'string') set.name = str(raw.name, 120) || set.name;
    if (typeof raw.subtitle === 'string') set.subtitle = str(raw.subtitle, 200);
    if (typeof raw.date === 'string') set.date = str(raw.date, 80);
    if (typeof raw.notes === 'string') set.notes = str(raw.notes, 1000);
    if (typeof raw.countIn === 'boolean') set.countIn = raw.countIn;
    if (Number.isInteger(raw.transpose) && raw.transpose >= -12 && raw.transpose <= 12) set.transpose = raw.transpose;
    if (Array.isArray(raw.songs)) {
      set.songs = raw.songs.slice(0, MAX_SET_SONGS).map(s => {
        const tab = s && this.tab(String(s.tab));
        // only tabs the set's owner may use
        if (!tab || (tab.owner !== set.owner && tab.owner !== SHARED && !(user && user.admin))) return null;
        const meta = songMeta(s);
        return { tab: tab.id, title: str(s.title, 200), ...meta };
      }).filter(Boolean);
    }
  }

  removeSet(set) {
    this.db.sets = this.db.sets.filter(s => s !== set);
    this.save();
  }

  /** the set as room songs (parseSong input) — files read from disk */
  songsOf(set) {
    return set.songs.map(s => {
      const tab = this.tab(s.tab);
      if (!tab) return null;
      this.touch(tab);
      const { tab: _id, ...meta } = s;
      return { ...meta, data: this.tabData(tab), name: tab.name, title: s.title || tab.title || null };
    }).filter(Boolean);
  }

  /** listing shapes — no file data */
  describeTab(tab) {
    const { hash: _h, ...rest } = tab;
    return { ...rest, shared: tab.owner === SHARED };
  }

  describeSet(set) {
    return {
      ...set,
      shared: set.owner === SHARED,
      songs: set.songs.map(s => {
        const tab = this.tab(s.tab);
        // title stays what the set says (often empty); tabTitle is the library's name for the song
        return { ...s, tabTitle: tab?.title || 'missing song', artist: tab?.artist || '', name: tab?.name || null, roles: tab?.roles ?? null, missing: !tab };
      }),
    };
  }
}

function httpError(status, message) {
  const err = new Error(message);
  err.status = status;
  err.expose = true;
  return err;
}

module.exports = { Library, httpError, parseGroove, SHARED };
