const fs = require('fs');
const path = require('path');
const { loadExamples, describeExample } = require('../server/examples');

/**
 * Prebuilds the example shows (example/*\/show.json) into public/examples, so a
 * deployment without the tabs server (vercel) still lists them and opens them
 * as solo sessions (lib/local.ts):
 *   public/examples/index.json        what GET /api/examples returns
 *   public/examples/<id>/show.json    the setlist with live settings and each role's tuning
 *   public/examples/<id>/<file>       the tab files
 * Runs before `npm run build`.
 */
const root = path.join(__dirname, '..');
const dest = path.join(root, 'public', 'examples');

// the public build (vercel) offers no shows of its own — only servers with a library carry them
if (process.env.VERCEL && process.env.TABS_BUILD_EXAMPLES !== '1') {
  fs.rmSync(dest, { recursive: true, force: true });
  console.log('build-examples: skipped on vercel (TABS_BUILD_EXAMPLES=1 builds them anyway)');
  process.exit(0);
}
const shows = [...loadExamples(path.join(root, 'example')).values()];

fs.rmSync(dest, { recursive: true, force: true });
fs.mkdirSync(dest, { recursive: true });
fs.writeFileSync(path.join(dest, 'index.json'), JSON.stringify(shows.map(describeExample)));

for (const show of shows) {
  const dir = path.join(dest, show.id);
  fs.mkdirSync(dir, { recursive: true });
  const songs = show.songs.map(({ data, ...song }) => {
    fs.writeFileSync(path.join(dir, song.name), Buffer.from(data, 'base64'));
    return { ...song, file: `/examples/${encodeURIComponent(show.id)}/${encodeURIComponent(song.name)}` };
  });
  fs.writeFileSync(path.join(dir, 'show.json'), JSON.stringify({ id: show.id, countIn: show.countIn, songs }));
}
console.log(`build-examples: ${shows.length} example show${shows.length === 1 ? '' : 's'} in ${path.relative(root, dest)}`);
