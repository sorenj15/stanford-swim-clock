# Stanford Swim & Water Polo Tools

Two poolside tools built for Stanford Swimming & Water Polo — a swim interval clock and a water polo scoreboard.

## Swim Interval Clock (`index.html`)

A 3-lane interval timer designed for pace training across speed tiers.

**Features:**
- 3 side-by-side clocks (Tier 1 / 2 / 3) with independent pace targets
- Paste any swim set and the parser auto-detects distances, intervals, rounds, warm-up, cool-down, etc.
- Live preview panel so you can verify the parsed set before launching
- 10-second countdown with beeps before each set starts
- Per-tier pause and reset controls
- Large, high-contrast display optimized for reading from across the pool deck
- Supports warm-up, main set, pull, cool-down sections with set breaks and round structure

**Usage:**
1. Open `index.html` in a browser (or visit the deployed URL)
2. Paste your set into the text box — the preview updates live
3. Adjust rest intervals and tier paces as needed
4. Hit **Launch** to start the clocks

## Water Polo Scoreboard (`waterpolo.html`)

A full game clock, shot clock, and score tracker with iPhone remote control.

**Features:**
- Game clock + shot clock with large, bright display
- Shot-clock-only mode for standalone shot clock use
- Score tracking for White vs Black teams
- Real-time remote control from any phone via WebSocket
- Settable clocks — tap to edit game clock or shot clock time
- Auto horn when shot clock or game clock hits zero
- Stanford cardinal color scheme

**Usage:**
- **Display (big screen):** Open `waterpolo.html`
- **Phone remote:** Open `waterpolo.html?control` on your phone
- Both devices connect via WebSocket through the Node server

## Running Locally

```bash
npm install
node server.js
```

Then open `http://localhost:3000` in your browser.

## Deployment

Currently deployed on [Render](https://render.com). The server uses `process.env.PORT` for compatibility.

## Tech Stack

- Vanilla HTML/CSS/JS — no frameworks, no build step
- Node.js + Express for static file serving
- WebSocket (`ws`) for real-time phone-to-display sync
- Web Audio API for synthesized sounds (whistle, beeps, horn)
