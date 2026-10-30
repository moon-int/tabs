import type { ClickPrefs, ClickSound } from './prefs';
import { Synth, hitVelocity, swingOffset, type TrackParams } from './beats/engine';
import { kits, TRACK_COUNT } from './beats/kits';
import { grooveMatrix, type Groove } from './groove';

export type BarInfo = { start: number; end: number; num: number; den: number };
export type Beat = { beat: number; beats: number; bar: number };
type Kind = 'accent' | 'beat' | 'sub';

const TICKS_PER_QUARTER = 960;
// scheduled this far ahead on the audio clock: enough that a busy page (or a phone) never makes it stutter
const LOOKAHEAD_S = 0.18;
const TIMER_MS = 25;
const ANCHOR_WINDOW = 48; // ~2 s of position reports

/**
 * A scheduler on its own AudioContext, locked to alphaTab's playback.
 *
 * alphaTab reports its position in bursts (one report per audio block), so
 * every report arrives a little late but never early. Each report gives an
 * estimate of when tick 0 would have sounded on our clock; the earliest of
 * the recent estimates is the most accurate one. Events are then scheduled
 * ~120 ms ahead with sample accuracy, like the beats engine does.
 *
 * Owning the AudioContext means each lane can go to its own output device:
 * the click to the in-ears, the groove to the speakers with the music.
 */
abstract class LockedLane {
  protected ctx: AudioContext | null = null;
  private playing = false;
  protected rate = 0; // ticks per second at the current tempo
  private bases: number[] = []; // ctx time at which tick 0 would sound, one per report
  private lastTick = -1;
  private scheduledTo = -1; // ticks up to which events are scheduled
  private timer: number | undefined;
  private sink = '';
  private startMark: { at: number; tick: number } | null = null;

  /**
   * Seconds between asking alphaTab to play and its first note sounding (worker, synth, output
   * buffer). Measured on every start that follows a count-in, so the downbeat lands right after it.
   */
  startLatency = 0.12;

  getBars: () => BarInfo[] = () => [];
  getRangeEnd: () => number | null = () => null;

  /** builds the lane's audio graph on a fresh context */
  protected abstract init(ctx: AudioContext): void;
  /** schedule everything in [fromTick, toTick]; `at(tick)` is its time on this context */
  protected abstract scheduleRange(fromTick: number, toTick: number, at: (tick: number) => number, now: number): void;
  /** drop whatever was scheduled but hasn't sounded yet */
  protected cancel() {}

  /** must run inside a user gesture once (autoplay policy) */
  unlock() {
    if (!this.ctx) {
      const Ctx = window.AudioContext || (window as any).webkitAudioContext;
      this.ctx = new Ctx({ latencyHint: 'interactive' });
      this.init(this.ctx);
      if (this.sink) this.setSink(this.sink);
    }
    if (this.ctx.state === 'suspended') this.ctx.resume().catch(() => {});
  }

  async setSink(deviceId: string) {
    this.sink = deviceId;
    const ctx = this.ctx as AudioContext & { setSinkId?: (id: string) => Promise<void> };
    if (!ctx?.setSinkId) return false;
    try { await ctx.setSinkId(deviceId || ''); return true; } catch { return false; }
  }

  static get canPickDevice() {
    return typeof window !== 'undefined' && 'setSinkId' in AudioContext.prototype;
  }

  // ---- fed by the player --------------------------------------------------------

  protected get isRunning() { return this.playing; }

  setPlaying(playing: boolean) {
    this.playing = playing;
    this.reset();
    window.clearInterval(this.timer);
    if (playing) this.timer = window.setInterval(() => this.schedule(), TIMER_MS);
    else this.cancel();
  }

  /** every position report from alphaTab while playing */
  position(tick: number, bpm: number, isSeek: boolean) {
    if (!this.ctx || !this.playing || bpm <= 0) return;
    const rate = (bpm * TICKS_PER_QUARTER) / 60;
    // a jump (seek, loop wrap) or tempo change invalidates the clock estimate
    if (isSeek || tick < this.lastTick - 1 || Math.abs(rate - this.rate) > 0.01) {
      if (this.lastTick >= 0) this.startMark = null; // not a clean start any more
      this.reset();
      this.cancel();
      this.scheduledTo = tick - 1;
    }
    this.rate = rate;
    this.lastTick = tick;
    this.bases.push(this.ctx.currentTime - tick / rate);
    if (this.bases.length > ANCHOR_WINDOW) this.bases.shift();
    // ~a second into a start: when did its first tick actually sound, compared to when we asked?
    const mark = this.startMark;
    if (mark && this.bases.length >= 16) {
      this.startMark = null;
      const measured = Math.min(...this.bases) + mark.tick / rate - mark.at;
      if (measured > 0 && measured < 0.6) this.startLatency = this.startLatency * 0.4 + measured * 0.6;
    }
  }

