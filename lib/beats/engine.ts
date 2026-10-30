// copied unchanged from mo-tion/Beats lib/engine.ts — keep the two in sync so grooves sound the same in both apps
import type { Kit, Voice } from './kits';

export type TrackParams = {
  gain: number;  // 0..1
  pan: number;   // -1..1
  tune: number;  // semitones, -12..12
  decay: number; // multiplier, 0.25..2
  mute: boolean;
  solo: boolean;
};

type StepEvent = { step: number; total: number; time: number; hits: [number, number][] };

const LOOKAHEAD = 0.12;  // seconds of audio scheduled ahead
const TICK_MS = 25;      // scheduler wake-up interval
const ACCENT_VEL = 1;
const NORMAL_VEL = 0.68;

// 808-style metallic hat partials (Hz)
const HAT_PARTIALS = [205.3, 304.4, 369.6, 522.7, 540, 800];

// longest possible ring-out of any voice (kick decay 0.75 × max decay 2 + margin)
export const MAX_TAIL = 2;

/** pattern value → velocity, or null if the track is silent at this step */
export function hitVelocity(value: number | undefined, track: TrackParams | undefined, anySolo: boolean) {
  if (!value || !track || (anySolo ? !track.solo : track.mute)) return null;
  return value === 2 ? ACCENT_VEL : NORMAL_VEL;
}

/** swing delays every second 16th; 100% = triplet feel */
export function swingOffset(step: number, swing: number, sixteenth: number) {
  return step % 2 ? (swing / 100) * (sixteenth / 3) : 0;
}

/**
 * The drum voices plus their mix bus (channel strips → master → kit tone →
 * compressor). Works on any BaseAudioContext, so the live engine and the
 * offline loop export sound identical.
 */
export class Synth {
  readonly output: DynamicsCompressorNode;
  private master: GainNode;
  private tone: BiquadFilterNode;
  private channels: { gain: GainNode; pan: StereoPannerNode }[] = [];
  private noise: AudioBuffer;
  private curves = new Map<number, Float32Array>();
  private openHat: GainNode | null = null;
  private kit: Kit | null = null;
  private tracks: TrackParams[] = [];

  constructor(readonly ctx: BaseAudioContext) {
    this.master = ctx.createGain();
    this.tone = ctx.createBiquadFilter();
    this.tone.type = 'lowpass';
    this.tone.Q.value = 0.5;
    this.tone.frequency.value = 20000;
    const comp = ctx.createDynamicsCompressor();
    comp.threshold.value = -14;
    comp.knee.value = 18;
    comp.ratio.value = 3.5;
    comp.attack.value = 0.004;
    comp.release.value = 0.2;
    this.master.connect(this.tone).connect(comp);
    this.output = comp;

    // one shared second of white noise for all noise-based voices
    this.noise = ctx.createBuffer(1, ctx.sampleRate, ctx.sampleRate);
    const d = this.noise.getChannelData(0);
    for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;
  }

  setVolume(v: number) {
    this.master.gain.setTargetAtTime(v, this.ctx.currentTime, 0.02);
  }

  setKit(k: Kit) {
    this.kit = k;
    this.tone.frequency.setTargetAtTime(k.tone, this.ctx.currentTime, 0.05);
  }

  setTracks(t: TrackParams[]) {
    this.tracks = t;
    const ctx = this.ctx;
    t.forEach((tr, i) => {
      let ch = this.channels[i];
      if (!ch) {
        const gain = ctx.createGain();
        const pan = ctx.createStereoPanner();
        gain.connect(pan).connect(this.master);
        ch = this.channels[i] = { gain, pan };
      }
      ch.gain.gain.setTargetAtTime(tr.gain, ctx.currentTime, 0.015);
      ch.pan.pan.setTargetAtTime(tr.pan, ctx.currentTime, 0.015);
    });
  }

  play(track: number, time: number, vel: number) {
    const voice = this.kit?.voices[track];
    const ch = this.channels[track];
    if (!voice || !ch) return;
    const t = this.tracks[track];
    const tune = Math.pow(2, (t?.tune ?? 0) / 12);
    const decay = t?.decay ?? 1;
    const level = vel * (voice.p.level ?? 1);
    this.voice(voice, ch.gain, time, level, tune, decay);
  }

