const { analyzeBytes, describeBytes, rolesOfScore } = require('../lib/rig');

// each role's tuning, read from a tab file — the logic lives in lib/rig.js, shared with solo sessions in the browser

let alphaTab = null;
const at = () => {
  if (!alphaTab) alphaTab = require('@coderline/alphatab');
  return alphaTab;
};

/** reads a base64 tab file; null if alphaTab can't make sense of it */
function analyzeSong(base64) {
  return analyzeBytes(at(), new Uint8Array(Buffer.from(base64, 'base64')));
}

/** title, artist, tracks and roles of a tab file (raw bytes) — null if alphaTab can't read it */
function describeSong(bytes) {
  return describeBytes(at(), bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes));
}

module.exports = { analyzeSong, describeSong, rolesOfScore };
