import { SCRIPT_FILE, VENDOR, type AlphaTab, type AlphaTabApi, type Score, type Track } from './alphatab';
import type { BarInfo } from './click';
import type { NotationColors } from './themes';
import type { Follow, MonitorMode, Part } from './prefs';
import { retuneTrack } from './tuning';
import { detectPart } from './parts';

export type TrackInfo = {
  index: number; name: string; short: string; percussion: boolean; strings: number; part: Part;
  tuning: number[]; // as written in the file, highest string first — empty when not a stringed track
};
export type Section = { bar: number; name: string };
export type SongInfo = {
  title: string;
  artist: string;
  album: string;
  tempo: number; // the song's own starting tempo (bpm)
  bars: number;
  tracks: TrackInfo[];
  sections: Section[];
};
export type Position = { tick: number; endTick: number; time: number; endTime: number; bpm: number; bar: number };
export type Range = { startTick: number; endTick: number } | null;
export type TrackMix = { visible: boolean; mute: boolean; solo: boolean; volume: number; tuning: number[] | null };

export type Layout = 'page' | 'horizontal';
export type Stave = 'default' | 'scoretab' | 'tab' | 'score';
export type ViewPrefs = { layout: Layout; stave: Stave; zoom: number; follow: Follow };
/** one bar of clicks before playback — the same plan runs on every screen */
export type CountInPlan = { tick: number; beats: number; beatMs: number };
/** what the score tells about a track before it is drawn — enough to pick the tracks to show */
export type TrackHead = { index: number; name: string; program: number; percussion: boolean };

const STAVE: Record<Stave, number> = { default: 0, scoretab: 1, score: 2, tab: 3 };
const FOLLOW: Record<Follow, number> = { off: 0, continuous: 1, page: 2, smooth: 3 }; // alphaTab ScrollMode

const abs = (path: string) => new URL(path, window.location.href).href;
export const BUILTIN_SOUNDFONT = `${VENDOR}soundfont/sonivox.sf3`;

export const defaultMix = (index: number): TrackMix => ({ visible: index === 0, mute: false, solo: false, volume: 1, tuning: null });

/**
 * Thin wrapper around one alphaTab instance: renders the score, plays it with
 * the built-in synthesizer and reports back what react needs to draw the
 * transport. Knows nothing about rooms — the session hook decides who drives.
 */
export class TabPlayer {
  readonly api: AlphaTabApi;
  private at: AlphaTab;
  private mix: TrackMix[] = [];
  private ready = false;
  private lastBar = 0;
  private lastPos: Position = { tick: 0, endTick: 0, time: 0, endTime: 0, bpm: 0, bar: 0 };
  private song: SongInfo | null = null;
  private disposed = false;
  private monitor: { mode: MonitorMode; mine: Set<number> } = { mode: 'full', mine: new Set() };
  private grid: BarInfo[] | null = null;
  private scrollEl: HTMLElement;
  private shown: number[] = [0]; // tracks drawn by the last load

  /** which tracks a freshly loaded song shows first (default: the first one) */
  pickTracks?: (tracks: TrackHead[]) => number[];

  onSong?: (song: SongInfo | null) => void;
  onPosition?: (pos: Position, isSeek: boolean) => void;
  onPlaying?: (playing: boolean) => void;
  onReady?: () => void;
  onFinished?: () => void;
  onRange?: (range: Range) => void;
  onBusy?: (busy: { soundfont: number | null; rendering: boolean }) => void;
  onError?: (message: string) => void;

  private busy = { soundfont: 0 as number | null, rendering: false };

