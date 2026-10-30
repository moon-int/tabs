import type { Score } from './alphatab';

/**
 * Tunings & re-fretting.
 *
 * Tuning arrays follow alphaTab: midi note numbers from the highest string to
 * the lowest. Notes use string 1 = lowest string. Re-fretting keeps every
 * note's pitch and moves it to the frets (or, if needed, the string) where it
 * lives in the chosen tuning — so you read the song in *your* tuning while the
 * band still hears the original.
 */

export type TuningPreset = { id: string; name: string; tunings: number[] };

const shift = (t: number[], d: number) => t.map(n => n + d);
const G6 = [64, 59, 55, 50, 45, 40];
const G7 = [64, 59, 55, 50, 45, 40, 35];
const B4 = [43, 38, 33, 28];
const B5 = [43, 38, 33, 28, 23];
const drop = (t: number[], d = 2) => [...t.slice(0, -1), t[t.length - 1] - d];

export const TUNINGS: Record<number, TuningPreset[]> = {
  6: [
    { id: 'e', name: 'standard (e)', tunings: G6 },
    { id: 'eb', name: 'half step down (eb)', tunings: shift(G6, -1) },
    { id: 'd', name: 'whole step down (d)', tunings: shift(G6, -2) },
    { id: 'c#', name: 'c# standard', tunings: shift(G6, -3) },
    { id: 'c', name: 'c standard', tunings: shift(G6, -4) },
    { id: 'b', name: 'b standard', tunings: shift(G6, -5) },
    { id: 'dropd', name: 'drop d', tunings: drop(G6) },
    { id: 'dropc#', name: 'drop c#', tunings: drop(shift(G6, -1)) },
    { id: 'dropc', name: 'drop c', tunings: drop(shift(G6, -2)) },
    { id: 'dropb', name: 'drop b', tunings: drop(shift(G6, -3)) },
    { id: 'dadgad', name: 'dadgad', tunings: [62, 57, 55, 50, 45, 38] },
    { id: 'openg', name: 'open g', tunings: [62, 59, 55, 50, 43, 38] },
    { id: 'opend', name: 'open d', tunings: [62, 57, 54, 50, 45, 38] },
    { id: 'opene', name: 'open e', tunings: [64, 59, 56, 52, 47, 40] },
    { id: 'openc', name: 'open c', tunings: [64, 60, 55, 48, 43, 36] },
  ],
  7: [
    { id: 'b7', name: 'standard (b)', tunings: G7 },
    { id: 'bb7', name: 'half step down', tunings: shift(G7, -1) },
    { id: 'a7', name: 'a standard', tunings: shift(G7, -2) },
    { id: 'dropa7', name: 'drop a', tunings: drop(G7) },
  ],
  4: [
    { id: 'e4', name: 'standard (e)', tunings: B4 },
    { id: 'eb4', name: 'half step down (eb)', tunings: shift(B4, -1) },
    { id: 'd4', name: 'd standard', tunings: shift(B4, -2) },
    { id: 'dropd4', name: 'drop d', tunings: drop(B4) },
    { id: 'dropc#4', name: 'drop c#', tunings: drop(shift(B4, -1)) },
    { id: 'dropc4', name: 'drop c', tunings: drop(shift(B4, -2)) },
  ],
  5: [
    { id: 'b5', name: 'standard (b)', tunings: B5 },
    { id: 'bb5', name: 'half step down', tunings: shift(B5, -1) },
    { id: 'dropa5', name: 'drop a', tunings: drop(B5) },
  ],
};

const NAMES = ['c', 'c#', 'd', 'eb', 'e', 'f', 'f#', 'g', 'ab', 'a', 'bb', 'b'];
const PC: Record<string, number> = {
  c: 0, 'c#': 1, db: 1, d: 2, 'd#': 3, eb: 3, e: 4, f: 5, 'f#': 6, gb: 6, g: 7, 'g#': 8, ab: 8, a: 9, 'a#': 10, bb: 10, b: 11,
};

export const noteName = (midi: number) => NAMES[((midi % 12) + 12) % 12];

/** "d a d g b e" — low string first, the way guitarists say it */
export const describeTuning = (t: number[]) => [...t].reverse().map(noteName).join(' ');

export const sameTuning = (a: number[] | null | undefined, b: number[] | null | undefined) =>
  !!a && !!b && a.length === b.length && a.every((n, i) => n === b[i]);

export function findPreset(t: number[]): TuningPreset | null {
  return (TUNINGS[t.length] ?? []).find(p => sameTuning(p.tunings, t)) ?? null;
}

export function tuningLabel(t: number[]) {
  return findPreset(t)?.name ?? describeTuning(t);
}

