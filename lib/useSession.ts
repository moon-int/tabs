"use client";
import { useCallback, useEffect, useMemo, useRef, useState, type RefObject } from 'react';
import { loadAlphaTab, type AlphaTab } from './alphatab';
import { TabPlayer, type CountInPlan, type Position, type Range, type SongInfo, type TrackMix } from './player';
import { ClickEngine, GrooveEngine, type Beat } from './click';
import type { Groove } from './groove';
import { detectPart } from './parts';
import {
  SyncClient, base64ToBytes, hostCall, readHostToken, readTabFile,
  type Conn, type Member, type Playback, type RemoteCommand, type Role, type RoomFile, type ServerMsg, type Setlist, type SongMeta,
} from './sync';
import { LOCAL_ROOM, LOCAL_TOKEN, LocalSync, localCall } from './local';
import type { Prefs } from './prefs';
import { loadBank } from './soundbank';
import type { NotationColors } from './themes';

const TICKS_PER_QUARTER = 960;
const MAX_DRIFT_MS = 120; // listeners re-seek when they stay further than this from the host
const BIG_DRIFT_MS = 400; // … or at once when they are this far off
const SEEK_SETTLE_MS = 1500; // after a correction, give the player time to settle before judging again
const POSITION_EVERY_MS = 90; // the page redraws the transport ~11× a second, not at every audio block
const HEARTBEAT_MS = 1000;
const STATUS_MS = 2000;
export const SPEED_MIN = 0.25;
export const SPEED_MAX = 2.5;

const freshPlayback = (): Playback => ({ playing: false, tick: 0, speed: 1, loop: false, range: null, countIn: false, transpose: 0 });
const EMPTY_POS: Position = { tick: 0, endTick: 0, time: 0, endTime: 0, bpm: 0, bar: 0 };

export type Busy = { soundfont: number | null; rendering: boolean; uploading: boolean };
export type CueState = { text: string; seconds: number; since: number } | null; // since = local epoch ms
export type Countdown = { endsAt: number; seconds: number; label: string | null } | null; // endsAt = local epoch ms
export type Counting = { beat: number; beats: number } | null; // the count-in bar, beat -1 until the first click

/**
 * Wires one alphaTab player to one room. The host's player is the source of
 * truth: its state changes are sent to the server and fanned out. Listeners
 * keep a "desired" copy of the shared playback and reconcile their own
 * player against it, re-seeking only when they drift audibly.
 *
 * Everything personal — click, monitor mix, view, theme — is applied here
 * from the local prefs and never leaves the browser, except name, part and
 * sync health, which every member reports so the host can check the band.
 */
