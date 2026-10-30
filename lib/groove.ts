import { kits, TRACK_COUNT } from './beats/kits';
import { presets as beatsPresets, STEPS } from './beats/patterns';

/**
 * Grooves — drum patterns from mo-tion beats, played by tabs in sync with the
 * song. Same 8 tracks × 16 steps as beats (kick · snare · clap · hat · open
 * hat · tom · rim · perc), same synthesized kits, so a pattern built in beats
 * sounds identical here. The host picks the groove for everyone; each person
 * only sets how loud it is.
 *
 * Steps are 16ths of each bar. Shorter bars (3/4, 6/8 …) simply use the first
 * steps of the pattern.
 */

export type Groove = {
  on: boolean;
  name: string;
  kit: number; // index into beats' kits
  swing: number; // 0..100, like beats
  rows: string[]; // 8 rows of 16 chars: X accent, x hit, . rest — the pattern playing now
  mix?: number[][]; // optional per-track [gain, pan, tune, decay, mute, solo] from a beats link
  slots?: string[][]; // a beats link's patterns a–d; switching between them waits for the next downbeat
  slot?: number;
  mutes?: boolean[]; // live mutes per drum track, for everyone (the dj's hands on the mixer)
  bpm?: number; // its own tempo, for running free between songs
  free?: boolean; // keeps playing at bpm while no song plays
};

export const DRUM_TRACKS = ['kick', 'snare', 'clap', 'hat', 'open hat', 'tom', 'rim', 'perc'];

/** the same groove on another of its patterns (a–d) */
export const withSlot = (g: Groove, slot: number): Groove =>
  g.slots && g.slots[slot] ? { ...g, slot, rows: g.slots[slot], on: true } : g;

/** one drum track muted / back in, live */
export function withMute(g: Groove, track: number): Groove {
  const mutes = Array.from({ length: TRACK_COUNT }, (_, i) => !!g.mutes?.[i]);
  mutes[track] = !mutes[track];
  return { ...g, mutes };
}

export type GrooveDef = Omit<Groove, 'on'> & { id: string; group: 'band' | 'beats' };

const g = (id: string, name: string, kit: number, swing: number, rows: string[]): GrooveDef => ({ id, name, kit, swing, rows, group: 'band' });

// grooves a band rehearses to — played on the 909 kit unless a lighter touch fits better
export const BAND_GROOVES: GrooveDef[] = [
  g('rock', 'rock', 1, 0, ['X.......x.x.....', '....X.......X...', '................', 'x.x.x.x.x.x.x.x.', '................', '................', '................', '................']),
  g('halftime', 'half-time', 1, 0, ['X.........x.....', '........X.......', '................', 'x.x.x.x.x.x.x.x.', '................', '................', '................', '................']),
  g('pop', 'pop', 1, 0, ['X.....x.X.......', '....X.......X...', '................', 'x.xxx.x.x.xxx.x.', '..............x.', '................', '................', '................']),
  g('punk', 'punk', 1, 0, ['X.x.X.x.X.x.X.x.', '....X.......X...', '................', 'x.x.x.x.x.x.x.x.', '................', '................', '................', '................']),
  g('shuffle', 'shuffle', 0, 70, ['X.....x.X.....x.', '....X.......X...', '................', 'x.x.x.x.x.x.x.x.', '................', '................', '................', '................']),
  g('funk', 'funk', 1, 15, ['X..x..x...X..x..', '....X..x.x..X...', '................', 'xxxxxxxxxxxxxxxx', '..........x.....', '................', '.......x.......x', '................']),
  g('disco', 'disco', 1, 0, ['X...X...X...X...', '....X.......X...', '................', 'x.x.x.x.x.x.x.x.', '..X...X...X...X.', '................', '................', '................']),
  g('ballad', 'ballad', 2, 0, ['X.........x.....', '........X.......', '................', 'x...x...x...x...', '................', '................', '....x.......x...', '................']),
  g('onedrop', 'one drop', 2, 30, ['........X.......', '................', '................', 'x.x.x.x.x.x.x.x.', '................', '................', '........X.......', '................']),
  g('bossa', 'bossa nova', 2, 0, ['X..xX..xX..xX..x', '................', '................', 'x.x.x.x.x.x.x.x.', '................', '................', 'x..x..x...x..x..', '................']),
  g('metronome', 'four on the floor', 1, 0, ['X...X...X...X...', '................', '................', '..x...x...x...x.', '................', '................', '................', '................']),
];

