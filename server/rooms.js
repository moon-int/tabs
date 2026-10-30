const crypto = require('crypto');
const { analyzeSong } = require('./rig');
const room = require('../lib/room');

const { Room, parseGroove, songMeta } = room;

/**
 * The server's room registry. A room itself (playback, setlist, broadcast) lives
 * in lib/room.js, shared with the browser's solo sessions.
 */

const ID_ALPHABET = 'abcdefghjkmnpqrstuvwxyz23456789'; // no 0/o/1/l/i — easy to read out loud
const ROOM_TTL_MS = 12 * 60 * 60 * 1000;

function randomId(length, alphabet = ID_ALPHABET) {
  const bytes = crypto.randomBytes(length);
  let id = '';
  for (let i = 0; i < length; i++) id += alphabet[bytes[i] % alphabet.length];
  return id;
}

class RoomStore {
  /**
   * @param {{ prefix?: string }} [opts] prefix: every code starts with it ("lg" on jam.geyser.at/tabs), so
   * another tabs (tabs.mo-tion.at) can tell whose session a code is and send people there
   */
  constructor(opts = {}) {
    /** @type {Map<string, Room>} */
    this.rooms = new Map();
    this.prefix = String(opts.prefix || '').toLowerCase().replace(/[^a-z0-9]/g, '').slice(0, 4);
  }

  create() {
    let id;
    do id = this.prefix + randomId(6); while (this.rooms.has(id));
    const room = new Room(id, crypto.randomBytes(18).toString('base64url'));
    this.rooms.set(id, room);
    return room;
  }

  get(id) {
    return typeof id === 'string' ? this.rooms.get(id.toLowerCase()) : undefined;
  }

  /** drops rooms nobody has been connected to for a while */
  sweep(now = Date.now()) {
    for (const [id, room] of this.rooms) {
      if (room.clients.size === 0 && now - room.lastActive > ROOM_TTL_MS) this.rooms.delete(id);
    }
  }
}

/** validates an api song and reads each role's tuning out of the file */
const parseSong = raw => room.parseSong(raw, analyzeSong);

module.exports = { RoomStore, Room, parseSong, parseGroove, songMeta, randomId, ROOM_TTL_MS };
