import React from 'react';
import { BRAND } from '../lib/brand';
import { at } from '../lib/base';

/** four strings and an accent playhead — the tabs mark, follows the theme */
function TabsMark({ size }: { size: number }) {
  const accent = { fill: 'var(--mint)' };
  return (
    <svg viewBox="0 0 64 64" width={size} height={size} aria-hidden="true">
      <rect width="64" height="64" rx="14" style={{ fill: 'var(--logo-bg, #0b141b)' }} />
      <path d="M10 18h44M10 28h44M10 38h44M10 48h44" style={{ stroke: 'var(--mint)' }} strokeOpacity="0.35" strokeWidth="2.5" strokeLinecap="round" />
      <rect x="29" y="10" width="6" height="46" rx="3" style={accent} />
      <circle cx="18" cy="28" r="4.5" style={accent} />
      <circle cx="45" cy="38" r="4.5" style={accent} />
      <circle cx="45" cy="18" r="4.5" style={accent} />
    </svg>
  );
}

/** a guitar pick with a level meter in it — the jam mark, follows the theme */
function JamMark({ size }: { size: number }) {
  return (
    <svg viewBox="0 0 64 64" width={size} height={size} aria-hidden="true">
      <path d="M32 61C19 50 7 34 8 20 9 9 20 4 32 4s23 5 24 16c1 14-11 30-24 41z" style={{ fill: 'var(--mint)' }} />
      <g style={{ fill: 'var(--on-accent, #1a0710)' }}>
        <rect x="18" y="22" width="5" height="12" rx="2.5" />
        <rect x="26" y="15" width="5" height="26" rx="2.5" />
        <rect x="34" y="19" width="5" height="18" rx="2.5" />
        <rect x="42" y="24" width="5" height="9" rx="2.5" />
      </g>
    </svg>
  );
}

export default function Logo({ size = 28 }: { size?: number }) {
  return BRAND.id === 'jam' ? <JamMark size={size} /> : <TabsMark size={size} />;
}

export function Brand() {
  return (
    <a className={`brand brand-${BRAND.id}`} href={at('/')}>
      <Logo />
      <span className="brand-name">{BRAND.name}</span>
      {BRAND.by && <span className="brand-by">{BRAND.by}</span>}
    </a>
  );
}
