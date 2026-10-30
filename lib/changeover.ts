import { tuningLabel } from './tuning';
import type { Part } from './prefs';

/**
 * Changeovers between setlist songs, per role. The tunings come from the
 * tab files (the server reads each role's tuning when a song is added), the
 * optional rig line ("Katana Brown") from the song's settings — so a set
 * shows "guitar: drop c# → drop b" by itself, without anyone typing it.
 */

export type RoleTuning = { strings: number; tuning: number[] };
export type SongRig = {
  roles?: Partial<Record<Part, RoleTuning>> | null;
  rig?: Partial<Record<Part, string>> | null;
  transpose?: number | null;
};

export type Setup = { role: Part; tuning: string | null; rig: string | null };
export type Change = { role: Part; from: Setup; to: Setup; tuning: boolean; rig: boolean };

const ORDER: Part[] = ['guitar', 'bass', 'keys', 'vocals', 'drums', 'other'];
const STANDARD_STRINGS: Partial<Record<Part, number>> = { guitar: 6, bass: 4 };

/** "drop c#", or "5-string standard (b)" when the instrument itself changes */
export function tuningName(role: Part, t: RoleTuning | undefined, transpose = 0): string | null {
  if (!t) return null;
  const name = tuningLabel(t.tuning.map(n => n + transpose));
  return t.strings !== STANDARD_STRINGS[role] ? `${t.strings}-string ${name}` : name;
}

/** what each role plays a song with */
export function setupOf(song: SongRig | null | undefined): Setup[] {
  if (!song) return [];
  const roles = new Set<Part>([...Object.keys(song.roles ?? {}), ...Object.keys(song.rig ?? {})] as Part[]);
  return ORDER.filter(r => roles.has(r)).map(role => ({
    role,
    tuning: tuningName(role, song.roles?.[role], song.transpose ?? 0),
    rig: song.rig?.[role] ?? null,
  }));
}

/** roles that have to change something between two songs */
export function changeovers(from: SongRig | null | undefined, to: SongRig | null | undefined): Change[] {
  if (!from || !to) return [];
  const a = new Map(setupOf(from).map(s => [s.role, s]));
  const out: Change[] = [];
  for (const next of setupOf(to)) {
    const prev = a.get(next.role) ?? { role: next.role, tuning: null, rig: null };
    // a role that isn't in one of the songs has nothing to retune
    const tuning = !!prev.tuning && !!next.tuning && prev.tuning !== next.tuning;
    const rig = !!next.rig && prev.rig !== next.rig;
    if (tuning || rig) out.push({ role: next.role, from: prev, to: next, tuning, rig });
  }
  return out;
}

/** "guitar: drop c# → drop b · Katana Brown/Lead" */
export function describeChange(c: Change): string {
  const parts: string[] = [];
  if (c.tuning) parts.push(`${c.from.tuning} → ${c.to.tuning}`);
  if (c.rig) parts.push(c.to.rig!);
  return `${c.role}: ${parts.join(' · ')}`;
}

/** your role first, then the rest */
export function forRole<T extends { role: Part }>(items: T[], part: Part | null): T[] {
  if (!part) return items;
  return [...items.filter(i => i.role === part), ...items.filter(i => i.role !== part)];
}
