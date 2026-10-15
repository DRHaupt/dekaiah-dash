// Talking to the server: normal requests and the live connection.

let getToken = async () => null;

export function setTokenSource(fn) {
  getToken = fn;
}

export async function api(method, path, body) {
  const token = await getToken();
  const res = await fetch('/api' + path, {
    method,
    headers: {
      ...(body ? { 'Content-Type': 'application/json' } : {}),
      ...(token ? { Authorization: 'Bearer ' + token } : {}),
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  let data = null;
  try { data = await res.json(); } catch { /* empty reply */ }
  if (!res.ok) throw new Error((data && data.error) || "Couldn't reach the server. Check your connection.");
  return data;
}

// Keeps a live connection open and reconnects if it drops.
// onMessage gets every update; onReconnect runs after a reconnect so screens can catch up.
let socket = null;
let stopped = false;

export function connectLive(onMessage, onReconnect) {
  stopped = false;
  let attempt = 0;
  let first = true;

  const open = async () => {
    if (stopped) return;
    const proto = location.protocol === 'https:' ? 'wss:' : 'ws:';
    socket = new WebSocket(`${proto}//${location.host}/live`);
    socket.onopen = async () => {
      socket.send(JSON.stringify({ type: 'hello', token: await getToken() }));
    };
    socket.onmessage = (e) => {
      const msg = JSON.parse(e.data);
      if (msg.type === 'ready') {
        attempt = 0;
        if (!first) onReconnect();
        first = false;
        return;
      }
      onMessage(msg);
    };
    socket.onclose = () => {
      socket = null;
      if (stopped) return;
      attempt++;
      setTimeout(open, Math.min(30000, 1000 * 2 ** Math.min(attempt, 5)));
    };
  };
  open();

  // Phones pause pages in the background, so check the connection when the app comes back.
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState !== 'visible' || stopped) return;
    if (!socket || socket.readyState > 1) open();
    else onReconnect();
  });
}

export function sendLive(data) {
  if (socket && socket.readyState === 1) socket.send(JSON.stringify(data));
}

export function stopLive() {
  stopped = true;
  if (socket) socket.close();
}
