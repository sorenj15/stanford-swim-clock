# Stanford Swim & Water Polo Tools — Session Handoff

This is the single doc that gets a new session up to speed. Read this first, then `CLAUDE.md` for architecture-only details that auto-load into every agent.

---

## Who's working in here

- **Soren** (head coach, primary user). Mostly drives feature requests through Claude Code.
- **Brian** (assistant coach). Has GitHub collaborator access. Sometimes pushes his own commits — always `git pull --rebase origin main` before starting.

---

## What this repo is

Two single-page web apps for poolside use plus a tiny Node server:

1. **Swim Interval Clock** (`index.html`) — paste a swim set, parse it, run 3 tier timers side-by-side with auto-computed pace targets per tier/zone/distance.
2. **Water Polo Scoreboard** (`waterpolo.html`) — game clock + shot clock + score + period tracking. Optional split-screen for two simultaneous games. Phone remote controller. TV mirror views.
3. **`server.js`** — Express static file host + WebSocket relay (no server-side state, just rebroadcasts) + OpenAI proxy for AI Clean.

No build step. No framework. Vanilla HTML/CSS/JS. **Don't add React.**

---

## URLs you'll touch

| Use | URL |
| --- | --- |
| Swim clock (display) | `https://stanford-swim-clock.onrender.com/index.html` |
| Swim clock TV (3 big tier timers) | `https://stanford-swim-clock.onrender.com/index.html?tv` |
| Water polo display | `https://stanford-swim-clock.onrender.com/waterpolo.html` |
| Water polo phone controller | `https://stanford-swim-clock.onrender.com/waterpolo.html?control` |
| Water polo TV (Side A / single court) | `https://stanford-swim-clock.onrender.com/waterpolo.html?tv` |
| Water polo TV — Side B (split mode) | `https://stanford-swim-clock.onrender.com/waterpolo.html?tv&side=B` |
| Water polo TV — amber digits A/B test | `https://stanford-swim-clock.onrender.com/waterpolo.html?tv&amber` |
| Big board showing only Side A in split mode | `https://stanford-swim-clock.onrender.com/waterpolo.html?solo=A` |
| Big board showing only Side B in split mode | `https://stanford-swim-clock.onrender.com/waterpolo.html?solo=B` |
| Drills layout TV | `https://stanford-swim-clock.onrender.com/waterpolo.html?tv&drills` |

The hub site `smwphub.com` embeds the swim clock via iframe pointing at the Render URL — so changes propagate to the hub automatically. **Never ask anyone to mirror files to smwphub.**

GitHub repo: `https://github.com/sorenj15/stanford-swim-clock`

Render deploys main automatically (~1 min after a push). Watch the dashboard for the green deploy checkmark before testing prod URLs.

---

## First-time setup on a new machine

```bash
git clone https://github.com/sorenj15/stanford-swim-clock.git
cd stanford-swim-clock
npm install
node server.js     # verify locally — http://localhost:3000 should redirect to waterpolo.html
# Ctrl+C to stop
```

Then in this directory: `claude` to launch Claude Code. It auto-reads `CLAUDE.md` for architecture context.

**Every work session starts with `git pull --rebase origin main`.** Skipping this is the single most reliable way to create merge conflicts.

---

## Architecture in 90 seconds

### Three-mode pattern

Both HTML files use URL params to swap modes:

| Mode | Trigger | Role |
| --- | --- | --- |
| Display | no params (or `?solo=A`/`?solo=B`) | Big screen. Authoritative. Runs the clock loop. Sends state. |
| Controller | `?control` | iPhone remote. Sends `cmd` messages. Receives state. Never runs its own clock. |
| TV | `?tv` (with optional `&side=B`, `&amber`, `&drills`) | Receive-only mirror. Stripped-down view. Never sends. |

Detection at top of `<script>` block via `location.search`. `IS_CONTROL`, `IS_TV`, etc. flags.

### WebSocket — dumb relay

`server.js` accepts any JSON message and rebroadcasts to all *other* clients. **No auth, no persistence, no server-side game state.** Display is source of truth.

```js
// Display → others (~8 Hz default, 30 Hz when game<60s or shot<5s)
{ type: 'state', gameTime, shotTime, quarter, homeScore, awayScore,
  splitMode, bGameTime, bShotTime, bHomeScore, bAwayScore, bRunning,
  drillsMode, repCounterEnabled, repCount, bRepCount, restMode, restTime, ... }

// Controller → display
{ type: 'cmd', action: 'toggle' | 'shot30' | 'shot20' | 'resetSide' | 'score' | 'setShot' | 'setRepCounter' | 'repInc' | 'repDec' | ..., data: { side: 'A'|'B', ... } }

// Display → swim TV (separate channel)
{ type: 'swimState', tierCount, tiers: [{ phase, elapsed, repIdx, ... }] }
```

**Adding a feature that touches display ↔ controller ↔ TV requires updating three places:**
1. The `sendState` / `tvBroadcast` payload on the display
2. The `applyState` / `applyTvState` handler on the controller / TV
3. Often: a new `cmd` action handler in `handleCmd`

### Display rebuild gotcha