  private voice(v: Voice, out: AudioNode, t: number, lvl: number, tune: number, dec: number) {
    const ctx = this.ctx;
    const p = v.p;
    switch (v.type) {
      case 'kick': {
        const o = ctx.createOscillator();
        o.frequency.setValueAtTime(p.f0 * tune, t);
        o.frequency.exponentialRampToValueAtTime(p.f1 * tune, t + p.sweep);
        const g = this.env(t, lvl, p.decay * dec, 0.001);
        let node: AudioNode = o;
        if (p.drive > 0) {
          const ws = ctx.createWaveShaper();
          ws.curve = this.curve(p.drive) as any;
          node = node.connect(ws);
        }
        node.connect(g).connect(out);
        o.start(t); o.stop(t + p.decay * dec + 0.05);
        if (p.click > 0) this.noiseHit(out, t, lvl * p.click, 0.012, 'highpass', 2500);
        break;
      }
      case 'snare': {
        const o = ctx.createOscillator();
        o.type = 'triangle';
        o.frequency.setValueAtTime(p.tone * tune * 1.4, t);
        o.frequency.exponentialRampToValueAtTime(p.tone * tune, t + 0.03);
        const g = this.env(t, lvl * (1.1 - p.mix * 0.5), p.toneDecay * dec);
        o.connect(g).connect(out);
        o.start(t); o.stop(t + p.toneDecay * dec + 0.05);
        this.noiseHit(out, t, lvl * p.mix, p.noiseDecay * dec, 'highpass', p.noiseFreq * tune);
        break;
      }
      case 'clap': {
        const src = this.noiseSrc();
        const bp = ctx.createBiquadFilter();
        bp.type = 'bandpass'; bp.frequency.value = p.freq * tune; bp.Q.value = p.q;
        const g = ctx.createGain();
        g.gain.setValueAtTime(0, t);
        // three quick bursts, then the body
        for (let i = 0; i < 3; i++) {
          const s = t + i * 0.011;
          g.gain.setValueAtTime(lvl * 1.6, s);
          g.gain.exponentialRampToValueAtTime(lvl * 0.2, s + 0.009);
        }
        const body = t + 0.033;
        g.gain.setValueAtTime(lvl * 1.3, body);
        g.gain.exponentialRampToValueAtTime(0.0001, body + p.decay * dec);
        src.connect(bp).connect(g).connect(out);
        src.start(t); src.stop(body + p.decay * dec + 0.05);
        break;
      }
      case 'hat':
      case 'openhat': {
        const open = v.type === 'openhat';
        const d = p.decay * dec;
        if (!open) this.chokeOpenHat(t);
        const hp = ctx.createBiquadFilter();
        hp.type = 'highpass'; hp.frequency.value = p.freq * tune;
        const g = this.env(t, lvl, d);
        const stopAt = t + d + 0.05;
        if (p.metal) {
          const bp = ctx.createBiquadFilter();
          bp.type = 'bandpass'; bp.frequency.value = 10000 * tune; bp.Q.value = 0.8;
          const sum = ctx.createGain(); sum.gain.value = 0.35;
          HAT_PARTIALS.forEach(f => {
            const o = ctx.createOscillator();
            o.type = 'square'; o.frequency.value = f * 1.6 * tune;
            o.connect(sum); o.start(t); o.stop(stopAt);
          });
          sum.connect(bp).connect(hp);
        } else {
          const src = this.noiseSrc();
          src.connect(hp); src.start(t); src.stop(stopAt);
        }
        hp.connect(g).connect(out);
        if (open) this.openHat = g;
        break;
      }
      case 'tom': {
        const o = ctx.createOscillator();
        o.frequency.setValueAtTime(p.f0 * tune * 1.25, t);
        o.frequency.exponentialRampToValueAtTime(p.f0 * tune, t + 0.015);
        o.frequency.exponentialRampToValueAtTime(p.f1 * tune, t + p.decay * dec);
        const g = this.env(t, lvl, p.decay * dec);
        o.connect(g).connect(out);
        o.start(t); o.stop(t + p.decay * dec + 0.05);
        this.noiseHit(out, t, lvl * 0.12, 0.03, 'lowpass', 3000);
        break;
      }
      case 'rim': {
        const bp = ctx.createBiquadFilter();
        bp.type = 'bandpass'; bp.frequency.value = p.freq * tune; bp.Q.value = 2.5;
        const g = this.env(t, lvl * 2.2, p.decay * dec, 0.0005);
        [1, 0.29].forEach((m, i) => {
          const o = ctx.createOscillator();
          o.type = i ? 'square' : 'triangle';
          o.frequency.value = p.freq * m * tune;
          o.connect(bp); o.start(t); o.stop(t + p.decay * dec + 0.05);
        });
        bp.connect(g).connect(out);
        break;
      }
      case 'cowbell': {
        const bp = ctx.createBiquadFilter();
        bp.type = 'bandpass'; bp.frequency.value = p.freq * 4.6 * tune; bp.Q.value = 1.4;
        const g = ctx.createGain();
        g.gain.setValueAtTime(0.0001, t);
        g.gain.linearRampToValueAtTime(lvl, t + 0.002);
        g.gain.exponentialRampToValueAtTime(lvl * 0.25, t + 0.06);
        g.gain.exponentialRampToValueAtTime(0.0001, t + p.decay * dec);
        [1, 1.48].forEach(m => {
          const o = ctx.createOscillator();
          o.type = 'square'; o.frequency.value = p.freq * m * tune;
          o.connect(bp); o.start(t); o.stop(t + p.decay * dec + 0.05);
        });
        bp.connect(g).connect(out);
        break;
      }
      case 'blip': {
        const o = ctx.createOscillator();
        o.type = 'sine';
        o.frequency.setValueAtTime(p.f0 * tune, t);
        o.frequency.exponentialRampToValueAtTime(p.f1 * tune, t + p.decay * dec);
        const g = this.env(t, lvl, p.decay * dec);
        o.connect(g).connect(out);
        o.start(t); o.stop(t + p.decay * dec + 0.05);
        break;
      }
      case 'shaker': {
        const src = this.noiseSrc();
        const bp = ctx.createBiquadFilter();
        bp.type = 'bandpass'; bp.frequency.value = p.freq * tune; bp.Q.value = 1.2;
        const g = ctx.createGain();
        g.gain.setValueAtTime(0.0001, t);
        g.gain.exponentialRampToValueAtTime(lvl, t + 0.025);
        g.gain.exponentialRampToValueAtTime(0.0001, t + 0.025 + p.decay * dec);
        src.connect(bp).connect(g).connect(out);
        src.start(t); src.stop(t + p.decay * dec + 0.1);
        break;
      }
    }
  }