export const BEATS_GROOVES: GrooveDef[] = beatsPresets.map(p => ({
  id: `beats-${p.name}`, name: p.name, kit: 0, swing: p.swing, rows: p.rows, group: 'beats' as const,
}));

export const GROOVES: GrooveDef[] = [...BAND_GROOVES, ...BEATS_GROOVES];

export const grooveFromDef = (d: GrooveDef): Groove => ({ on: true, name: d.name, kit: d.kit, swing: d.swing, rows: d.rows });

export const kitName = (i: number) => kits[i]?.name ?? kits[0].name;

/** rows → beats' numeric pattern (0 rest, 1 hit, 2 accent) */
export function grooveMatrix(rows: string[]): number[][] {
  return Array.from({ length: TRACK_COUNT }, (_, r) =>
    Array.from({ length: STEPS }, (_, c) => (rows[r]?.[c] === 'X' ? 2 : rows[r]?.[c] === 'x' ? 1 : 0)));
}

const EMPTY_ROWS = () => Array.from({ length: TRACK_COUNT }, () => '.'.repeat(STEPS));
const hasHits = (rows: string[]) => rows.some(r => /[Xx]/.test(r));

/** beats' "0120…" digit rows joined by "." → our X/x/. rows */
function rowsOfBeats(pattern: unknown): string[] {
  const rows = String(pattern ?? '').split('.').map(r => r.replace(/2/g, 'X').replace(/1/g, 'x').replace(/[^Xx]/g, '.').padEnd(STEPS, '.').slice(0, STEPS));
  return Array.from({ length: TRACK_COUNT }, (_, i) => rows[i] ?? '.'.repeat(STEPS));
}

/**
 * Reads a beats share link (…/#s=…) or just its code: all four pattern slots (empty ones left out),
 * the slot that was active, kit, swing, tempo and mixer — so the dj can switch patterns live.
 */
export function decodeBeatsLink(text: string): Groove | null {
  const m = text.trim().match(/(?:#s=)?([A-Za-z0-9_-]{16,})\s*$/);
  if (!m) return null;
  try {
    const c = JSON.parse(atob(m[1].replace(/-/g, '+').replace(/_/g, '/')));
    const all = (Array.isArray(c.p) ? c.p : []).slice(0, 4).map(rowsOfBeats);
    const active = Number.isInteger(c.s) && all[c.s] && hasHits(all[c.s]) ? c.s : all.findIndex(hasHits);
    if (active < 0) return null;
    // keep the slots that have something in them, in order; remember where the active one went
    const kept = all.map((rows: string[], i: number) => ({ rows, i })).filter((x: { rows: string[] }) => hasHits(x.rows));
    const slot = Math.max(0, kept.findIndex((x: { i: number }) => x.i === active));
    const kit = Number.isInteger(c.k) && kits[c.k] ? c.k : 0;
    const bpm = Number(c.b);
    return {
      on: true,
      name: kept.length > 1 ? `beats · ${kept.length} patterns` : `beats · pattern ${'abcd'[active] ?? 'a'}`,
      kit,
      swing: Math.min(100, Math.max(0, Number(c.w) || 0)),
      rows: kept[slot].rows,
      ...(kept.length > 1 ? { slots: kept.map((x: { rows: string[] }) => x.rows), slot } : {}),
      ...(bpm >= 40 && bpm <= 240 ? { bpm: Math.round(bpm) } : {}),
      mix: Array.isArray(c.t) ? c.t.slice(0, TRACK_COUNT).map((t: unknown) => (Array.isArray(t) ? t.slice(0, 6).map(Number) : [0.8, 0, 0, 1, 0, 0])) : undefined,
    };
  } catch {
    return null;
  }
}

/** the groove as a beats share link — open it in beats, change it, "use in tabs" brings it back */
export function encodeBeatsLink(beatsUrl: string, g: Groove): string {
  const slots = (g.slots?.length ? g.slots : [g.rows]).slice(0, 4);
  while (slots.length < 4) slots.push(EMPTY_ROWS());
  const digits = (rows: string[]) => rows.map(r => r.replace(/X/g, '2').replace(/x/g, '1').replace(/[^12]/g, '0')).join('.');
  const state = {
    b: g.bpm ?? 120, w: g.swing, v: 0.8, k: g.kit, s: g.slots?.length ? g.slot ?? 0 : 0,
    p: slots.map(digits),
    t: g.mix ?? Array.from({ length: TRACK_COUNT }, () => [0.8, 0, 0, 1, 0, 0]),
  };
  const code = btoa(JSON.stringify(state)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
  return `${beatsUrl.replace(/\/+$/, '')}/#s=${code}`;
}