  /** call right when asking the player to start at `tick` — calibrates startLatency */
  markStart(tick: number) {
    if (this.ctx) this.startMark = { at: this.ctx.currentTime, tick };
  }

  private reset() {
    this.bases = [];
    this.lastTick = -1;
    this.scheduledTo = -1;
  }

  private schedule() {
    const ctx = this.ctx;
    if (!ctx || !this.bases.length || !this.rate) return;
    const base = Math.min(...this.bases);
    const now = ctx.currentTime;
    const fromTick = Math.max(this.scheduledTo + 1, Math.ceil((now - base) * this.rate));
    let toTick = Math.floor((now + LOOKAHEAD_S - base) * this.rate);
    if (toTick < fromTick) return;
    const rangeEnd = this.getRangeEnd();
    if (rangeEnd !== null) toTick = Math.min(toTick, rangeEnd - 1);
    if (toTick >= fromTick) this.scheduleRange(fromTick, toTick, tick => base + tick / this.rate, now);
    this.scheduledTo = Math.max(this.scheduledTo, toTick);
  }

  dispose() {
    window.clearInterval(this.timer);
    this.cancel();
    this.ctx?.close().catch(() => {});
    this.ctx = null;
  }
}

/** the metronome: beat lights for everyone, and a click if it's switched on */
export class ClickEngine extends LockedLane {
  onBeat?: (b: Beat) => void;

  private out: GainNode | null = null;
  private countOut: GainNode | null = null;
  private panner: StereoPannerNode | null = null;
  private noise: AudioBuffer | null = null;
  private prefs: ClickPrefs;
  private audible = false; // own sounds on (false when off or using the soundfont click)
  private timeouts = new Set<number>();
  private sources = new Set<AudioScheduledSourceNode>();
  private countTimeouts = new Set<number>();
  private countSources = new Set<AudioScheduledSourceNode>();

  constructor(prefs: ClickPrefs) {
    super();
    this.prefs = prefs;
  }

  protected init(ctx: AudioContext) {
    // louder than a plain oscillator: a fixed boost into a limiter, so the click cuts through
    // a full band mix in the in-ears without ever clipping
    const boost = ctx.createGain();
    boost.gain.value = CLICK_BOOST;
    const limiter = ctx.createDynamicsCompressor();
    limiter.threshold.value = -4;
    limiter.knee.value = 0;
    limiter.ratio.value = 20;
    limiter.attack.value = 0.001;
    limiter.release.value = 0.06;
    boost.connect(limiter).connect(ctx.destination);
    this.panner = ctx.createStereoPanner();
    this.panner.connect(boost);
    this.out = ctx.createGain();
    this.out.connect(this.panner);
    // the count-in has its own level: it is heard even with the click switched off
    this.countOut = ctx.createGain();
    this.countOut.connect(this.panner);
    this.noise = makeNoise(ctx);
    this.configure(this.prefs, true);
  }

  configure(prefs: ClickPrefs, force = false) {
    const deviceChanged = force || prefs.device !== this.prefs.device;
    this.prefs = prefs;
    this.audible = prefs.on && prefs.sound !== 'synth' && prefs.level > 0;
    if (!this.ctx) return;
    this.out!.gain.setTargetAtTime(prefs.level, this.ctx.currentTime, 0.01);
    this.countOut!.gain.setTargetAtTime(countLevel(prefs), this.ctx.currentTime, 0.01);
    this.panner!.pan.setTargetAtTime(prefs.pan, this.ctx.currentTime, 0.01);
    if (deviceChanged) this.setSink(prefs.device);
  }

