"use client";
import { useEffect, useRef, useState } from 'react';
import type { MidiAction } from './prefs';

/**
 * Web MIDI for foot controllers: any note-on or control change (value > 63)
 * becomes a key like "cc:1:64" that can be mapped to an action. Learn mode
 * captures the next message instead of triggering anything.
 */
export function midiKey(data: Uint8Array): string | null {
  const [status, a, b] = data;
  const type = status & 0xf0, ch = (status & 0x0f) + 1;
  if (type === 0x90 && b > 0) return `note:${ch}:${a}`;
  if (type === 0xb0 && b > 63) return `cc:${ch}:${a}`;
  if (type === 0xc0) return `pc:${ch}:${a}`;
  return null;
}

export function describeMidiKey(key: string | undefined) {
  if (!key) return '—';
  const [type, ch, n] = key.split(':');
  return `${type === 'cc' ? 'cc' : type === 'pc' ? 'program' : 'note'} ${n} · ch ${ch}`;
}

export type MidiState = { supported: boolean; enabled: boolean; inputs: string[]; error: string | null };

export function useMidi(map: Partial<Record<MidiAction, string>>, onAction: (a: MidiAction) => void, onLearn: (a: MidiAction, key: string) => void) {
  const [state, setState] = useState<MidiState>({ supported: false, enabled: false, inputs: [], error: null });
  const [learning, setLearning] = useState<MidiAction | null>(null);
  const latest = useRef({ map, onAction, onLearn, learning });
  latest.current = { map, onAction, onLearn, learning };
  const access = useRef<MIDIAccess | null>(null);

  useEffect(() => {
    setState(s => ({ ...s, supported: typeof navigator !== 'undefined' && 'requestMIDIAccess' in navigator }));
    return () => {
      access.current?.inputs.forEach(i => { i.onmidimessage = null; });
    };
  }, []);

  const wire = (a: MIDIAccess) => {
    const names: string[] = [];
    a.inputs.forEach(input => {
      names.push(input.name || 'midi input');
      input.onmidimessage = (e: MIDIMessageEvent) => {
        const key = e.data ? midiKey(e.data) : null;
        if (!key) return;
        const { map, onAction, onLearn, learning } = latest.current;
        if (learning) { onLearn(learning, key); setLearning(null); return; }
        const action = (Object.keys(map) as MidiAction[]).find(k => map[k] === key);
        if (action) onAction(action);
      };
    });
    setState(s => ({ ...s, enabled: true, inputs: names, error: null }));
  };

  const enable = async () => {
    try {
      const a = await navigator.requestMIDIAccess();
      access.current = a;
      wire(a);
      a.onstatechange = () => wire(a); // pedals plugged in later
    } catch (err) {
      setState(s => ({ ...s, error: (err as Error).message || 'midi access denied' }));
    }
  };

  return { ...state, learning, setLearning, enable };
}
