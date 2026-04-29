# Stanford Swim & Water Polo Tools — Agent Orientation

This repo hosts two poolside apps plus a tiny Node server that glues them together. Keep this doc current as the architecture evolves.

## Files

| File | Purpose |
| --- | --- |
| `index.html` | **Swim Interval Clock.** Single-page app: setup view → clocks view. Paste a set, edit inline, launch 3 tier timers. |
| `waterpolo.html` | **Water Polo Scoreboard.** Game clock + shot clock + score + exclusion tracking. |
| `server.js` | Express static file host + `ws` WebSocket relay + OpenAI proxy for AI Clean. |
| `package.json` | Node deps (`express`, `ws`). `node >= 18` required for built-in `fetch`. |
| `README.md` | User-facing docs. Keep light. |

No build step. No framework. Vanilla HTML/CSS/JS everywhere. Don't add React.

## Three mode pattern (per app, driven by URL param)

Both HTML files use the same structural convention:

| URL | Mode | Role |
| --- | --- | --- |
| `/waterpolo.html` or `/index.html` | **Display** | Big screen. Authoritative — runs the clock loop. |
| `/waterpolo.html?control` | **Controller** | iPhone remote. Sends commands, displays synced state. Never runs its own clock. |
| `/waterpolo.html?tv` | **TV** | Dedicated secondary TV. Receive-only. Renders a stripped-down view from broadcast state. Never sends anything. |
| `/waterpolo.html?tv&amber` | TV variant | Amber digits instead of default white (A/B test for outdoor legibility). |
| `/index.html?tv` | Swim TV | 3 big tier timers, hides unused columns when fewer tiers are active. |

Mode detection happens near the top of the `<script>` block via `location.search`. When adding a new mode, follow the existing flag pattern (`IS_CONTROL`, `IS_TV`) and guard everything that touches DOM or state with those flags.

## WebSocket sync — important

`server.js` runs a **dumb relay**. It accepts any JSON message from any client and broadcasts it to every *other* connected client. There is no auth, no persistence, no server-side game state. The display is the source of truth.

**Message shape — water polo:**
```js
// Display → others (broadcast at 60fps while running)
{ type: 'state', gameTime, shotTime, quarter, homeScore, awayScore, running, shotOnly, exclusions }

// Controller → display
{ type: 'cmd', action: 'start' | 'stop' | 'reset' | 'setGame' | 'setShot' | 'score' | ..., data: {...} }
```

**Message shape — swim clock:**
```js
// Display → TV (~10 Hz throttle, not every frame)
{ type: 'swimState', tierCount, tiers: [{ phase, elapsed, restDur, countdownDur, repIdx, repCount, repDist, paused }, ...] }
```

**If you add a feature that needs the remote or TV to know about new state, you must update three things:**
1. The `sendState` / `tvBroadcast` payload on the display.
2. The `applyState` / `applyTvState` handler on the controller / TV.
3. (Sometimes) a new `cmd` type in `handleCmd`.

**Do not** move the clock loop out of the display. Do not introduce server-side game state. Keep the server a relay.

## OpenAI proxy for AI Clean

`server.js` exposes `POST /api/ai-clean`. Body: `{ text, poolLength }`. Returns `{ cleaned }`.

The client (`index.html`) calls this from the **absolute** Render URL, not a relative path, so the swim clock works when embedded on smwphub.com via iframe. CORS is open (`Access-Control-Allow-Origin: *`) on `/api/*`.

The OpenAI API key is loaded from `process.env.OPENAI_API_KEY` on Render. **Never commit a key.** If a key ever ends up in a file, revoke it on OpenAI's dashboard immediately — bots scrape GitHub within minutes.

The AI_SYSTEM_PROMPT in `server.js` has detailed formatting rules that must stay in sync with the swim parser in `index.html`. Changing the parser's understanding of a format means updating the prompt too.

## Swim parser — key concepts

`parseSet(text)` in `index.html` returns an array of section objects. Understanding the data model saves hours:

- **Sections** are the blocks: Warm-up, Main Set, Pull Set, Cool-down, Ladder, Test, Extension.
- **Each section** has either `timed: true` with `reps[]` or `timed: false` with `items[]` (warmup/cooldown).
- **Reps** are `{ dist, laps, zKey?, rest?, easy?, roundEnd? }` — `zKey` and `rest` are **per-rep overrides** of the section defaults. This means one Main Set can mix Z2/Z3/Z5 reps and different rest intervals without splitting into multiple sections.
- **Set break** between blocks is `sec.restAfterSec`. Standalone rest lines like `1:30 rest` at the top of a section get attached to the *previous* section as a set break.
- **Pending end-rest** (`_pendingEndRest`) handles the ambiguous case where a `X:YY rest` line appears between reps — we don't know if it's a mid-group pause or a set break until the next line arrives. Resolved in `mkRep` or `finalizePendingRest`.
- **Inline preview editor** mutates `_EDITED_SECS` directly. Launch uses those edits unless the source text changed since.

## Deployment

- GitHub main branch → Render auto-deploys. ~1 min turnaround.
- Render URL: `https://stanford-swim-clock.onrender.com`
- `smwphub.com` iframes the swim clock from that Render URL — changes propagate automatically. **Do not** ask anyone to manually copy files to smwphub.

## Before you start any session

1. **`git pull`** — you or Soren may have pushed. Skipping this causes merge conflicts.
2. If working on anything that touches display ↔ controller ↔ TV sync, plan the WS message change first, then implement on all three ends.
3. Changes to the parser probably need a matching update to the AI_SYSTEM_PROMPT in `server.js`.

## Conventions

- No TypeScript. No framework. No build step.
- Commit messages: one-line subject, blank line, short body. End with `Co-Authored-By: Claude ...` if you're helping.
- Don't break existing URL params (`?control`, `?tv`, `?tv&amber`) — they're shared with the coaches.
- Don't add localStorage persistence for tier names / CSS — the values in the HTML file *are* the defaults and coaches expect them.
- CSS zones colors: Z1 green, Z2 blue, Z3 gold, Z4 red, Z5 purple. Don't reassign.
- Poolside legibility trumps design. Bigger fonts, higher contrast, fewer visual elements.

## Known constraints

- `DSEG7` font loaded from `jsdelivr` CDN for the water polo TV. Falls back to Arial Black if CDN fails.
- Pool length defaults to 36 m (Avery short-course meters). Coaches change this per-session.
- CSS defaults: Tier 1 = 61.1 s/100m, Tier 2 = 63.3, Tier 3 = 65.7. These are Stanford-specific (converted from sec/100y test averages × 1.0936) — don't repurpose. BASE_CSS in index.html must stay in sync with these so the default scale is 1.0.
