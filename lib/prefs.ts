import type { Layout, Stave } from './player';
import { THEMES, type ThemeId } from './themes';
import { clamp } from './format';
import { BRAND } from './brand';

// ---- local, per-person preferences (never synced) ------------------------------

export type Part = 'guitar' | 'bass' | 'drums' | 'keys' | 'vocals' | 'other';
export type ClickSound = 'synth' | 'studio' | 'beep' | 'clave' | 'wood' | 'cowbell' | 'hat' | 'rim';
export type MonitorMode = 'full' | 'mine' | 'minus' | 'click';
export type Follow = 'smooth' | 'continuous' | 'page' | 'off';
export type MidiAction = 'playPause' | 'stop' | 'next' | 'prev' | 'loop' | 'countIn' | 'click' | 'stage';

export type ClickPrefs = {
  on: boolean;
  level: number;
  sound: ClickSound;
  accent: boolean; // louder, higher first beat
  sub: 1 | 2 | 3 | 4; // clicks per beat
  pan: number; // -1 left … 1 right — hard left = click in one ear
  device: string; // '' = default output
  visual: boolean; // beat lights
  flash: boolean; // flash the screen edge on every downbeat
};

export type Prefs = {
  name: string;
  part: Part | null;
  music: number; // music level
  groove: number; // level of the beats groove the host may run
  musicDevice: string;
  /** the music's sound bank: '' built-in, 'file' a .sf2/.sf3 from this computer, else a url on the server */
  soundBank: string;
  click: ClickPrefs;
  monitor: { mode: MonitorMode; focus: boolean }; // focus = notation shows only my part
  view: { layout: Layout; stave: Stave; zoom: number; follow: Follow; paper: boolean };
  theme: { id: ThemeId; accent: string | null };
  stage: { wakeLock: boolean; hud: 'big' | 'compact'; zoom: number };
  midi: Partial<Record<MidiAction, string>>;
  /** your instrument's tuning — your part's tracks are re-fretted to it in every song */
  myTuning: number[] | null;
  /** which part of the session panel under the notation is open */
  ui: { tab: PanelTab };
};

export type PanelTab = 'mix' | 'groove' | 'setlist' | 'live' | 'band';
export const PANEL_TABS: PanelTab[] = ['mix', 'groove', 'setlist', 'live', 'band'];

export const PARTS: [Part, string][] = [['guitar', 'guitar'], ['bass', 'bass'], ['drums', 'drums'], ['keys', 'keys'], ['vocals', 'vocals'], ['other', 'other']];
export const CLICK_SOUNDS: [ClickSound, string][] = [['studio', 'studio'], ['beep', 'beep'], ['clave', 'clave'], ['wood', 'wood'], ['rim', 'rim'], ['hat', 'hat'], ['cowbell', 'cowbell'], ['synth', 'soundfont']];
export const MONITOR_MODES: [MonitorMode, string, string][] = [
  ['full', 'full mix', 'everything'],
  ['mine', 'my part', 'only my instrument (+ click)'],
  ['minus', 'minus me', 'everything except my instrument — play along'],
  ['click', 'click only', 'no music, just the click'],
];
export const MIDI_ACTIONS: [MidiAction, string][] = [
  ['playPause', 'play / pause'], ['stop', 'stop'], ['next', 'next song'], ['prev', 'previous song'],
  ['loop', 'loop'], ['countIn', 'count-in'], ['click', 'click on/off'], ['stage', 'stage view'],
];

export const defaultPrefs = (): Prefs => ({
  name: '',
  part: null,
  music: 0.8,
  groove: 0.8,
  musicDevice: '',
  soundBank: '',
  click: { on: false, level: 0.7, sound: 'studio', accent: true, sub: 1, pan: 0, device: '', visual: true, flash: false },
  monitor: { mode: 'full', focus: false },
  // 'page' turns the page when the cursor leaves the screen — calmer than gliding along
  view: { layout: 'page', stave: 'default', zoom: 1, follow: 'page', paper: false },
  theme: { id: BRAND.theme, accent: null },
  stage: { wakeLock: true, hud: 'big', zoom: 1.3 },
  midi: {},
  myTuning: null,
  ui: { tab: 'mix' },
});

const PREFS_KEY = 'tabs.prefs.v2';
const OLD_KEY = 'tabs.prefs.v1';

