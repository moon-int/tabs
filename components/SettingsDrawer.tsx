"use client";
import React, { useEffect, useRef, useState } from 'react';
import { calm } from '../lib/calm';
import { CLICK_SOUNDS, MIDI_ACTIONS, type Prefs } from '../lib/prefs';
import { THEMES } from '../lib/themes';
import { ClickEngine } from '../lib/click';
import { listOutputs, } from '../lib/stage';
import { describeMidiKey, type useMidi } from '../lib/midi';
import { forgetBank, loadBank, saveBank } from '../lib/soundbank';

/**
 * Only what has no place on the session screen itself. Levels, click on/off, monitor mix, your
 * instrument and tuning, zoom, notes and auto-scroll are right there — not here a second time.
 */
export type DrawerTab = 'sound' | 'view' | 'stage';
const TABS: [DrawerTab, string][] = [['sound', 'sound'], ['view', 'view'], ['stage', 'stage']];

type Props = {
  open: boolean;
  tab: DrawerTab;
  onTab: (t: DrawerTab) => void;
  onClose: () => void;
  prefs: Prefs;
  setPrefs: (fn: (p: Prefs) => Prefs) => void;
  midi: ReturnType<typeof useMidi>;
  onPreviewClick: () => void;
  onToast: (msg: string) => void;
  /** sound banks the server offers (on the NUC: data/soundfonts) */
  soundfonts?: { name: string; url: string; size: number }[];
  /** a sound bank file from this computer was saved — load it */
  onSoundBankFile?: () => void;
};

function Toggle({ on, onChange, label, hint }: { on: boolean; onChange: (v: boolean) => void; label: string; hint?: string }) {
  return (
    <label className="toggle-row">
      <span>
        <span className="toggle-label">{label}</span>
        {hint && <span className="toggle-hint">{hint}</span>}
      </span>
      <button type="button" role="switch" aria-checked={on} className={`switch ${on ? 'on' : ''}`} onClick={() => onChange(!on)}><span /></button>
    </label>
  );
}

function Seg<T extends string | number>({ value, options, onChange, label }: { value: T; options: [T, string][]; onChange: (v: T) => void; label: string }) {
  return (
    <div className="segmented wrap" role="radiogroup" aria-label={label}>
      {options.map(([v, l]) => (
        <button key={String(v)} role="radio" aria-checked={value === v} className={value === v ? 'active' : ''} onClick={() => onChange(v)}>{l}</button>
      ))}
    </div>
  );
}

// a module-level component: defined inside the drawer it would remount on every render
// and close an open dropdown whenever the device list refreshes
function DeviceSelect({ value, outputs, onChange, onReveal, label }: {
  value: string; outputs: { id: string; label: string }[]; label: string;
  onChange: (id: string) => void; onReveal: () => void;
}) {
  return (
    <div className="field">
      <span className="field-label">{label}</span>
      <div className="row">
        <select className="btn" value={value} onChange={e => onChange(e.target.value)} aria-label={label}>
          <option value="">system default</option>
          {outputs.map(o => <option key={o.id} value={o.id}>{o.label}</option>)}
          {value && !outputs.some(o => o.id === value) && <option value={value}>saved device (not connected)</option>}
        </select>
        <button className="btn sm ghost" onClick={onReveal} title="browsers hide device names until you allow it once">show names</button>
      </div>
    </div>
  );
}