The display rebuilds DOM from `innerHTML` at 60fps from the clock loop. **Buttons attached via `onclick=` get destroyed between mousedown and click**, so the click never fires. Pattern: use document-level `mousedown` / `touchstart` event delegation with `data-` attributes.

Examples in code: tier buttons (swim), Edit Set toggle (swim), rep counter badges (water polo).

### Controller diff-aware updates

`applyState` on the controller uses tiny `setText` / `setDisplay` / `setStartBtn` helpers that only touch the DOM if the value actually changed. Browsers repaint on every `textContent` assignment regardless, and at 60 state msgs/sec that was the source of "screen glitches between screens." Keep that pattern when adding new controller fields.

---

## Swim parser data model

`parseSet(text)` in `index.html` returns an array of section objects:

- **Sections**: `Warm-up`, `Main Set`, `Pull Set`, `Cool-down`, `Ladder`, `Test`, `Extension`.
- **Section shape**: `{ timed: true, reps: [...], restBetween, restAfterSec, restAfterLabel, rounds, roundBreakRest, equipment, zKey, ... }` for timed sections, or `{ timed: false, items: [...] }` for warm-up/cool-down.
- **Reps**: `{ dist, laps, zKey?, rest?, easy?, roundEnd? }`. `zKey` and `rest` are *per-rep overrides* of the section defaults — one Main Set can mix Z2/Z3/Z5 reps without splitting into multiple sections.
- **Set break** between blocks is `sec.restAfterSec`. Standalone rest lines like `1:30 rest` at the top of a section get attached to the **previous** section's `restAfterSec`.
- **Pending end-rest** (`_pendingEndRest`) handles the ambiguous case where `X:YY rest` appears between reps. We can't tell if it's a mid-group pause or a set break until the next line arrives. Resolved in `mkRep` (next rep pushed → mid-group rest) or `finalizePendingRest` (next section header → set break).
- **Inline preview editor** mutates `_EDITED_SECS` directly. `Launch` uses those edits unless the source text changed since (then re-parses).
- **In-set live editor** (during running clock) — same data model. Edits to upcoming reps apply when the clock reaches them. Past + current reps locked.

If you change the parser's grammar, **also update `AI_SYSTEM_PROMPT` in `server.js`** so the AI Clean output stays compatible.

---

## OpenAI AI Clean proxy

- Endpoint: `POST /api/ai-clean` on the Render server. Body `{ text, poolLength }`. Returns `{ cleaned }`.
- Client calls the **absolute Render URL**, not a relative path, so the swim clock works when embedded on smwphub via iframe.
- CORS open (`Access-Control-Allow-Origin: *`) on `/api/*`.
- API key from `process.env.OPENAI_API_KEY` set in Render dashboard.
- **Never commit a key.** GitHub bots find exposed keys within minutes. If one slips into a file, revoke it on OpenAI's dashboard immediately.

---

## Stanford-specific defaults (June 2026 FTP test)

Four-tier roster (the default) + per-tier CSS (sec / 100m, converted from
`sec/100y × 1.0936`):

| Tier | Color | Swimmers | FTP (y) | CSS (m) |
| --- | --- | --- | --- | --- |
| 1 | Green | C. Ohl, R. Ohl, West | 54.71 | 59.8 |
| 2 | Blue | Krilanovich, De Vecchis, Mathiopoulos, Schneider | 55.70 | 60.9 |
| 3 | Cardinal | Gheorghe (fins), Balogh, Oerlemans, Wu (TBD) | 57.74 | 63.1 |
| 4 | Orange | Rozolis-Hill, Zelikov, Leonardi, Forer, Arakelian, Caras, Mnatsakanian, Austen (TBD), Ben T. (TBD) | 59.58 | 65.2 |

(Gheorghe tested with fins — excluded from the tier-3 average. Wu, Austen,
and Ben T. untested — they follow their tier. A 6-tier preset from the
same test lives in `_TIER_PRESETS` if the coach wants finer splits; the
older 1/2/3-tier presets carry the April 2026 rosters.)

Pool length default: **36 m** (Avery short-course meters).