  /**
   * One bar of count-in clicks, sample-accurate on this lane (so in the in-ears with the click).
   * `late` is how long ago the count-in started elsewhere (the host's, seen by a listener):
   * beats already gone are skipped. `onBeat(i)` fires as beat i sounds. Returns the seconds from
   * now until the bar is over — the moment the song's first note is due.
   */
  countIn(beats: number, beatSec: number, late: number, onBeat: (beat: number) => void): number {
    this.unlock();
    this.cancelCountIn();
    const lead = 0.06; // time to get the first click scheduled
    const ctx = this.ctx;
    if (!ctx || ctx.state !== 'running') {
      // no audio clock (yet): still count visibly, on the wall clock
      for (let i = 0; i < beats; i++) {
        const ms = (lead - late + i * beatSec) * 1000;
        if (ms < -5) continue;
        const id = window.setTimeout(() => { this.countTimeouts.delete(id); onBeat(i); }, Math.max(0, ms));
        this.countTimeouts.add(id);
      }
      return lead - late + beats * beatSec;
    }
    const now = ctx.currentTime;
    const start = now + lead - late;
    for (let i = 0; i < beats; i++) {
      const t = start + i * beatSec;
      if (t < now - 0.005) continue;
      const kind: Kind = i === 0 && this.prefs.accent ? 'accent' : 'beat';
      voices[this.prefs.sound === 'synth' ? 'beep' : this.prefs.sound](ctx, this.countOut!, this.noise!, kind, t, kind === 'accent' ? 1 : 0.8, s => {
        this.countSources.add(s);
        s.onended = () => this.countSources.delete(s);
      });
      const id = window.setTimeout(() => { this.countTimeouts.delete(id); onBeat(i); }, Math.max(0, (t - now) * 1000));
      this.countTimeouts.add(id);
    }
    return start + beats * beatSec - now;
  }

  cancelCountIn() {
    this.countTimeouts.forEach(id => window.clearTimeout(id));
    this.countTimeouts.clear();
    this.countSources.forEach(s => { try { s.stop(); } catch {} });
    this.countSources.clear();
  }

  protected scheduleRange(fromTick: number, toTick: number, at: (tick: number) => number, now: number) {
    for (const { tick, kind, beat } of gridBetween(this.getBars(), fromTick, toTick, this.prefs.sub)) {
      const t = at(tick);
      if (t < now - 0.005) continue;
      if (this.audible) this.play(this.prefs.accent || kind !== 'accent' ? kind : 'beat', t);
      if (beat && this.onBeat) {
        const delay = Math.max(0, (t - now) * 1000);
        const id = window.setTimeout(() => { this.timeouts.delete(id); this.onBeat?.(beat); }, delay);
        this.timeouts.add(id);
      }
    }
  }

  protected cancel() {
    this.timeouts.forEach(id => window.clearTimeout(id));
    this.timeouts.clear();
    this.sources.forEach(s => { try { s.stop(); } catch {} });
    this.sources.clear();
  }

  dispose() {
    this.cancelCountIn();
    super.dispose();
  }

  /** a single click right now — for the settings preview */
  preview(kind: Kind = 'accent') {
    this.unlock();
    if (this.ctx && this.prefs.sound !== 'synth') this.play(kind, this.ctx.currentTime + 0.02, true);
  }

  // ---- sounds ---------------------------------------------------------------------

  private play(kind: Kind, t: number, force = false) {
    if (!this.ctx || (!this.audible && !force)) return;
    const vel = kind === 'accent' ? 1 : kind === 'beat' ? 0.72 : 0.42;
    voices[this.prefs.sound === 'synth' ? 'beep' : this.prefs.sound](this.ctx, this.out!, this.noise!, kind, t, vel, s => {
      this.sources.add(s);
      s.onended = () => this.sources.delete(s);
    });
  }
}

const SIXTEENTH = TICKS_PER_QUARTER / 4;

/**
 * A mo-tion beats drum pattern locked to the song: step n of the pattern
 * falls on the n-th 16th of every bar, at the song's tempo — tempo changes,
 * loops and seeks included. Uses beats' own synth and kits, so it sounds the
 * same as in beats.
 */
export class GrooveEngine extends LockedLane {
  private synth: Synth | null = null;
  private gain: GainNode | null = null;
  private groove: Groove | null = null;
  private matrix: number[][] = [];
  private queued: number[][] | null = null; // the next pattern, waiting for a downbeat
  private tracks: TrackParams[] = [];
  private level = 0.8;
  private freeTimer: number | undefined;