function SettingsDrawer({ open, tab, onTab, onClose, prefs, setPrefs, midi, onPreviewClick, onToast, soundfonts = [], onSoundBankFile }: Props) {
  const [bank, setBank] = useState<{ name: string; size: number } | null>(null);
  const bankInput = useRef<HTMLInputElement>(null);
  useEffect(() => { if (open) loadBank().then(b => setBank(b ? { name: b.name, size: b.size } : null)); }, [open]);
  const [outputs, setOutputs] = useState<{ id: string; label: string }[]>([]);

  useEffect(() => { if (open && tab === 'sound') listOutputs().then(setOutputs).catch(() => {}); }, [open, tab]);
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open, onClose]);

  const set = <K extends keyof Prefs>(key: K, patch: Partial<Prefs[K]> | Prefs[K]) =>
    setPrefs(p => ({ ...p, [key]: typeof patch === 'object' && patch !== null && !Array.isArray(patch) ? { ...(p[key] as object), ...patch } : patch }));

  const revealNames = () => listOutputs(true).then(setOutputs);
  const c = prefs.click;

  return (
    <>
      <div className={`drawer-backdrop ${open ? 'show' : ''}`} onClick={onClose} aria-hidden="true" />
      <aside className={`drawer ${open ? 'open' : ''}`} aria-label="settings" aria-hidden={!open} {...(!open ? { inert: '' as any } : {})}>
        <div className="drawer-head">
          <h2>settings</h2>
          <span className="hint-inline">only for you · saved in this browser</span>
          <div className="spacer" />
          <button className="icon-btn" onClick={onClose} aria-label="close settings">
            <svg viewBox="0 0 16 16" width="14" height="14" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round"><path d="M4 4l8 8M12 4l-8 8" /></svg>
          </button>
        </div>
        <div className="drawer-tabs">
          <Seg value={tab} options={TABS} onChange={onTab} label="settings section" />
        </div>

        <div className="drawer-body">
          {tab === 'sound' && (
            <>
              <div className="field">
                <span className="field-label">sound bank — how the music sounds</span>
                <select
                  className="btn" aria-label="sound bank" value={prefs.soundBank}
                  onChange={e => { if (e.target.value === 'pick') bankInput.current?.click(); else set('soundBank', e.target.value); }}
                >
                  <option value="">built-in (small, loads fast)</option>
                  {soundfonts.map(f => <option key={f.url} value={f.url}>{f.name} · {Math.round(f.size / 1048576)} mb</option>)}
                  {bank && <option value="file">from this computer: {bank.name}</option>}
                  <option value="pick">choose a .sf2 / .sf3 file…</option>
                </select>
                <input
                  ref={bankInput} type="file" accept=".sf2,.sf3" hidden
                  onChange={async e => {
                    const f = e.target.files?.[0];
                    e.target.value = '';
                    if (!f) return;
                    try {
                      const b = await saveBank(f);
                      setBank({ name: b.name, size: b.size });
                      set('soundBank', 'file');
                      onSoundBankFile?.();
                      onToast(`sound bank “${b.name}” loading…`);
                    } catch (err) {
                      onToast((err as Error).message);
                    }
                  }}
                />
                <span className="toggle-hint">a bigger general midi soundfont (e.g. GeneralUser GS) sounds far more real. it stays in this browser.</span>
                {bank && prefs.soundBank !== 'file' && (
                  <button className="btn sm ghost" onClick={() => { forgetBank(); setBank(null); }}>remove “{bank.name}” from this browser</button>
                )}
              </div>

              <div className="field">
                <span className="field-label">click sound</span>
                <div className="row">
                  <Seg value={c.sound} options={CLICK_SOUNDS} label="click sound" onChange={v => set('click', { sound: v })} />
                  <button className="btn sm" onClick={onPreviewClick} disabled={c.sound === 'synth'} title="hear it">▶ test</button>
                </div>
              </div>
              <div className="field">
                <span className="field-label">click counts</span>
                <Seg value={c.sub} label="subdivision" onChange={v => set('click', { sub: v })} options={[[1, 'beats'], [2, '8ths'], [3, 'triplets'], [4, '16ths']]} />
              </div>
              <Toggle label="accent the one" hint="first beat of every bar higher and louder" on={c.accent} onChange={v => set('click', { accent: v })} />
              <div className="field">
                <span className="field-label">click in</span>
                <Seg value={c.pan <= -0.99 ? -1 : c.pan >= 0.99 ? 1 : 0} label="click pan" onChange={v => set('click', { pan: v })} options={[[-1, 'left ear'], [0, 'both'], [1, 'right ear']]} />
              </div>

              <DeviceSelect label="music output" value={prefs.musicDevice} outputs={outputs} onReveal={revealNames} onChange={id => set('musicDevice', id)} />
              {ClickEngine.canPickDevice && (
                <DeviceSelect label="click output — e.g. the in-ears" value={c.device} outputs={outputs} onReveal={revealNames} onChange={id => set('click', { device: id })} />
              )}
            </>
          )}

          {tab === 'view' && (
            <>
              <div className="field">
                <span className="field-label">theme</span>
                <div className="theme-grid">
                  {THEMES.map(t => (
                    <button key={t.id} className={`theme-card ${prefs.theme.id === t.id ? 'active' : ''}`} onClick={() => set('theme', { id: t.id, accent: null })}>
                      <span className="theme-swatch" style={{ background: t.vars['--bg'] }}>
                        <span style={{ background: t.vars['--panel'] }} />
                        <span style={{ background: t.accent }} />
                      </span>
                      <strong>{t.name}</strong>
                      <span>{t.hint}</span>
                    </button>
                  ))}
                </div>
              </div>
              <Toggle label="notation on paper" hint="black notes on white — easiest to read under stage light" on={prefs.view.paper} onChange={v => set('view', { paper: v })} />
              <div className="field">
                <span className="field-label">layout</span>
                <Seg value={prefs.view.layout} label="layout" onChange={v => set('view', { layout: v })} options={[['page', 'pages'], ['horizontal', 'one long line']]} />
              </div>
            </>
          )}

          {tab === 'stage' && (
            <>
              <div className="field">
                <span className="field-label">stage view readouts</span>
                <Seg value={prefs.stage.hud} label="stage display" onChange={v => set('stage', { hud: v })} options={[['big', 'big'], ['compact', 'compact']]} />
              </div>
              <Toggle label="flash on the one" hint="the screen edge blinks on every downbeat" on={c.flash} onChange={v => set('click', { flash: v })} />
              <Toggle label="keep the screen on" hint="no sleeping tablets mid-song" on={prefs.stage.wakeLock} onChange={v => set('stage', { wakeLock: v })} />
              <div className="field">
                <span className="field-label">pedals</span>
                <span className="toggle-hint">bluetooth page-turners work out of the box (page up / down, space). midi foot controllers: enable, then press “learn” and the pedal.</span>
                {!midi.supported && <span className="toggle-hint">this browser has no web midi — use chrome or edge.</span>}
                {midi.supported && !midi.enabled && <button className="btn" onClick={midi.enable}>enable midi</button>}
                {midi.error && <span className="toggle-hint warn-text">{midi.error}</span>}
                {midi.enabled && (
                  <>
                    <span className="toggle-hint">{midi.inputs.length ? `connected: ${midi.inputs.join(', ')}` : 'no midi device connected yet'}</span>
                    <div className="midi-list">
                      {MIDI_ACTIONS.map(([a, label]) => (
                        <div key={a} className="midi-row">
                          <span>{label}</span>
                          <span className="mono muted">{midi.learning === a ? 'press a pedal…' : describeMidiKey(prefs.midi[a])}</span>
                          <button className={`btn xs ${midi.learning === a ? 'on' : ''}`} onClick={() => midi.setLearning(midi.learning === a ? null : a)}>learn</button>
                          <button className="icon-btn" disabled={!prefs.midi[a]} onClick={() => setPrefs(p => { const m = { ...p.midi }; delete m[a]; return { ...p, midi: m }; })} aria-label={`forget ${label}`}>×</button>
                        </div>
                      ))}
                    </div>
                  </>
                )}
              </div>
            </>
          )}
        </div>
      </aside>
    </>
  );
}

export default calm(SettingsDrawer);
