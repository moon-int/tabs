// codes of other tabs servers, by prefix: on vercel (tabs.mo-tion.at) "lg…" codes are the band's own
// server's. "prefix=url" pairs, comma-separated — see lib/remotes.ts
const REMOTES = process.env.TABS_REMOTES ?? (process.env.VERCEL ? 'lg=https://jam.geyser.at/tabs' : '');

const remotes = REMOTES.split(',').map(part => {
  const i = part.indexOf('=');
  const prefix = part.slice(0, i).trim().toLowerCase();
  const url = part.slice(i + 1).trim().replace(/\/+$/, '');
  return i > 0 && /^[a-z0-9]{1,4}$/.test(prefix) && /^https?:\/\/[^\s/]+/.test(url) ? { prefix, url } : null;
}).filter(Boolean);

// "lg" → "[lL][gG]": a code typed in capitals still goes over
const anyCase = prefix => prefix.split('').map(c => (/[a-z]/.test(c) ? `[${c}${c.toUpperCase()}]` : c)).join('');

// under a path next to other apps (jam.geyser.at/tabs): BASE_PATH=/tabs, like the moon modules
const BASE_PATH = (process.env.BASE_PATH || '').replace(/\/+$/, '');

/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  basePath: BASE_PATH || undefined,
  // NEXT_DIST_DIR lets a second build live next to a running one
  distDir: process.env.NEXT_DIST_DIR || '.next',
  env: {
    // hosts without the tabs server (vercel, or TABS_SOLO=1) open solo sessions right away,
    // instead of probing /api first — elsewhere the landing page finds out by itself
    TABS_SOLO: process.env.TABS_SOLO || (process.env.VERCEL ? '1' : ''),
    // tabs by mo-tion everywhere; TABS_BRAND=jam would give a server its own name and look (lib/brand.ts)
    TABS_BRAND: process.env.TABS_BRAND || '',
    TABS_BRAND_NAME: process.env.TABS_BRAND_NAME || '',
    TABS_BRAND_TAGLINE: process.env.TABS_BRAND_TAGLINE || '',
    TABS_REMOTES: REMOTES,
    BASE_PATH,
  },
  // a link to another server's session (tabs.mo-tion.at/room/lg…) is answered right away with a redirect
  async redirects() {
    return remotes.map(r => ({
      source: `/room/:code(${anyCase(r.prefix)}[a-zA-Z0-9]+)`,
      destination: `${r.url}/room/:code`,
      permanent: false,
    }));
  },
};

export default nextConfig;
