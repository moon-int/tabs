"use client";
import { useCallback, useEffect, useRef, useState, type RefObject } from 'react';

/**
 * Stage view: real fullscreen where the browser allows it (desktop, android),
 * a fixed full-viewport overlay where it doesn't (iphone safari).
 */
export function useStage(el: RefObject<HTMLElement | null>) {
  const [stage, setStage] = useState(false);

  useEffect(() => {
    const onChange = () => { if (!document.fullscreenElement) setStage(false); };
    document.addEventListener('fullscreenchange', onChange);
    return () => document.removeEventListener('fullscreenchange', onChange);
  }, []);

  const enter = useCallback(async () => {
    setStage(true);
    const node = el.current;
    if (node?.requestFullscreen && !document.fullscreenElement) {
      try { await node.requestFullscreen({ navigationUI: 'hide' }); } catch { /* fixed overlay still works */ }
    }
  }, [el]);

  const exit = useCallback(async () => {
    setStage(false);
    if (document.fullscreenElement) { try { await document.exitFullscreen(); } catch {} }
  }, []);

  const toggle = useCallback(() => (stage ? exit() : enter()), [stage, enter, exit]);
  return { stage, enter, exit, toggle };
}

/** keeps the screen on while `active` — re-acquired when the tab comes back */
export function useWakeLock(active: boolean) {
  const lock = useRef<WakeLockSentinel | null>(null);
  const [held, setHeld] = useState(false);

  useEffect(() => {
    if (!active || typeof navigator === 'undefined' || !('wakeLock' in navigator)) return;
    let cancelled = false;
    const acquire = async () => {
      if (document.visibilityState !== 'visible' || lock.current) return;
      try {
        const l = await navigator.wakeLock.request('screen');
        if (cancelled) { l.release().catch(() => {}); return; }
        lock.current = l;
        setHeld(true);
        l.addEventListener('release', () => { lock.current = null; setHeld(false); });
      } catch { setHeld(false); }
    };
    acquire();
    document.addEventListener('visibilitychange', acquire);
    return () => {
      cancelled = true;
      document.removeEventListener('visibilitychange', acquire);
      lock.current?.release().catch(() => {});
      lock.current = null;
      setHeld(false);
    };
  }, [active]);

  return held;
}

/** controls fade out after a few seconds without pointer movement */
export function useIdle(active: boolean, ms = 3000) {
  const [idle, setIdle] = useState(false);
  useEffect(() => {
    if (!active) { setIdle(false); return; }
    let t = window.setTimeout(() => setIdle(true), ms);
    const wake = () => { setIdle(false); window.clearTimeout(t); t = window.setTimeout(() => setIdle(true), ms); };
    window.addEventListener('pointermove', wake);
    window.addEventListener('pointerdown', wake);
    window.addEventListener('keydown', wake);
    return () => {
      window.clearTimeout(t);
      window.removeEventListener('pointermove', wake);
      window.removeEventListener('pointerdown', wake);
      window.removeEventListener('keydown', wake);
    };
  }, [active, ms]);
  return idle;
}

export async function listOutputs(askForNames = false): Promise<{ id: string; label: string }[]> {
  if (typeof navigator === 'undefined' || !navigator.mediaDevices?.enumerateDevices) return [];
  if (askForNames) {
    // device names are hidden until the page has had some media permission
    try { (await navigator.mediaDevices.getUserMedia({ audio: true })).getTracks().forEach(t => t.stop()); } catch {}
  }
  const all = await navigator.mediaDevices.enumerateDevices();
  return all
    .filter(d => d.kind === 'audiooutput' && d.deviceId !== 'default' && d.deviceId !== 'communications')
    .map((d, i) => ({ id: d.deviceId, label: d.label || `output ${i + 1}` }));
}