  constructor(at: AlphaTab, el: HTMLElement, scrollEl: HTMLElement, opts: { interactive: boolean; view: ViewPrefs; notation: NotationColors; soundFont?: string }) {
    this.at = at;
    this.scrollEl = scrollEl;
    this.customSound = !!opts.soundFont;
    this.api = new at.AlphaTabApi(el, {
      // workers are spawned from blobs, so every asset url has to be absolute
      // no lazy loading: alphaTab would blank every part of the sheet that leaves the view and redraw it on the way
      // back — in the one-line layout parts stayed blank, and page turns flashed empty. the whole sheet is drawn once.
      core: { scriptFile: abs(SCRIPT_FILE), fontDirectory: abs(`${VENDOR}font/`), includeNoteBounds: false, enableLazyLoading: false },
      display: {
        scale: opts.view.zoom,
        layoutMode: opts.view.layout === 'horizontal' ? at.LayoutMode.Horizontal : at.LayoutMode.Page,
        staveProfile: STAVE[opts.view.stave],
        resources: opts.notation,
      },
      player: {
        playerMode: at.PlayerMode.EnabledSynthesizer,
        // the vorbis-compressed soundfont is a quarter smaller than the .sf2 — every listener downloads it
        soundFont: opts.soundFont ? abs(opts.soundFont) : abs(BUILTIN_SOUNDFONT),
        scrollElement: scrollEl,
        scrollMode: FOLLOW[opts.view.follow],
        scrollOffsetY: -24,
        enableCursor: true,
        enableAnimatedBeatCursor: true,
        enableElementHighlighting: true,
        enableUserInteraction: opts.interactive,
      },
    } as any);

    const api = this.api;
    api.soundFontLoad.on(e => this.setBusy({ soundfont: e.total ? e.loaded / e.total : 0 }));
    api.soundFontLoaded.on(() => this.setBusy({ soundfont: null }));
    api.player?.soundFontLoadFailed?.on(() => {
      this.setBusy({ soundfont: null });
      if (!this.customSound) { this.onError?.('could not load the sounds'); return; }
      this.customSound = false;
      this.onError?.('could not load that sound bank — back to the built-in one');
      try { api.loadSoundFont(abs(BUILTIN_SOUNDFONT), false); } catch {}
    });
    api.renderStarted.on(() => this.setBusy({ rendering: true }));
    api.renderFinished.on(() => this.setBusy({ rendering: false }));
    // no cursor nudging after a re-layout: alphaTab redraws the cursor itself (postRenderFinished),
    // and setting tickPosition here would seek — an audible skip, and a seek sent to the whole band
    // on every zoom, resize, fullscreen or track toggle

    api.scoreLoaded.on(score => {
      this.ready = false;
      this.grid = null;
      this.song = describe(score);
      const shown = new Set(this.shown.filter(i => i < score.tracks.length));
      if (!shown.size) shown.add(0);
      this.mix = score.tracks.map((_, i) => ({ ...defaultMix(i), visible: shown.has(i) }));
      this.modelShift = 0;
      this.lastBar = 0;
      // a new song starts at its top, not wherever the last one was scrolled to
      this.scrollEl.scrollTop = 0;
      this.scrollEl.scrollLeft = 0;
      this.onSong?.(this.song);
    });

    // midi is rebuilt per song: re-apply this listener's mix, then report ready.
    // playerReady fires after every midi load; api.midiLoaded is avoided on purpose —
    // subscribing to it recurses forever inside alphaTab 1.8's worker synth (loadedMidiInfo getter).
    api.playerReady.on(() => setTimeout(() => {
      if (this.disposed || this.ready || !api.isReadyForPlayback || !api.score) return;
      this.ready = true;
      this.grid = null;
      this.applyAudio();
      this.onReady?.();
    }, 0));

    api.playerStateChanged.on(e => {
      const playing = (e.state as number) === 1;
      // a pause that came in before the audio was running (play → pause in quick succession, or a host's
      // pause racing a listener's start): alphaTab ignores it then, so pause again once it is running —
      // a beat later, alphaTab throws when its audio source is paused that early
      if (playing && !this.wanted) window.setTimeout(() => { if (!this.disposed && !this.wanted && this.isPlaying) this.api.pause(); }, 60);
      this.onPlaying?.(playing);
    });
    // alphaTab also reports "finished" every time a loop wraps — that's not the end of the song
    api.playerFinished.on(() => { if (this.api.isLooping) return; this.wanted = false; this.onFinished?.(); });
    api.playerPositionChanged.on(e => {
      const bar = this.barAt(e.currentTick);
      this.lastPos = { tick: e.currentTick, endTick: e.endTick, time: e.currentTime, endTime: e.endTime, bpm: e.modifiedTempo, bar };
      this.lastPosAt = performance.now();
      this.onPosition?.(this.lastPos, e.isSeek);
    });
    api.playbackRangeChanged.on(e => this.onRange?.(e.playbackRange ? { startTick: e.playbackRange.startTick, endTick: e.playbackRange.endTick } : null));
    api.error.on(e => this.onError?.(e?.message || 'something went wrong'));
  }