  protected init(ctx: AudioContext) {
    this.synth = new Synth(ctx);
    this.gain = ctx.createGain();
    this.synth.output.connect(this.gain).connect(ctx.destination);
    this.apply();
  }

  setGroove(groove: Groove | null) {
    const was = this.groove;
    this.groove = groove && groove.on ? groove : null;
    const matrix = this.groove ? grooveMatrix(this.groove.rows) : [];
    // while it runs, a new pattern starts on the next downbeat — never in the middle of a bar
    const running = !!was && !!this.groove && (this.isRunning || this.freeTimer !== undefined);
    if (running && JSON.stringify(matrix) !== JSON.stringify(this.matrix)) this.queued = matrix;
    else { this.matrix = matrix; this.queued = null; }
    this.tracks = Array.from({ length: TRACK_COUNT }, (_, i) => {
      const t = this.groove?.mix?.[i];
      const live = !!this.groove?.mutes?.[i];
      return t
        ? { gain: num(t[0], 0, 1, 0.8), pan: num(t[1], -1, 1, 0), tune: num(t[2], -12, 12, 0), decay: num(t[3], 0.25, 2, 1), mute: !!t[4] || live, solo: !!t[5] }
        : { gain: 0.8, pan: 0, tune: 0, decay: 1, mute: live, solo: false };
    });
    this.apply();
  }

  setLevel(level: number) {
    this.level = level;
    this.apply();
  }

  private apply() {
    if (!this.ctx || !this.synth || !this.gain) return;
    this.synth.setKit(kits[this.groove?.kit ?? 0] ?? kits[0]);
    this.synth.setTracks(this.tracks);
    this.synth.setVolume(1);
    this.gain.gain.setTargetAtTime(this.level, this.ctx.currentTime, 0.02);
  }

  /**
   * Runs the groove on its own clock at `bpm` in 4/4 — between songs, when nothing else keeps time.
   * `late` (s): how long ago the host started it, so every screen lands on the same beat.
   */
  runFree(bpm: number, late = 0) {
    this.unlock();
    const ctx = this.ctx;
    if (!ctx) return;
    this.stopFree();
    const rate = (bpm * TICKS_PER_QUARTER) / 60;
    const t0 = ctx.currentTime + 0.05 - late;
    let scheduledTo = -1;
    const run = () => {
      const now = ctx.currentTime;
      const from = Math.max(scheduledTo + 1, Math.ceil((now - t0) * rate));
      const to = Math.floor((now + LOOKAHEAD_S - t0) * rate);
      if (to < from) return;
      const first = Math.max(0, Math.floor(from / FREE_BAR)), last = Math.floor(to / FREE_BAR);
      const bars: BarInfo[] = [];
      for (let b = first; b <= last; b++) bars.push({ start: b * FREE_BAR, end: (b + 1) * FREE_BAR, num: 4, den: 4 });
      this.scheduleBars(bars, from, to, tick => t0 + tick / rate, now, rate);
      scheduledTo = to;
    };
    run();
    this.freeTimer = window.setInterval(run, 25);
  }

  stopFree() {
    window.clearInterval(this.freeTimer);
    this.freeTimer = undefined;
  }

  get runningFree() { return this.freeTimer !== undefined; }

  dispose() {
    this.stopFree();
    super.dispose();
  }

  protected scheduleRange(fromTick: number, toTick: number, at: (tick: number) => number, now: number) {
    this.scheduleBars(this.getBars(), fromTick, toTick, at, now, this.rate);
  }

  private scheduleBars(bars: BarInfo[], fromTick: number, toTick: number, at: (tick: number) => number, now: number, rate: number) {
    const synth = this.synth, g = this.groove;
    if (!synth || !g || this.level <= 0 || !bars.length) return;
    const anySolo = this.tracks.some(t => t.solo);
    const sixteenthSec = SIXTEENTH / rate;
    let lo = 0, hi = bars.length - 1;
    while (lo < hi) { const mid = (lo + hi + 1) >> 1; if (bars[mid].start <= fromTick) lo = mid; else hi = mid - 1; }
    for (let b = lo; b < bars.length && bars[b].start <= toTick; b++) {
      const bar = bars[b];
      for (let step = 0; step < STEPS_PER_BAR; step++) {
        const tick = bar.start + step * SIXTEENTH;
        if (tick >= bar.end) break; // shorter bars use the first steps
        if (tick < fromTick || tick > toTick) continue;
        if (step === 0 && this.queued) { this.matrix = this.queued; this.queued = null; } // the downbeat a switch waits for
        const t = at(tick) + swingOffset(step, g.swing, sixteenthSec);
        if (t < now - 0.005) continue;
        this.matrix.forEach((row, r) => {
          const vel = hitVelocity(row[step], this.tracks[r], anySolo);
          if (vel != null) synth.play(r, t, vel);
        });
      }
    }
  }
}

