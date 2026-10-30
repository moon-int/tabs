"use client";
import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Brand } from '../../../components/Logo';
import { BRAND } from '../../../lib/brand';
import Transport from '../../../components/Transport';
import SeekBar from '../../../components/SeekBar';
import TrackMixer from '../../../components/TrackMixer';
import GrooveStrip from '../../../components/GrooveStrip';
import GroovePanel from '../../../components/GroovePanel';
import Transpose, { referenceTuning, transposeOption } from '../../../components/Transpose';
import { changeovers, forRole, setupOf } from '../../../lib/changeover';
import Setlist, { ChangeoverLine } from '../../../components/Setlist';
import StageHud from '../../../components/StageHud';
import SettingsDrawer, { type DrawerTab } from '../../../components/SettingsDrawer';
import { CountInOverlay, CountdownOverlay, CueBanner, LivePanel, Members } from '../../../components/Live';
import Invite from '../../../components/Invite';
import { api, loadConfig, signInUrl, type ServerConfig } from '../../../lib/account';
import { useSession } from '../../../lib/useSession';
import { ACCEPT, freshKey, readHostToken } from '../../../lib/sync';
import { loadAlphaTab } from '../../../lib/alphatab';
import { LOCAL_ROOM, localRoom, startLocalExample } from '../../../lib/local';
import { clamp, stripExt } from '../../../lib/format';
import { TUNINGS, describeTuning, findPreset } from '../../../lib/tuning';
import {
  PARTS, defaultPrefs, loadPrefs, savePrefs,
  type MidiAction, type PanelTab, type Prefs,
} from '../../../lib/prefs';
import { applyTheme, resolveTheme } from '../../../lib/themes';
import { useIdle, useStage, useWakeLock } from '../../../lib/stage';
import { useMidi } from '../../../lib/midi';
import { at } from '../../../lib/base';

const FOLLOW_RESUME_MS = 6000;