  // percussive envelope: fast attack, exponential decay
  private env(t: number, peak: number, decay: number, attack = 0.002) {
    const g = this.ctx.createGain();
    g.gain.setValueAtTime(0.0001, t);
    g.gain.linearRampToValueAtTime(Math.max(peak, 0.0002), t + attack);
    g.gain.exponentialRampToValueAtTime(0.0001, t + attack + Math.max(decay, 0.01));
    return g;
  }

  private noiseSrc() {
    const src = this.ctx.createBufferSource();
    src.buffer = this.noise;
    src.loop = true;
    return src;
  }

  private noiseHit(out: AudioNode, t: number, lvl: number, decay: number, type: BiquadFilterType, freq: number) {
    const ctx = this.ctx;
    const src = this.noiseSrc();
    const f = ctx.createBiquadFilter();
    f.type = type; f.frequency.value = Math.min(freq, ctx.sampleRate / 2 - 100);
    const g = this.env(t, lvl, decay, 0.001);
    src.connect(f).connect(g).connect(out);
    src.start(t, Math.random() * 0.5); src.stop(t + decay + 0.05);
  }

  private chokeOpenHat(t: number) {
    const g = this.openHat;
    if (!g) return;
    const param = g.gain as AudioParam & { cancelAndHoldAtTime?: (t: number) => AudioParam };
    if (param.cancelAndHoldAtTime) param.cancelAndHoldAtTime(t);
    else param.cancelScheduledValues(t);
    param.setTargetAtTime(0, t, 0.008);
    this.openHat = null;
  }

  private curve(amount: number) {
    const key = Math.round(amount * 100);
    let c = this.curves.get(key);
    if (!c) {
      const k = 1 + amount * 8;
      c = new Float32Array(1024);
      for (let i = 0; i < c.length; i++) {
        const x = (i / (c.length - 1)) * 2 - 1;
        c[i] = Math.tanh(k * x) / Math.tanh(k);
      }
      this.curves.set(key, c);
    }
    return c;
  }
}

/**
 * Live drum machine. Lives outside React: the UI pushes parameters in
 * through setters, the scheduler reads them on every tick, and visual events
 * (playhead, track hits) are delivered in sync with what is actually heard.
 */
export class DrumEngine {
  ctx: AudioContext | null = null;
  analyser: AnalyserNode | null = null;
  playing = false;

  onStep?: (step: number, total: number) => void;
  onTrigger?: (track: number, velocity: number) => void;
  /**
   * Asked right before the first step of every bar is scheduled. Return a
   * pattern to switch to it exactly on the downbeat (queued pattern changes,
   * chain mode) — or null to keep playing the current one.
   */
  onBarStart?: () => number[][] | null;

