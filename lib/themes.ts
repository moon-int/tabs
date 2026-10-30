export type ThemeId = 'mint' | 'jam' | 'ember' | 'violet' | 'ice' | 'stage' | 'paper';

export type NotationColors = {
  staffLineColor: string;
  barSeparatorColor: string;
  barNumberColor: string;
  mainGlyphColor: string;
  secondaryGlyphColor: string;
  scoreInfoColor: string;
};

export type Theme = {
  id: ThemeId;
  name: string;
  hint: string;
  light: boolean;
  accent: string;
  vars: Record<string, string>; // css custom properties on :root
  notation: NotationColors;
};

const darkNotation = (accent: string, glyph = '#e8f1ef', staff = '#3b4a53'): NotationColors => ({
  staffLineColor: staff,
  barSeparatorColor: '#56656e',
  barNumberColor: accent,
  mainGlyphColor: glyph,
  secondaryGlyphColor: 'rgba(232,241,239,0.45)',
  scoreInfoColor: glyph,
});

/** black notes on white, for the "paper" notation option and light themes */
export const paperNotation = (accent: string): NotationColors => ({
  staffLineColor: '#9aa4a8',
  barSeparatorColor: '#5f6b70',
  barNumberColor: accent,
  mainGlyphColor: '#10181c',
  secondaryGlyphColor: 'rgba(16,24,28,0.5)',
  scoreInfoColor: '#10181c',
});

const dark = (o: { bg: string; panel: string; panel2: string; cell: string; lcd: string; score: string; knob: string; text?: string; muted?: string; faint?: string; line?: string; line2?: string; warn?: string }) => ({
  '--bg': o.bg,
  '--panel': o.panel,
  '--panel-2': o.panel2,
  '--cell': o.cell,
  '--lcd-bg': o.lcd,
  '--score-bg': o.score,
  '--knob-body': o.knob,
  '--text': o.text ?? '#e8f1ef',
  '--muted': o.muted ?? '#7f8d95',
  '--faint': o.faint ?? '#4a5861',
  '--line': o.line ?? 'rgba(255, 255, 255, 0.07)',
  '--line-2': o.line2 ?? 'rgba(255, 255, 255, 0.12)',
  '--orange': o.warn ?? '#ff6b00',
  '--shade': 'rgba(0, 0, 0, 0.22)',
  '--hover': 'rgba(255, 255, 255, 0.04)',
});