const pick = <T,>(v: unknown, allowed: readonly T[], fb: T): T => (allowed.includes(v as T) ? (v as T) : fb);
const num = (v: unknown, min: number, max: number, fb: number) => (typeof v === 'number' && Number.isFinite(v) ? clamp(v, min, max) : fb);
const bool = (v: unknown, fb: boolean) => (typeof v === 'boolean' ? v : fb);
const obj = (v: unknown): Record<string, any> => (v && typeof v === 'object' ? (v as Record<string, any>) : {});

/** fills gaps and drops junk, so stale or hand-edited storage can never break the app */
export function sanitizePrefs(raw: unknown): Prefs {
  const d = defaultPrefs();
  const r = obj(raw), c = obj(r.click), m = obj(r.monitor), v = obj(r.view), t = obj(r.theme), s = obj(r.stage), midi = obj(r.midi);
  return {
    name: typeof r.name === 'string' ? r.name.slice(0, 40) : d.name,
    part: r.part === null ? null : pick(r.part, PARTS.map(p => p[0]), d.part as Part) ?? null,
    music: num(r.music, 0, 1, d.music),
    groove: num(r.groove, 0, 1, d.groove),
    musicDevice: typeof r.musicDevice === 'string' ? r.musicDevice : '',
    soundBank: typeof r.soundBank === 'string' && (r.soundBank === 'file' || /^\/[\w./%-]*$/.test(r.soundBank)) ? r.soundBank : '',
    click: {
      on: bool(c.on, d.click.on),
      level: num(c.level, 0, 1, d.click.level),
      sound: pick(c.sound, CLICK_SOUNDS.map(x => x[0]), d.click.sound),
      accent: bool(c.accent, d.click.accent),
      sub: pick(c.sub, [1, 2, 3, 4] as const, d.click.sub),
      pan: num(c.pan, -1, 1, 0),
      device: typeof c.device === 'string' ? c.device : '',
      visual: bool(c.visual, d.click.visual),
      flash: bool(c.flash, d.click.flash),
    },
    monitor: { mode: pick(m.mode, MONITOR_MODES.map(x => x[0]), 'full'), focus: bool(m.focus, false) },
    view: {
      layout: pick(v.layout, ['page', 'horizontal'] as const, 'page'),
      stave: pick(v.stave, ['default', 'scoretab', 'tab', 'score'] as const, 'default'),
      zoom: num(v.zoom, 0.5, 2.5, 1),
      follow: pick(v.follow, ['smooth', 'continuous', 'page', 'off'] as const, 'page'),
      paper: bool(v.paper, false),
    },
    theme: {
      id: pick(t.id, THEMES.map(x => x.id), BRAND.theme),
      accent: typeof t.accent === 'string' && /^#[0-9a-f]{6}$/i.test(t.accent) ? t.accent : null,
    },
    stage: { wakeLock: bool(s.wakeLock, true), hud: pick(s.hud, ['big', 'compact'] as const, 'big'), zoom: num(s.zoom, 0.5, 3, 1.3) },
    myTuning: Array.isArray(r.myTuning) && r.myTuning.length >= 4 && r.myTuning.length <= 8 && r.myTuning.every((n: unknown) => Number.isInteger(n) && (n as number) >= 0 && (n as number) < 128) ? r.myTuning : null,
    ui: { tab: pick(obj(r.ui).tab, PANEL_TABS, 'mix') },
    midi: Object.fromEntries(Object.entries(midi).filter(([k, val]) => MIDI_ACTIONS.some(a => a[0] === k) && typeof val === 'string')),
  };
}

export function loadPrefs(): Prefs {
  try {
    const raw = JSON.parse(localStorage.getItem(PREFS_KEY) || 'null');
    // before v3 everyone got 'smooth' by default, which kept the page moving — reset that once
    if (raw) return sanitizePrefs(raw.v === 3 ? raw : { ...raw, view: { ...obj(raw.view), follow: 'page' } });
    // carry over volume, click and view from the first version
    const old = JSON.parse(localStorage.getItem(OLD_KEY) || 'null');
    if (old) return sanitizePrefs({ music: old.master, click: { on: old.clickOn, level: old.click, sound: 'synth' }, view: old.view });
  } catch {}
  return defaultPrefs();
}

export function savePrefs(p: Prefs) {
  try { localStorage.setItem(PREFS_KEY, JSON.stringify({ ...p, v: 3 })); } catch {}
}
