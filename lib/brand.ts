import type { ThemeId } from './themes';
import { at } from './base';

/**
 * One app, two faces. The public build (tabs.mo-tion.at on vercel) is "tabs by mo-tion"; the band's
 * own server (jam.geyser.at/tabs) sets TABS_BRAND=jam in its .env and becomes "jam" — its own name, mark,
 * colours and home page. Chosen at build time (next.config.mjs passes TABS_BRAND through), so every
 * page renders in the right brand from the first frame.
 */

export type BrandId = 'tabs' | 'jam';

export type Brand = {
  id: BrandId;
  name: string;
  /** small line next to the name */
  by: string;
  /** browser tab title */
  title: string;
  description: string;
  /** the theme everyone starts with */
  theme: ThemeId;
  icon: string;
};

const BRANDS: Record<BrandId, Brand> = {
  tabs: {
    id: 'tabs',
    name: 'tabs',
    by: 'by mo-tion',
    title: 'tabs — mo-tion interactive',
    description: 'play guitar pro & musicxml tabs together, in sync — built with next.js and alphaTab',
    theme: 'mint',
    icon: at('/favicon.svg'),
  },
  jam: {
    id: 'jam',
    name: (process.env.TABS_BRAND_NAME || 'jam').toLowerCase(),
    by: process.env.TABS_BRAND_TAGLINE || 'the band room',
    title: process.env.TABS_BRAND_NAME || 'jam',
    description: 'our band room — rehearse, play and perform together, in sync',
    theme: 'jam',
    icon: at('/jam.svg'),
  },
};

export const BRAND: Brand = BRANDS[process.env.TABS_BRAND === 'jam' ? 'jam' : 'tabs'];
export const isJam = BRAND.id === 'jam';
