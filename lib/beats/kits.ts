// copied unchanged from mo-tion/Beats lib/kits.ts — keep the two in sync so grooves sound the same in both apps
export type VoiceType =
  | 'kick' | 'snare' | 'clap' | 'hat' | 'openhat'
  | 'tom' | 'rim' | 'cowbell' | 'blip' | 'shaker';

export type Voice = {
  label: string;
  type: VoiceType;
  // synthesis parameters, interpreted per voice type (see engine.ts)
  p: Record<string, number>;
};

export type Kit = {
  id: string;
  name: string;
  tone: number; // master low-pass in Hz — gives each kit its colour
  voices: Voice[];
};

// every kit has the same 8 slots so patterns stay valid when switching kits:
// kick · snare · clap · hat · open hat · tom · rim · perc
export const TRACK_COUNT = 8;

export const kits: Kit[] = [
  {
    id: '808',
    name: '808',
    tone: 18000,
    voices: [
      { label: 'kick', type: 'kick', p: { f0: 150, f1: 46, sweep: 0.09, decay: 0.75, click: 0.15, drive: 0.2, level: 1 } },
      { label: 'snare', type: 'snare', p: { tone: 190, toneDecay: 0.11, noiseFreq: 1800, noiseDecay: 0.17, mix: 0.75, level: 0.8 } },
      { label: 'clap', type: 'clap', p: { freq: 1200, q: 0.9, decay: 0.22, level: 0.85 } },
      { label: 'hat', type: 'hat', p: { metal: 1, freq: 7500, decay: 0.05, level: 0.45 } },
      { label: 'open hat', type: 'openhat', p: { metal: 1, freq: 7000, decay: 0.38, level: 0.35 } },
      { label: 'tom', type: 'tom', p: { f0: 165, f1: 105, decay: 0.38, level: 0.8 } },
      { label: 'rim', type: 'rim', p: { freq: 1700, decay: 0.035, level: 0.6 } },
      { label: 'cowbell', type: 'cowbell', p: { freq: 560, decay: 0.32, level: 0.4 } },
    ],
  },
  {
    id: '909',
    name: '909',
    tone: 20000,
    voices: [
      { label: 'kick', type: 'kick', p: { f0: 230, f1: 52, sweep: 0.045, decay: 0.38, click: 0.55, drive: 0.55, level: 1 } },
      { label: 'snare', type: 'snare', p: { tone: 230, toneDecay: 0.08, noiseFreq: 2600, noiseDecay: 0.2, mix: 0.95, level: 0.75 } },
      { label: 'clap', type: 'clap', p: { freq: 1500, q: 1.2, decay: 0.28, level: 0.85 } },
      { label: 'hat', type: 'hat', p: { metal: 0, freq: 8500, decay: 0.045, level: 0.5 } },
      { label: 'open hat', type: 'openhat', p: { metal: 0, freq: 8000, decay: 0.3, level: 0.38 } },
      { label: 'tom', type: 'tom', p: { f0: 210, f1: 120, decay: 0.28, level: 0.75 } },
      { label: 'rim', type: 'rim', p: { freq: 2100, decay: 0.03, level: 0.55 } },
      { label: 'blip', type: 'blip', p: { f0: 1400, f1: 380, decay: 0.07, level: 0.4 } },
    ],
  },
  {
    id: 'lofi',
    name: 'lo-fi',
    tone: 4200,
    voices: [
      { label: 'kick', type: 'kick', p: { f0: 115, f1: 48, sweep: 0.07, decay: 0.32, click: 0.05, drive: 0.7, level: 1 } },
      { label: 'snare', type: 'snare', p: { tone: 170, toneDecay: 0.09, noiseFreq: 1100, noiseDecay: 0.14, mix: 0.6, level: 0.9 } },
      { label: 'clap', type: 'clap', p: { freq: 900, q: 0.7, decay: 0.16, level: 0.85 } },
      { label: 'hat', type: 'hat', p: { metal: 0, freq: 5500, decay: 0.04, level: 0.55 } },
      { label: 'open hat', type: 'openhat', p: { metal: 0, freq: 5200, decay: 0.22, level: 0.4 } },
      { label: 'tom', type: 'tom', p: { f0: 140, f1: 95, decay: 0.3, level: 0.8 } },
      { label: 'rim', type: 'rim', p: { freq: 1300, decay: 0.04, level: 0.65 } },
      { label: 'shaker', type: 'shaker', p: { freq: 6000, decay: 0.09, level: 0.5 } },
    ],
  },
];
