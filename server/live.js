// Live updates over WebSockets. Each open app tab keeps one connection.
const { WebSocketServer } = require('ws');
const db = require('./db');
const auth = require('./auth');

const sockets = new Map(); // user id -> Set of open sockets
let onDriverLocation = () => {};

function start(server, handlers) {
  onDriverLocation = handlers.onDriverLocation;
  const wss = new WebSocketServer({ server, path: '/live' });

  wss.on('connection', (ws) => {
    let userId = null;

    ws.on('message', async (raw) => {
      let msg;
      try { msg = JSON.parse(raw); } catch { return; }

      // The first message must be the login token.
      if (msg.type === 'hello') {
        try {
          const login = await auth.verifyToken(msg.token);
          const user = await db.one('SELECT id, role FROM users WHERE firebase_uid = $1', [login.uid]);
          if (!user) return ws.close();
          userId = user.id;
          ws.role = user.role;
          if (!sockets.has(userId)) sockets.set(userId, new Set());
          sockets.get(userId).add(ws);
          ws.send(JSON.stringify({ type: 'ready' }));
        } catch {
          ws.close();
        }
        return;
      }

      if (msg.type === 'location' && userId && ws.role === 'driver') {
        const lat = Number(msg.lat), lng = Number(msg.lng);
        if (Number.isFinite(lat) && Number.isFinite(lng)) onDriverLocation(lat, lng).catch(console.error);
      }
    });

    ws.on('close', () => {
      if (userId && sockets.has(userId)) {
        sockets.get(userId).delete(ws);
        if (sockets.get(userId).size === 0) sockets.delete(userId);
      }
    });
  });

  // Drop dead connections every 30 seconds.
  setInterval(() => {
    for (const ws of wss.clients) {
      if (ws.isAlive === false) { ws.terminate(); continue; }
      ws.isAlive = false;
      ws.ping();
    }
  }, 30000);
  wss.on('connection', (ws) => { ws.isAlive = true; ws.on('pong', () => { ws.isAlive = true; }); });
}

function send(userId, data) {
  const set = sockets.get(userId);
  if (!set) return;
  const text = JSON.stringify(data);
  for (const ws of set) if (ws.readyState === 1) ws.send(text);
}

function isConnected(userId) {
  return sockets.has(userId);
}

module.exports = { start, send, isConnected };