export function useSession(
  roomId: string,
  started: boolean,
  els: { score: RefObject<HTMLDivElement | null>; scroll: RefObject<HTMLDivElement | null> },
  prefs: Prefs,
  notation: NotationColors,
) {
  const [conn, setConn] = useState<Conn>('connecting');
  const [role, setRole] = useState<Role | null>(null);
  const [memberId, setMemberId] = useState<number | null>(null);
  const [peers, setPeers] = useState({ hostConnected: false, listeners: 0 });
  const [members, setMembers] = useState<Member[]>([]);
  const [setlist, setSetlist] = useState<Setlist>({ songs: [], index: -1 });
  const [fileName, setFileName] = useState<string | null>(null);
  const [song, setSong] = useState<SongInfo | null>(null);
  const [position, setPosition] = useState<Position>(EMPTY_POS);
  const [playing, setPlaying] = useState(false);
  const [ready, setReady] = useState(false);
  const [shared, setShared] = useState<Playback>(freshPlayback);
  const [mix, setMix] = useState<TrackMix[]>([]);
  const [audible, setAudible] = useState<boolean[]>([]);
  const [sectionTicks, setSectionTicks] = useState<number[]>([]);
  const [busy, setBusy] = useState<Busy>({ soundfont: null, rendering: false, uploading: false });
  const [error, setError] = useState<string | null>(null);
  const [beat, setBeat] = useState<Beat | null>(null);
  const [cue, setCue] = useState<CueState>(null);
  const [countdown, setCountdown] = useState<Countdown>(null);
  const [showStart, setShowStart] = useState<number | null>(null);
  const [groove, setGrooveState] = useState<Groove | null>(null);
  const [counting, setCounting] = useState<Counting>(null);

  const playerRef = useRef<TabPlayer | null>(null);
  const clickRef = useRef<ClickEngine | null>(null);
  const grooveRef = useRef<GrooveEngine | null>(null);
  const syncRef = useRef<SyncClient | LocalSync | null>(null);
  const roleRef = useRef<Role | null>(null);
  const tokenRef = useRef<string | null>(null);
  const fileRef = useRef<RoomFile | null>(null);
  const setlistRef = useRef(setlist);
  setlistRef.current = setlist;
  const loadedVersion = useRef(-1);
  const desired = useRef<Playback & { at: number }>({ ...freshPlayback(), at: 0 });
  const driftRef = useRef<number | null>(null);
  const autoStartRef = useRef<number | null>(null); // countdown seconds after an auto-advance
  const countdownTimer = useRef<number | undefined>(undefined);
  const hostCountdownRef = useRef<((seconds: number, label: string | null) => void) | null>(null);
  const countRef = useRef<{ timers: number[] } | null>(null); // a count-in bar is running
  const startRef = useRef<(() => void) | null>(null); // host: start playback (with count-in if it's on)
  const cancelCountInRef = useRef<(() => boolean) | null>(null); // host: abort a running count-in
  const remoteRef = useRef<((cmd: RemoteCommand) => void) | null>(null); // host: a command from the host api
  const bankRef = useRef(''); // the sound bank the player has loaded
  const prefsRef = useRef(prefs);
  prefsRef.current = prefs;
  const notationRef = useRef(notation);
  notationRef.current = notation;

  // ---- local prefs → player & click ---------------------------------------------

  const clickOn = prefs.click.on;
  const clickLevel = prefs.click.level;
  const clickSound = prefs.click.sound;

  useEffect(() => {
    const p = playerRef.current;
    if (!p) return;
    p.masterVolume = prefs.music;
    // the soundfont click is alphaTab's own sample-accurate metronome
    p.metronomeVolume = clickOn && clickSound === 'synth' ? clickLevel : 0;
  }, [prefs.music, clickOn, clickLevel, clickSound, ready]);

  useEffect(() => { clickRef.current?.configure(prefs.click); }, [prefs.click]);

  // another sound bank for the music, picked in the settings
  const soundBank = prefs.soundBank;
  useEffect(() => {
    const p = playerRef.current;
    if (!p || bankRef.current === soundBank) return;
    bankRef.current = soundBank;
    if (soundBank === 'file') loadBank().then(b => { if (b) p.setSoundFont(b.bytes); else p.setSoundFont(null); });
    else p.setSoundFont(soundBank || null);
  }, [soundBank, ready]);

  // the groove plays with the music: same output device, own level
  useEffect(() => { grooveRef.current?.setLevel(prefs.groove); }, [prefs.groove]);
  useEffect(() => { grooveRef.current?.setSink(prefs.musicDevice); }, [prefs.musicDevice]);
  useEffect(() => { grooveRef.current?.setGroove(groove); }, [groove]);

  // between songs a "free" groove keeps the band going at its own tempo; as soon as a song plays
  // (or counts in) the groove locks to the song again
  const freeBpm = groove?.on && groove.free ? groove.bpm ?? 120 : null;
  useEffect(() => {
    const g = grooveRef.current;
    if (!g) return;
    if (freeBpm && !playing && !counting) g.runFree(freeBpm, (syncRef.current?.latency ?? 0) / 1000);
    else g.stopFree();
  }, [freeBpm, playing, counting]);

  // layout/staves/zoom need a re-render; following the cursor does not
  const { layout, stave, zoom, follow } = prefs.view;
  const view = useMemo(() => ({ layout, stave, zoom, follow }), [layout, stave, zoom]); // eslint-disable-line react-hooks/exhaustive-deps
  const firstView = useRef(true);
  useEffect(() => {
    if (firstView.current) { firstView.current = false; return; }
    playerRef.current?.setView(view);
  }, [view]);

  useEffect(() => { playerRef.current?.setFollow(follow); }, [follow, ready]);

  const firstNotation = useRef(true);
  useEffect(() => {
    if (firstNotation.current) { firstNotation.current = false; return; }
    playerRef.current?.setNotation(notation);
  }, [notation]);

  useEffect(() => {
    if (ready) playerRef.current?.setOutputDevice(prefs.musicDevice).then(ok => { if (!ok && prefs.musicDevice) setError('could not switch the music output'); });
  }, [prefs.musicDevice, ready]);

  // my part in this song, by instrument family
  const mine = useMemo(
    () => (song && prefs.part ? song.tracks.filter(t => t.part === prefs.part).map(t => t.index) : []),
    [song, prefs.part],
  );

  useEffect(() => {
    const p = playerRef.current;
    if (!p || !song) return;
    p.setMonitor(prefs.monitor.mode, mine);
    setAudible(p.audible());
  }, [prefs.monitor.mode, mine, song, ready]);

  // your instrument's tuning, applied to your part in every song unless you picked one by hand
  const manualTuning = useRef(new Set<number>());
  const myTuning = prefs.myTuning;
  useEffect(() => {
    const p = playerRef.current;
    if (!p || !song || !ready) return;
    let unplayable = 0;
    for (const t of song.tracks) {
      if (manualTuning.current.has(t.index) || !t.tuning.length) continue;
      const want = myTuning && mine.includes(t.index) && myTuning.length === t.tuning.length ? myTuning : null;
      const cur = p.tracks[t.index]?.tuning ?? null;
      if (JSON.stringify(want) === JSON.stringify(cur)) continue;
      unplayable += p.setTrackTuning(t.index, want);
    }
    setMix(p.tracks.slice());
    if (unplayable) setError(`${unplayable} note${unplayable === 1 ? '' : 's'} sit below your lowest string`);
  }, [myTuning, mine, song, ready]);

  useEffect(() => {
    const p = playerRef.current;
    if (!p || !song || !prefs.monitor.focus || !mine.length) return;
    p.showTracks(mine);
    setMix(p.tracks.slice());
  }, [prefs.monitor.focus, mine, song]);

  // ---- session lifecycle ----------------------------------------------------------

  useEffect(() => {
    if (!started) return;
    let cancelled = false;
    let at: AlphaTab | null = null;
    let heartbeat: number | undefined;
    // a solo session runs the room right here in the page — same messages, no server
    const local = roomId === LOCAL_ROOM;
    const token = local ? LOCAL_TOKEN : readHostToken(roomId);
    tokenRef.current = token;
    const sync = local ? new LocalSync() : new SyncClient(roomId, token);
    syncRef.current = sync;

    const click = new ClickEngine(prefsRef.current.click);
    clickRef.current = click;
    click.unlock();
    click.getBars = () => playerRef.current?.beatGrid() ?? [];
    click.getRangeEnd = () => desired.current.range?.endTick ?? null;
    click.onBeat = b => setBeat(b);

    const grooveLane = new GrooveEngine();
    grooveRef.current = grooveLane;
    grooveLane.unlock();
    grooveLane.getBars = click.getBars;
    grooveLane.getRangeEnd = click.getRangeEnd;
    grooveLane.setLevel(prefsRef.current.groove);
    if (prefsRef.current.musicDevice) grooveLane.setSink(prefsRef.current.musicDevice);
    // a later gesture also counts, in case the context started suspended
    const unlock = () => { click.unlock(); grooveLane.unlock(); };
    window.addEventListener('pointerdown', unlock);

    const isHost = () => roleRef.current === 'host';
    const publishShared = () => { const { at: _a, ...pb } = desired.current; setShared(pb); };

    const startHeartbeat = () => {
      window.clearInterval(heartbeat);
      heartbeat = window.setInterval(() => {
        const p = playerRef.current;
        if (p?.isPlaying) sync.send({ type: 'position', tick: Math.round(p.liveTick) });
      }, HEARTBEAT_MS);
    };
    const stopHeartbeat = () => window.clearInterval(heartbeat);

    let songInfo: SongInfo | null = null;
    let shownPos: Position = EMPTY_POS;
    let shownAt = 0;
    let trailing: number | undefined;
    const reportUnplayable = (n: number) => { if (n) setError(`${n} note${n === 1 ? '' : 's'} sit below the lowest string after transposing`); };

    let lastCorrection = 0;
    let driftedBefore = false;

    /** listener: bring the local player in line with the host */
    const reconcile = (force: boolean) => {
      const p = playerRef.current;
      if (!p || !p.isReady || isHost()) return;
      const d = desired.current;
      if (p.speed !== d.speed) p.speed = d.speed;
      if (p.loop !== d.loop) p.loop = d.loop;
      p.range = d.range;
      if (p.transpose !== d.transpose) reportUnplayable(p.setTranspose(d.transpose));

      // counting in: the player waits at the start tick on purpose, it starts by itself at the end of the bar
      if (countRef.current) { driftRef.current = 0; return; }

      const bpm = p.position.bpm || (songInfo?.tempo ?? 120) * d.speed;
      const ticksPerMs = (bpm * TICKS_PER_QUARTER) / 60000;
      const now = performance.now();
      const target = d.playing ? Math.max(0, d.tick + (now - d.at) * ticksPerMs) : d.tick;
      // compare where we are *now*, not the last (bursty) report — otherwise the drift jitters by a
      // whole audio block and every jitter above the limit became an audible jump
      const driftMs = ((d.playing ? p.liveTick : p.tick) - target) / (ticksPerMs || 1);
      driftRef.current = d.playing ? Math.round(driftMs) : 0;
      // the host's last heartbeat can arrive after we already reached the end — don't restart the song
      const atEnd = !d.loop && p.position.endTick > 0 && target >= p.position.endTick - ticksPerMs * 250;
      // a jump is audible: only for a drift that's big, or that stays (two checks in a row), and not
      // while the player is still settling from the last one
      const off = Math.abs(driftMs) > MAX_DRIFT_MS;
      const settling = now - lastCorrection < SEEK_SETTLE_MS;
      const correct = force || (!settling && (Math.abs(driftMs) > BIG_DRIFT_MS || (off && driftedBefore)));
      driftedBefore = off && !correct;
      if (correct) {
        lastCorrection = now;
        p.seek(Math.min(target, p.position.endTick || target));
      }

      // look at what was requested, not alphaTab's state: a play() takes a moment to show up there
      if (d.playing && !p.wantsPlay && !atEnd) p.play();
      else if (!d.playing && (p.wantsPlay || p.isPlaying)) p.pause();
    };

    /** host: after (re)connecting, the server learns the truth from us */
    const pushHostState = () => {
      const p = playerRef.current;
      if (!p || !p.isReady) return;
      sync.send({ type: 'speed', speed: p.speed });
      sync.send({ type: 'loop', loop: p.loop });
      sync.send({ type: 'range', range: p.range });
      sync.send({ type: 'countIn', countIn: desired.current.countIn });
      sync.send({ type: 'transpose', transpose: p.transpose });
      sync.send({ type: p.isPlaying ? 'play' : 'pause', tick: p.tick });
    };

    const reportStatus = () => {
      const p = playerRef.current;
      const pr = prefsRef.current;
      sync.send({
        type: 'status',
        name: pr.name || null,
        part: pr.part,
        ready: !!p?.isReady,
        playing: !!p?.isPlaying,
        drift: isHost() ? 0 : driftRef.current,
        latency: Math.round(sync.latency),
      });
    };
    const statusTimer = window.setInterval(reportStatus, STATUS_MS);

    const runCountdown = (seconds: number, label: string | null, then?: () => void) => {
      window.clearTimeout(countdownTimer.current);
      if (seconds <= 0) { setCountdown(null); return; }
      setCountdown({ endsAt: Date.now() + seconds * 1000, seconds, label });
      countdownTimer.current = window.setTimeout(() => { setCountdown(null); then?.(); }, seconds * 1000);
    };
    hostCountdownRef.current = (seconds, label) => {
      sync.send({ type: 'countdown', seconds, label });
      runCountdown(seconds, label, seconds > 0 ? () => startRef.current?.() : undefined);
    };

    // ---- count-in: one bar of clicks on every screen, then everyone starts together -------------

    const stopCountIn = () => {
      const c = countRef.current;
      if (!c) return false;
      c.timers.forEach(id => window.clearTimeout(id));
      countRef.current = null;
      click.cancelCountIn();
      setCounting(null);
      setBeat(null);
      return true;
    };

    /**
     * Counts `plan` in and starts the player as the bar ends. The host runs it on its own; a listener
     * runs the very same plan `late` ms after the host did (the message's way here), so both start
     * together instead of the listener waiting for the host's "play" to arrive.
     */
    const runCountIn = (plan: CountInPlan, late: number) => {
      stopCountIn();
      const p = playerRef.current;
      if (!p?.isReady) return false;
      if (p.wantsPlay || p.isPlaying) p.pause();
      if (Math.abs(p.tick - plan.tick) > 1) p.seek(plan.tick);
      const { beats } = plan;
      setCounting({ beat: -1, beats });
      const endIn = click.countIn(beats, plan.beatMs / 1000, late / 1000, i => {
        setCounting({ beat: i, beats });
        setBeat({ beat: i, beats, bar: -1 });
      });
      // ask for playback a little early: the player needs a moment before its first note sounds
      const lead = click.startLatency;
      const timers = [
        window.setTimeout(() => {
          const pl = playerRef.current;
          if (!pl?.isReady || pl.wantsPlay) return;
          if (!isHost()) desired.current = { ...desired.current, playing: true, tick: plan.tick, at: performance.now() + lead * 1000 };
          click.markStart(plan.tick);
          pl.play();
        }, Math.max(0, (endIn - lead) * 1000)),
        window.setTimeout(() => { countRef.current = null; setCounting(null); }, Math.max(0, endIn * 1000)),
      ];
      countRef.current = { timers };
      return true;
    };

    /** host: play — after a count-in bar if it's switched on */
    startRef.current = () => {
      const p = playerRef.current;
      if (!isHost() || !p?.isReady || p.isPlaying || p.wantsPlay || countRef.current) return;
      const plan = desired.current.countIn ? p.countInPlan() : null;
      if (!plan) { p.play(); return; }
      sync.send({ type: 'countoff', ...plan });
      desired.current = { ...desired.current, playing: false, tick: plan.tick, at: performance.now() };
      runCountIn(plan, 0);
    };

    /** host: abort a running count-in (pause, stop, seek, another song) — false if none was running */
    cancelCountInRef.current = () => {
      if (!stopCountIn()) return false;
      const p = playerRef.current;
      if (p) {
        p.pause();
        sync.send({ type: 'pause', tick: p.tick });
        desired.current = { ...desired.current, playing: false, tick: p.tick, at: performance.now() };
      }
      return true;
    };

    const ensurePlayer = () => {
      if (playerRef.current || !at || cancelled || !roleRef.current) return playerRef.current;
      const scoreEl = els.score.current, scrollEl = els.scroll.current;
      if (!scoreEl || !scrollEl) return null;
      // a bank on the server loads right away; one from this computer comes in after (IndexedDB is async)
      const bank = prefsRef.current.soundBank;
      const p = new TabPlayer(at, scoreEl, scrollEl, {
        interactive: isHost(), view: prefsRef.current.view, notation: notationRef.current,
        soundFont: bank && bank !== 'file' ? bank : undefined,
      });
      bankRef.current = bank && bank !== 'file' ? bank : '';
      if (bank === 'file') loadBank().then(b => { if (b && playerRef.current === p) { bankRef.current = 'file'; p.setSoundFont(b.bytes); } });
      playerRef.current = p;
      const pr = prefsRef.current;
      p.masterVolume = pr.music;
      p.metronomeVolume = pr.click.on && pr.click.sound === 'synth' ? pr.click.level : 0;
      // a new song opens on your part (all of it with "focus my part"), not on whatever track 1 is
      p.pickTracks = heads => {
        const { part, monitor } = prefsRef.current;
        if (!part) return [0];
        const mine = heads.filter(h => detectPart(h.name || `track ${h.index + 1}`, h.program, h.percussion) === part).map(h => h.index);
        if (!mine.length) return [0];
        return monitor.focus ? mine : [mine[0]];
      };

      p.onSong = s => {
        songInfo = s;
        manualTuning.current = new Set();
        setSong(s);
        setMix(p.tracks.slice());
        setSectionTicks([]);
        setReady(false);
      };
      p.onBusy = b => setBusy(prev => ({ ...prev, ...b }));
      p.onError = msg => setError(msg);
      p.onReady = () => {
        setReady(true);
        // your own mix of this song, as you left it last time
        const saved = songInfo ? loadMix(songInfo) : null;
        if (saved && saved.length === p.tracks.length) {
          saved.forEach((m, i) => p.setTrack(i, { mute: m.mute, solo: m.solo, volume: m.volume }));
          setAudible(p.audible());
        }
        setMix(p.tracks.slice());
        setSectionTicks((songInfo?.sections ?? []).map(sec => p.barStart(sec.bar) ?? 0));
        const d = desired.current;
        if (isHost()) {
          // a fresh song (or a reloaded host page) starts from the room's state
          p.speed = d.speed;
          p.loop = d.loop;
          p.range = d.range;
          reportUnplayable(p.setTranspose(d.transpose));
          if (d.tick) p.seek(d.tick);
          publishShared();
          const gap = autoStartRef.current;
          autoStartRef.current = null;
          if (gap !== null) hostCountdownRef.current?.(gap, songInfo?.title || null);
        } else {
          reconcile(true);
        }
      };
      p.onPlaying = isPlaying => {
        setPlaying(isPlaying);
        click.setPlaying(isPlaying);
        grooveLane.setPlaying(isPlaying);
        if (!isPlaying && !countRef.current) setBeat(null);
        // (a start that raced a pause is paused again by the player itself)
        if (!isHost()) return;
        sync.send({ type: isPlaying ? 'play' : 'pause', tick: p.tick });
        desired.current = { ...desired.current, playing: isPlaying, tick: p.tick, at: performance.now() };
        if (isPlaying) startHeartbeat(); else stopHeartbeat();
      };
      p.onPosition = (pos, isSeek) => {
        // the transport doesn't need every audio block: redraw at most ~11× a second (always on a
        // jump or a new bar) — a full page render per report made phones and http pages stutter
        const nowMs = performance.now();
        if (isSeek || pos.bar !== shownPos.bar || nowMs - shownAt >= POSITION_EVERY_MS || !p.isPlaying) {
          window.clearTimeout(trailing);
          shownPos = pos;
          shownAt = nowMs;
          setPosition(pos);
        } else {
          window.clearTimeout(trailing);
          trailing = window.setTimeout(() => { shownPos = pos; shownAt = performance.now(); setPosition(pos); }, POSITION_EVERY_MS);
        }
        click.position(pos.tick, pos.bpm, isSeek);
        grooveLane.position(pos.tick, pos.bpm, isSeek);
        // clicks into the notation, the progress bar, section jumps — all arrive here
        if (isSeek && isHost() && p.isReady) sync.send({ type: 'seek', tick: pos.tick });
      };
      p.onRange = range => {
        if (!isHost()) return;
        desired.current = { ...desired.current, range };
        sync.send({ type: 'range', range });
        publishShared();
      };
      p.onFinished = () => {
        if (!isHost()) return;
        // live sets: roll into the next song if this one asks for it
        const sl = setlistRef.current;
        const cur = sl.songs[sl.index];
        const next = sl.songs[sl.index + 1];
        if (sl.index < 0 || !cur?.autoNext || !next) return;
        autoStartRef.current = next.autoStart ? next.gap : null;
        const t = tokenRef.current;
        if (t) callHost(roomId, t, '/setlist/next').catch(e => setError((e as Error).message));
      };
      return p;
    };

    /** load the room's current file if we haven't yet */
    const settle = (force: boolean) => {
      const p = ensurePlayer();
      if (!p) return;
      const f = fileRef.current;
      if (f && f.version !== loadedVersion.current) {
        loadedVersion.current = f.version;
        setFileName(f.name);
        setError(null);
        setPosition(EMPTY_POS);
        p.load(base64ToBytes(f.data)); // onReady takes it from here
        return;
      }
      reconcile(force);
    };

    const setDesired = (patch: Partial<Playback>) => {
      desired.current = { ...desired.current, ...patch, at: performance.now() - sync.latency };
      publishShared();
    };

    sync.onConn = c => { if (!cancelled) setConn(c); };
    sync.onMessage = (msg: ServerMsg) => {
      if (cancelled) return;
      switch (msg.type) {
        case 'init': {
          roleRef.current = msg.role;
          setRole(msg.role);
          setMemberId(msg.memberId);
          setPeers({ hostConnected: msg.hostConnected, listeners: msg.listeners });
          setSetlist(msg.setlist);
          setMembers(msg.members);
          setCue(msg.cue ? { text: msg.cue.text, seconds: msg.cue.seconds, since: Date.now() - msg.cue.elapsed } : null);
          setShowStart(msg.show === null ? null : Date.now() - msg.show);
          setGrooveState(msg.groove ?? null);
          reportStatus();
          const sameFile = !!msg.file && msg.file.version === loadedVersion.current && fileRef.current?.data === msg.file.data;
          fileRef.current = msg.file;
          if (msg.role === 'host' && sameFile) { if (!countRef.current) pushHostState(); return; }
          stopCountIn();
          setDesired(msg.playback);
          settle(true);
          return;
        }
        case 'file':
          stopCountIn();
          fileRef.current = msg.file;
          setDesired(msg.playback);
          settle(true);
          return;
        case 'remote': if (isHost()) remoteRef.current?.(msg); return;
        case 'setlist': setSetlist(msg.setlist); return;
        case 'peers': setPeers({ hostConnected: msg.hostConnected, listeners: msg.listeners }); return;
        case 'members': setMembers(msg.members); return;
        case 'cue': setCue(msg.cue ? { text: msg.cue.text, seconds: msg.cue.seconds, since: Date.now() - msg.cue.elapsed } : null); return;
        case 'show': setShowStart(msg.show === null ? null : Date.now() - msg.show); return;
        case 'groove': setGrooveState(msg.groove); return;
        case 'error': setError(msg.error.replace(/_/g, ' ')); return;
      }
      if (isHost()) return; // the host's own player already did all of this
      switch (msg.type) {
        case 'play':
          // already running (started by the count-in, or a repeat): only correct a real drift
          setDesired({ playing: true, tick: msg.tick });
          if (!playerRef.current?.wantsPlay) stopCountIn();
          reconcile(!playerRef.current?.wantsPlay);
          break;
        case 'pause': stopCountIn(); setDesired({ playing: false, tick: msg.tick }); reconcile(true); break;
        case 'stop':
          stopCountIn();
          setDesired({ playing: false, tick: desired.current.range?.startTick ?? 0 });
          playerRef.current?.stop();
          break;
        // while playing a seek is only followed when it's audible — a loop wrap the player already did
        // itself (or a tempo change) would otherwise cause a second, audible jump
        case 'seek': stopCountIn(); setDesired({ tick: msg.tick }); reconcile(!desired.current.playing); break;
        case 'countoff':
          setDesired({ playing: false, tick: msg.tick });
          runCountIn({ tick: msg.tick, beats: msg.beats, beatMs: msg.beatMs }, sync.latency);
          break;
        case 'position': setDesired({ tick: msg.tick }); reconcile(false); break;
        case 'speed': setDesired({ speed: msg.speed }); reconcile(false); break;
        case 'loop': setDesired({ loop: msg.loop }); reconcile(false); break;
        case 'range': setDesired({ range: msg.range }); reconcile(false); break;
        case 'countIn': setDesired({ countIn: msg.countIn }); break;
        case 'transpose': setDesired({ transpose: msg.transpose }); reconcile(false); break;
        case 'countdown': runCountdown(msg.seconds, msg.label); break;
      }
    };

    sync.connect();
    loadAlphaTab()
      .then(a => { if (cancelled) return; at = a; settle(true); })
      .catch(err => { console.error(err); if (!cancelled) setError((err as Error).message); });

    return () => {
      cancelled = true;
      window.clearTimeout(trailing);
      stopCountIn();
      startRef.current = null;
      cancelCountInRef.current = null;
      stopHeartbeat();
      window.clearInterval(statusTimer);
      window.clearTimeout(countdownTimer.current);
      window.removeEventListener('pointerdown', unlock);
      hostCountdownRef.current = null;
      sync.close();
      syncRef.current = null;
      click.dispose();
      clickRef.current = null;
      grooveLane.dispose();
      grooveRef.current = null;
      playerRef.current?.dispose();
      playerRef.current = null;
      loadedVersion.current = -1;
      roleRef.current = null;
    };
  }, [started, roomId, els.score, els.scroll]);

  // ---- actions -----------------------------------------------------------------

  const p = () => playerRef.current;
  const host = role === 'host';

  const cancelCountdown = useCallback(() => {
    if (countdownTimer.current === undefined) return;
    window.clearTimeout(countdownTimer.current);
    countdownTimer.current = undefined;
    setCountdown(c => {
      if (c) syncRef.current?.send({ type: 'countdown', seconds: 0 });
      return null;
    });
  }, []);

  /** host: play / pause — a press during the count-in calls it off */
  const playPause = useCallback(() => {
    if (!host) return;
    cancelCountdown();
    if (cancelCountInRef.current?.()) return;
    const pl = p();
    if (!pl?.isReady) return;
    // what was asked for, not alphaTab's state: right after play() it still says "paused" for a moment
    if (pl.isPlaying || pl.wantsPlay) pl.pause();
    else startRef.current?.();
  }, [host, cancelCountdown]);

  const stop = useCallback(() => {
    if (!host) return;
    cancelCountdown();
    cancelCountInRef.current?.();
    p()?.stop();
    syncRef.current?.send({ type: 'stop' });
  }, [host, cancelCountdown]);

  /** "band, get ready": big countdown on every screen, then play */
  const startWithCountdown = useCallback((seconds: number) => {
    const pl = p();
    if (!host || !pl?.isReady || pl.isPlaying || pl.wantsPlay || countRef.current) return;
    hostCountdownRef.current?.(seconds, song?.title || null);
  }, [host, song]);

  const seek = useCallback((tick: number) => {
    const pl = p();
    if (!host || !pl?.isReady) return;
    cancelCountInRef.current?.();
    pl.seek(tick);
    syncRef.current?.send({ type: 'seek', tick: pl.tick });
  }, [host]);

  const seekBy = useCallback((bars: number) => {
    const pl = p();
    if (!host || !pl?.isReady || !song) return;
    const bar = Math.min(song.bars - 1, Math.max(0, pl.position.bar + bars));
    const tick = pl.barStart(bar);
    if (tick !== null) seek(tick);
  }, [host, song, seek]);

  const jumpToBar = useCallback((bar: number) => {
    const tick = p()?.barStart(bar);
    if (tick !== null && tick !== undefined) seek(tick);
  }, [seek]);

  const setSpeed = useCallback((speed: number) => {
    const pl = p();
    if (!host || !pl) return;
    const s = Math.min(SPEED_MAX, Math.max(SPEED_MIN, Math.round(speed * 1000) / 1000));
    pl.speed = s;
    syncRef.current?.send({ type: 'speed', speed: s });
    desired.current = { ...desired.current, speed: s };
    setShared(sh => ({ ...sh, speed: s }));
  }, [host]);

  const setLoop = useCallback((loop: boolean) => {
    const pl = p();
    if (!host || !pl) return;
    pl.loop = loop;
    syncRef.current?.send({ type: 'loop', loop });
    desired.current = { ...desired.current, loop };
    setShared(sh => ({ ...sh, loop }));
  }, [host]);

  /** host: the whole song up/down in semitones for everyone — tabs keep their frets */
  const setTranspose = useCallback((transpose: number) => {
    const pl = p();
    if (!host || !pl) return;
    const t = Math.max(-12, Math.min(12, Math.round(transpose)));
    const unplayable = pl.setTranspose(t);
    if (unplayable) setError(`${unplayable} note${unplayable === 1 ? '' : 's'} sit below the lowest string after transposing`);
    syncRef.current?.send({ type: 'transpose', transpose: t });
    desired.current = { ...desired.current, transpose: t };
    setShared(sh => ({ ...sh, transpose: t }));
    setMix(pl.tracks.slice());
  }, [host]);

  const setCountIn = useCallback((countIn: boolean) => {
    if (!host) return;
    syncRef.current?.send({ type: 'countIn', countIn });
    desired.current = { ...desired.current, countIn };
    setShared(sh => ({ ...sh, countIn }));
  }, [host]);

  const setRange = useCallback((range: Range) => {
    const pl = p();
    if (!host || !pl) return;
    pl.range = range;
    syncRef.current?.send({ type: 'range', range });
    desired.current = { ...desired.current, range };
    setShared(sh => ({ ...sh, range }));
  }, [host]);

  const clearRange = useCallback(() => setRange(null), [setRange]);

  /** practice loop over bars [from, to) — e.g. one section */
  const loopBars = useCallback((from: number, to: number) => {
    const pl = p();
    if (!host || !pl?.isReady || !song) return;
    const startTick = pl.barStart(from);
    const endTick = to < song.bars ? pl.barStart(to) : pl.position.endTick;
    if (startTick === null || endTick === null || endTick <= startTick) return;
    setRange({ startTick, endTick });
    setLoop(true);
    seek(startTick);
  }, [host, song, setRange, setLoop, seek]);

  const sendCue = useCallback((text: string | null, seconds = 0) => {
    if (!host) return;
    syncRef.current?.send({ type: 'cue', text, seconds });
  }, [host]);

  /** host: the groove everyone hears (null = off) */
  const setGroove = useCallback((g: Groove | null) => {
    if (!host) return;
    syncRef.current?.send({ type: 'groove', groove: g });
  }, [host]);

  const showClock = useCallback((action: 'start' | 'reset') => {
    if (host) syncRef.current?.send({ type: 'show', action });
  }, [host]);

  // the host api (a script, a footswitch) drives the host's player exactly like its own buttons
  remoteRef.current = (cmd: RemoteCommand) => {
    const pl = p();
    switch (cmd.action) {
      case 'play':
        if (cmd.tick !== undefined && !pl?.wantsPlay) seek(cmd.tick);
        if (pl && !pl.isPlaying && !pl.wantsPlay) { cancelCountdown(); startRef.current?.(); }
        break;
      case 'pause':
        cancelCountdown();
        if (!cancelCountInRef.current?.() && pl && (pl.isPlaying || pl.wantsPlay)) pl.pause();
        if (cmd.tick !== undefined) seek(cmd.tick);
        break;
      case 'stop': stop(); break;
      case 'seek': seek(cmd.tick); break;
      case 'speed': setSpeed(cmd.speed); break;
      case 'loop': setLoop(cmd.loop); break;
      case 'range': setRange(cmd.range); break;
      case 'countIn': setCountIn(cmd.countIn); break;
      case 'transpose': setTranspose(cmd.transpose); break;
      case 'go':
        if (!pl?.isReady || pl.isPlaying || pl.wantsPlay || countRef.current) break;
        if (cmd.seconds > 0) hostCountdownRef.current?.(cmd.seconds, pl.info?.title || null);
        else startRef.current?.();
        break;
    }
  };

  const refreshAudible = () => { const pl = p(); if (pl) setAudible(pl.audible()); };

  const setTrack = useCallback((index: number, patch: Partial<TrackMix>) => {
    const pl = p();
    if (!pl) return;
    pl.setTrack(index, patch);
    setMix(pl.tracks.slice());
    refreshAudible();
    if ((patch.mute !== undefined || patch.solo !== undefined || patch.volume !== undefined) && pl.info) saveMix(pl.info, pl.tracks);
  }, []);

  /** every track back to full level, nothing muted or soloed — and forget this song's saved mix */
  const resetMix = useCallback(() => {
    const pl = p();
    if (!pl) return;
    pl.tracks.forEach((_, i) => pl.setTrack(i, { mute: false, solo: false, volume: 1 }));
    setMix(pl.tracks.slice());
    refreshAudible();
    if (pl.info) forgetMix(pl.info);
  }, []);

  const setTrackTuning = useCallback((index: number, tuning: number[] | null) => {
    const pl = p();
    if (!pl) return;
    manualTuning.current.add(index);
    const unplayable = pl.setTrackTuning(index, tuning);
    setMix(pl.tracks.slice());
    if (unplayable) setError(`${unplayable} note${unplayable === 1 ? '' : 's'} sit below the lowest string of that tuning`);
  }, []);

  const scrollToCursor = useCallback(() => p()?.scrollToCursor(), []);

  /** a sound bank file was just picked in the settings: load it (also when one was in use before) */
  const reloadSoundBank = useCallback(() => {
    const pl = p();
    if (!pl) return;
    bankRef.current = 'file';
    loadBank().then(b => { if (b && p() === pl) pl.setSoundFont(b.bytes); });
  }, []);

  /** saves the song as a .mid — at the session's tempo and transposition, one track per instrument */
  const downloadMidi = useCallback(() => {
    const pl = p();
    const bytes = pl?.midiFile(desired.current.speed || 1);
    if (!pl || !bytes) return false;
    const base = (pl.info?.title || fileName?.replace(/\.[^.]+$/, '') || 'song').replace(/[\\/:*?"<>|]+/g, ' ').trim();
    const speed = desired.current.speed;
    const extra = [pl.transpose ? `${pl.transpose > 0 ? '+' : ''}${pl.transpose} st` : '', speed !== 1 ? `${Math.round(speed * 100)}%` : ''].filter(Boolean).join(' ');
    const url = URL.createObjectURL(new Blob([bytes as BlobPart], { type: 'audio/midi' }));
    const link = document.createElement('a');
    link.href = url;
    link.download = `${base}${extra ? ` (${extra})` : ''}.mid`;
    document.body.appendChild(link);
    link.click();
    link.remove();
    window.setTimeout(() => URL.revokeObjectURL(url), 1000);
    return true;
  }, [fileName]);

  const showOnly = useCallback((index: number) => {
    const pl = p();
    if (!pl) return;
    pl.showOnly(index);
    setMix(pl.tracks.slice());
  }, []);

  const previewClick = useCallback(() => clickRef.current?.preview(), []);
  const setClickDevice = useCallback((id: string) => clickRef.current?.setSink(id) ?? Promise.resolve(false), []);

  // ---- host rest calls (uploads & setlist) ------------------------------------------

  const call = useCallback(async (path: string, body?: unknown, method?: string) => {
    const token = tokenRef.current;
    if (!token) throw new Error('only the host can do that');
    return callHost(roomId, token, path, body, method);
  }, [roomId]);

  const withUpload = useCallback(async (fn: () => Promise<unknown>) => {
    setBusy(b => ({ ...b, uploading: true }));
    try { await fn(); setError(null); }
    catch (err) { setError((err as Error).message); throw err; }
    finally { setBusy(b => ({ ...b, uploading: false })); }
  }, []);

  const openFile = useCallback((file: File) => withUpload(async () => {
    const { data, name } = await readTabFile(file);
    await call('/file', { data, name });
  }), [call, withUpload]);

  const addToSet = useCallback((files: File[]) => withUpload(async () => {
    for (const file of files) {
      const { data, name } = await readTabFile(file);
      await call('/setlist/songs', { data, name });
    }
  }), [call, withUpload]);

  const fail = (e: unknown) => setError((e as Error).message);
  const gotoSong = useCallback((index: number) => { cancelCountdown(); return call('/setlist/goto', { index }).catch(fail); }, [call, cancelCountdown]);
  const nextSong = useCallback(() => { cancelCountdown(); return call('/setlist/next').catch(() => {}); }, [call, cancelCountdown]);
  const prevSong = useCallback(() => { cancelCountdown(); return call('/setlist/prev').catch(() => {}); }, [call, cancelCountdown]);
  const removeSong = useCallback((index: number) => call(`/setlist/songs/${index}`, undefined, 'DELETE').catch(fail), [call]);
  const moveSong = useCallback((from: number, to: number) => call('/setlist/move', { from, to }).catch(fail), [call]);
  const updateSong = useCallback((index: number, patch: Partial<SongMeta> & { title?: string }) =>
    call(`/setlist/songs/${index}`, patch, 'PATCH').catch(fail), [call]);

  return {
    conn, role, memberId, peers, members, setlist, fileName, song, position, playing, ready, shared,
    mix, audible, mine, sectionTicks, busy, error, beat, cue, countdown, showStart, groove, counting,
    clearError: () => setError(null),
    actions: {
      playPause, stop, seek, seekBy, jumpToBar, setSpeed, setLoop, setCountIn, setTranspose, clearRange, setRange, loopBars,
      startWithCountdown, cancelCountdown, sendCue, showClock, setGroove,
      setTrack, resetMix, setTrackTuning, scrollToCursor, downloadMidi, reloadSoundBank, showOnly, previewClick, setClickDevice,
      openFile, addToSet, gotoSong, nextSong, prevSong, removeSong, moveSong, updateSong,
    },
  };
}

export type Session = ReturnType<typeof useSession>;

// ---- your mix per song, kept in this browser -----------------------------------------------

type SavedMix = { mute: boolean; solo: boolean; volume: number }[];
/** a song is recognised by its title and its tracks, so the same file in another session finds its mix */
const mixKey = (song: SongInfo) => `tabs.mix.${song.title}|${song.tracks.map(t => t.name).join('|')}`.slice(0, 400);

function loadMix(song: SongInfo): SavedMix | null {
  try {
    const raw = JSON.parse(localStorage.getItem(mixKey(song)) ?? 'null');
    if (!Array.isArray(raw)) return null;
    return raw.map(m => ({ mute: !!m?.mute, solo: !!m?.solo, volume: typeof m?.volume === 'number' ? Math.min(2, Math.max(0, m.volume)) : 1 }));
  } catch { return null; }
}

function saveMix(song: SongInfo, mix: TrackMix[]) {
  const plain = mix.every(m => !m.mute && !m.solo && m.volume === 1);
  try {
    if (plain) localStorage.removeItem(mixKey(song));
    else localStorage.setItem(mixKey(song), JSON.stringify(mix.map(m => ({ mute: m.mute, solo: m.solo, volume: Math.round(m.volume * 100) / 100 }))));
  } catch {}
}

function forgetMix(song: SongInfo) {
  try { localStorage.removeItem(mixKey(song)); } catch {}
}

/** the server's host api — or, in a solo session, the room in this page */
const callHost = (roomId: string, token: string, path: string, body?: unknown, method?: string) =>
  roomId === LOCAL_ROOM ? localCall(path, body, method) : hostCall(roomId, token, path, body, method);
