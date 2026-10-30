"use client";
import React, { useRef, useState } from 'react';
import { calm } from '../lib/calm';
import { ACCEPT, type Setlist as SetlistData, type SetlistSong, type SongMeta } from '../lib/sync';
import { GROOVES, grooveFromDef } from '../lib/groove';
import { changeovers, forRole, type Change } from '../lib/changeover';
import type { Part } from '../lib/prefs';

type Patch = Partial<SongMeta> & { title?: string };

type Props = {
  setlist: SetlistData;
  host: boolean;
  uploading: boolean;
  onGoto: (index: number) => void;
  onRemove: (index: number) => void;
  onMove: (from: number, to: number) => void;
  onAdd: (files: File[]) => void;
  onUpdate: (index: number, patch: Patch) => void;
  myPart: Part | null;
};

const Arrow = ({ d }: { d: string }) => (
  <svg viewBox="0 0 16 16" width="12" height="12" aria-hidden="true" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round"><path d={d} /></svg>
);

/** live settings of one song: cue notes, tempo, count-in, auto-advance */
export function SongEditor({ song, onUpdate }: { song: SetlistSong; onUpdate: (patch: Patch) => void }) {
  const [title, setTitle] = useState(song.title);
  const [notes, setNotes] = useState(song.notes ?? '');
  return (
    <div className="song-editor">
      <label className="field">
        <span className="field-label">title</span>
        <input className="input" value={title} maxLength={200} onChange={e => setTitle(e.target.value)} onBlur={() => title.trim() !== song.title && onUpdate({ title: title.trim() })} />
      </label>
      <label className="field">
        <span className="field-label">notes — shown to everyone on stage</span>
        <textarea className="input" rows={2} value={notes} maxLength={500} placeholder="capo 2 · drop d · segue into next · …" onChange={e => setNotes(e.target.value)} onBlur={() => notes !== (song.notes ?? '') && onUpdate({ notes })} />
      </label>
      <div className="editor-row">
        <label className="field">
          <span className="field-label">tempo</span>
          <select className="btn" value={song.speed ?? ''} onChange={e => onUpdate({ speed: e.target.value ? Number(e.target.value) : null })}>
            <option value="">original</option>
            {[0.5, 0.6, 0.7, 0.75, 0.8, 0.85, 0.9, 0.95, 1.05, 1.1, 1.15, 1.2, 1.25].map(s => <option key={s} value={s}>{Math.round(s * 100)}%</option>)}
          </select>
        </label>
        <label className="field">
          <span className="field-label">groove</span>
          <select
            className="btn"
            value={!song.groove ? '' : !song.groove.on ? 'off' : GROOVES.find(d => d.name === song.groove!.name)?.id ?? 'custom'}
            onChange={e => {
              const v = e.target.value;
              if (v === 'custom') return;
              const def = GROOVES.find(d => d.id === v);
              onUpdate({ groove: v === '' ? null : v === 'off' ? { ...(song.groove ?? grooveFromDef(GROOVES[0])), on: false } : def ? grooveFromDef(def) : null });
            }}
          >
            <option value="">keep running</option>
            <option value="off">no groove</option>
            {song.groove?.on && !GROOVES.some(d => d.name === song.groove!.name) && <option value="custom">{song.groove.name}</option>}
            {GROOVES.map(d => <option key={d.id} value={d.id}>{d.group === 'beats' ? `beats · ${d.name}` : d.name}</option>)}
          </select>
        </label>
        <label className="field">
          <span className="field-label">play in</span>
          <select className="btn" value={song.transpose ?? ''} onChange={e => onUpdate({ transpose: e.target.value === '' ? null : Number(e.target.value) })}>
            <option value="">as set</option>
            {[2, 1, 0, -1, -2, -3, -4, -5].map(n => <option key={n} value={n}>{n === 0 ? 'original pitch' : `${n > 0 ? '+' : '−'}${Math.abs(n)} semitone${Math.abs(n) === 1 ? '' : 's'}`}</option>)}
          </select>
        </label>
        <label className="field">
          <span className="field-label">count-in</span>
          <select className="btn" value={song.countIn === null ? '' : song.countIn ? 'on' : 'off'} onChange={e => onUpdate({ countIn: e.target.value === '' ? null : e.target.value === 'on' })}>
            <option value="">as set</option>
            <option value="on">on</option>
            <option value="off">off</option>
          </select>
        </label>
        <label className="check">
          <input type="checkbox" checked={song.autoNext} onChange={e => onUpdate({ autoNext: e.target.checked })} />
          load next song when this ends
        </label>
        <label className="check">
          <input type="checkbox" checked={song.autoStart} onChange={e => onUpdate({ autoStart: e.target.checked })} />
          start by itself after
          <input className="input tiny" type="number" min={0} max={120} value={song.gap} onChange={e => onUpdate({ gap: Number(e.target.value) })} aria-label="countdown seconds" />
          s countdown
        </label>
      </div>
    </div>
  );
}

/**
 * What has to change between two songs, per role — tunings straight from the
 * tab files, plus each song's rig line. Your role is listed first and lit.
 */