const FREE_BAR = TICKS_PER_QUARTER * 4;
const STEPS_PER_BAR = 16;
const num = (v: unknown, min: number, max: number, fb: number) => (typeof v === 'number' && Number.isFinite(v) ? Math.min(max, Math.max(min, v)) : fb);

/** beat & subdivision ticks between two ticks, following the score's time signatures */
export function gridBetween(bars: BarInfo[], from: number, to: number, sub: number) {
  const out: { tick: number; kind: Kind; beat: Beat | null }[] = [];
  if (!bars.length || to < from) return out;
  let lo = 0, hi = bars.length - 1;
  while (lo < hi) { const mid = (lo + hi + 1) >> 1; if (bars[mid].start <= from) lo = mid; else hi = mid - 1; }
  for (let b = lo; b < bars.length && bars[b].start <= to; b++) {
    const bar = bars[b];
    // compound meters (6/8, 9/8, 12/8) count in dotted quarters
    const compound = bar.den === 8 && bar.num % 3 === 0 && bar.num >= 6;
    const beatLen = compound ? (TICKS_PER_QUARTER * 4 * 3) / bar.den : (TICKS_PER_QUARTER * 4) / bar.den;
    const beats = compound ? bar.num / 3 : bar.num;
    const step = beatLen / sub;
    for (let i = 0; i < beats * sub; i++) {
      const tick = Math.round(bar.start + i * step);
      if (tick >= bar.end) break;
      if (tick < from || tick > to) continue;
      const onBeat = i % sub === 0;
      out.push({ tick, kind: i === 0 ? 'accent' : onBeat ? 'beat' : 'sub', beat: onBeat ? { beat: i / sub, beats, bar: b } : null });
    }
  }
  return out;
}

/** makeup gain of the click lane before its limiter (~ +10 db) */
const CLICK_BOOST = 3.2;

/** the count-in follows the click level, but never so quiet that the band misses it */
const countLevel = (p: ClickPrefs) => Math.max(0.45, p.level);

function makeNoise(ctx: AudioContext) {
  const buf = ctx.createBuffer(1, ctx.sampleRate * 0.5, ctx.sampleRate);
  const d = buf.getChannelData(0);
  for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;
  return buf;
}

type Voice = (ctx: AudioContext, out: AudioNode, noise: AudioBuffer, kind: Kind, t: number, vel: number, track: (s: AudioScheduledSourceNode) => void) => void;

function env(ctx: AudioContext, t: number, peak: number, decay: number) {
  const g = ctx.createGain();
  g.gain.setValueAtTime(0, t);
  g.gain.linearRampToValueAtTime(peak, t + 0.001);
  g.gain.exponentialRampToValueAtTime(0.0001, t + decay);
  return g;
}

function tone(ctx: AudioContext, type: OscillatorType, freq: number, t: number, dur: number, dest: AudioNode, track: (s: AudioScheduledSourceNode) => void, endFreq?: number) {
  const o = ctx.createOscillator();
  o.type = type;
  o.frequency.setValueAtTime(freq, t);
  if (endFreq) o.frequency.exponentialRampToValueAtTime(endFreq, t + dur);
  o.connect(dest);
  o.start(t);
  o.stop(t + dur + 0.01);
  track(o);
}

function noiseBurst(ctx: AudioContext, noise: AudioBuffer, t: number, dur: number, dest: AudioNode, track: (s: AudioScheduledSourceNode) => void) {
  const s = ctx.createBufferSource();
  s.buffer = noise;
  s.connect(dest);
  s.start(t, Math.random() * 0.3);
  s.stop(t + dur + 0.01);
  track(s);
}