/**
 * Parses "D A D G B E" / "dadgbe" / "d2 a2 d3 …" (low to high). Without an
 * octave each string lands on the pitch closest to the reference string.
 */
export function parseTuning(text: string, reference: number[]): number[] | null {
  const tokens = text.toLowerCase().replace(/♯/g, '#').replace(/♭/g, 'b').match(/[a-g](#|b)?-?\d?/g);
  if (!tokens || tokens.length !== reference.length) return null;
  const refLowToHigh = [...reference].reverse();
  const lowToHigh = tokens.map((tok, i) => {
    const m = tok.match(/^([a-g](?:#|b)?)(-?\d)?$/)!;
    const pc = PC[m[1]];
    if (pc === undefined) return NaN;
    if (m[2] !== undefined) return (Number(m[2]) + 1) * 12 + pc;
    const ref = refLowToHigh[i];
    let best = pc;
    for (let n = pc; n < 128; n += 12) if (Math.abs(n - ref) < Math.abs(best - ref)) best = n;
    return best;
  });
  return lowToHigh.some(n => !Number.isFinite(n)) ? null : lowToHigh.reverse();
}

// ---- re-fretting ------------------------------------------------------------------

const MAX_FRET = 24;
type Spot = { string: number; fret: number };
const originals = new WeakMap<object, Spot>();
const originalTunings = new WeakMap<object, { tunings: number[]; name: string }>();

/** the tuning a staff had when the file was loaded */
export function originalTuning(staff: { stringTuning: { tunings: number[]; name: string } }) {
  return originalTunings.get(staff)?.tunings ?? staff.stringTuning.tunings.slice();
}

/**
 * Re-frets every note of one track for `target` (null = back to the file's
 * tuning). Returns how many notes could not be placed in range.
 *
 * `shift` moves the whole song by semitones first — the file's tuning moves
 * with it, so without a target the frets stay exactly as written and only
 * the pitches (notation, string names) go up or down: the same tab, played
 * on a guitar tuned that much lower or higher. A target then re-frets
 * relative to the shifted song.
 */
export function retuneTrack(score: Score, trackIndex: number, target: number[] | null, shift = 0): number {
  const track = score.tracks[trackIndex];
  if (!track || track.isPercussion) return 0;
  let unplayable = 0;

  for (const staff of track.staves) {
    if (!staff.isStringed || staff.isPercussion) continue;
    if (!originalTunings.has(staff)) originalTunings.set(staff, { tunings: staff.stringTuning.tunings.slice(), name: staff.stringTuning.name });
    const orig0 = originalTunings.get(staff)!;
    const from = orig0.tunings.map(t => t + shift);
    const to = target && target.length === from.length ? target : from;
    const n = from.length;
    const openOf = (t: number[], s: number) => t[n - s]; // s: 1 = lowest

    for (const bar of staff.bars) {
      for (const voice of bar.voices) {
        for (const beat of voice.beats) {
          const taken = new Set<number>();
          // place the highest notes first: they have the fewest alternatives
          const notes = beat.notes.filter(no => no.string > 0).sort((a, b) => b.string - a.string);
          for (const note of notes) {
            if (!originals.has(note)) originals.set(note, { string: note.string, fret: note.fret });
            const orig = originals.get(note)!;
            const pitch = openOf(from, orig.string) + orig.fret;
            let spot: Spot | null = null;

            const origin = note.isTieDestination ? note.tieOrigin : null;
            if (origin && origin.string > 0 && !taken.has(origin.string)) {
              spot = { string: origin.string, fret: origin.fret }; // a tie stays on its string
            } else {
              const same = pitch - openOf(to, orig.string);
              if (same >= 0 && same <= MAX_FRET && !taken.has(orig.string)) spot = { string: orig.string, fret: same };
              else {
                // nearest playable position on another string, close to the original hand position
                let best: Spot | null = null;
                for (let s = 1; s <= n; s++) {
                  const f = pitch - openOf(to, s);
                  if (f < 0 || f > MAX_FRET || taken.has(s)) continue;
                  if (!best || Math.abs(f - orig.fret) < Math.abs(best.fret - orig.fret)) best = { string: s, fret: f };
                }
                spot = best;
              }
            }
            if (!spot) {
              unplayable++;
              spot = { string: orig.string, fret: Math.max(0, pitch - openOf(to, orig.string)) };
            }
            note.string = spot.string;
            note.fret = spot.fret;
            taken.add(spot.string);
          }
        }
      }
    }
    staff.stringTuning.tunings = to.slice();
    staff.stringTuning.name = target || shift ? tuningLabel(to) : orig0.name;
  }
  return unplayable;
}