  private setBusy(patch: Partial<typeof this.busy>) {
    this.busy = { ...this.busy, ...patch };
    this.onBusy?.(this.busy);
  }

  get isReady() { return this.ready && this.api.isReadyForPlayback; }
  get isPlaying() { return (this.api.playerState as number) === 1; }
  /**
   * What we last asked for. alphaTab reports a started playback only once its
   * audio output is running, so right after play() isPlaying is still false —
   * code that mirrors a remote state has to look at this instead.
   */
  get wantsPlay() { return this.wanted; }
  private wanted = false;
  get position() { return this.lastPos; }
  private lastPosAt = 0;
  private customSound = false;

  /**
   * Where playback is right now. alphaTab reports its position in bursts (one report per audio
   * block, ~50–100 ms apart), so the last report is always a little behind; while playing, this
   * moves it on by the time since — what drift checks and heartbeats should compare.
   */
  get liveTick() {
    const p = this.lastPos;
    if (!this.isPlaying || !p.bpm || !this.lastPosAt) return this.tick;
    const ms = Math.min(250, performance.now() - this.lastPosAt);
    return p.tick + (ms * p.bpm * 960) / 60000;
  }
  get tick() { return this.api.tickPosition; }
  get tracks(): TrackMix[] { return this.mix; }
  get info() { return this.song; }

  load(bytes: Uint8Array): boolean {
    this.ready = false;
    this.wanted = false;
    try {
      // read the file here (as api.load does) so the first drawing already shows the right tracks —
      // your part instead of whatever happens to be track 1, without drawing the song twice
      const score = this.at.importer.ScoreLoader.loadScoreFromBytes(bytes, this.api.settings);
      const heads: TrackHead[] = score.tracks.map((t, i) => ({
        index: i, name: t.name?.trim() || '', program: t.playbackInfo?.program ?? 0, percussion: t.isPercussion,
      }));
      const picked = (this.pickTracks?.(heads) ?? []).filter(i => i >= 0 && i < heads.length);
      this.shown = picked.length ? picked : [0];
      this.api.renderScore(score, this.shown);
      return true;
    } catch (err) {
      this.onError?.((err as Error).message || 'could not read this file');
      return false;
    }
  }

  play() { if (!this.isReady) return; this.wanted = true; this.api.play(); }
  // alphaTab throws inside its audio output when pausing/stopping something that never started —
  // a pause before the start shows up is caught in playerStateChanged
  pause() { this.wanted = false; if (this.isPlaying) this.api.pause(); }
  stop() { this.wanted = false; if (this.isReady) this.api.stop(); }
  seek(tick: number) { if (this.isReady) this.api.tickPosition = Math.max(0, Math.round(tick)); }

  /** the song's tempo (bpm, without the speed factor) at a playback tick — tempo changes and repeats included */
  tempoAt(tick: number): number {
    const bars = this.api.tickCache?.masterBars;
    const fallback = this.song?.tempo ?? 120;
    if (!bars?.length) return fallback;
    let lo = 0, hi = bars.length - 1;
    while (lo < hi) {
      const mid = (lo + hi + 1) >> 1;
      if (bars[mid].start <= tick) lo = mid; else hi = mid - 1;
    }
    let tempo = 0;
    for (const c of bars[lo].tempoChanges) if (c.tick <= tick || !tempo) tempo = c.tempo;
    return tempo > 0 ? tempo : fallback;
  }