`BASE_CSS` in `index.html` must stay in sync with the tier 1-3 input
defaults so their default scale is 1.0 and pace ranges from `RAW` are
absolute. Tiers 4-6 have no `RAW` tables — they reuse tier3's and scale
by CSS ratio (their `BASE_CSS` entries are tier3's value).

Zone colors: **Z1 green · Z2 blue · Z3 gold · Z4 red · Z5 purple.** Don't reassign.

---

## Recent feature inventory (what's already built)

### Swim clock
- Inline preview editor (click-to-edit dist / zone / rest, +/× buttons, Add Rep)
- Live in-set editor while the clock is running (✏ Edit Set button, locks past + current reps, edits future reps + add rep at end)
- AI Clean button → calls server-side OpenAI proxy
- Per-rep zone + rest overrides
- "Easy" rep support (no zone, no target, never marked missed)
- Dynamic mid-section rest resolution (mid-group pause vs set break)
- Inter-rep rest pills shown between reps in the hero strip
- Color-coded zone badges (Z1 green → Z5 purple)
- Set break "→ 1:30 set break" indicator in hero
- MISSED badge fades after 10s of rest (no permanent stamp)
- "GO AGAIN" banner removed (was a fake judgment)
- Swim TV `?tv` mode — three big tier timers, 7-segment digits, tier-colored header bars, blink red flash for last 5s of rest

### Water polo scoreboard
- Phone controller with full game/shot/score/excl controls
- TV mirror (`?tv`) — shot clock big, mini game clock + scores in corner
- Split-screen mode for two simultaneous games — `?solo=A`/`?solo=B` puts only one side full-screen on the big board, with the other on a TV via `?tv&side=B`
- Shot clock auto-off when game time < shot time (per rule)
- Sticky custom shot clock default — Set Shot Clock to 12, all `↺ RESET` buttons go back to 12
- `↺ 30` and `↺ 20` always those exact values regardless of sticky default
- `↺ RESET` button (single + per-side) — shot-clock-only reset, **does not pause the clock** (continues running from new value)
- Rep counter — small tappable badge on display, +/-/reset buttons on phone, per-side counters in split mode (Side A top-right, Side B bottom-right of display)
- Drills mode TV layout (big game clock + scores, no shot clock)
- Rest timer overlay between quarters — score visible, no "REST" banner
- Diff-aware DOM updates + 8 Hz state broadcast throttle (was 60 Hz, caused glitchiness)

---

## Common workflows

### Coach asks for a feature

1. `git pull --rebase origin main`
2. Sketch the change. If it touches sync, plan the WebSocket message addition first.
3. Implement display side first (it's the source of truth).
4. Add controller/TV handlers.
5. Test locally (`node server.js`, open multiple browser tabs).
6. Commit + push. Render auto-deploys.
7. Confirm on the Render URL with hard-refresh (Cmd+Shift+R).

### Production bug report

1. Reproduce on the Render URL first (not locally) — local + prod behavior can drift if Render has a cached deploy.
2. Check the Render dashboard for the latest deploy commit. If it's older than your last push, redeploy may not have triggered.
3. If the user can't see your fix even after deploy, almost always a browser cache issue — get them to hard-refresh.
4. Last-resort revert:
   ```bash
   git revert HEAD
   git push origin main
   ```
   Render redeploys to the previous state in ~1 min.

### Coach reports glitchiness or flicker

Two likely culprits, both already addressed but watch for regressions:
1. **Display rebuilds destroying buttons mid-click.** Look for `onclick=` on elements inside loop-rebuilt containers; switch to document-level mousedown delegation.
2. **Unconditional textContent writes in applyState.** Use `setText` helpers — only write when the value differs.

### Pre-commit checklist

- Brian or coach push since you started? `git status` should show clean. `git log origin/main..HEAD` shows what you're about to push.
- Did you touch `parseSet`? Update `AI_SYSTEM_PROMPT` in `server.js` accordingly.
- Did you add a state field? Update three places: payload, applyState, applyTvState.

---

## Things to NOT do

- **Don't add localStorage persistence** for tier names or CSS values. The HTML defaults *are* the canonical defaults and coaches expect them to persist across sessions only by being in the file.
- **Don't reassign zone colors.** Z1 green, Z2 blue, Z3 gold, Z4 red, Z5 purple is a hard convention.
- **Don't move the clock loop off the display.** It's authoritative. The server stays a relay.
- **Don't introduce server-side game state.** Same reason.
- **Don't break URL params** (`?control`, `?tv`, `?tv&amber`, `?solo=A`, `?solo=B`, `?tv&side=B`, `?tv&drills`, `?court=N`). They're shared with coaches and on TV bookmarks.
- **Don't auto-generate commits.** Wait for the user to say "commit and push."
- **Don't hardcode any API key, ever.** Server proxy + env var only.
- **Don't add a build step or framework.** Vanilla JS forever.

---

## What's likely to come up

Based on recent sessions, common follow-up requests:

- **More live-editing flexibility** — coach wants to tweak a running set without pausing.
- **Display readability** — bigger fonts, higher contrast, fewer visual elements. Poolside legibility wins over design.
- **Sun visibility on outdoor TVs** — white digits on black for max LCD luminance is the current call, but the user A/B tests amber via `?tv&amber`.
- **Keeping smwphub.com in sync** — already handled via iframe to the Render URL. If anyone proposes copying files to smwphub manually, push back.

---

## Sanity-check commands

```bash
# Verify Render is serving the latest
curl -s https://stanford-swim-clock.onrender.com/waterpolo.html | grep -c "ctrlRepSec"

# Verify the AI proxy is alive
curl -s -X POST https://stanford-swim-clock.onrender.com/api/ai-clean \
  -H "Content-Type: application/json" \
  -d '{"text":"test"}'
# Should return {"error":"OPENAI_API_KEY not configured ..."} or a real response

# See what's about to push
git log origin/main..HEAD --oneline
```

---

## When stuck

Read `CLAUDE.md` for architecture-only details. Read recent commits (`git log --oneline -30`) for what's been changing lately. The user is fast at giving direct feedback ("nope, do X instead") so favor shipping a small change and iterating over big up-front planning.
