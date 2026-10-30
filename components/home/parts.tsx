"use client";
import React, { useRef, useState } from 'react';
import { ACCEPT } from '../../lib/sync';

/** drop tab files here or click to choose — several become a setlist */
export function DropZone({ onFiles, busy, title, hint, big }: { onFiles: (f: File[]) => void; busy: string | null; title: string; hint?: string; big?: boolean }) {
  const input = useRef<HTMLInputElement>(null);
  const [drag, setDrag] = useState(false);
  return (
    <div
      className={`dropzone ${big ? 'dropzone-big' : ''} ${drag ? 'drag-over' : ''}`}
      role="button"
      tabIndex={0}
      onClick={() => input.current?.click()}
      onKeyDown={e => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); input.current?.click(); } }}
      onDragOver={e => { e.preventDefault(); setDrag(true); }}
      onDragLeave={() => setDrag(false)}
      onDrop={e => { e.preventDefault(); setDrag(false); const f = Array.from(e.dataTransfer.files); if (f.length) onFiles(f); }}
    >
      <svg width={big ? 34 : 26} height={big ? 34 : 26} viewBox="0 0 24 24" fill="none" aria-hidden="true">
        <path d="M12 4v11m0-11-4 4m4-4 4 4M5 15v3a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2v-3" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" />
      </svg>
      <span className="dropzone-title">{busy ?? title}</span>
      {hint && <small>{hint}</small>}
      <input
        ref={input} type="file" accept={ACCEPT} multiple hidden
        onChange={e => { const f = Array.from(e.target.files ?? []); e.target.value = ''; if (f.length) onFiles(f); }}
      />
    </div>
  );
}

/** a session code or a link → into the session */
export function JoinForm({ onJoin, big, autoFocus }: { onJoin: (code: string) => boolean; big?: boolean; autoFocus?: boolean }) {
  const [code, setCode] = useState('');
  return (
    <form className={`join-form ${big ? 'join-big' : ''}`} onSubmit={e => { e.preventDefault(); if (onJoin(code)) setCode(''); }}>
      <input
        className="input code" value={code} onChange={e => setCode(e.target.value)} autoFocus={autoFocus}
        placeholder="session code, e.g. k7m2qa" aria-label="session code" autoComplete="off" spellCheck={false}
      />
      <button className="btn primary" type="submit" disabled={!code.trim()}>join</button>
    </form>
  );
}

export const Toast = ({ msg }: { msg: string | null }) => <div className={`toast error ${msg ? 'show' : ''}`} role="status">{msg}</div>;

export const FORMATS = '.gp · .gp3–.gp5 · .gpx · .musicxml · .capx · alphatex — several files become a setlist';