export function ChangeoverLine({ changes: all, myPart, compact }: { changes: Change[]; myPart: Part | null; compact?: boolean }) {
  // a retune concerns the whole band (everyone waits for it); a rig switch only its own role
  const changes = all.filter(c => c.tuning || !myPart || c.role === myPart);
  if (!changes.length) return null;
  const retune = changes.some(c => c.tuning);
  return (
    <div className={`changeover ${compact ? 'compact' : ''} ${retune ? '' : 'light'}`}>
      <span className="changeover-tag">changeover</span>
      {changes.map(c => (
        <span key={c.role} className={`changeover-role ${c.role === myPart ? 'mine' : ''}`}>
          <strong>{c.role}</strong>
          {c.tuning && <> {c.from.tuning} <span className="arrow">→</span> <b>{c.to.tuning}</b></>}
          {c.rig && <span className="rig"> {c.tuning ? '· ' : ''}{c.to.rig}</span>}
        </span>
      ))}
    </div>
  );
}

function Setlist({ setlist, host, uploading, myPart, onGoto, onRemove, onMove, onAdd, onUpdate }: Props) {
  const input = useRef<HTMLInputElement>(null);
  const [editing, setEditing] = useState<number | null>(null);
  const { songs, index } = setlist;

  return (
    <>
      <div className="section-head">
        <span className="hint-inline">
          {songs.length ? <>song <strong className="mono">{index >= 0 ? index + 1 : '–'}</strong> of {songs.length}</> : 'nothing queued yet'}
        </span>
        <div className="spacer" />
        {host && (
          <>
            <button className="btn sm" onClick={() => input.current?.click()} disabled={uploading}>{uploading ? 'uploading…' : '+ add songs'}</button>
            <input
              ref={input} type="file" accept={ACCEPT} multiple hidden
              onChange={e => { const f = Array.from(e.target.files ?? []); e.target.value = ''; if (f.length) onAdd(f); }}
            />
          </>
        )}
      </div>

      {songs.length === 0
        ? <div className="empty-line">{host ? 'queue songs for a rehearsal or a gig, then step through them with page up / page down — or a page-turner pedal. each song can carry its own tempo, notes and auto-advance.' : 'no setlist yet.'}</div>
        : (
          <div className="setlist">
            {songs.map((s, i) => (
              <React.Fragment key={`${i}-${s.title}`}>
              {i > 0 && <ChangeoverLine changes={forRole(changeovers(songs[i - 1], s), myPart)} myPart={myPart} />}
              <div className={`song-item ${i === index ? 'current' : ''}`}>
                <div className="song-row">
                  <span className="num">{String(i + 1).padStart(2, '0')}</span>
                  <div className="title-wrap">
                    {host
                      ? <button className="title" onClick={() => onGoto(i)} title="load this song for everyone">{s.title}</button>
                      : <span className="title">{s.title}</span>}
                    {s.notes && <span className="song-notes">{s.notes}</span>}
                  </div>
                  <span className="badges">
                    {s.speed && <span className="badge">{Math.round(s.speed * 100)}%</span>}
                    {s.countIn === true && <span className="badge">count-in</span>}
                    {s.transpose ? <span className="badge" title="whole song moved — same tab">{s.transpose > 0 ? '+' : '−'}{Math.abs(s.transpose)} st</span> : null}
                    {s.groove && <span className="badge" title="groove for this song">{s.groove.on ? `♪ ${s.groove.name}` : 'no groove'}</span>}
                    {s.autoNext && <span className="badge" title="rolls into the next song">→</span>}
                    {s.autoStart && <span className="badge" title={`starts after a ${s.gap}s countdown`}>auto {s.gap}s</span>}
                  </span>
                  {host && (
                    <span className="row-actions">
                      <button className={`icon-btn ${editing === i ? 'active' : ''}`} onClick={() => setEditing(editing === i ? null : i)} aria-label={`settings for ${s.title}`} aria-expanded={editing === i} title="song settings">
                        <Arrow d="M3 5h10M3 11h10M6 3v4M10 9v4" />
                      </button>
                      <button className="icon-btn" onClick={() => onMove(i, i - 1)} disabled={i === 0} aria-label={`move ${s.title} up`}><Arrow d="M8 13V3M4 7l4-4 4 4" /></button>
                      <button className="icon-btn" onClick={() => onMove(i, i + 1)} disabled={i === songs.length - 1} aria-label={`move ${s.title} down`}><Arrow d="M8 3v10M4 9l4 4 4-4" /></button>
                      <button className="icon-btn warn" onClick={() => onRemove(i)} aria-label={`remove ${s.title}`}><Arrow d="M4 4l8 8M12 4l-8 8" /></button>
                    </span>
                  )}
                </div>
                {host && editing === i && <SongEditor key={i} song={s} onUpdate={patch => onUpdate(i, patch)} />}
              </div>
              </React.Fragment>
            ))}
          </div>
        )}
    </>
  );
}

// the setlist doesn't change while a song plays — don't redraw it with every transport update
export default calm(Setlist);
