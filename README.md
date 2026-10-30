# tabs — mo-tion interactive

**live:** [tabs.mo-tion.at](https://tabs.mo-tion.at) · **source:** [github.com/moon-int/tabs](https://github.com/moon-int/tabs) · MIT licence

play guitar pro & musicxml tabs together, in sync. built with next.js 14, [alphaTab](https://github.com/CoderLine/alphaTab) and a tiny websocket server, styled in the mo-tion.at mint (`#00ffce`).

## features

- **one cursor for everyone** — the host runs play/pause/stop, seeking, tempo, loops and playback ranges; every listener's own alphaTab player mirrors it, latency-compensated and re-synced when anyone drifts more than ~120 ms
- **your own mix** — show/hide, mute, solo and level every instrument just for yourself, kept per song in your browser (the master strip resets it); click track (metronome), master volume, layout (page / one line), staves (auto, score + tab, tab, score) and zoom are local too and remembered in `localStorage`
- **midi download** — the song as a midi file, one track per instrument, at the session's tempo and transposition (*midi* in the notation bar)
- **tab only** — one switch (`n`) hides the standard notation above the tab
- **calm auto-scroll** — by default the view only turns the page when the cursor leaves the screen; one switch (`a`) turns it off. a nudge of the wheel or the screen never throws you off the cursor: following only pauses when you clearly scroll away to read ahead, and it picks the cursor up again by itself after a few quiet seconds (or tap *back to cursor*)
- **tunings** — every guitar and bass track has a tuning picker (standard, half/whole step down, drop d/c#/c/b, dadgad, open g/d/e/c, 7-string and 5-string bass tunings, or type your own like `d a d g b e`). the tab is re-fretted so you play the original pitches on your guitar; notes that fall below your lowest string are reported. pick *i play guitar* and *my guitar in …* once in the instruments tab and your part is re-fretted in every song
- **play a song in any tuning — tabs unchanged** — the host's *play in* picker moves the whole song up or down in semitones and names the tuning that takes (e.g. *−2 st · whole step down (d)*). every pitched track sounds that much lower/higher for everyone, drums stay; guitar & bass tabs keep every fret while the notation and string names show the real pitches — tune down, play the tab exactly as written. the shift carries over to the next song (a tuned-down band stays tuned down) and a setlist song can set its own. it combines with *tunings*: your own tuning then re-frets relative to the moved song. chord names written into the file are not transposed
- **fast start** — the landing page preloads alphaTab, its font and the (compressed `.sf3`) soundfont while you pick a file; the host lands in the session without an extra click; everything is served gzipped
- **formats** — guitar pro 3–8 (`.gp3`–`.gp5`, `.gpx`, `.gp`), musicxml (`.musicxml`, `.xml`, `.mxl`), capella (`.capx`) and alphatex
- **sections** — markers from the file become chips: jump to a part, or loop it for practice (`⟳`)
- **tempo** — starts at the song's own tempo, host can change it (25–250 %), with live bpm readout including tempo changes in the song
- **practice ranges** — the host drags across the notation to select a range, `loop` repeats it for everyone
- **setlist** — queue songs for a rehearsal or a gig, reorder/remove, step through with page up / page down (works with page-turner pedals)
- **late joiners & reconnects** — anyone who joins mid-song lands at the right spot; a host who reloads stays host and keeps the song; if the host drops out, playback pauses for everyone
- **host api** — drive any session from a script, a footswitch or a lighting desk (see below)
- **one tidy page** — on top the *deck*: song, setlist position, every role's setup, transport, position, sections and what comes next (with its changeover). then the notation. below it one panel with tabs — *instruments · setlist · live tools · band* — that remembers which one you had open
### made for the stage

- **stage view** (`f`) — fullscreen notation with a big readout: song, section, bar, beat lights, bpm, time left, show clock, next song and its notes; host controls fade out while playing. falls back to a full-window view where the browser has no fullscreen (iphone)
- **cues** — the host sends “2× chorus”, “watch me”, “outro” … or any text to every screen, timed or until cleared
- **go** (`g`) — a big synced countdown on every screen, then playback starts for everyone
- **count-in** (`c`) — one bar of clicks in the time signature and tempo playback starts in (compound meters in dotted quarters), on every screen at once: a big 1 2 3 4 over the notation, beat lights, the click on your click output (heard even with the click off). the song starts right on the next downbeat — tabs measures how long the player takes to start and asks for it that much earlier. a listener who joins mid-song is never counted in; space during the count calls it off
- **per-song settings in the setlist** — notes (“capo 2”), tempo, count-in, *load next song when this ends*, *start by itself after n s countdown* — a whole set can run hands-free
- **band monitor** — who's connected, their name and instrument, loaded or not, latency and live drift
- **show clock**, **screen wake lock**, **midi foot controllers** (learn any note / cc / program change per action) and bluetooth page-turner pedals

### click & monitoring

- **own click engine** locked to the playback, following every tempo and time-signature change (compound meters count in dotted quarters): sounds *studio* (a crisp daw click), *beep, clave, wood, rim, hat, cowbell* — boosted into a limiter so it cuts through a loud mix without clipping — accented one, subdivisions (8ths, triplets, 16ths), pan hard left/right for one-ear in-ear setups, and its **own output device** (chrome/edge) — or alphaTab's sample-exact soundfont metronome
- **beat lights** and an optional **screen flash on the one**
- **monitor mixes** per person: full mix · my part · minus me (play-along) · click only. your part (guitar, bass, drums, keys, vocals) is matched to the right tracks in every song automatically; **only my tracks** shows only those in the notation — all of it in the instruments tab, next to the mixer
- separate **music output device**
- **sound bank** (settings → sound) — the built-in soundfont is small so it loads fast; pick a bigger general midi soundfont (.sf2/.sf3, e.g. GeneralUser GS or FluidR3 GM) from your computer and the band sounds far more real. it stays in your browser. on the tabs server, files in `data/soundfonts` are offered to everyone

### example show — S/CAPE · Watch Them Slaughter

on a server with a library (jam.geyser.at/tabs), the shows in `example/` are put into the library once, as ordinary **shared shows** that every host can start — no "demo" anywhere; an admin may change or delete them, and a deleted one stays deleted (`TABS_SEED_SHOWS=0` skips them). the public build offers none. the one that comes with tabs is **S/CAPE** (`example/wts/`), the first live set of Watch Them Slaughter (Watch Me Suffocate × Schlachthauß, played 20 june 2026), as a ready-made show — modelled on [the band's setlist page](https://s.geyser.at): same running order, and for each song only what changes for a role — the guitar's boss katana preset. the tunings aren't typed in: they come out of the tab files (see *changeovers*), which gives exactly the page's three blocks, drop c# → drop b → standard e. one click opens a session with you as host and *caraphernelia* loaded, count-in on.

order and settings live in `example/wts/show.json` — edit it and restart the server. any folder in `example/` with a `show.json` (`{ name, subtitle?, date?, description?, source?, sourceLabel?, rig?: [{ name, text }], countIn?, songs: [{ file, title?, rig?: { guitar?, bass?, … }, notes?, speed?, countIn?, transpose?, autoNext?, autoStart?, gap?, groove? }] }`) becomes another example show. api: `GET /api/examples`, `POST /api/examples/:id` → `{ roomId, hostToken }`. without a server (vercel) the show opens as a solo session, from the copy `npm run build` puts into `public/examples`.

### changeovers — read from the tabs

every song that enters a setlist (upload, api or example) is read by the server, and each role — guitar, bass — gets the tuning it has to play the song in. between two songs the setlist then shows what each role has to change: *bass: drop c# → 5-string standard (b) · guitar: drop c# → drop b · Katana Brown/Lead*. your role (set it under *instruments → i play …*) comes first and is lit; a retune is shown to everyone, a rig switch only to its role. the same line sits under *next* on the deck and in stage view, and the current song lists every role's setup next to its title. a transposed song shows the tunings it now needs.

a file often holds several guitar tracks in different tunings; the role's tuning is the track that names its tuning (*"Guitar (Drop B version)"*), otherwise the lowest tuning that covers all of the role's real parts string by string (an eb standard rhythm part plus drop c# overdubs → drop c#). tracks with less than 5 % of the main part's notes don't count.

### groove — with mo-tion beats

no drummer at rehearsal, or a song without a drum track? the host switches on a **groove**: a [mo-tion beats](../Beats) drum pattern that runs locked to the song — every 16th of every bar, at the song's tempo, through tempo changes, loops and seeks. tabs plays it with beats' own synthesized kits (808, 909, lo-fi), so it sounds exactly like in beats.

- pick one of the band grooves (rock, half-time, pop, punk, shuffle, funk, disco, ballad, one drop, bossa nova, four on the floor) or a beats preset on the host's **groove desk** (the *groove* tab under the notation)
- or build your own in beats, press **use in tabs** there and choose *paste beats link…* — all four patterns (a–d), kit, swing, tempo and the beats mixer come along; *edit in beats* (with `BEATS_URL`) sends the groove back to beats
- **dj controls**, for everyone at once: switch between patterns a–d (the switch waits for the next downbeat), mute and unmute single drums live, change kit and swing
- **run free between songs** — the groove keeps playing at its own tempo (tap it, nudge it, or take the song's) while no song plays, and locks to the song again as soon as one starts
- everyone hears the same groove in sync; each person sets its level, and it plays on the music output device
- a setlist song can bring its own groove (or switch it off) — set it in the song's settings

### themes & settings

- themes *mint, jam, ember, violet, ice, stage* (max contrast) and *paper* (light), notation on paper, pages or one long line
- the settings hold only what has no place on the session screen — **sound** (sound bank, click sound, counts, accent, which ear, music and click outputs), **view** (theme, paper, layout), **stage** (readouts, flash on the one, screen on, pedals). levels, click on/off, monitor mix, your instrument and tuning, zoom, notes and auto-scroll sit where you use them

### general

- sessions live in memory and empty ones expire after 12 h. without sign-in nothing touches the disk; on the platform (below) your tabs and shows are kept in the library

## jam.geyser.at/tabs — the band platform on the NUC

the same tabs by mo-tion, with three things switched on by its `.env`: **sign-in with havoc**, a **library** on disk and the **control api**. tabs.mo-tion.at stays the public solo version on vercel. both look the same — mint, the tabs mark, the tabs home page; on the NUC it adds *join a session*, *your shows* and sign-in. (`TABS_BRAND=jam` could give a server its own name and look — `lib/brand.ts` — it isn't used.)

session codes on the NUC start with **lg** (`TABS_ROOM_PREFIX`), e.g. `lg7k2m9q`.

**codes travel between the two.** every code of the NUC starts with `lg`. on tabs.mo-tion.at such a code in *join a session* — or a link like `tabs.mo-tion.at/room/lg7k2m9q` — goes straight to `https://jam.geyser.at/tabs/room/lg7k2m9q` (a 307 redirect from next.js, before any page loads; capitals work too). the table is `TABS_REMOTES` (`prefix=url`, comma-separated) at build time; on vercel it defaults to `lg=https://jam.geyser.at/tabs`.

### setting it up on the NUC (no docker) — jam.geyser.at/tabs, /beats, /time

tabs, beats and time share one address, each under its path, all on the NUC. **one file starts
everything: `start.bat` in tabs.** it runs `deploy/jam.mjs`, which installs what's missing, builds
when the code changed, runs the three apps and a small router on **port 3000** that sends each path
to its app — and starts any of them again if it stops:

```
internet → t-mobile router → mikrotik (192.168.88.x) → nginx proxy manager (192.168.88.20, certificates)
         → the NUC (192.168.88.100:3000, the router)
              /tabs  → :3001      /beats → :3002      /time  → :3003      /  → /tabs
```

beats and time need nothing of their own there (no start file, no `.env`) — their path and port come
from the launcher; the three repositories just sit side by side (`…\Tabs`, `…\Beats`, `…\Time`).

**once, from havoc** — the NUC needs no `hc`. `hc` runs on any machine that has it (the dev pc: `Havoc\cmd\hc.cmd`); in the tabs folder there:

```cmd
..\..\Havoc\cmd\hc.cmd login https://havoc.geyser.at
..\..\Havoc\cmd\hc.cmd setup havoc.app.json --url https://jam.geyser.at/tabs --print-env
```

it connects tabs as an app of the project in `havoc.app.json` and only *prints* the lines for `.env` — `HAVOC_URL`, `HAVOC_CLIENT_ID`, `HAVOC_CLIENT_SECRET`, `APP_URL`, … — to copy over. in the havoc console, add yourself as **admin** of that project, the band from *contributor* up.

moving tabs to another address later: the same `hc setup` with the new `--url` and `--env-file deploy\nuc.env` (the file with the current secrets) instead of `--print-env` — havoc adds the new return address, the client secret stays, and `APP_URL` in the file follows.

**on the NUC** — node.js 20 lts and git, the three repositories side by side:

1. tabs' `.env`: the lines from havoc (or `deploy\nuc.env` from the dev pc, which has them). `SESSION_SECRET` and `TABS_CONTROL_KEY` may stay empty — the server makes them once (`data\secrets.json`); the control key shows on `/control` for admins. `HAVOC_INTERNAL_URL` only if the NUC can't reach havoc.geyser.at itself (then the pi: `http://192.168.88.15:8000`)
2. **`start.bat`** in tabs — the first start installs and builds all three (a few minutes). autostart: task scheduler → *at log on* → `…\Tabs\start.bat`. `update.bat` pulls the newest tabs, beats and time; the next start builds them
3. firewall — only nginx proxy manager may reach the router; the apps' own ports stay closed (as admin):
   `netsh advfirewall firewall add rule name="jam" dir=in action=allow protocol=TCP localport=3000 remoteip=192.168.88.20`

**nginx proxy manager** — a proxy host `jam.geyser.at` → `http://192.168.88.100:3000`, **websockets support on**, ssl via let's encrypt, force ssl. if big tab uploads fail, add `client_max_body_size 30m;` under *advanced*.

**dns** — `jam.geyser.at` the way `havoc` and `moon` are: a `CNAME` to `jam.lgeyser.duckdns.org` (duckdns answers every name under `lgeyser.duckdns.org` with the home address). the t-mobile router and the mikrotik already forward 80/443 to the proxy. inside the network the mikrotik answers the name with the proxy (no nat loopback through two routers):
`/ip dns static add name=jam.geyser.at address=192.168.88.20`

**vercel** — tabs.mo-tion.at forwards `lg…` codes to `https://jam.geyser.at/tabs` (the default of `TABS_REMOTES` there) — redeploy once.

the server prints what's active when it starts (sign-in, library folder, control api). better sounds for everyone: put general midi soundfonts (.sf2/.sf3) into `data/soundfonts` — they show up in everyone's settings. the library is `data/` (or `TABS_DATA`) — back it up with the rest of the NUC.

### control api — for mo-tion time, scripts, a stream deck

one stable url per action; everything acts on the **live session** (the one a signed-in host opened last, or the one switched with *make live* in the setlist tab). playback goes through the host's page like a press on its transport (count-in included).

```
POST https://jam.geyser.at/tabs/api/control/<action>     header X-Tabs-Key: <TABS_CONTROL_KEY>   (or ?key=)
```

| action | body | effect |
| --- | --- | --- |
| `status` (GET) | – | what's live: song, position in the setlist, next song, host online |
| `load` | `{ set }` | a show (id or name) into the live session — or a new one |
| `play` · `pause` · `stop` | – | transport |
| `go` | `{ seconds }` | big countdown on every screen, then play |
| `next` · `prev` · `goto` | `{ index }` (1-based) | setlist |
| `cue` | `{ text, seconds }` | cue on every screen |
| `countdown` | `{ seconds, label }` | countdown overlay |
| `show` | `{ action: "start" \| "reset" }` | show clock |
| `countin` · `tempo` · `transpose` | `{ on }` · `{ speed }` · `{ semitones }` | |
| `groove` | `{ on }` · `{ off }` · `{ slot: 1–4 }` · `{ mute: 1–8 }` | the groove desk |
| `live` | `{ room }` | which session is live |

mo-tion time fires one http request per cue at its time of day: on `/control`, *copy cue* gives each one in time's format (method, url, headers, body) — e.g. doors at 19:30 → show clock, 20:00 → *load* the show, 20:05 → *go*. time can call tabs straight from the browser (cors is open for `/api/control`, `TABS_CONTROL_ORIGINS` narrows it) or through its relay.

### keyboard

| key | action | who |
| --- | --- | --- |
| space | play / pause | host |
| s | stop | host |
| ← / → | previous / next bar (shift: 4 bars) | host |
| ↑ / ↓ | tempo ±5 bpm (shift: ±1) | host |
| 0 | back to the song's tempo | host |
| l | loop on / off | host |
| c | count-in on / off | host |
| g | 4 s countdown, then play | host |
| f | fullscreen stage view | everyone |
| n | notes above the tab on / off | everyone |
| a | auto-scroll on / off | everyone |
| page up / page down | previous / next song in the setlist | host |
| m | click on / off | everyone |
| + / − | zoom | everyone |

knobs: drag up/down (shift for fine), scroll wheel, arrow keys, double-click to reset.

## development

```cmd
npm install
npm run dev
```

then open `http://localhost:3000`. production:

```cmd
npm run build
npm start
```

`npm run build` also copies alphaTab's assets to `public/vendor/alphatab` and prebuilds the example shows into `public/examples`.

### the NUC, here

`npm run nuc` runs jam on this machine the way `start.bat` runs it on the NUC — the same launcher
(`deploy/jam.mjs --local`) and router: `http://localhost:3100/tabs`, `/beats`, `/time/`, the apps on
3101–3103, own builds (`.next-nuc`, `-- --build` builds again after code changes) and library
(`data-nuc`); the usual `npm run dev` stays as it is. `npm run nuc -- --check` starts everything,
checks it through the router like a browser and stops again. sign-in with havoc: `HAVOC_*` lines in
`deploy/nuc-local.env` (redirect url `http://localhost:3100/tabs/api/auth/callback`); without them
tabs runs open.

### open source

tabs, beats and time are public at [github.com/moon-int](https://github.com/moon-int) under the MIT licence — copies with a history of their own; these private repositories (and the NUC and vercel builds) stay where they are. `node deploy/publish.mjs` brings the current commit of all three over (`--dry` shows what would go), leaving out the example tab files.

### open source

tabs, beats and time are public at [github.com/moon-int](https://github.com/moon-int) under the MIT licence — copies with a history of their own; these private repositories (and the NUC and vercel builds) stay where they are. `node deploy/publish.mjs` brings the current commit of all three over (`--dry` shows what would go), leaving out the example tab files.

### two ways to run it

- **solo on vercel** — vercel serves only the next.js pages: no long-running process, no websockets, so no shared sessions. the landing page notices that (on vercel at build time, elsewhere when `/api` doesn't answer, or with `TABS_SOLO=1`) and runs everything in the browser instead: `lib/local.ts` runs the same room logic as the server (`lib/room.js`) inside the page. you're the host, nobody else joins, nothing is uploaded — notation, playback, click, tunings, setlist and the example shows all work. a reload keeps the example show (`/room/solo?example=wts`), uploaded files are gone.
- **band session on your own machine** — the host runs `npm start` on a laptop in the rehearsal room (or `node app.js`, the startup file for plesk / passenger / pm2). the server prints the addresses the band can reach (`band in the same wifi · http://192.168.…:3000`); in the session, **invite** shows that link and a qr code. everyone in the same wifi joins, no internet needed. on windows, allow node through the firewall for private networks. a page opened over plain `http://` on another device has no wake lock and no midi pedals (browsers keep those for https); sound and sync work. behind a reverse proxy, websocket upgrades on `/ws` have to pass through.

`PORT` sets the port (beats runs on 3001, so both work side by side), `NEXT_DIST_DIR` the build folder (default `.next`). `npm test` runs the session-store tests, `npm run typecheck` the typescript check.

## structure

- `server/index.js` — custom node server: next.js, the rest api, the `/ws` websocket and alphaTab's runtime assets under `/vendor/alphatab` (font, soundfont, worker bundle — served straight from `node_modules`)
- `lib/brand.ts` — the brand (tabs by mo-tion; an optional own one) · `components/home/` — the home pages on one hook, `lib/useLanding.ts`
- `server/config.js` — settings from the environment and `.env` · `server/auth.js` — sign-in with havoc (oauth + pkce, sealed session cookie, roles) · `server/library.js` — tabs and shows on disk · `server/control.js` — the control api
- `app/library`, `app/sets/[id]`, `app/control` — library, show editor, control page · `lib/account.ts` — the pages' view of the server and the signed-in user · `components/GroovePanel.tsx` — the groove desk
- `start.bat` / `update.bat` — run and update the server on windows · `havoc.app.json` — tabs' registration in havoc · `.env.example` — every setting
- `lib/room.js` — one session: playback state, setlist, broadcast; shared by `server/rooms.js` (the in-memory session store) and `lib/local.ts` (solo sessions in the page)
- `server/examples.js` — example shows from `example/*/show.json`
- `lib/rig.js` — reads each role's tuning out of a tab file, with alphaTab in node (`server/rig.js`) or in the page · `lib/changeover.ts` — changeovers between setlist songs · `lib/parts.js` — track → role, shared by browser and server
- `app/` — next.js app router: landing (`page.tsx`), session (`room/[id]/page.tsx`), `globals.css`
- `components/` — `Transport`, `SeekBar`, `TrackMixer`, `Setlist`, `StageHud`, `Live` (cues, countdown, band), `SettingsDrawer`, `BeatLights`, `Knob`, `Logo`, `ThemeBoot`
- `lib/player.ts` — `TabPlayer`, a thin wrapper around one alphaTab instance
- `lib/useSession.ts` — wires player and websocket: the host's player is the source of truth, listeners reconcile against it
- `lib/tuning.ts` — tuning presets, parsing and re-fretting
- `lib/groove.ts` — grooves and the beats-link decoder · `lib/beats/` — beats' synth, kits and presets, copied unchanged from the beats repo (keep in sync)
- `lib/click.ts` — the clock-locked lanes: click engine and groove engine, each a lookahead scheduler on its own AudioContext anchored to alphaTab's position reports
- `lib/prefs.ts` — per-person settings · `lib/themes.ts` — themes · `lib/stage.ts` — fullscreen, wake lock, output devices · `lib/midi.ts` — midi pedals
- `components/Invite.tsx` — invite link & qr code (uses the laptop's wifi address when the host is on localhost, `GET /api/lan`)
- `scripts/` — `vendor-alphatab.js` (alphaTab assets → `public/vendor`), `build-examples.js` (example shows → `public/examples`)
- `lib/sync.ts` — websocket client with reconnect and latency estimate, host rest helpers, file helpers
- `test/` — `node --test` tests: session store, library, control api, sign-in sealing, grooves, tunings, changeovers

## host api

every session can be driven without the web ui. `POST /api/rooms` returns `{ roomId, hostToken }`; send the token as `Authorization: Bearer <hostToken>` (or `X-Host-Token`, or `?token=`). everything you do here is mirrored to every open page instantly — the room ui uses the same endpoints for uploads and the setlist. while the host's page is open, playback commands (play, pause, stop, seek, speed, loop, range, count-in, transpose) are run by that page like a press on its own transport — count-in included — and reach the band from there; without a host page they apply to the session directly.

| endpoint | auth | body | effect |
| --- | --- | --- | --- |
| `POST /api/rooms` | – | – | create a session |
| `GET /api/rooms/:roomId` | – | – | state: file, playback, setlist, host online, listener count |
| `POST /api/rooms/:roomId/file` | host | `{ data, name? }` (data = base64) | load a file for everyone (leaves the setlist position) |
| `POST /api/rooms/:roomId/play` | host | `{ tick? }` | play |
| `POST /api/rooms/:roomId/pause` | host | `{ tick? }` | pause |
| `POST /api/rooms/:roomId/stop` | host | – | stop and rewind |
| `POST /api/rooms/:roomId/seek` | host | `{ tick }` | jump to a midi tick (960 per quarter note) |
| `POST /api/rooms/:roomId/speed` | host | `{ speed }` | tempo factor, 1 = the song's own tempo |
| `POST /api/rooms/:roomId/loop` | host | `{ loop }` | loop on/off |
| `POST /api/rooms/:roomId/range` | host | `{ range: { startTick, endTick } \| null }` | playback range |
| `POST /api/rooms/:roomId/countin` | host | `{ countIn }` | count-in on/off |
| `POST /api/rooms/:roomId/transpose` | host | `{ transpose }` | whole song in semitones (−12…12) — tabs keep their frets |
| `POST /api/rooms/:roomId/cue` | host | `{ text \| null, seconds? }` | cue on every screen (0 s = until cleared) |
| `POST /api/rooms/:roomId/countdown` | host | `{ seconds, label? }` | countdown overlay (0 cancels) |
| `POST /api/rooms/:roomId/show` | host | `{ action: "start" \| "reset" }` | show clock |
| `POST /api/rooms/:roomId/groove` | host | `{ groove: { name, kit, swing, rows, on?, mix? } \| null }` | beats groove for everyone — `rows`: 8 strings of 16 steps (`X` accent, `x` hit, `.` rest), `kit`: 0 808 · 1 909 · 2 lo-fi |

### setlist

| endpoint | auth | body | effect |
| --- | --- | --- | --- |
| `GET /api/rooms/:roomId/setlist` | – | – | songs & current index |
| `POST /api/rooms/:roomId/setlist` | host | `{ songs: [{ data, name?, title? }], autoStart? }` | replace the setlist; `autoStart` loads song 1 |
| `POST /api/rooms/:roomId/setlist/songs` | host | `{ data, name?, title? }` | append a song |
| `PATCH /api/rooms/:roomId/setlist/songs/:index` | host | `{ title?, notes?, speed?, countIn?, transpose?, autoNext?, autoStart?, gap?, groove? }` | per-song live settings |
| `DELETE /api/rooms/:roomId/setlist/songs/:index` | host | – | remove a song |
| `POST /api/rooms/:roomId/setlist/move` | host | `{ from, to }` | reorder |
| `POST /api/rooms/:roomId/setlist/next` | host | – | next song |
| `POST /api/rooms/:roomId/setlist/prev` | host | – | previous song |
| `POST /api/rooms/:roomId/setlist/goto` | host | `{ index }` | jump to a song |

`fileData` / `fileName` are accepted as aliases for `data` / `name`.

```bash
curl -X POST http://localhost:3000/api/rooms/k7m2qa/setlist/next \
  -H "Authorization: Bearer <hostToken>"
```

## notes

- browsers only play audio after a click, so everyone confirms once when entering a session.
- the host token lives in the host's `localStorage`; opening the same session from that browser makes you host again.
- sessions are lost when the server restarts.
