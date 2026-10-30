"use client";
import React from 'react';
import Knob from './Knob';
import BeatLights from './BeatLights';
import type { Position, Range } from '../lib/player';
import type { Beat } from '../lib/click';
import type { Counting } from '../lib/useSession';

type Props = {
  host: boolean;
  ready: boolean;
  playing: boolean;
  counting: Counting;
  position: Position;
  bars: number;
  songTempo: number | null;
  speed: number;
  loop: boolean;
  range: Range;
  countIn: boolean;
  beat: Beat | null;
  showBeats: boolean;
  music: number;
  click: number;
  clickOn: boolean;
  onPlayPause: () => void;
  onStop: () => void;
  onSpeed: (speed: number) => void;
  onLoop: (loop: boolean) => void;
  onCountIn: (on: boolean) => void;
  onClearRange: () => void;
  onMusic: (v: number) => void;
  onClick: (v: number) => void;
  onClickOn: (on: boolean) => void;
};

export default function Transport(p: Props) {
  const tempo = p.songTempo ?? 0;
  const bpm = Math.round(tempo * p.speed);
  const setBpm = (v: number) => tempo && p.onSpeed(v / tempo);
  const live = p.playing && p.position.bpm ? Math.round(p.position.bpm) : bpm;
  const canDrive = p.host && p.ready;
  const counting = p.counting;
  const running = p.playing || !!counting;

  return (
    <div className="transport">
      <div className="play-group">
        <button
          className={`play ${p.playing ? 'is-playing' : ''} ${counting ? 'is-counting' : ''}`}
          onClick={p.onPlayPause}
          disabled={!canDrive}
          aria-label={counting ? 'cancel the count-in' : p.playing ? 'pause' : p.countIn ? 'count in and play' : 'play'}
          title={!p.host ? 'the host runs the transport' : counting ? 'cancel the count-in (space)' : 'space'}
        >
          {running
            ? <svg viewBox="0 0 24 24" width="22" height="22"><path d="M7 5h3.5v14H7zM13.5 5H17v14h-3.5z" fill="currentColor" /></svg>
            : <svg viewBox="0 0 24 24" width="22" height="22"><path d="M8 5.5v13l11-6.5z" fill="currentColor" /></svg>}
        </button>
        {p.host && (
          <button className="round" onClick={p.onStop} disabled={!canDrive} aria-label="stop" title="stop (s)">
            <svg viewBox="0 0 24 24" width="14" height="14"><rect x="5" y="5" width="14" height="14" rx="2" fill="currentColor" /></svg>
          </button>
        )}
      </div>

      <div className={`lcd ${counting ? 'lcd-count' : ''}`}>
        <div className="lcd-label"><span>{counting ? 'count-in' : 'bar'}</span>{p.showBeats && <BeatLights beat={p.beat} fallback={counting?.beats} />}</div>
        <div className="lcd-value">
          {counting
            ? <>{counting.beat >= 0 ? counting.beat + 1 : '·'}<small> / {counting.beats}</small></>
            : p.bars
            ? <>{String(p.position.bar + 1).padStart(3, '0')}<small> / {p.bars}</small></>
            : '---'}
        </div>
      </div>

      <div className="bpm">
        <div className="lcd" title={tempo ? `original tempo ${tempo} bpm` : undefined}>
          <div className="lcd-label">
            <span>tempo</span>
            {tempo > 0 && <span>{Math.round(p.speed * 100)}%</span>}
          </div>
          <div className="lcd-value">{tempo ? live : '---'}<small> bpm</small></div>
        </div>
        {p.host && (
          <div className="bpm-buttons">
            <button className="btn sm" onClick={() => setBpm(bpm - 5)} disabled={!canDrive} aria-label="tempo down" title="↓ (shift: −1)">−</button>
            <button className="btn sm" onClick={() => setBpm(bpm + 5)} disabled={!canDrive} aria-label="tempo up" title="↑ (shift: +1)">+</button>
            <button className="btn sm" onClick={() => p.onSpeed(1)} disabled={!canDrive || p.speed === 1} title="back to the song's own tempo (0)">
              {tempo ? `${tempo} orig` : 'orig'}
            </button>
          </div>
        )}
      </div>

      {p.host ? (
        <div className="transport-toggles">
          <button className={`btn sm ${p.loop ? 'on' : ''}`} onClick={() => p.onLoop(!p.loop)} disabled={!canDrive} aria-pressed={p.loop} title="loop (l)">
            loop{p.range ? ' range' : ''}
          </button>
          <button className={`btn sm ${p.countIn ? 'on' : ''}`} onClick={() => p.onCountIn(!p.countIn)} disabled={!p.host} aria-pressed={p.countIn} title="one bar of clicks on every screen before playback starts (c)">
            count-in
          </button>
          {/* a range is made by dragging across the notation — the button only shows while there is one */}
          {p.range && (
            <button className="btn sm ghost" onClick={p.onClearRange} disabled={!canDrive} title="play the whole song again">
              × range
            </button>
          )}
        </div>
      ) : (
        (p.countIn || p.loop) && (
          <div className="transport-toggles">
            {p.countIn && <span className="chip">count-in</span>}
            {p.loop && <span className="chip">loop{p.range ? ' range' : ''}</span>}
          </div>
        )
      )}

      <div className="spacer" />

      <div className="transport-knobs">
        <Knob label="music" value={p.music} min={0} max={1} step={0.01} defaultValue={0.8} onChange={p.onMusic} format={v => `${Math.round(v * 100)}%`} />
        <div className={`knob-toggle ${p.clickOn ? '' : 'off'}`}>
          <Knob label="click" value={p.click} min={0} max={1} step={0.01} defaultValue={0.7} onChange={v => { p.onClick(v); if (!p.clickOn) p.onClickOn(true); }} format={v => (p.clickOn ? `${Math.round(v * 100)}%` : 'off')} />
          <button className={`btn xs ${p.clickOn ? 'on' : ''}`} onClick={() => p.onClickOn(!p.clickOn)} aria-pressed={p.clickOn} title="click, just for you (m)">
            {p.clickOn ? 'on' : 'off'}
          </button>
        </div>
      </div>
    </div>
  );
}
