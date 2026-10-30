// Shared by the browser (lib/player.ts) and the server (server/rig.js), so both
// put a track in the same role. Plain CommonJS on purpose: node requires it as is.

/**
 * Guesses what a track is from its name first, then its general-midi program.
 * @param {string} name
 * @param {number} program
 * @param {boolean} percussion
 * @returns {'guitar' | 'bass' | 'drums' | 'keys' | 'vocals' | 'other'}
 */
function detectPart(name, program, percussion) {
  const n = name.toLowerCase();
  if (percussion || /drum|perc|schlagzeug|kit\b|cajon/.test(n)) return 'drums';
  if (/voc|vox|voice|sing|gesang|stimme|choir|chor/.test(n)) return 'vocals';
  if (/bass|bajo/.test(n)) return 'bass';
  if (/gtr|guit|gitarre|git\b|e-git|acoustic|lead|rhythm/.test(n)) return 'guitar';
  if (/key|piano|klavier|synth|organ|orgel|rhodes|pad/.test(n)) return 'keys';
  if (program >= 24 && program <= 31) return 'guitar';
  if (program >= 32 && program <= 39) return 'bass';
  if (program <= 23 || (program >= 80 && program <= 103)) return 'keys';
  if (program >= 52 && program <= 54) return 'vocals';
  return 'other';
}

module.exports = { detectPart };