  private synth: Synth | null = null;
  private bpm = 120;
  private swing = 0;
  private volume = 0.8;
  private steps = 16;
  private kit: Kit | null = null;
  private pattern: number[][] = [];
  private tracks: TrackParams[] = [];

  private timer: number | null = null;
  private raf: number | null = null;
  private nextTime = 0;
  private step = 0;
  private queue: StepEvent[] = [];

  // ---- parameters -------------------------------------------------------

  setBpm(v: number) { this.bpm = v; }
  setSwing(v: number) { this.swing = v; }
  setSteps(v: number) { this.steps = v; }
  setPattern(p: number[][]) { this.pattern = p; }
  setVolume(v: number) { this.volume = v; this.synth?.setVolume(v); }
  setKit(k: Kit) { this.kit = k; this.synth?.setKit(k); }
  setTracks(t: TrackParams[]) { this.tracks = t; this.synth?.setTracks(t); }

  // ---- lifecycle --------------------------------------------------------

  private async ensure() {
    if (!this.ctx) {
      const AC = window.AudioContext || (window as any).webkitAudioContext;
      const ctx: AudioContext = new AC({ latencyHint: 'interactive' });
      const synth = new Synth(ctx);
      synth.setVolume(this.volume);
      if (this.kit) synth.setKit(this.kit);
      synth.setTracks(this.tracks);
      this.analyser = ctx.createAnalyser();
      this.analyser.fftSize = 2048;
      this.analyser.smoothingTimeConstant = 0.78;
      synth.output.connect(this.analyser).connect(ctx.destination);
      this.synth = synth;
      this.ctx = ctx;
    }
    if (this.ctx.state !== 'running') await this.ctx.resume().catch(() => {});
    return this.ctx;
  }

  async start() {
    if (this.playing) return;
    const ctx = await this.ensure();
    this.playing = true;
    this.step = 0;
    this.queue = [];
    this.nextTime = ctx.currentTime + 0.06;
    this.tick();
    this.frame();
  }

  stop() {
    this.playing = false;
    if (this.timer != null) clearTimeout(this.timer);
    if (this.raf != null) cancelAnimationFrame(this.raf);
    this.timer = this.raf = null;
    this.queue = [];
    this.onStep?.(-1, 0);
  }

  async toggle() {
    if (this.playing) this.stop();
    else await this.start();
    return this.playing;
  }

  /** play a single track right now (pads / keyboard) */
  async preview(track: number, velocity = ACCENT_VEL) {
    const ctx = await this.ensure();
    this.synth!.play(track, ctx.currentTime + 0.005, velocity);
    this.onTrigger?.(track, velocity);
  }

  dispose() {
    this.stop();
    this.ctx?.close().catch(() => {});
    this.ctx = null;
    this.synth = null;
  }

  // ---- scheduling -------------------------------------------------------

  private tick = () => {
    this.schedule();
    this.timer = window.setTimeout(this.tick, TICK_MS);
  };

  private schedule() {
    const ctx = this.ctx;
    const synth = this.synth;
    if (!ctx || !synth) return;
    // fell far behind (tab was in background): resync instead of bursting
    if (this.nextTime < ctx.currentTime - 0.25) this.nextTime = ctx.currentTime + 0.02;

    while (this.nextTime < ctx.currentTime + LOOKAHEAD) {
      const sixteenth = 60 / this.bpm / 4;
      const step = this.step % this.steps;
      if (step === 0 && this.step > 0) {
        const next = this.onBarStart?.();
        if (next) this.pattern = next;
      }
      const time = this.nextTime + swingOffset(step, this.swing, sixteenth);
      const anySolo = this.tracks.some(t => t.solo);
      const hits: [number, number][] = [];

      this.pattern.forEach((row, r) => {
        const vel = hitVelocity(row[step], this.tracks[r], anySolo);
        if (vel == null) return;
        synth.play(r, time, vel);
        hits.push([r, vel]);
      });

      this.queue.push({ step, total: this.step, time, hits });
      this.nextTime += sixteenth;
      this.step++;
    }
  }

  // deliver visual events when they are heard, not when they are scheduled
  private frame = () => {
    const ctx = this.ctx;
    if (ctx) {
      const latency = (ctx.baseLatency || 0) + ((ctx as any).outputLatency || 0);
      const now = ctx.currentTime - latency;
      while (this.queue.length && this.queue[0].time <= now) {
        const e = this.queue.shift()!;
        this.onStep?.(e.step, e.total);
        e.hits.forEach(([r, v]) => this.onTrigger?.(r, v));
      }
    }
    this.raf = requestAnimationFrame(this.frame);
  };
}
