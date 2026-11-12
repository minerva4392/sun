const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const { randomUUID } = require('node:crypto');
const { WebSocketServer, WebSocket } = require('ws');
const { Redis } = require('@upstash/redis');

const root = __dirname;
const port = Number(process.env.PORT || 3000);
const answers = [1, 2, 0];
const localRooms = new Map();
const redis = process.env.KV_REST_API_URL && process.env.KV_REST_API_TOKEN
  ? new Redis({ url: process.env.KV_REST_API_URL, token: process.env.KV_REST_API_TOKEN })
  : null;
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

function key(code) { return `bomb-room:${code}`; }
function send(ws, type, data = {}) { if (ws.readyState === WebSocket.OPEN) ws.send(JSON.stringify({ type, ...data })); }
function decodeRoom(value) { return typeof value === 'string' ? JSON.parse(value) : value; }
async function getRoom(code) {
  return redis ? decodeRoom(await redis.get(key(code))) : localRooms.get(code) || null;
}
async function putRoom(room) {
  if (redis) await redis.set(key(room.code), JSON.stringify(room), { ex: 86400 });
  else localRooms.set(room.code, room);
}
async function createRoom(room) {
  if (!redis) { if (localRooms.has(room.code)) return false; localRooms.set(room.code, room); return true; }
  return (await redis.set(key(room.code), JSON.stringify(room), { nx: true, ex: 86400 })) === 'OK';
}
async function updateRoom(code, update) {
  if (!redis) {
    const room = localRooms.get(code);
    if (!room) return { error: '방 코드를 찾을 수 없어요.' };
    const result = update(room);
    await putRoom(room);
    return { room, result };
  }
  const lockKey = `bomb-room-lock:${code}`;
  const token = randomUUID();
  let locked = false;
  for (let attempt = 0; attempt < 25; attempt++) {
    if (await redis.set(lockKey, token, { nx: true, ex: 10 }) === 'OK') { locked = true; break; }
    await new Promise(resolve => setTimeout(resolve, 80));
  }
  if (!locked) return { error: '방 상태를 갱신하고 있어요. 다시 눌러 주세요.' };
  try {
    const room = await getRoom(code);
    if (!room) return { error: '방 코드를 찾을 수 없어요.' };
    const result = update(room);
    await putRoom(room);
    return { room, result };
  } finally {
    await redis.eval("if redis.call('get', KEYS[1]) == ARGV[1] then return redis.call('del', KEYS[1]) else return 0 end", [lockKey], [token]);
  }
}
function publicState(room, playerId) {
  const timeLeft = room.status === 'playing' ? Math.max(0, Math.ceil((room.endsAt - Date.now()) / 1000)) : room.timeLeft;
  return { code: room.code, players: room.players.map(p => ({ name: p.name, role: p.role, connected: p.connected })), host: room.host, isHost: room.host === playerId, started: room.status === 'playing', round: room.round, timeLeft, strikes: room.strikes, status: room.status };
}
function addEvent(room, event) {
  room.eventId = (room.eventId || 0) + 1;
  room.events.push({ id: room.eventId, ...event });
  if (room.events.length > 20) room.events.splice(0, room.events.length - 20);
}
function broadcast(room) {
  for (const ws of wss.clients) {
    if (ws.readyState !== WebSocket.OPEN || ws.roomCode !== room.code) continue;
    send(ws, 'state', publicState(room, ws.id));
    const cursor = ws.eventCursor ?? room.eventId;
    for (const event of room.events) {
      if (event.id > cursor && event.target === ws.role) send(ws, event.type, { text: event.text, from: event.from });
    }
    ws.eventCursor = room.eventId;
  }
}
function makeCode() { return Math.random().toString(36).slice(2, 7).toUpperCase(); }
async function remove(ws) {
  if (!ws.roomCode) return;
  const code = ws.roomCode; ws.roomCode = null;
  const result = await updateRoom(code, room => {
    room.players = room.players.filter(p => p.id !== ws.id);
    if (!room.players.length) return 'empty';
    if (room.host === ws.id) room.host = room.players[0].id;
    if (room.status === 'playing') { room.status = 'paused'; room.endsAt = null; }
    return 'updated';
  });
  if (!result.room || result.result === 'empty') {
    if (redis) await redis.del(key(code)); else localRooms.delete(code);
    return;
  }
  broadcast(result.room);
}
async function syncConnectedRooms() {
  const codes = new Set([...wss.clients].filter(ws => ws.roomCode).map(ws => ws.roomCode));
  for (const code of codes) {
    let room = await getRoom(code);
    if (!room) continue;
    if (room.status === 'playing' && room.endsAt <= Date.now()) {
      await updateRoom(code, current => { if (current.status === 'playing' && current.endsAt <= Date.now()) { current.status = 'failed'; current.endsAt = null; } });
      room = await getRoom(code);
    }
    if (room) broadcast(room);
  }
}
wss.on('connection', ws => {
  ws.id = randomUUID();
  ws.on('message', async raw => {
    let msg; try { msg = JSON.parse(raw.toString()); } catch { return; }
    if (msg.type === 'create') {
      if (ws.roomCode) return;
      const role = ['blind', 'mute', 'deaf'].includes(msg.role) ? msg.role : '';
      const name = String(msg.name || '').trim().slice(0, 18);
      if (!role || !name) { send(ws, 'error', { message: '이름과 역할을 입력해 주세요.' }); return; }
      let room, created = false;
      for (let attempt = 0; attempt < 5 && !created; attempt++) {
        const code = makeCode();
        room = { code, players: [{ id: ws.id, name, role, connected: true }], host: ws.id, status: 'waiting', round: 0, timeLeft: 120, endsAt: null, strikes: 0, eventId: 0, events: [] };
        created = await createRoom(room);
      }
      if (!created) { send(ws, 'error', { message: '방을 만들지 못했어요. 다시 시도해 주세요.' }); return; }
      ws.roomCode = room.code; ws.name = name; ws.role = role; ws.eventCursor = room.eventId;
      send(ws, 'joined', { code: room.code, role, host: true }); broadcast(room); return;
    }
    if (msg.type === 'join') {
      if (ws.roomCode) return;
      const code = String(msg.code || '').trim().toUpperCase();
      const role = ['blind', 'mute', 'deaf'].includes(msg.role) ? msg.role : '';
      const name = String(msg.name || '').trim().slice(0, 18);
      if (!role || !name) { send(ws, 'error', { message: '이름과 역할을 입력해 주세요.' }); return; }
      const result = await updateRoom(code, room => {
        if (room.players.length >= 3) return '방이 가득 찼어요.';
        if (room.players.some(p => p.role === role)) return '그 역할은 이미 선택됐어요.';
        if (room.status === 'playing') return '게임이 이미 시작됐어요.';
        room.players.push({ id: ws.id, name, role, connected: true });
        return 'joined';
      });
      if (result.error || typeof result.result === 'string' && result.result !== 'joined') { send(ws, 'error', { message: result.error || result.result }); return; }
      ws.roomCode = code; ws.name = name; ws.role = role; ws.eventCursor = result.room.eventId;
      send(ws, 'joined', { code, role, host: result.room.host === ws.id }); broadcast(result.room); return;
    }
    if (!ws.roomCode) return;
    const code = ws.roomCode;
    const result = await updateRoom(code, room => {
      const player = room.players.find(p => p.id === ws.id);
      if (!player) return 'not-player';
      if (msg.type === 'start') {
        if (room.host !== ws.id || room.players.length !== 3 || room.status === 'playing') return 'ignored';
        room.round = 0; room.timeLeft = 120; room.strikes = 0; room.status = 'playing'; room.endsAt = Date.now() + 120000; return 'updated';
      }
      if (msg.type === 'message' && player.role === 'mute' && room.status === 'playing') {
        addEvent(room, { type: 'team-message', target: 'deaf', text: String(msg.text || '').slice(0, 50), from: player.name }); return 'updated';
      }
      if (msg.type === 'guide' && player.role === 'deaf' && room.status === 'playing') {
        addEvent(room, { type: 'guide', target: 'blind', text: String(msg.text || '').slice(0, 50), from: player.name }); return 'updated';
      }
      if (msg.type === 'answer' && player.role === 'blind' && room.status === 'playing') {
        const choice = Number(msg.choice);
        if (![0, 1, 2].includes(choice)) return 'ignored';
        if (room.endsAt <= Date.now()) { room.status = 'failed'; room.endsAt = null; return 'updated'; }
        if (choice === answers[room.round]) {
          room.round++;
          if (room.round >= answers.length) { room.status = 'won'; room.endsAt = null; }
        } else {
          room.strikes++;
          if (room.strikes >= 3) { room.status = 'failed'; room.endsAt = null; }
        }
        return 'updated';
      }
      return 'ignored';
    });
    if (result.room) broadcast(result.room);
  });
  ws.on('close', () => { remove(ws).catch(() => {}); });
  ws.on('error', () => { remove(ws).catch(() => {}); });
});
setInterval(() => { syncConnectedRooms().catch(error => console.error('Room sync failed:', error.message)); }, 1000);

if (require.main === module) server.listen(port, '0.0.0.0', () => console.log(`Countdown Club listening on ${port}${redis ? ' with Redis room sync' : ''}`));
module.exports = server;
