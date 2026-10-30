const fs = require('fs');
const path = require('path');

/**
 * Copies alphaTab's runtime assets (umd bundle, bravura font, soundfont) into
 * public/vendor/alphatab, so next.js serves them on every host — not only
 * when server/index.js runs. Runs on `npm install` and before `npm run build`.
 */
const root = path.join(__dirname, '..');
const src = path.join(root, 'node_modules', '@coderline', 'alphatab', 'dist');
const dest = path.join(root, 'public', 'vendor', 'alphatab');

const FILES = [
  'alphaTab.min.js',
  'alphaTab.min.mjs',
  'alphaTab.core.min.mjs',
  'alphaTab.worker.min.mjs',
  'alphaTab.worklet.min.mjs',
  'font',
  'soundfont/sonivox.sf3',
  'soundfont/LICENSE',
];

if (!fs.existsSync(src)) {
  console.error(`vendor-alphatab: ${path.relative(root, src)} not found — run "npm install" first`);
  process.exit(1);
}

fs.rmSync(dest, { recursive: true, force: true });
for (const file of FILES) {
  const from = path.join(src, file);
  if (!fs.existsSync(from)) continue;
  fs.cpSync(from, path.join(dest, file), { recursive: true });
}
console.log(`vendor-alphatab: copied alphaTab assets to ${path.relative(root, dest)}`);
