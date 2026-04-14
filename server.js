const express = require('express');
const http = require('http');
const { WebSocketServer } = require('ws');
const os = require('os');

const app = express();
const server = http.createServer(app);
const wss = new WebSocketServer({ server });

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

const PORT = 3000;
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