  /**
   * One bar of the time signature playback starts in, at the tempo it starts with (speed included).
   * Compound meters (6/8, 12/8) count in dotted quarters, like the click.
   */
  countInPlan(): CountInPlan | null {
    if (!this.isReady) return null;
    const tick = Math.max(0, Math.round(this.tick));
    const grid = this.beatGrid();
    let bar = grid[0];
    for (const b of grid) { if (b.start > tick) break; bar = b; }
    const num = bar?.num || 4, den = bar?.den || 4;
    const compound = den === 8 && num % 3 === 0 && num >= 6;
    const beats = compound ? num / 3 : num;
    const beatQuarters = compound ? (4 * 3) / den : 4 / den;
    const bpm = this.tempoAt(tick) * (this.speed || 1);
    return { tick, beats: Math.min(16, Math.max(1, beats)), beatMs: (60000 / bpm) * beatQuarters };
  }

  /** tick at which a bar starts in playback time (repeats expanded) */
  barStart(barIndex: number): number | null {
    const mb = this.api.score?.masterBars[barIndex];
    if (!mb || !this.isReady) return null;
    try { return this.api.tickCache?.getMasterBarStart(mb) ?? null; } catch { return null; }
  }

  /** every bar as played (repeats expanded) with its time signature — the click's grid */
  beatGrid(): BarInfo[] {
    if (this.grid) return this.grid;
    const bars = this.api.tickCache?.masterBars;
    if (!bars?.length) return [];
    this.grid = bars.map(b => ({ start: b.start, end: b.end, num: b.masterBar.timeSignatureNumerator, den: b.masterBar.timeSignatureDenominator }));
    return this.grid;
  }

  set speed(v: number) { this.api.playbackSpeed = v; }
  get speed() { return this.api.playbackSpeed; }
  set loop(v: boolean) { this.api.isLooping = v; }
  get loop() { return this.api.isLooping; }
  set masterVolume(v: number) { this.api.masterVolume = v; }
  set metronomeVolume(v: number) { this.api.metronomeVolume = v; }
  // alphaTab's own count-in stays off (countInVolume 0): it shows nothing, reports no position while
  // it runs and would also count in a listener who joins mid-song — the session counts in instead

  /**
   * The song as a standard midi file, one track per instrument (format 1) — as you hear it:
   * at the session's tempo and moved by its transposition (drums stay). Null without a song.
   */
  midiFile(speed: number): Uint8Array | null {
    const score = this.api.score;
    if (!score) return null;
    const m = this.at.midi;
    const file = new m.MidiFile();
    file.format = m.MidiFileFormat.MultiTrack;
    const handler = new m.AlphaSynthMidiFileHandler(file, true);
    const drums = new Set<number>();
    for (const t of score.tracks) if (t.isPercussion) { drums.add(t.playbackInfo.primaryChannel); drums.add(t.playbackInfo.secondaryChannel); }
    const shift = this.shift;
    // the generator writes through the handler: move pitched notes and scale the tempo on the way
    const shaped = new Proxy(handler, {
      get(target, prop) {
        if (prop === 'addNote') {
          return (track: number, start: number, length: number, key: number, velocity: number, channel: number) =>
            target.addNote(track, start, length, drums.has(channel) ? key : Math.min(127, Math.max(0, key + shift)), velocity, channel);
        }
        if (prop === 'addTempo') return (tick: number, tempo: number) => target.addTempo(tick, tempo * speed);
        const v = (target as any)[prop];
        return typeof v === 'function' ? v.bind(target) : v;
      },
    });
    new m.MidiFileGenerator(score, this.api.settings, shaped).generate();
    return file.toBinary();
  }

  get range(): Range {
    const r = this.api.playbackRange;
    return r ? { startTick: r.startTick, endTick: r.endTick } : null;
  }
  set range(r: Range) {
    const cur = this.range;
    if (cur?.startTick === r?.startTick && cur?.endTick === r?.endTick) return;
    if (!r) { this.api.playbackRange = null; this.api.clearPlaybackRangeHighlight?.(); return; }
    const pr = new this.at.synth.PlaybackRange();
    pr.startTick = r.startTick;
    pr.endTick = r.endTick;
    this.api.playbackRange = pr;
  }

