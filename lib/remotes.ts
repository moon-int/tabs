/**
 * Other tabs servers whose session codes this one knows by their prefix — on tabs.mo-tion.at:
 * "lg=https://jam.geyser.at/tabs", so a code like lg7k2m9q (or a link …/room/lg7k2m9q) goes straight to
 * the band's own server. Set at build time (TABS_REMOTES, see next.config.mjs, which also turns them
 * into server-side redirects); several are separated by commas.
 */

export type Remote = { prefix: string; url: string };

export function parseRemotes(raw: string | undefined): Remote[] {
  return String(raw || '').split(',').map(part => {
    const i = part.indexOf('=');
    const prefix = part.slice(0, i).trim().toLowerCase();
    const url = part.slice(i + 1).trim().replace(/\/+$/, '');
    return i > 0 && /^[a-z0-9]{1,4}$/.test(prefix) && /^https?:\/\/[^\s/]+/.test(url) ? { prefix, url } : null;
  }).filter((r): r is Remote => !!r);
}

export const REMOTES = parseRemotes(process.env.TABS_REMOTES);

/** where a session code lives, if it's another server's */
export function remoteRoom(code: string): string | null {
  const c = code.trim().toLowerCase();
  const r = REMOTES.find(x => c.startsWith(x.prefix) && c.length > x.prefix.length);
  return r ? `${r.url}/room/${encodeURIComponent(c)}` : null;
}
