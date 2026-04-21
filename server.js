const express = require('express');
const http = require('http');
const { WebSocketServer } = require('ws');
const os = require('os');

const app = express();
const server = http.createServer(app);
const wss = new WebSocketServer({ server });

// Redirect root to water polo clock
app.get('/', (req, res) => res.redirect('/waterpolo.html'));

// Parse JSON bodies for API routes
app.use(express.json());

// ── CORS for /api/* so the swim clock works when embedded on smwphub.com
//    or opened from a local file:// URL ───────────────────────────────────────
app.use('/api', (req, res, next) => {
  res.header('Access-Control-Allow-Origin', '*');
  res.header('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.header('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.sendStatus(204);
  next();
});

// ── AI Clean proxy (keeps OpenAI key server-side) ────────────────────────────
app.post('/api/ai-clean', async (req, res) => {
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) {
    return res.status(500).json({ error: 'OPENAI_API_KEY not configured on server' });
  }

  const { text, poolLength } = req.body;
  if (!text || typeof text !== 'string') {
    return res.status(400).json({ error: 'Missing "text" field' });
  }

  try {
    const openaiRes = await fetch('https://api.openai.com/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${apiKey}`
      },
      body: JSON.stringify({
        model: 'gpt-4o-mini',
        temperature: 0,
        max_tokens: 2000,
        messages: [
          { role: 'system', content: AI_SYSTEM_PROMPT },
          { role: 'user', content: `Pool length: ${poolLength || 36}m\n\nReformat this swim set:\n\n${text}` }
        ]
      })
    });

    if (!openaiRes.ok) {
      const errBody = await openaiRes.json().catch(() => ({}));
      console.error('OpenAI error:', openaiRes.status, errBody);
      return res.status(openaiRes.status).json({
        error: errBody.error?.message || `OpenAI API error ${openaiRes.status}`
      });
    }

    const data = await openaiRes.json();
    let cleaned = (data.choices[0].message.content || '').trim();
    // Strip markdown fences if model wraps output
    cleaned = cleaned.replace(/^```[\w]*\n?/, '').replace(/\n?```$/, '').trim();

    res.json({ cleaned });
  } catch (err) {
    console.error('AI Clean error:', err);
    res.status(500).json({ error: err.message || 'Internal error' });
  }
});