const pitch = (kind: Kind, accent: number, beat: number, sub: number) => (kind === 'accent' ? accent : kind === 'beat' ? beat : sub);

const voices: Record<Exclude<ClickSound, 'synth'>, Voice> = {
  // a crisp studio click like a daw's: a sharp noise tick for the attack, a short high ping for the pitch
  studio(ctx, out, noise, kind, t, vel, track) {
    const f = pitch(kind, 2800, 2100, 1600);
    const g = env(ctx, t, vel, kind === 'sub' ? 0.018 : 0.03);
    g.connect(out);
    tone(ctx, 'sine', f, t, 0.03, g, track);
    tone(ctx, 'triangle', f * 2.01, t, 0.012, g, track);
    const hp = ctx.createBiquadFilter();
    hp.type = 'highpass'; hp.frequency.value = 4000;
    const ng = env(ctx, t, vel * 0.7, 0.006);
    hp.connect(ng).connect(out);
    noiseBurst(ctx, noise, t, 0.01, hp, track);
  },
  // a clave: a strongly resonant knock, cuts through distorted guitars
  clave(ctx, out, noise, kind, t, vel, track) {
    const f = pitch(kind, 2700, 2350, 2000);
    const g = env(ctx, t, vel * 0.9, kind === 'sub' ? 0.035 : 0.07);
    g.connect(out);
    tone(ctx, 'sine', f, t, 0.07, g, track, f * 0.97);
    const bp = ctx.createBiquadFilter();
    bp.type = 'bandpass'; bp.frequency.value = f; bp.Q.value = 18;
    const ng = env(ctx, t, vel * 1.4, 0.03);
    bp.connect(ng).connect(out);
    noiseBurst(ctx, noise, t, 0.02, bp, track);
  },
  beep(ctx, out, _n, kind, t, vel, track) {
    const g = env(ctx, t, vel * 0.6, 0.06);
    g.connect(out);
    tone(ctx, 'sine', pitch(kind, 1760, 1320, 990), t, 0.06, g, track);
  },
  wood(ctx, out, noise, kind, t, vel, track) {
    const f = pitch(kind, 1250, 900, 700);
    const g = env(ctx, t, vel * 0.9, 0.05);
    g.connect(out);
    tone(ctx, 'triangle', f * 1.4, t, 0.05, g, track, f);
    const bp = ctx.createBiquadFilter();
    bp.type = 'bandpass'; bp.frequency.value = f * 2; bp.Q.value = 6;
    const ng = env(ctx, t, vel * 0.5, 0.02);
    bp.connect(ng).connect(out);
    noiseBurst(ctx, noise, t, 0.03, bp, track);
  },
  rim(ctx, out, noise, kind, t, vel, track) {
    const g = env(ctx, t, vel * 0.7, 0.03);
    g.connect(out);
    tone(ctx, 'square', pitch(kind, 1900, 1650, 1400), t, 0.03, g, track);
    const hp = ctx.createBiquadFilter();
    hp.type = 'highpass'; hp.frequency.value = 2500;
    const ng = env(ctx, t, vel * 0.6, 0.025);
    hp.connect(ng).connect(out);
    noiseBurst(ctx, noise, t, 0.03, hp, track);
  },
  hat(ctx, out, noise, kind, t, vel, track) {
    const hp = ctx.createBiquadFilter();
    hp.type = 'highpass'; hp.frequency.value = kind === 'accent' ? 6000 : 8000;
    const g = env(ctx, t, vel * 0.9, kind === 'accent' ? 0.09 : 0.045);
    hp.connect(g).connect(out);
    noiseBurst(ctx, noise, t, 0.1, hp, track);
  },
  cowbell(ctx, out, _n, kind, t, vel, track) {
    const bp = ctx.createBiquadFilter();
    bp.type = 'bandpass'; bp.frequency.value = kind === 'accent' ? 1100 : 900; bp.Q.value = 2;
    const g = env(ctx, t, vel * 0.5, kind === 'sub' ? 0.08 : 0.22);
    bp.connect(g).connect(out);
    const k = kind === 'accent' ? 1.12 : 1;
    tone(ctx, 'square', 562 * k, t, 0.25, bp, track);
    tone(ctx, 'square', 845 * k, t, 0.25, bp, track);
  },
};
