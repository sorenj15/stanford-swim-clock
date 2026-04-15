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

Section headers (each on its own line, ALL CAPS or Title Case):
- WARM-UP (or Warm-up, WU)
- MAIN SET — Zone N (where N is 2, 3, 4, or 5)
- PULL SET — Zone N
- COOL-DOWN (or Cool-down, CD)
- LADDER @ Zone N
- TEST @ Zone N
- EXTENSION @ Zone N

Metadata lines (one per line, right after the section header):
- :20 rest (means 20 seconds rest between reps)
- 1:00 rest (means 60 seconds rest after section)
- paddles + pull buoy (equipment line)
- 2 rounds: (followed by the rep lines on subsequent lines)
- :30 between rounds

Rep formats (each on its own line):
- Dash-separated distances: 108-72-36-72-108
- Multiplied reps: 4x216 or 4x108 or 3 x 100
- Single distances: 108m free or 72m kick or 216

CRITICAL RULES:
1. Each section MUST start with one of the section headers above on its own line.
2. Zone info goes in the section header (MAIN SET — Zone 3), NOT on individual rep lines.
3. Rest info goes on its own line right after the header (:20 rest).
4. Rep lines must contain ONLY distances and simple stroke descriptions — no zone annotations on the rep line itself.
5. If the input mentions zones within a section that change per rep, split into separate sections for each zone.
6. Use the exact distance numbers from the input — do NOT convert or round distances.
7. "on 1:30" or "@ 1:30" style interval targets should be REMOVED (the app calculates its own targets from CSS/FTP).
8. Preserve round structure: "4 rounds" becomes "4 rounds:" on its own line before the reps.
9. If you see "build" or "descend", keep it as a note (e.g., "4x36 build to Z3, :10 rest").
10. Keep warm-up and cool-down items as simple distance + stroke lines (e.g., "108m free", "72m kick").
11. If the input has no clear section headers, infer them from context: look for warm-up patterns, main set patterns, pull set mentions, and cool-down patterns.
12. Pool-specific distances (36, 72, 108, 144, 216 for 36m pool; 25, 50, 100, 200, etc. for 25m/25yd pool) should be kept as-is.

EXAMPLE INPUT (messy):
"warmup - 200 free, 100 back, 100 choice
then do 4x50 building to fast on 10 sec rest
main - zone 3, 20 sec rest between each
200-100-50-100-200-100-50-100-200
pull w/ paddles and buoy zone 2 - 4 x 200 on 20 rest
cooldown 100 back 100 easy"

EXAMPLE OUTPUT (clean):
WARM-UP
200 free
100 back
100 choice
4x50 build, :10 rest

MAIN SET — Zone 3
:20 rest
200-100-50-100-200-100-50-100-200

PULL SET — Zone 2
paddles + pull buoy, :20 rest
4x200

COOL-DOWN
100 back
100 easy free`;

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