const AI_SYSTEM_PROMPT = `You are a swim set formatting assistant for a Stanford swim clock app. Your ONLY job is to take messy, inconsistent swim set text and reformat it into the exact structure the parser expects. Return ONLY the cleaned set text — no explanations, no markdown, no backticks.

THE PARSER EXPECTS THIS EXACT FORMAT:

Section headers (each on its own line, ALL CAPS). ONE header per workout block:
- WARM-UP
- MAIN SET          (the ENTIRE main set goes under one header, even if zones vary per rep)
- PULL SET          (all pull reps under one header)
- COOL-DOWN
- LADDER            (optional, instead of MAIN SET)
- TEST              (optional, instead of MAIN SET)
- EXTENSION        (optional, a second main-style block)

** DO NOT split a block into multiple sections just because the zones vary. **
Every rep line can carry its own zone and rest — the parser handles mixed zones in one block.

Rest-gap line (optional). A standalone "1:00 rest" / ":30 rest" line has TWO meanings depending on where it sits:
- FIRST line inside a section (before any rep lines) → rest gap BEFORE this block starts (separates blocks on the clock).
- BETWEEN two rep lines inside a section → extra pause between those two rep groups (e.g. a rest in the middle of a main set).
Preserve both kinds verbatim — do not merge them into per-rep rest.

Equipment line (optional, for PULL SET usually):
- paddles + pull buoy

Rep line formats. Each rep line goes on its own line, underneath the section header:
- "6x108 @ Zone 2, :10 rest"        ← N reps, zone per rep, rest per rep
- "4x72 @ Zone 3, :15 rest"         ← different zone/rest in same block is FINE
- "3x216 w/ paddles + pull buoy, :20 rest"
- "200 free"                        ← single distance + stroke (warmup/cooldown)
- "4x50 build, :10 rest"            ← keep "build" / "descend" as notes
- "200-100-50-100-200"              ← dash-separated distances (ladder-style)
- "4 rounds:"                       ← rounds header (followed by the rep lines that get repeated)
- ":30 between rounds"              ← round break inside a rounded section

CRITICAL RULES:
1. ONE header per workout block. Warm-up = 1 section. Main = 1 section. Pull = 1 section. Cool-down = 1 section. Do not split by zone.
2. Zone goes on the REP LINE as "@ Zone N" — NOT in the header, NOT on its own line.
3. Rest between reps goes on the REP LINE as ":NN rest" — NOT on its own line.
4. A standalone "1:00 rest" or ":30 rest" line is ONLY used at the very top of a section to denote the break between blocks. Do not invent these.
5. Strip "on 1:30" or "@ 1:30" style interval targets — the app computes targets from the swimmer's CSS.
6. Use exact distances from input — do NOT convert or round.
7. Keep "build" / "descend" as an inline note.
8. Warm-up and cool-down items should be simple "{distance} {stroke}" lines — no zone needed.
9. If input has no clear headers, infer: warm-up patterns → WARM-UP, main set patterns → MAIN SET, anything with paddles/buoy → PULL SET, easy stuff at end → COOL-DOWN.
10. Pool-specific distances (36, 72, 108, 144, 216 for 36m pool; 25, 50, 100, 200 for 25yd/25m pool) — keep as-is.

EXAMPLE INPUT (messy):
"Warm-up
- 216m free
- 108m kick

Main Set
- **1:00 rest**
- 6x108m @ Zone 2, :10 rest
- 4x108m @ Zone 3, :15 rest
- 4x72m @ Zone 3, :15 rest

Pull Set w/ paddles + pull buoy
- **1:30 rest**
- 3x216m @ Zone 2, :20 rest

Cool-down
- **:30 rest**
- 216m easy"

EXAMPLE OUTPUT (clean):
WARM-UP
216m free
108m kick

MAIN SET
1:00 rest
6x108 @ Zone 2, :10 rest
4x108 @ Zone 3, :15 rest
4x72 @ Zone 3, :15 rest

PULL SET
1:30 rest
paddles + pull buoy
3x216 @ Zone 2, :20 rest

COOL-DOWN
:30 rest
216 easy`;

app.use(express.static(__dirname));

// Track all connected clients
const clients = new Set();

wss.on('connection', (ws) => {
  clients.add(ws);
  console.log(`Client connected (${clients.size} total)`);

  ws.on('message', (data) => {
    // Relay message to all OTHER clients
    const msg = data.toString();
    for (const client of clients) {
      if (client !== ws && client.readyState === 1) {
        client.send(msg);
      }
    }
  });

  ws.on('close', () => {
    clients.delete(ws);
    console.log(`Client disconnected (${clients.size} total)`);
  });
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, '0.0.0.0', () => {
  // Find local IP for phone connection
  const nets = os.networkInterfaces();
  let localIP = 'localhost';
  for (const name of Object.keys(nets)) {
    for (const net of nets[name]) {
      if (net.family === 'IPv4' && !net.internal) {
        localIP = net.address;
        break;
      }
    }
  }
  console.log('');
  console.log('  ╔══════════════════════════════════════════════╗');
  console.log('  ║   STANFORD WATER POLO CLOCK                 ║');
  console.log('  ╠══════════════════════════════════════════════╣');
  console.log(`  ║   Display:  http://${localIP}:${PORT}/waterpolo.html`);
  console.log(`  ║   Remote:   http://${localIP}:${PORT}/waterpolo.html?control`);
  console.log('  ║                                              ║');
  console.log('  ║   Open Display on the big screen,            ║');
  console.log('  ║   then scan the QR or open Remote on phone.  ║');
  console.log('  ╚══════════════════════════════════════════════╝');
  console.log('');
});
