// copied unchanged from mo-tion/Beats lib/patterns.ts — keep the two in sync so grooves sound the same in both apps
import { TRACK_COUNT } from './kits';

export const STEPS = 16;
export const SLOTS = 4;

export type Preset = { name: string; bpm: number; swing: number; rows: string[] };

// one string per track (kick · snare · clap · hat · open hat · tom · rim · perc)
// x = hit, X = accent, anything else = rest
export const presets: Preset[] = [
  {
    name: 'house', bpm: 124, swing: 20, rows: [
      'X...x...X...x...',
      '................',
      '....X.......X...',
      'x.x.x.x.x.x.x.xx',
      '..x...x...x...x.',
      '................',
      '...........x....',
      '......x.......x.',
    ],
  },
  {
    name: 'techno', bpm: 132, swing: 0, rows: [
      'X...X...X...X...',
      '................',
      '....x.......x...',
      'xxXxxxXxxxXxxxXx',
      '..X...X...X...X.',
      '.............x..',
      '...x..x....x..x.',
      '................',
    ],
  },
  {
    name: 'boom bap', bpm: 90, swing: 55, rows: [
      'X.....x.x.X.....',
      '....X.......X...',
      '............x...',
      'x.x.x.x.x.x.x.x.',
      '..............X.',
      '................',
      '.......x........',
      '................',
    ],
  },
  {
    name: 'trap', bpm: 140, swing: 0, rows: [
      'X......x..x.....',
      '........X.......',
      '........x.......',
      'x.x.x.xxx.x.xxxx',
      '................',
      '...........x.x..',
      '................',
      '..x.......x.....',
    ],
  },
  {
    name: 'breakbeat', bpm: 112, swing: 10, rows: [
      'X.x.......xx....',
      '....X..x.x..X..x',
      '................',
      'x.x.x.x.x.x.x.x.',
      '..............x.',
      '................',
      '................',
      '................',
    ],
  },
  {
    name: 'electro', bpm: 126, swing: 0, rows: [
      'X......x..X.....',
      '....X.......X...',
      '................',
      '..x...x...x...x.',
      '................',
      '..........x..x..',
      'x..x..x.....x...',
      '.x.....x.....x..',
    ],
  },
];

export const emptyPattern = (): number[][] =>
  Array.from({ length: TRACK_COUNT }, () => Array(STEPS).fill(0));

export function parseRows(rows: string[]): number[][] {
  return Array.from({ length: TRACK_COUNT }, (_, r) =>
    Array.from({ length: STEPS }, (_, c) => {
      const ch = rows[r]?.[c];
      return ch === 'X' ? 2 : ch === 'x' ? 1 : 0;
    }),
  );
}

// musically weighted random pattern: [downbeat, 8th offbeat, 16th] probabilities
const WEIGHTS: [number, number, number][] = [
  [0.55, 0.22, 0.1],  // kick
  [0.04, 0.06, 0.06], // snare (backbeat handled below)
  [0.02, 0.04, 0.03], // clap
  [0.7, 0.75, 0.3],   // hat
  [0.02, 0.35, 0.04], // open hat
  [0.03, 0.05, 0.07], // tom
  [0.05, 0.1, 0.12],  // rim
  [0.06, 0.1, 0.12],  // perc
];

export function randomPattern(): number[][] {
  return WEIGHTS.map((w, r) =>
    Array.from({ length: STEPS }, (_, c) => {
      if (r === 0 && c === 0) return 2;
      let prob = c % 4 === 0 ? w[0] : c % 2 === 0 ? w[1] : w[2];
      if (r === 1 && (c === 4 || c === 12)) prob = 0.9;
      if (r === 2 && (c === 4 || c === 12)) prob = 0.3;
      if (Math.random() >= prob) return 0;
      return c % 4 === 0 && Math.random() < 0.4 ? 2 : 1;
    }),
  );
}