  setView(view: ViewPrefs) {
    const d = this.api.settings.display;
    d.scale = view.zoom;
    d.layoutMode = view.layout === 'horizontal' ? this.at.LayoutMode.Horizontal : this.at.LayoutMode.Page;
    d.staveProfile = STAVE[view.stave] as any;
    this.api.updateSettings();
    if (this.api.score) this.api.render();
  }

  /** auto-scroll only — no re-render needed */
  setFollow(follow: Follow) {
    this.api.settings.player.scrollMode = FOLLOW[follow] as any;
    this.api.updateSettings();
  }

  scrollToCursor() {
    try { this.api.scrollToCursor(); } catch {}
  }

  /** re-frets a track for another tuning (null = as written); returns notes that didn't fit */
  setTrackTuning(index: number, tuning: number[] | null): number {
    const score = this.api.score;
    const t = this.mix[index];
    if (!score || !t) return 0;
    const unplayable = retuneTrack(score, index, tuning, this.shift);
    this.mix = this.mix.map((m, i) => (i === index ? { ...m, tuning } : m));
    // pitches don't change, so the midi stays — only the drawing does
    if (t.visible) this.api.render();
    return unplayable;
  }

  get transpose() { return this.shift; }
  private shift = 0;

  /**
   * Moves the whole song up or down by semitones: every pitched track sounds
   * that much higher/lower, and guitar & bass tabs keep their frets — play
   * the same tab on a guitar tuned down (or up) by that much. Drums stay.
   * Returns notes that didn't fit a re-fretted track.
   */
  setTranspose(semitones: number): number {
    const score = this.api.score;
    this.shift = semitones;
    if (!score) return 0;
    let unplayable = 0;
    // a freshly loaded song is as written (shift 0) — only touch the model when it differs
    if (semitones !== this.modelShift) {
      score.tracks.forEach((_, i) => { unplayable += retuneTrack(score, i, this.mix[i]?.tuning ?? null, semitones); });
      this.modelShift = semitones;
      this.api.render();
    }
    this.applyTransposition();
    return unplayable;
  }
  private modelShift = 0;

  /** alphaTab transposes per midi channel, live; drums would turn into other drums, so they're left out */
  private applyTransposition() {
    const score = this.api.score;
    if (!score || !this.isReady) return;
    const pitched = score.tracks.filter(t => !t.isPercussion);
    if (pitched.length) this.api.changeTrackTranspositionPitch(pitched, this.shift);
  }

  setNotation(colors: NotationColors) {
    this.api.settings.fillFromJson({ display: { resources: colors } } as any);
    this.api.updateSettings();
    if (this.api.score) this.api.render();
  }

  /**
   * Another sound bank for the music: a url (a bigger general midi soundfont on the server) or the
   * bytes of a .sf2/.sf3 file from this computer; null goes back to the built-in one.
   */
  setSoundFont(source: string | Uint8Array | null) {
    const wasPlaying = this.isPlaying;
    if (wasPlaying) this.pause();
    this.setBusy({ soundfont: 0 });
    this.customSound = !!source;
    try {
      this.api.loadSoundFont(source instanceof Uint8Array ? source : abs(source || BUILTIN_SOUNDFONT), false);
    } catch (err) {
      this.onError?.((err as Error).message || 'could not load that sound bank');
    }
  }

  async setOutputDevice(deviceId: string) {
    try {
      if (!deviceId) { await this.api.setOutputDevice(null); return true; }
      const devices = await this.api.enumerateOutputDevices();
      const d = devices.find(x => x.deviceId === deviceId);
      if (!d) return false;
      await this.api.setOutputDevice(d);
      return true;
    } catch {
      return false;
    }
  }

  // ---- per-listener track mix & monitoring (never synced) --------------------------