export const THEMES: Theme[] = [
  {
    id: 'mint', name: 'mint', hint: 'the mo-tion classic', light: false, accent: '#00ffce',
    vars: dark({ bg: '#05080d', panel: '#0a1118', panel2: '#0c141c', cell: '#0e1821', lcd: '#03070b', score: '#070c12', knob: '#101b24' }),
    notation: darkNotation('#00ffce'),
  },
  {
    // the band room's own look: deep plum, a hot coral accent
    id: 'jam', name: 'jam', hint: 'the band room — warm coral on plum', light: false, accent: '#ff5c7a',
    vars: dark({ bg: '#0c0710', panel: '#160e1b', panel2: '#1a1020', cell: '#201427', lcd: '#07040a', score: '#100a14', knob: '#26182e', muted: '#a08ea9', faint: '#5f4e69', line: 'rgba(255, 220, 240, 0.08)', line2: 'rgba(255, 220, 240, 0.14)', warn: '#ffb020' }),
    notation: darkNotation('#ff5c7a', '#f6eaf2', '#4b3a55'),
  },
  {
    id: 'ember', name: 'ember', hint: 'warm, low-blue for late gigs', light: false, accent: '#ff8a1f',
    vars: dark({ bg: '#0b0705', panel: '#150e0a', panel2: '#18100b', cell: '#1d140e', lcd: '#080403', score: '#0e0907', knob: '#241811', muted: '#9a8a7f', faint: '#5e5047', warn: '#ff3d5e' }),
    notation: darkNotation('#ff8a1f', '#f3e9e1', '#4a3b31'),
  },
  {
    id: 'violet', name: 'violet', hint: 'soft and moody', light: false, accent: '#b69cff',
    vars: dark({ bg: '#07060d', panel: '#0f0d18', panel2: '#120f1d', cell: '#161325', lcd: '#04030a', score: '#0a0912', knob: '#1b1730', muted: '#8d87a3', faint: '#524c68' }),
    notation: darkNotation('#b69cff', '#ece8f8', '#3d3854'),
  },
  {
    id: 'ice', name: 'ice', hint: 'cool blue', light: false, accent: '#4cc9ff',
    vars: dark({ bg: '#04080f', panel: '#091220', panel2: '#0b1526', cell: '#0e1a2e', lcd: '#02060c', score: '#060c16', knob: '#0f1e33', muted: '#7c8ea3', faint: '#465a70' }),
    notation: darkNotation('#4cc9ff', '#e6f0fa', '#34465c'),
  },
  {
    id: 'stage', name: 'stage', hint: 'max contrast for dark stages', light: false, accent: '#ffe14d',
    vars: dark({ bg: '#000000', panel: '#0a0a0a', panel2: '#0d0d0d', cell: '#141414', lcd: '#000000', score: '#000000', knob: '#1a1a1a', text: '#ffffff', muted: '#b3b3b3', faint: '#6b6b6b', line: 'rgba(255, 255, 255, 0.14)', line2: 'rgba(255, 255, 255, 0.24)', warn: '#ff4d4d' }),
    notation: { ...darkNotation('#ffe14d', '#ffffff', '#6b6b6b'), barSeparatorColor: '#8a8a8a', secondaryGlyphColor: 'rgba(255,255,255,0.6)' },
  },
  {
    id: 'paper', name: 'paper', hint: 'light, for daylight & bright rooms', light: true, accent: '#00a884',
    vars: {
      '--bg': '#eef2f1',
      '--panel': '#ffffff',
      '--panel-2': '#f8faf9',
      '--cell': '#eef2f1',
      '--lcd-bg': '#0b1512',
      '--score-bg': '#ffffff',
      '--knob-body': '#e6ecea',
      '--text': '#0d1a17',
      '--muted': '#5b6b66',
      '--faint': '#93a19c',
      '--line': 'rgba(13, 26, 23, 0.09)',
      '--line-2': 'rgba(13, 26, 23, 0.16)',
      '--orange': '#e35d00',
      '--shade': 'rgba(13, 26, 23, 0.04)',
      '--hover': 'rgba(13, 26, 23, 0.05)',
    },
    notation: paperNotation('#00a884'),
  },
];

export const themeById = (id: string) => THEMES.find(t => t.id === id) ?? THEMES[0];

function hexToRgb(hex: string): [number, number, number] | null {
  const m = hex.trim().match(/^#?([0-9a-f]{6})$/i);
  if (!m) return null;
  const n = parseInt(m[1], 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}

/** dark text on bright accents, light text on dark ones */
function onAccent([r, g, b]: [number, number, number]) {
  const lum = (0.2126 * r + 0.7152 * g + 0.0722 * b) / 255;
  return lum > 0.55 ? '#03120e' : '#ffffff';
}

export type ResolvedTheme = { theme: Theme; accent: string; notation: NotationColors; light: boolean };

export function resolveTheme(id: string, customAccent: string | null, paper: boolean): ResolvedTheme {
  const theme = themeById(id);
  const accent = customAccent && hexToRgb(customAccent) ? customAccent : theme.accent;
  const notation = paper && !theme.light ? paperNotation(accent) : { ...theme.notation, barNumberColor: accent };
  return { theme, accent, notation, light: theme.light };
}

/** writes the theme into css custom properties on <html> */
export function applyTheme(r: ResolvedTheme, paper: boolean) {
  const root = document.documentElement;
  for (const [k, v] of Object.entries(r.theme.vars)) root.style.setProperty(k, v);
  const rgb = hexToRgb(r.accent)!;
  root.style.setProperty('--mint', r.accent); // --mint is "the accent" throughout the css
  root.style.setProperty('--mint-rgb', rgb.join(', '));
  root.style.setProperty('--on-accent', onAccent(rgb));
  // the lcd stays dark on light themes, so its digits keep a bright accent
  root.style.setProperty('--lcd-fg', r.light ? '#00ffce' : r.accent);
  if (paper && !r.light) root.style.setProperty('--score-bg', '#ffffff');
  root.dataset.light = r.light ? 'true' : 'false';
  root.style.colorScheme = r.light ? 'light' : 'dark';
  document.querySelector('meta[name="theme-color"]')?.setAttribute('content', r.theme.vars['--bg']);
}
