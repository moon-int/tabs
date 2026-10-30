"use client";
import React from 'react';
import BeatLights from './BeatLights';
import { useNow } from './Live';
import { formatTime } from '../lib/format';
import type { Beat } from '../lib/click';
import type { Position, SongInfo } from '../lib/player';
import type { Setlist } from '../lib/sync';
import type { Part } from '../lib/prefs';
import type { Counting } from '../lib/useSession';
import { changeovers, forRole } from '../lib/changeover';
import { ChangeoverLine } from './Setlist';

type Props = {
  title: string;
  song: SongInfo | null;
  position: Position;
  playing: boolean;
  counting: Counting;
  speed: number;
  beat: Beat | null;
  showBeats: boolean;
  section: string | null;
  setlist: Setlist;
  showStart: number | null;
  host: boolean;
  ready: boolean;
  countIn: boolean;
  clickOn: boolean;
  compact: boolean;
  idle: boolean;
  zoom: number;
  notesOn: boolean;
  transpose: number;
  transposeLabel: string;
  myPart: Part | null;
  onNotes: () => void;
  onPlayPause: () => void;
  onStop: () => void;
  onPrev: () => void;
  onNext: () => void;
  onGo: () => void;
  onCountIn: () => void;
  onClick: () => void;
  onZoom: (d: number) => void;
  onExit: () => void;
};

const I = ({ d, fill }: { d: string; fill?: boolean }) => (
  <svg viewBox="0 0 24 24" width="20" height="20" aria-hidden="true" fill={fill ? 'currentColor' : 'none'} stroke={fill ? 'none' : 'currentColor'} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d={d} /></svg>
);

/** the readout on top of the fullscreen notation — readable from a few metres away */
export default function StageHud(p: Props) {
  const now = useNow(p.showStart !== null, 1000);
  const { songs, index } = p.setlist;
  const current = index >= 0 ? songs[index] : null;
  const next = index >= 0 ? songs[index + 1] : null;
  const bpm = p.playing && p.position.bpm ? Math.round(p.position.bpm) : p.song ? Math.round(p.song.tempo * p.speed) : 0;
  const remaining = Math.max(0, p.position.endTime - p.position.time);
  const counting = p.counting;
  const running = p.playing || !!counting;

  return (
    <div className={`hud ${p.compact ? 'hud-compact' : ''}`}>
      <div className="hud-top">
        <div className="hud-song">
          <div className="hud-title">{p.title || 'no song'}</div>
          <div className="hud-sub">
            {index >= 0 && <span className="mono">{index + 1}/{songs.length}</span>}
            {p.section && <span className="hud-section">{p.section}</span>}
            {p.transpose ? <span className="hud-section">play in {p.transposeLabel}</span> : null}
            {current?.notes && <span className="hud-notes">{current.notes}</span>}
          </div>
        </div>

        <div className="hud-readouts">
          <div className={`hud-cell ${counting ? 'hud-count' : ''}`}>
            <span className="hud-label">{counting ? 'count-in' : 'bar'}</span>
            {counting
              ? <span className="hud-value mono">{counting.beat >= 0 ? counting.beat + 1 : '·'}<small>/{counting.beats}</small></span>
              : <span className="hud-value mono">{p.song ? p.position.bar + 1 : '–'}<small>/{p.song?.bars ?? '–'}</small></span>}
          </div>
          {p.showBeats && (
            <div className="hud-cell hud-beats">
              <span className="hud-label">beat</span>
              <BeatLights beat={p.beat} size="lg" fallback={counting?.beats} />
            </div>
          )}
          <div className="hud-cell">
            <span className="hud-label">bpm</span>
            <span className="hud-value mono">{bpm || '–'}</span>
          </div>
          <div className="hud-cell">
            <span className="hud-label">left</span>
            <span className="hud-value mono">{formatTime(remaining)}</span>
          </div>
          {p.showStart !== null && (
            <div className="hud-cell">
              <span className="hud-label">show</span>
              <span className="hud-value mono">{formatTime(now - p.showStart)}</span>
            </div>
          )}
        </div>
      </div>

      {next && (
        <div className="hud-next">
          <span className="hud-label">next</span> <strong>{next.title}</strong>
          {next.notes && <span className="hud-notes"> · {next.notes}</span>}
          {/* the changeover the band has to do before it — read from the tabs, your role first */}
          <ChangeoverLine changes={forRole(changeovers(current, next), p.myPart)} myPart={p.myPart} compact />
        </div>
      )}

      <div className={`hud-controls ${p.idle && running ? 'faded' : ''}`}>
        {p.host && (
          <>
            <button className="hud-btn" onClick={p.onPrev} disabled={index <= 0} aria-label="previous song" title="page up"><I d="M19 20 9 12l10-8zM5 19V5" /></button>
            <button className="hud-btn hud-play" onClick={p.onPlayPause} disabled={!p.ready} aria-label={counting ? 'cancel the count-in' : p.playing ? 'pause' : 'play'} title="space">
              {running ? <I fill d="M7 5h3.5v14H7zM13.5 5H17v14h-3.5z" /> : <I fill d="M8 5.5v13l11-6.5z" />}
            </button>
            <button className="hud-btn" onClick={p.onStop} disabled={!p.ready} aria-label="stop" title="s"><I fill d="M6 6h12v12H6z" /></button>
            <button className="hud-btn" onClick={p.onNext} disabled={index < 0 || index >= songs.length - 1} aria-label="next song" title="page down"><I d="m5 4 10 8-10 8zM19 5v14" /></button>
            <button className="hud-btn hud-text" onClick={p.onGo} disabled={!p.ready || running} title="countdown, then play (g)">go</button>
            <button className={`hud-btn hud-text ${p.countIn ? 'on' : ''}`} onClick={p.onCountIn} aria-pressed={p.countIn} title="count-in (c)">count-in</button>
          </>
        )}
        <div className="spacer" />
        <button className={`hud-btn hud-text ${p.notesOn ? 'on' : ''}`} onClick={p.onNotes} aria-pressed={p.notesOn} title="notes above the tab (n)">notes</button>
        <button className={`hud-btn hud-text ${p.clickOn ? 'on' : ''}`} onClick={p.onClick} aria-pressed={p.clickOn} title="click (m)">click</button>
        <button className="hud-btn" onClick={() => p.onZoom(-0.1)} aria-label="zoom out" title="−"><I d="M5 12h14" /></button>
        <span className="hud-zoom mono">{Math.round(p.zoom * 100)}%</span>
        <button className="hud-btn" onClick={() => p.onZoom(0.1)} aria-label="zoom in" title="+"><I d="M12 5v14M5 12h14" /></button>
        <button className="hud-btn" onClick={p.onExit} aria-label="leave stage view" title="esc / f"><I d="M9 4v5H4M15 4v5h5M9 20v-5H4M15 20v-5h5" /></button>
      </div>
    </div>
  );
}