  setTrack(index: number, patch: Partial<TrackMix>) {
    const t = this.mix[index];
    if (!t || !this.api.score) return;
    const next = { ...t, ...patch };
    // keep at least one track on screen
    if (patch.visible === false && this.mix.filter(m => m.visible).length <= 1) next.visible = true;
    this.mix = this.mix.map((m, i) => (i === index ? next : m));
    if (patch.mute !== undefined || patch.solo !== undefined || patch.volume !== undefined) this.applyAudio();
    if (patch.visible !== undefined && next.visible !== t.visible) this.renderVisible();
  }

  showOnly(index: number) { this.showTracks([index]); }

  showTracks(indices: number[]) {
    const set = new Set(indices.filter(i => i >= 0 && i < this.mix.length));
    if (!set.size) return;
    const same = this.mix.every((m, i) => m.visible === set.has(i));
    this.mix = this.mix.map((m, i) => ({ ...m, visible: set.has(i) }));
    if (!same) this.renderVisible();
  }

  /** monitor mixes layer on top of the manual mute/solo of each strip */
  setMonitor(mode: MonitorMode, mine: number[]) {
    this.monitor = { mode, mine: new Set(mine) };
    this.applyAudio();
  }

  /** which tracks are actually audible right now (for dimming strips) */
  audible(): boolean[] {
    return this.effective().map(e => !e.mute);
  }

  private effective() {
    const { mode, mine } = this.monitor;
    const focus = mine.size > 0;
    const anySolo = mode === 'full' && this.mix.some(m => m.solo);
    return this.mix.map((m, i) => {
      let mute = m.mute;
      if (mode === 'click') mute = true;
      else if (mode === 'mine' && focus) mute = mute || !mine.has(i);
      else if (mode === 'minus' && focus) mute = mute || mine.has(i);
      const solo = mode === 'full' && m.solo;
      return { mute: mute || (anySolo && !solo), solo, volume: m.volume };
    });
  }

  private applyAudio() {
    const score = this.api.score;
    if (!score) return;
    this.effective().forEach((e, i) => {
      const track = score.tracks[i];
      if (!track) return;
      this.api.changeTrackMute([track], e.mute);
      this.api.changeTrackSolo([track], false); // solo is folded into mute above
      this.api.changeTrackVolume([track], e.volume);
    });
    this.applyTransposition();
  }

  private renderVisible() {
    const score = this.api.score;
    if (!score) return;
    const tracks: Track[] = score.tracks.filter((_, i) => this.mix[i]?.visible);
    if (tracks.length) this.api.renderTracks(tracks);
  }

  // ---- helpers -------------------------------------------------------------

  private barAt(tick: number): number {
    const bars = this.api.tickCache?.masterBars;
    if (!bars?.length) return this.lastBar;
    // playback ticks include repeats, so search the expanded lookup, not the score
    let lo = 0, hi = bars.length - 1;
    while (lo < hi) {
      const mid = (lo + hi + 1) >> 1;
      if (bars[mid].start <= tick) lo = mid; else hi = mid - 1;
    }
    this.lastBar = bars[lo].masterBar.index;
    return this.lastBar;
  }

  dispose() {
    this.disposed = true;
    try { this.api.destroy(); } catch {}
  }
}

function describe(score: Score): SongInfo {
  const sections: Section[] = [];
  score.masterBars.forEach((mb, i) => {
    if (mb.section) sections.push({ bar: i, name: (mb.section.text || mb.section.marker || `part ${sections.length + 1}`).trim() });
  });
  return {
    title: score.title?.trim() || '',
    artist: score.artist?.trim() || '',
    album: score.album?.trim() || '',
    tempo: score.tempo > 0 ? Math.round(score.tempo) : 120,
    bars: score.masterBars.length,
    sections,
    tracks: score.tracks.map((t, i) => {
      const name = t.name?.trim() || `track ${i + 1}`;
      return {
        index: i,
        name,
        short: t.shortName?.trim() || '',
        percussion: t.isPercussion,
        strings: t.staves[0]?.tuning?.length ?? 0,
        part: detectPart(name, t.playbackInfo?.program ?? 0, t.isPercussion),
        tuning: !t.isPercussion && t.staves[0]?.isStringed ? t.staves[0].stringTuning.tunings.slice() : [],
      };
    }),
  };
}