export default function RoomPage({ params }: { params: { id: string } }) {
  const roomId = decodeURIComponent(params.id).toLowerCase();
  // a solo session runs in this page (lib/local.ts) — no server, nobody else
  const local = roomId === LOCAL_ROOM;
  const [exists, setExists] = useState<boolean | null>(null);
  const [isHostHere, setIsHostHere] = useState(false);
  const [started, setStarted] = useState(false);
  const [prefs, setPrefsState] = useState<Prefs>(defaultPrefs);
  const [hydrated, setHydrated] = useState(false);
  const [toast, setToast] = useState<{ msg: string; error?: boolean } | null>(null);
  const [dragOver, setDragOver] = useState(false);
  const [drawer, setDrawer] = useState<{ open: boolean; tab: DrawerTab }>({ open: false, tab: 'sound' });
  const [followPaused, setFollowPaused] = useState(false);
  const [invite, setInvite] = useState(false);
  const [server, setServer] = useState<ServerConfig | null>(null);
  const scoreRef = useRef<HTMLDivElement>(null);
  const scrollRef = useRef<HTMLDivElement>(null);
  const stageRef = useRef<HTMLDivElement>(null);
  const fileInput = useRef<HTMLInputElement>(null);
  const els = useRef({ score: scoreRef, scroll: scrollRef }).current;

  const setPrefs = useCallback((fn: (p: Prefs) => Prefs) => setPrefsState(fn), []);
  const { stage, enter: enterStage, exit: exitStage, toggle: toggleStage } = useStage(stageRef);

  // stage view has its own zoom, so a music stand can sit further away than a desk
  // scrolling by hand pauses following until "back to cursor"
  const sessionPrefs = useMemo(() => ({
    ...prefs,
    view: { ...prefs.view, zoom: stage ? prefs.stage.zoom : prefs.view.zoom, follow: followPaused ? 'off' as const : prefs.view.follow },
  }), [prefs, stage, followPaused]);
  const theme = useMemo(() => resolveTheme(prefs.theme.id, prefs.theme.accent, prefs.view.paper), [prefs.theme.id, prefs.theme.accent, prefs.view.paper]);
  useEffect(() => { if (hydrated) applyTheme(theme, prefs.view.paper); }, [theme, prefs.view.paper, hydrated]);

  const s = useSession(roomId, started, els, sessionPrefs, theme.notation);
  const { actions: a, song, position, shared } = s;
  const host = s.role === 'host';
  const canDrive = host && s.ready;

  useWakeLock(started && (prefs.stage.wakeLock || stage));
  const idle = useIdle(stage);

  // ---- boot: does the room exist, are we its host, local prefs ----------------

  useEffect(() => {
    setPrefsState(loadPrefs());
    setHydrated(true);
    setIsHostHere(local || !!readHostToken(roomId));
    // start fetching alphaTab right away — the click below only has to unlock audio
    loadAlphaTab().catch(() => {});
    // a host coming straight from "start a session" already clicked: no second "join" step
    let fresh = false;
    try { fresh = sessionStorage.getItem(freshKey(roomId)) === '1'; sessionStorage.removeItem(freshKey(roomId)); } catch {}
    // who is signed in, library, control — also for a host who comes straight from "start"
    if (!local) loadConfig().then(setServer);
    if (fresh) { setExists(true); setStarted(true); return; }
    if (local) {
      // after a reload the solo room is empty again — an example in the address comes back
      const example = new URLSearchParams(window.location.search).get('example');
      const r = localRoom();
      if (!example || r.file || r.setlist.length) { setExists(true); return; }
      startLocalExample(example)
        .catch(() => setToast({ msg: 'could not load the example show', error: true }))
        .finally(() => setExists(true));
      return;
    }
    fetch(at(`/api/rooms/${encodeURIComponent(roomId)}`))
      .then(async r => {
        setExists(r.ok);
        // signed in as an admin (or the session's owner) you host it, even when you came with the code
        if (r.ok && (await r.json().catch(() => ({}))).youHost) setIsHostHere(true);
      })
      .catch(() => setExists(false));
  }, [roomId, local]);

  useEffect(() => { if (hydrated) savePrefs(prefs); }, [prefs, hydrated]);

  const flash = useCallback((msg: string, error = false) => {
    setToast({ msg, error });
    window.setTimeout(() => setToast(t => (t?.msg === msg ? null : t)), error ? 3600 : 1800);
  }, []);

  const { error, clearError } = s;
  useEffect(() => { if (error) { flash(error, true); clearError(); } }, [error, clearError, flash]);

  const title = song?.title || stripExt(s.fileName);
  useEffect(() => { document.title = title ? `${title} — ${BRAND.name}` : BRAND.title; }, [title]);

  const setView = (patch: Partial<Prefs['view']>) => setPrefs(p => ({ ...p, view: { ...p.view, ...patch } }));
  const zoom = (d: number) => setPrefs(p => stage
    ? { ...p, stage: { ...p.stage, zoom: clamp(Math.round((p.stage.zoom + d) * 100) / 100, 0.5, 3) } }
    : { ...p, view: { ...p.view, zoom: clamp(Math.round((p.view.zoom + d) * 100) / 100, 0.5, 2.5) } });
  // a nudge of the wheel or a brushed screen must not throw you off the cursor: following only pauses
  // once you clearly scroll away to read ahead (a third of the view within a moment), and it picks the
  // cursor up again by itself after a few quiet seconds
  const scrollIntent = useRef({ sum: 0, at: 0, touchY: null as number | null });
  const resumeTimer = useRef<number | undefined>(undefined);
  const resumeFollow = useCallback(() => {
    window.clearTimeout(resumeTimer.current);
    resumeTimer.current = undefined;
    setFollowPaused(false);
    a.scrollToCursor();
  }, [a]);
  const userScroll = (delta: number) => {
    if (prefs.view.follow === 'off' || !s.playing) return;
    const it = scrollIntent.current;
    const now = performance.now();
    if (now - it.at > 1200) it.sum = 0;
    it.at = now;
    it.sum += Math.abs(delta);
    const reading = followPaused || it.sum > (scrollRef.current?.clientHeight ?? 600) * 0.33;
    if (!reading) return;
    if (!followPaused) setFollowPaused(true);
    window.clearTimeout(resumeTimer.current);
    resumeTimer.current = window.setTimeout(resumeFollow, FOLLOW_RESUME_MS);
  };
  useEffect(() => {
    if (s.playing) return;
    window.clearTimeout(resumeTimer.current);
    setFollowPaused(false);
  }, [s.playing]);
  useEffect(() => () => window.clearTimeout(resumeTimer.current), []);

  const setClick = (patch: Partial<Prefs['click']>) => setPrefs(p => ({ ...p, click: { ...p.click, ...patch } }));

  const openFiles = (files: File[]) => {
    if (!files.length) return;
    if (files.length === 1) a.openFile(files[0]).then(() => flash(`${files[0].name} loaded for everyone`)).catch(() => {});
    else a.addToSet(files).then(() => flash(`${files.length} songs added to the setlist`)).catch(() => {});
  };

  // ---- shared shortcut actions (keyboard, midi pedals, hud) ----------------------------

  const run = useCallback((action: MidiAction) => {
    switch (action) {
      case 'click': setPrefs(p => ({ ...p, click: { ...p.click, on: !p.click.on } })); return;
      case 'stage': toggleStage(); return;
    }
    if (!host) return;
    switch (action) {
      case 'playPause': a.playPause(); break;
      case 'stop': a.stop(); break;
      case 'next': a.nextSong(); break;
      case 'prev': a.prevSong(); break;
      case 'loop': a.setLoop(!shared.loop); break;
      case 'countIn': a.setCountIn(!shared.countIn); break;
    }
  }, [host, a, shared.loop, shared.countIn, setPrefs, toggleStage]);

  const midi = useMidi(prefs.midi, run, (action, key) => {
    setPrefs(p => ({ ...p, midi: { ...Object.fromEntries(Object.entries(p.midi).filter(([, v]) => v !== key)), [action]: key } }));
    flash('pedal learned');
  });

  const bpm = song ? Math.round(song.tempo * shared.speed) : 0;
  const keys = useRef<(e: KeyboardEvent) => void>(() => {});
  keys.current = (e: KeyboardEvent) => {
    const el = e.target as HTMLElement;
    if (!started || el.closest('input, select, textarea') || e.metaKey || e.ctrlKey || e.altKey) return;
    // inside the settings every key belongs to the settings (space toggles a switch there, not playback)
    if (drawer.open || invite || el.closest('.drawer')) return;
    const slider = el.getAttribute('role') === 'slider';
    const k = e.key.toLowerCase();

    if (e.key === 'Escape' && stage && !document.fullscreenElement) { exitStage(); return; }
    if (k === 'm' && !e.repeat) { run('click'); return; }
    if (k === 'f' && !e.repeat) { run('stage'); return; }
    if (k === 'n' && !e.repeat) { setView({ stave: prefs.view.stave === 'tab' ? 'default' : 'tab' }); return; }
    if (k === 'a' && !e.repeat) { setFollowPaused(false); setView({ follow: prefs.view.follow === 'off' ? 'page' : 'off' }); return; }
    if (k === '+' || k === '=') { zoom(0.1); return; }
    if (k === '-' || k === '_') { zoom(-0.1); return; }
    if (!host) return;

    if (e.code === 'Space') {
      e.preventDefault();
      // a focused button would also "click" on keyup and undo the toggle — let go of it
      if (el.closest('button, a, [role="radio"]')) el.blur();
      if (!e.repeat) a.playPause();
      return;
    }
    if (e.key === 'PageDown') { e.preventDefault(); a.nextSong(); return; }
    if (e.key === 'PageUp') { e.preventDefault(); a.prevSong(); return; }
    if (e.repeat && !['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown'].includes(e.key)) return;
    if (k === 's') { a.stop(); return; }
    if (k === 'l') { run('loop'); return; }
    if (k === 'c') { run('countIn'); return; }
    if (k === 'g') { a.startWithCountdown(4); return; }
    if (k === '0' && song) { a.setSpeed(1); return; }
    if (slider) return; // knobs & the seek bar use the arrows themselves
    if (e.key === 'ArrowLeft' || e.key === 'ArrowRight') {
      e.preventDefault();
      a.seekBy((e.key === 'ArrowRight' ? 1 : -1) * (e.shiftKey ? 4 : 1));
    } else if ((e.key === 'ArrowUp' || e.key === 'ArrowDown') && song) {
      e.preventDefault();
      a.setSpeed((bpm + (e.key === 'ArrowUp' ? 1 : -1) * (e.shiftKey ? 1 : 5)) / song.tempo);
    }
  };
  useEffect(() => {
    const on = (e: KeyboardEvent) => keys.current(e);
    window.addEventListener('keydown', on);
    return () => window.removeEventListener('keydown', on);
  }, []);

  // ---- render --------------------------------------------------------------------

  if (exists === false) {
    return (
      <div className="container">
        <header className="header"><Brand /></header>
        <section className="panel" style={{ textAlign: 'center', padding: 40 }}>
          <h2 style={{ margin: '0 0 8px' }}>session <span className="mono">{roomId}</span> not found</h2>
          <p className="muted" style={{ margin: '0 0 18px' }}>it may have ended, or the server was restarted. sessions only live in memory.</p>
          <a className="btn primary" href={at('/')}>start a new one</a>
        </section>
      </div>
    );
  }

  const endTick = position.endTick;
  const marks = endTick ? s.sectionTicks.filter(t => t > 0).map(t => t / endTick) : [];
  const currentSection = song ? song.sections.reduce((cur, sec, i) => (sec.bar <= position.bar ? i : cur), -1) : -1;
  const loadingSounds = s.busy.soundfont !== null && started;
  const busyWidth = s.busy.uploading ? 60 : loadingSounds ? Math.max(4, (s.busy.soundfont ?? 0) * 100) : s.busy.rendering ? 85 : 0;
  const hasFile = !!s.fileName || !!song;
  const meta = song ? [song.artist, song.album, `${song.bars} bars`, `${song.tracks.length} track${song.tracks.length === 1 ? '' : 's'}`].filter(Boolean) : [];
  const currentSong = s.setlist.index >= 0 ? s.setlist.songs[s.setlist.index] : null;
  // one name for the guitar tuning everywhere: the role tuning read from the file, else the first guitar track
  const guitarTuning = currentSong?.roles?.guitar?.tuning ?? referenceTuning(song);
  const flashOn = prefs.click.flash && (s.playing || !!s.counting) && s.beat?.beat === 0;
  const openDrawer = (tab: DrawerTab) => setDrawer({ open: true, tab });
  const nextSong = s.setlist.index >= 0 ? s.setlist.songs[s.setlist.index + 1] ?? null : null;
  // the panel under the notation: only the parts that have something to show
  const tabs: { id: PanelTab; label: string; count?: number }[] = [
    ...(song && s.mix.length ? [{ id: 'mix' as const, label: 'instruments' }] : []),
    ...(host ? [{ id: 'groove' as const, label: s.groove?.on ? 'groove ♪' : 'groove' }] : []),
    ...(host || s.setlist.songs.length ? [{ id: 'setlist' as const, label: 'setlist', count: s.setlist.songs.length || undefined }] : []),
    ...(host ? [{ id: 'live' as const, label: 'live tools' }] : []),
    ...(s.members.length > 1 ? [{ id: 'band' as const, label: 'band', count: s.members.length }] : []),
  ];
  const tab = tabs.find(t => t.id === prefs.ui.tab)?.id ?? tabs[0]?.id;

  return (
    <div className="container wide">
      <header className="header">
        <Brand />
        <div className="spacer" />
        <div className="header-info">
          {local ? (
            <span className="chip" title="runs in your browser — for a band session run tabs yourself">solo · <strong>just you</strong></span>
          ) : (
            <button className="chip chip-btn" onClick={() => setInvite(true)} title="invite link and qr code">
              session <strong className="mono">{roomId}</strong> · invite
              <svg viewBox="0 0 16 16" width="12" height="12" fill="none" stroke="currentColor" strokeWidth="1.5" aria-hidden="true"><rect x="5" y="5" width="8" height="8" rx="1.5" /><path d="M3 10V4a1 1 0 0 1 1-1h6" /></svg>
            </button>
          )}
          {s.role && !local && (
            <span className={`chip ${host ? 'mint' : ''}`} title={started ? `connection: ${s.conn}` : undefined}>
              {started && <span className={`dot ${s.conn === 'open' ? 'ok' : s.conn === 'connecting' ? 'wait' : 'bad'}`} />}
              {host
                ? <>host · {s.peers.listeners} listening</>
                : <>listening · host {s.peers.hostConnected ? 'online' : 'offline'}</>}
            </span>
          )}
          <button className="btn sm" onClick={() => openDrawer('sound')} title="sound bank, click sound, outputs, theme, layout, stage, pedals">
            <svg viewBox="0 0 24 24" width="15" height="15" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round"><path d="M4 7h10M18 7h2M4 17h4M12 17h8" /><circle cx="16" cy="7" r="2" /><circle cx="10" cy="17" r="2" /></svg>
            settings
          </button>
          <button className="btn sm" onClick={enterStage} disabled={!started} title="fullscreen (f)">
            <svg viewBox="0 0 24 24" width="15" height="15" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"><path d="M4 9V4h5M20 9V4h-5M4 15v5h5M20 15v5h-5" /></svg>
            fullscreen
          </button>
        </div>
      </header>

      {s.conn === 'closed' && <div className="banner warn"><span className="dot wait" />connection lost — reconnecting…</div>}
      {s.conn === 'gone' && <div className="banner warn">this session has ended. <div className="spacer" /><a className="btn sm" href={at('/')}>start a new one</a></div>}
      {s.role === 'listener' && !s.peers.hostConnected && s.conn === 'open' && (
        <div className="banner">the host is offline right now — playback picks up again as soon as they&apos;re back.</div>
      )}
      {!stage && <CueBanner cue={s.cue} host={host} onClear={() => a.sendCue(null)} />}

      {/* the deck: what's playing, where we are, and the transport — everything you need while playing */}
      <section className="panel deck">
        <div className="deck-song">
          <div className="song-text">
            <div className="song-kicker">
              {currentSong && <span className="chip mono" title="position in the setlist">{s.setlist.index + 1} / {s.setlist.songs.length}</span>}
              {meta.length > 0 && <span className="song-meta">{meta.join(' · ')}</span>}
            </div>
            <h1 className="song-title">{title || (host ? 'no song loaded' : 'waiting for a song')}</h1>
            {!song && <div className="song-meta">{host ? 'open a tab file — everyone in the session gets it instantly.' : 'the host picks what we play.'}</div>}
            {currentSong?.notes && <div className="song-cue-notes">{currentSong.notes}</div>}
            {/* what each role plays this song with — tunings from the file, your role first */}
            {currentSong && setupOf(currentSong).length > 0 && (
              <div className="setup">
                {forRole(setupOf({ ...currentSong, transpose: shared.transpose }), prefs.part).map(x => (
                  <span key={x.role} className={`setup-role ${x.role === prefs.part ? 'mine' : ''}`}>
                    <strong>{x.role}</strong> {[x.tuning, x.rig].filter(Boolean).join(' · ')}
                  </span>
                ))}
              </div>
            )}
          </div>
          <div className="deck-actions">
            {song && <Transpose song={song} reference={guitarTuning} value={shared.transpose} host={host} disabled={!s.ready} onChange={a.setTranspose} />}
            {host && (
              <div className="row">
                {s.setlist.songs.length > 0 && (
                  <div className="segmented" aria-label="setlist">
                    <button onClick={a.prevSong} disabled={s.setlist.index <= 0} title="previous song (page up)">‹ prev</button>
                    <button onClick={a.nextSong} disabled={s.setlist.index >= s.setlist.songs.length - 1} title="next song (page down)">next ›</button>
                  </div>
                )}
                <button className="btn sm" onClick={() => fileInput.current?.click()} disabled={s.busy.uploading || !started}>
                  {s.busy.uploading ? 'uploading…' : 'open file'}
                </button>
                <input
                  ref={fileInput} type="file" accept={ACCEPT} hidden
                  onChange={e => { const f = Array.from(e.target.files ?? []); e.target.value = ''; openFiles(f); }}
                />
              </div>
            )}
          </div>
        </div>

        <Transport
          host={host} ready={s.ready} playing={s.playing} counting={s.counting} position={position}
          bars={song?.bars ?? 0} songTempo={song?.tempo ?? null}
          speed={shared.speed} loop={shared.loop} range={shared.range} countIn={shared.countIn}
          beat={s.beat} showBeats
          music={prefs.music} click={prefs.click.level} clickOn={prefs.click.on}
          onPlayPause={a.playPause} onStop={a.stop} onSpeed={a.setSpeed}
          onLoop={a.setLoop} onCountIn={a.setCountIn} onClearRange={a.clearRange}
          onMusic={music => setPrefs(p => ({ ...p, music }))}
          onClick={level => setClick({ level })}
          onClickOn={on => setClick({ on })}
        />
        <SeekBar
          tick={position.tick} endTick={endTick} time={position.time} endTime={position.endTime}
          range={shared.range} marks={marks} interactive={canDrive} onSeek={a.seek}
        />

        {song && song.sections.length > 0 && (
          <div className="sections" aria-label="sections">
            {song.sections.map((sec, i) => {
              const next = song.sections[i + 1]?.bar ?? song.bars;
              return (
                <span key={i} className={`section-chip ${i === currentSection ? 'now' : ''}`}>
                  <button onClick={() => a.jumpToBar(sec.bar)} disabled={!canDrive} title={host ? `jump to bar ${sec.bar + 1}` : `bar ${sec.bar + 1}`}>{sec.name}</button>
                  {host && <button onClick={() => a.loopBars(sec.bar, next)} disabled={!canDrive} title={`loop bars ${sec.bar + 1}–${next}`} aria-label={`loop ${sec.name}`}>⟳</button>}
                </span>
              );
            })}
          </div>
        )}

        {nextSong && (
          <div className="deck-next">
            <span className="deck-next-label">next</span> <strong>{nextSong.title}</strong>
            {nextSong.notes && <span className="muted"> · {nextSong.notes}</span>}
            <ChangeoverLine changes={forRole(changeovers(currentSong, nextSong), prefs.part)} myPart={prefs.part} compact />
          </div>
        )}
      </section>

      <div ref={stageRef} className={`stage-wrap ${stage ? 'stage-on' : ''}`}>
        {stage && (
          <StageHud
            title={title} song={song} position={position} playing={s.playing} counting={s.counting} speed={shared.speed}
            beat={s.beat} showBeats section={currentSection >= 0 ? song!.sections[currentSection].name : null}
            setlist={s.setlist} showStart={s.showStart} host={host} ready={s.ready}
            countIn={shared.countIn} clickOn={prefs.click.on} compact={prefs.stage.hud === 'compact'} idle={idle}
            zoom={prefs.stage.zoom}
            transpose={shared.transpose} transposeLabel={transposeOption(shared.transpose, guitarTuning)} myPart={prefs.part}
            notesOn={prefs.view.stave !== 'tab'} onNotes={() => setView({ stave: prefs.view.stave === 'tab' ? 'default' : 'tab' })}
            onPlayPause={a.playPause} onStop={a.stop} onPrev={a.prevSong} onNext={a.nextSong}
            onGo={() => a.startWithCountdown(4)} onCountIn={() => run('countIn')} onClick={() => run('click')}
            onZoom={zoom} onExit={exitStage}
          />
        )}
        <section className="panel score-panel">
          {!stage && (
            <div className="section-head score-tools">
              <h2>notation</h2>
              <div className="spacer" />
              {/* the two things people actually switch: notes above the tab, and following the cursor */}
              <button
                className={`btn sm ${prefs.view.stave === 'tab' ? '' : 'on'}`}
                onClick={() => setView({ stave: prefs.view.stave === 'tab' ? 'default' : 'tab' })}
                aria-pressed={prefs.view.stave !== 'tab'}
                title="standard notation above the tab (n)"
              >notes {prefs.view.stave === 'tab' ? 'off' : 'on'}</button>
              <button
                className={`btn sm ${prefs.view.follow === 'off' ? '' : 'on'}`}
                onClick={() => { setFollowPaused(false); setView({ follow: prefs.view.follow === 'off' ? 'page' : 'off' }); }}
                aria-pressed={prefs.view.follow !== 'off'}
                title="turn the page when the cursor leaves the screen (a)"
              >auto-scroll {prefs.view.follow === 'off' ? 'off' : 'on'}</button>
              <button
                className="btn sm" disabled={!song}
                onClick={() => { if (a.downloadMidi()) flash('midi saved — at the session’s tempo and pitch'); }}
                title="download the song as a midi file: one track per instrument, at the tempo and pitch you hear"
              >
                <svg viewBox="0 0 16 16" width="12" height="12" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M8 2v8M4.5 6.5 8 10l3.5-3.5M3 13h10" /></svg>
                midi
              </button>
              <div className="segmented" aria-label="zoom">
                <button onClick={() => zoom(-0.1)} disabled={prefs.view.zoom <= 0.5} aria-label="zoom out">−</button>
                <button onClick={() => setView({ zoom: 1 })} className="mono" title="reset zoom">{Math.round(prefs.view.zoom * 100)}%</button>
                <button onClick={() => zoom(0.1)} disabled={prefs.view.zoom >= 2.5} aria-label="zoom in">+</button>
              </div>
            </div>
          )}
          {followPaused && (
            <button className="follow-pill" onClick={resumeFollow} title="following picks up again by itself after a few seconds">
              ↓ back to cursor
            </button>
          )}
          <div
            ref={scrollRef}
            onWheel={e => userScroll(e.deltaMode === 1 ? e.deltaY * 32 : e.deltaY)}
            onTouchStart={e => { scrollIntent.current.touchY = e.touches[0]?.clientY ?? null; }}
            onTouchMove={e => {
              const y = e.touches[0]?.clientY;
              const it = scrollIntent.current;
              if (y === undefined || it.touchY === null) return;
              userScroll(y - it.touchY);
              it.touchY = y;
            }}
            className={`score-scroll ${prefs.view.layout === 'horizontal' ? 'horizontal' : ''} ${dragOver ? 'drag-over' : ''}`}
            onDragOver={e => { if (host) { e.preventDefault(); setDragOver(true); } }}
            onDragLeave={() => setDragOver(false)}
            onDrop={e => { if (!host) return; e.preventDefault(); setDragOver(false); openFiles(Array.from(e.dataTransfer.files)); }}
          >
            {busyWidth > 0 && <div className="busy-bar" style={{ width: `${busyWidth}%` }} />}
            <div ref={scoreRef} className="score-surface" />
            {!hasFile && (
              <div className="score-placeholder">
                <div>
                  <svg width="44" height="44" viewBox="0 0 64 64" aria-hidden="true" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round">
                    <path d="M10 18h44M10 28h44M10 38h44M10 48h44" />
                  </svg>
                  <p>{host ? 'drop a guitar pro, musicxml or alphatex file here — or several to build a setlist.' : 'the notation shows up here as soon as the host loads a song.'}</p>
                </div>
              </div>
            )}
            {hasFile && loadingSounds && (
              <div className="score-placeholder"><p className="score-loading">loading sounds… {Math.round((s.busy.soundfont ?? 0) * 100)}%</p></div>
            )}
          </div>
          <CountInOverlay counting={s.counting} />
        </section>

        {/* overlays live inside the stage element so they survive real fullscreen */}
        {stage && <CueBanner cue={s.cue} big host={host} onClear={() => a.sendCue(null)} />}
        <CountdownOverlay countdown={s.countdown} host={host} onCancel={a.cancelCountdown} />
        {flashOn && <div className="downbeat-flash" key={`f${s.beat?.bar}`} aria-hidden="true" />}
        {stage && <div className={`toast ${toast?.error ? 'error' : ''} ${toast ? 'show' : ''}`} role="status">{toast?.msg}</div>}
      </div>

      {/* everything else — one panel, one part at a time */}
      {tabs.length > 0 && (
        <section className="panel workspace">
          <div className="tabs" role="tablist" aria-label="session">
            {tabs.map(t => (
              <button
                key={t.id} role="tab" aria-selected={tab === t.id} className={tab === t.id ? 'active' : ''}
                onClick={() => setPrefs(p => ({ ...p, ui: { ...p.ui, tab: t.id } }))}
              >
                {t.label}{t.count !== undefined && <span className="tab-count mono">{t.count}</span>}
              </button>
            ))}
          </div>

          <div className="tab-body" role="tabpanel">
            {tab === 'mix' && song && (
              <>
                <div className="section-head">
                  <span className="hint-inline">just for you — kept for every song</span>
                  <div className="spacer" />
                  <div className="segmented" role="radiogroup" aria-label="what you hear">
                    {([['full', 'everything'], ['mine', 'my part'], ['minus', 'without me'], ['click', 'click only']] as const).map(([m, l]) => (
                      <button
                        key={m} role="radio" aria-checked={prefs.monitor.mode === m}
                        className={prefs.monitor.mode === m ? 'active' : ''}
                        disabled={m !== 'full' && m !== 'click' && !prefs.part}
                        title={m !== 'full' && m !== 'click' && !prefs.part ? 'pick your instrument first' : undefined}
                        onClick={() => setPrefs(p => ({ ...p, monitor: { ...p.monitor, mode: m }, click: m === 'click' ? { ...p.click, on: true } : p.click }))}
                      >{l}</button>
                    ))}
                  </div>
                  <button className="btn sm ghost" onClick={() => { a.resetMix(); flash('mix reset'); }} title="every track back to 100 %, nothing muted or soloed">reset mix</button>
                </div>
                {/* you: your instrument (finds your tracks in every song), your guitar's tuning, focus */}
                <div className="section-head you-row">
                  <select
                    className="btn sm" aria-label="your instrument" value={prefs.part ?? ''}
                    onChange={e => setPrefs(p => ({ ...p, part: (e.target.value || null) as Prefs['part'] }))}
                  >
                    <option value="">my instrument…</option>
                    {PARTS.map(([v, l]) => <option key={v} value={v}>i play {l}</option>)}
                  </select>
                  {(prefs.part === 'guitar' || prefs.part === 'bass') && (
                    <select
                      className={`btn sm ${prefs.myTuning ? 'on-soft' : ''}`} aria-label="your tuning" title="your tracks are re-fretted to it in every song — same sound, frets for your instrument"
                      value={prefs.myTuning ? JSON.stringify(prefs.myTuning) : ''}
                      onChange={e => setPrefs(p => ({ ...p, myTuning: e.target.value ? JSON.parse(e.target.value) : null }))}
                    >
                      <option value="">tuned as written</option>
                      {(prefs.part === 'guitar' ? [6, 7] : [4, 5]).map(n => (
                        <optgroup key={n} label={`${n} strings`}>
                          {TUNINGS[n].map(t => <option key={t.id} value={JSON.stringify(t.tunings)}>my {prefs.part} in {t.name}</option>)}
                        </optgroup>
                      ))}
                      {prefs.myTuning && !findPreset(prefs.myTuning) && <option value={JSON.stringify(prefs.myTuning)}>{describeTuning(prefs.myTuning)}</option>}
                    </select>
                  )}
                  {prefs.part && (
                    <button
                      className={`btn sm ${prefs.monitor.focus ? 'on' : ''}`} aria-pressed={prefs.monitor.focus}
                      onClick={() => setPrefs(p => ({ ...p, monitor: { ...p.monitor, focus: !p.monitor.focus } }))}
                      title="the notation shows only your tracks, in every song"
                    >only my tracks</button>
                  )}
                  {prefs.part && s.mine.length === 0 && <span className="hint-inline">no {prefs.part} track in this song</span>}
                </div>
                <TrackMixer tracks={song.tracks} mix={s.mix} audible={s.audible} mine={s.mine} onChange={a.setTrack} onShowOnly={a.showOnly} onTuning={a.setTrackTuning}>
                  {(host || s.groove?.on) && (
                    <GrooveStrip
                      groove={s.groove} host={host} level={prefs.groove}
                      onLevel={groove => setPrefs(p => ({ ...p, groove }))}
                      onGroove={g => { a.setGroove(g); if (g) flash(`groove: ${g.name}`); }}
                      onError={msg => flash(msg, true)}
                    />
                  )}
                </TrackMixer>
              </>
            )}

            {tab === 'setlist' && host && server && (server.library || server.auth) && (
              <div className="row session-tools">
                {server.library && (
                  <button
                    className="btn sm" disabled={!s.setlist.songs.length && !song}
                    onClick={() => {
                      const name = window.prompt('name of the show', song?.title ? `set with ${song.title}` : 'new show');
                      if (name) api(`/rooms/${roomId}/save-set`, { name }).then(() => flash(`saved as show “${name}” in your library`)).catch(e => flash((e as Error).message, true));
                    }}
                    title="keep this setlist with all its song settings as a show in your library"
                  >save as show</button>
                )}
                <button
                  className={`btn sm ${server.control.live === roomId ? 'on' : ''}`}
                  onClick={() => api(`/rooms/${roomId}/live`, {}).then(() => { setServer(c => (c ? { ...c, control: { ...c.control, live: roomId } } : c)); flash('this session is now the live one — mo-tion time and the control api drive it'); }).catch(e => flash((e as Error).message, true))}
                  title="the session that mo-tion time cues and the control api act on"
                >{server.control.live === roomId ? 'live for control' : 'make live'}</button>
                {server.library && <a className="btn sm ghost" href={at('/library')} target="_blank" rel="noreferrer">library ↗</a>}
              </div>
            )}
            {tab === 'setlist' && (
              <Setlist
                setlist={s.setlist} host={host} uploading={s.busy.uploading}
                onGoto={a.gotoSong}
                onRemove={a.removeSong} onMove={a.moveSong} onUpdate={a.updateSong} myPart={prefs.part}
                onAdd={files => a.addToSet(files).then(() => flash(`${files.length} song${files.length === 1 ? '' : 's'} added`)).catch(() => {})}
              />
            )}

            {tab === 'groove' && host && (
              <GroovePanel
                groove={s.groove} songBpm={song ? Math.round(song.tempo * shared.speed) : null} beatsUrl={server?.beatsUrl ?? null}
                onGroove={g => a.setGroove(g)} onError={msg => flash(msg, true)}
              />
            )}

            {tab === 'live' && (
              <LivePanel
                showStart={s.showStart} countIn={shared.countIn} ready={s.ready} playing={s.playing || !!s.counting}
                onCue={(text, sec) => a.sendCue(text, sec)} onShow={a.showClock}
                onGo={sec => a.startWithCountdown(sec)}
              />
            )}

            {tab === 'band' && <Members members={s.members} me={s.memberId} />}
          </div>
        </section>
      )}

      <footer className="footer">
        {host && <>
          <span><kbd>space</kbd> play/pause</span>
          <span><kbd>←</kbd><kbd>→</kbd> bar</span>
          <span><kbd>pg↑</kbd><kbd>pg↓</kbd> song</span>
        </>}
        <span><kbd>f</kbd> fullscreen</span>
        <span><kbd>n</kbd> notes</span>
        <span><kbd>a</kbd> auto-scroll</span>
        <span><kbd>m</kbd> click</span>
        <span className="footer-credit">notation & synth by alphaTab · <a href="https://mo-tion.at" target="_blank" rel="noreferrer">mo-tion.at</a> · <a href="https://github.com/moon-int/tabs" target="_blank" rel="noreferrer">open source on github</a></span>
      </footer>

      <SettingsDrawer
        open={drawer.open} tab={drawer.tab} onTab={tab => setDrawer(d => ({ ...d, tab }))} onClose={() => setDrawer(d => ({ ...d, open: false }))}
        prefs={prefs} setPrefs={setPrefs} midi={midi}
        onPreviewClick={a.previewClick} onToast={flash}
        soundfonts={server?.soundfonts ?? []} onSoundBankFile={a.reloadSoundBank}
      />

      {!started && (
        <div className="overlay">
          <form className="panel overlay-card" onSubmit={e => { e.preventDefault(); setStarted(true); }}>
            {local ? <h2>solo session</h2> : <h2>{isHostHere ? 'your session' : 'join the session'} <span className="mono" style={{ color: 'var(--mint)' }}>{roomId}</span></h2>}
            <p>
              {local
                ? 'everything runs in your browser — nobody else can join. for a band session in sync, run tabs yourself.'
                : isHostHere
                ? 'you are the host: load songs and run the transport — everyone follows along.'
                : 'the music plays in sync with the host. your browser needs one click before it may play sound.'}
            </p>
            <div className="join-fields">
              <input className="input" value={prefs.name} onChange={e => setPrefs(p => ({ ...p, name: e.target.value.slice(0, 40) }))} placeholder="your name (optional)" aria-label="your name" />
              <select className="btn" value={prefs.part ?? ''} onChange={e => setPrefs(p => ({ ...p, part: (e.target.value || null) as Prefs['part'] }))} aria-label="your part">
                <option value="">your part…</option>
                {PARTS.map(([v, l]) => <option key={v} value={v}>{l}</option>)}
              </select>
            </div>
            <button className="btn primary" type="submit" disabled={exists === null} autoFocus>
              {exists === null ? 'checking…' : isHostHere ? 'open session' : 'join with sound'}
            </button>
            {/* came with the code on another device? sign in first — an admin then joins as host */}
            {server?.auth && !server.user && !isHostHere && (
              <p className="overlay-signin">in the band? <a href={signInUrl(`/room/${roomId}`)}>sign in with havoc</a> first — admins host every session.</p>
            )}
            {server?.auth && server.user && !isHostHere && (
              <p className="overlay-signin">signed in as {server.user.name} — you join like everyone else{server.user.admin ? '' : ' (hosting needs the session’s owner or an admin)'}.</p>
            )}
          </form>
        </div>
      )}

      {invite && <Invite roomId={roomId} onClose={() => setInvite(false)} onCopied={msg => flash(msg)} />}

      {!stage && <div className={`toast ${toast?.error ? 'error' : ''} ${toast ? 'show' : ''}`} role="status">{toast?.msg}</div>}
    </div>
  );
}
