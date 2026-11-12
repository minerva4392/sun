const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const { WebSocketServer, WebSocket } = require('ws');

const root = __dirname;
const port = Number(process.env.PORT || 3000);
const rounds = [1, 2, 0];
const rooms = new Map();
const mime = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.json': 'application/json; charset=utf-8' };
const server = http.createServer((req, res) => {
  const pathname = decodeURIComponent(new URL(req.url, 'http://localhost').pathname);
  if (pathname === '/network-addresses') {
    const addresses = Object.values(os.networkInterfaces()).flat().filter(x => x && x.family === 'IPv4' && !x.internal).map(x => x.address);
    res.writeHead(200, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' }).end(JSON.stringify({ addresses })); return;
  }
  const file = path.resolve(root, `.${pathname === '/' ? '/index.html' : pathname}`);
  if (!file.startsWith(root + path.sep) && file !== path.join(root, 'index.html')) { res.writeHead(403).end(); return; }
  fs.readFile(file, (err, data) => {
    if (err) { res.writeHead(404).end('Not found'); return; }
    res.writeHead(200, { 'content-type': mime[path.extname(file)] || 'application/octet-stream', 'cache-control': 'no-store' }).end(data);
  });
});
const wss = new WebSocketServer({ server, path: '/api/ws', perMessageDeflate: false, maxPayload: 2048 });

function send(ws, type, data = {}) { if (ws.readyState === WebSocket.OPEN) ws.send(JSON.stringify({ type, ...data })); }
function publicState(room) {
  return { code: room.code, players: [...room.players.values()].map(p => ({ name: p.name, role: p.role, connected: p.ws.readyState === WebSocket.OPEN })), host: room.host, started: room.started, round: room.round, timeLeft: room.timeLeft, strikes: room.strikes, status: room.status };
}
function broadcast(room) { const state = publicState(room); for (const p of room.players.values()) send(p.ws, 'state', { ...state, isHost: p.ws.id === room.host }); }
function end(room, status) { clearInterval(room.clock); room.clock = null; room.started = false; room.status = status; broadcast(room); }
function remove(ws) {
  const room = ws.room; if (!room) return;
  room.players.delete(ws.id); ws.room = null;
  if (!room.players.size) { clearInterval(room.clock); rooms.delete(room.code); return; }
  if (room.host === ws.id) room.host = room.players.keys().next().value;
  if (room.started) end(room, 'paused'); else broadcast(room);
}
wss.on('connection', ws => {
  ws.id = Math.random().toString(36).slice(2);
  ws.on('message', raw => {
    let msg; try { msg = JSON.parse(raw.toString()); } catch { return; }
    if (msg.type === 'create' || msg.type === 'join') {
      if (ws.room) return;
      let room;
      if (msg.type === 'create') {
        let code; do { code = Math.random().toString(36).slice(2, 7).toUpperCase(); } while (rooms.has(code));
        room = { code, players: new Map(), host: ws.id, started: false, round: 0, timeLeft: 120, strikes: 0, status: 'waiting', clock: null };
        rooms.set(code, room);
      } else room = rooms.get(String(msg.code || '').toUpperCase());
      const role = ['blind', 'mute', 'deaf'].includes(msg.role) ? msg.role : '';
      const name = String(msg.name || '').trim().slice(0, 18);
      if (!room) { send(ws, 'error', { message: '방 코드를 찾을 수 없어요.' }); return; }
      if (!role || !name) { send(ws, 'error', { message: '이름과 역할을 입력해 주세요.' }); return; }
      if (room.players.size >= 3) { send(ws, 'error', { message: '방이 가득 찼어요.' }); return; }
      if ([...room.players.values()].some(p => p.role === role)) { send(ws, 'error', { message: '그 역할은 이미 선택됐어요.' }); return; }
      if (room.started) { send(ws, 'error', { message: '게임이 이미 시작됐어요.' }); return; }
      ws.room = room; room.players.set(ws.id, { ws, name, role });
      send(ws, 'joined', { code: room.code, role, host: room.host === ws.id }); broadcast(room); return;
    }
    const room = ws.room; if (!room) return;
    const player = room.players.get(ws.id); if (!player) return;
    if (msg.type === 'start') {
      if (room.host !== ws.id || room.players.size !== 3 || room.started) return;
      room.round = 0; room.timeLeft = 120; room.strikes = 0; room.status = 'playing'; room.started = true; broadcast(room);
      room.clock = setInterval(() => { if (!room.started) return; room.timeLeft--; if (room.timeLeft <= 0) end(room, 'failed'); else broadcast(room); }, 1000); return;
    }
    if (msg.type === 'reset' && room.host === ws.id) { clearInterval(room.clock); room.clock = null; room.started = false; room.round = 0; room.timeLeft = 120; room.strikes = 0; room.status = 'waiting'; broadcast(room); return; }
    if (msg.type === 'message' && player.role === 'mute' && room.started) {
      const text = String(msg.text || '').slice(0, 50); if (!text) return;
      for (const p of room.players.values()) if (p.role === 'deaf') send(p.ws, 'team-message', { text, from: player.name }); return;
    }
    if (msg.type === 'guide' && player.role === 'deaf' && room.started) {
      const text = String(msg.text || '').slice(0, 50); if (!text) return;
      for (const p of room.players.values()) if (p.role === 'blind') send(p.ws, 'guide', { text, from: player.name }); return;
    }
    if (msg.type === 'answer' && player.role === 'blind' && room.started) {
      const choice = Number(msg.choice); if (![0, 1, 2].includes(choice)) return;
      if (choice === rounds[room.round]) {
        room.round++; if (room.round >= rounds.length) { end(room, 'won'); return; }
      } else { room.strikes++; if (room.strikes >= 3) { end(room, 'failed'); return; } }
      broadcast(room);
    }
  });
  ws.on('close', () => remove(ws)); ws.on('error', () => remove(ws));
});
if (require.main === module) server.listen(port, '0.0.0.0', () => console.log(`Countdown Club listening on ${port}`));
module.exports = server;
