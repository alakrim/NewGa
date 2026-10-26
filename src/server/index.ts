import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';
import { readFile, stat } from 'node:fs/promises';
import { extname, join, normalize } from 'node:path';
import { randomBytes } from 'node:crypto';
import { WebSocketServer, WebSocket } from 'ws';
import type { ClientMsg, LobbySlot, RoomInfo, ServerMsg } from '../shared/protocol';
import type { Team } from '../shared/types';
import { MAX_PLAYERS_PER_TEAM, TICK_RATE } from '../shared/constants';
import { HEROES } from '../shared/data/heroes';
import { Game, type PlayerSetup } from '../shared/sim/game';

const PORT = Number(process.env.PORT ?? 8787);
const STATIC_DIR = process.env.STATIC_DIR ?? new URL('./client/', import.meta.url).pathname;

// ------------------------------------------------------------------ static files (production build)
const MIME: Record<string, string> = {
  '.html': 'text/html; charset=utf-8', '.js': 'text/javascript', '.css': 'text/css', '.json': 'application/json', '.png': 'image/png',
  '.jpg': 'image/jpeg', '.webp': 'image/webp', '.svg': 'image/svg+xml', '.glb': 'model/gltf-binary', '.gltf': 'model/gltf+json',
  '.bin': 'application/octet-stream', '.ico': 'image/x-icon', '.woff2': 'font/woff2', '.mp3': 'audio/mpeg', '.ogg': 'audio/ogg',
};

async function serveStatic(req: IncomingMessage, res: ServerResponse) {
  const url = new URL(req.url ?? '/', 'http://x');
  if (url.pathname === '/health') { res.writeHead(200, { 'content-type': 'text/plain' }); res.end(`ok ${rooms.size} rooms`); return; }
  let path = normalize(decodeURIComponent(url.pathname)).replace(/^(\.\.[/\\])+/, '');
  if (path.endsWith('/')) path += 'index.html';
  let file = join(STATIC_DIR, path);
  try {
    if (!(await stat(file)).isFile()) throw new Error();
  } catch {
    file = join(STATIC_DIR, 'index.html');
  }
  try {
    const body = await readFile(file);
    const ext = extname(file);
    res.writeHead(200, { 'content-type': MIME[ext] ?? 'application/octet-stream', 'cache-control': ext === '.html' ? 'no-cache' : 'public, max-age=86400' });
    res.end(body);
  } catch {
    res.writeHead(404, { 'content-type': 'text/plain' });
    res.end('Not found. Run `npm run build` first, or use `npm run dev`.');
  }
}

// ------------------------------------------------------------------ rooms
interface Client { ws: WebSocket | null; pid: string; name: string; room: Room | null }
interface Room {
  code: string;
  host: string;
  slots: LobbySlot[];
  fillBots: boolean;
  teamSize: number;
  game: Game | null;
  loop: NodeJS.Timeout | null;
  endedAt: number;
  clients: Map<string, Client>;
}

const rooms = new Map<string, Room>();
const clients = new Map<string, Client>();
const newId = () => randomBytes(6).toString('base64url');
const send = (c: Client, m: ServerMsg) => { if (c.ws && c.ws.readyState === WebSocket.OPEN) c.ws.send(JSON.stringify(m)); };

function roomCode(): string {
  const A = 'ABCDEFGHJKLMNPQRSTUVWXYZ';
  for (;;) {
    const c = Array.from({ length: 4 }, () => A[Math.floor(Math.random() * A.length)]).join('');
    if (!rooms.has(c)) return c;
  }
}

function info(r: Room): RoomInfo {
  return { code: r.code, host: r.host, slots: r.slots, started: !!r.game, fillBots: r.fillBots, teamSize: r.teamSize };
}
function broadcastRoom(r: Room) { for (const c of r.clients.values()) send(c, { t: 'room', room: info(r) }); }

function teamCount(r: Room, team: Team) { return r.slots.filter((s) => s.team === team).length; }

function joinRoom(c: Client, r: Room) {
  if (c.room && c.room !== r) leaveRoom(c);
  c.room = r;
  r.clients.set(c.pid, c);
  if (!r.slots.some((s) => s.pid === c.pid)) {
    if (r.game) {
      // late join: spectate is not supported yet, so take over a bot if one exists
      const bot = r.slots.find((s) => s.bot);
      if (!bot) { send(c, { t: 'error', msg: 'Match in progress and no bot slot to take over.' }); return; }
      const oldPid = bot.pid;
      r.game.players.forEach((p) => { if (p.playerId === oldPid) { p.playerId = c.pid; p.name = c.name; p.bot = false; } });
      const u = r.game.heroOf(c.pid);
      if (u?.hero) { u.hero.pid = c.pid; u.hero.pname = c.name; }
      r.game.setBot(c.pid, false);
      bot.pid = c.pid; bot.name = c.name; bot.bot = false;
    } else {
      const team: Team = teamCount(r, 0) <= teamCount(r, 1) ? 0 : 1;
      if (teamCount(r, team) >= MAX_PLAYERS_PER_TEAM) { send(c, { t: 'error', msg: 'Room is full.' }); return; }
      r.slots.push({ pid: c.pid, name: c.name, team, heroId: null, bot: false, ready: false });
    }
  } else if (r.game) r.game.setBot(c.pid, false);
  broadcastRoom(r);
  if (r.game) send(c, { t: 'init', init: r.game.init(c.pid) });
}

function leaveRoom(c: Client) {
  const r = c.room;
  if (!r) return;
  c.room = null;
  r.clients.delete(c.pid);
  if (r.game) r.game.setBot(c.pid, true); // a bot takes over until they come back
  else r.slots = r.slots.filter((s) => s.pid !== c.pid);
  if (r.host === c.pid) r.host = [...r.clients.keys()][0] ?? '';
  if (!r.clients.size) {
    if (r.loop) clearInterval(r.loop);
    rooms.delete(r.code);
    return;
  }
  broadcastRoom(r);
}

function startGame(r: Room) {
  const taken = new Set(r.slots.map((s) => s.heroId).filter(Boolean) as string[]);
  const pickFree = () => {
    const free = HEROES.filter((h) => !taken.has(h.id));
    const h = (free.length ? free : HEROES)[Math.floor(Math.random() * (free.length || HEROES.length))];
    taken.add(h.id);
    return h.id;
  };
  if (r.fillBots) {
    const size = Math.min(MAX_PLAYERS_PER_TEAM, Math.max(r.teamSize, teamCount(r, 0), teamCount(r, 1)));
    for (const team of [0, 1] as Team[]) {
      let n = 1;
      while (teamCount(r, team) < size) r.slots.push({ pid: `bot-${newId()}`, name: `Bot ${team === 0 ? 'Dawn' : 'Dusk'} ${n++}`, team, heroId: null, bot: true, ready: true });
    }
  }
  for (const s of r.slots) if (!s.heroId) s.heroId = pickFree();
  const setups: PlayerSetup[] = r.slots.map((s) => ({ pid: s.pid, name: s.name, team: s.team, heroId: s.heroId!, bot: s.bot }));
  const game = new Game(setups, Math.floor(Math.random() * 1e9));
  r.game = game;
  r.endedAt = 0;
  for (const c of r.clients.values()) send(c, { t: 'init', init: game.init(c.pid) });
  broadcastRoom(r);
  r.loop = setInterval(() => {
    game.step();
    for (const c of r.clients.values()) {
      const p = game.players.find((x) => x.playerId === c.pid);
      send(c, { t: 'snap', s: game.snapshot(c.pid, p?.team ?? 0) });
    }
    game.flushEvents();
    if (game.winner !== null) {
      if (!r.endedAt) r.endedAt = Date.now();
      else if (Date.now() - r.endedAt > 3000 && r.loop) { clearInterval(r.loop); r.loop = null; }
    }
  }, 1000 / TICK_RATE);
}

function handle(c: Client, m: ClientMsg) {
  const r = c.room;
  switch (m.t) {
    case 'create': {
      c.name = clean(m.name);
      const room: Room = { code: roomCode(), host: c.pid, slots: [], fillBots: true, teamSize: 3, game: null, loop: null, endedAt: 0, clients: new Map() };
      rooms.set(room.code, room);
      joinRoom(c, room);
      return;
    }
    case 'join': {
      c.name = clean(m.name);
      const room = rooms.get(m.code.trim().toUpperCase());
      if (!room) { send(c, { t: 'error', msg: `No room with code ${m.code}` }); return; }
      joinRoom(c, room);
      return;
    }
    case 'leave': leaveRoom(c); send(c, { t: 'room', room: { code: '', host: '', slots: [], started: false, fillBots: false, teamSize: 0 } }); return;
    case 'ping': send(c, { t: 'pong', ts: m.ts }); return;
  }
  if (!r) return;
  const slot = r.slots.find((s) => s.pid === c.pid);
  switch (m.t) {
    case 'team':
      if (r.game || !slot || slot.team === m.team || teamCount(r, m.team) >= MAX_PLAYERS_PER_TEAM) return;
      slot.team = m.team;
      break;
    case 'hero':
      if (r.game || !slot || !HEROES.some((h) => h.id === m.heroId)) return;
      if (r.slots.some((s) => s.heroId === m.heroId && s.team === slot.team && s.pid !== c.pid)) { send(c, { t: 'error', msg: 'A teammate already picked that hero.' }); return; }
      slot.heroId = m.heroId;
      break;
    case 'ready': if (slot) slot.ready = m.ready; break;
    case 'addBot':
      if (r.game || c.pid !== r.host || teamCount(r, m.team) >= MAX_PLAYERS_PER_TEAM) return;
      r.slots.push({ pid: `bot-${newId()}`, name: `Bot ${r.slots.filter((s) => s.bot).length + 1}`, team: m.team, heroId: null, bot: true, ready: true });
      break;
    case 'removeBot':
      if (r.game || c.pid !== r.host) return;
      r.slots = r.slots.filter((s) => !(s.bot && s.pid === m.pid));
      break;
    case 'fillBots':
      if (c.pid !== r.host) return;
      r.fillBots = m.on;
      if (m.teamSize) r.teamSize = Math.max(1, Math.min(MAX_PLAYERS_PER_TEAM, m.teamSize));
      break;
    case 'start':
      if (r.game || c.pid !== r.host) return;
      startGame(r);
      return;
    case 'lobbyReturn':
      if (c.pid !== r.host || !r.game || r.game.winner === null) return;
      if (r.loop) clearInterval(r.loop);
      r.loop = null;
      r.game = null;
      r.slots = r.slots.filter((s) => !s.bot || false).filter((s) => r.clients.has(s.pid));
      r.slots.forEach((s) => (s.ready = false));
      break;
    case 'cmd':
      r.game?.command(c.pid, m.cmd);
      return;
    case 'chat': {
      const text = m.text.slice(0, 200).trim();
      if (!text) return;
      const team = (slot?.team ?? 0) as Team;
      for (const o of r.clients.values()) {
        const os = r.slots.find((s) => s.pid === o.pid);
        if (!m.team || os?.team === team) send(o, { t: 'chat', from: c.name, text, team: m.team, teamId: team });
      }
      return;
    }
  }
  broadcastRoom(r);
}

const clean = (n: string) => (n || 'Hero').replace(/[^\p{L}\p{N} _\-.]/gu, '').slice(0, 16) || 'Hero';

// ------------------------------------------------------------------ boot
const server = createServer((req, res) => void serveStatic(req, res));
const wss = new WebSocketServer({ server, path: '/ws', perMessageDeflate: { threshold: 512 } });

wss.on('connection', (ws, req) => {
  const url = new URL(req.url ?? '/', 'http://x');
  const want = url.searchParams.get('pid');
  let c = want ? clients.get(want) : undefined;
  if (c && c.ws && c.ws.readyState === WebSocket.OPEN) c = undefined; // pid in use
  if (!c) {
    c = { ws, pid: want && /^[\w-]{6,16}$/.test(want) && !clients.has(want) ? want : newId(), name: 'Hero', room: null };
    clients.set(c.pid, c);
  } else c.ws = ws;
  const client = c;
  send(client, { t: 'welcome', pid: client.pid });
  if (client.room) joinRoom(client, client.room);
  ws.on('message', (data) => {
    let m: ClientMsg;
    try { m = JSON.parse(String(data)); } catch { return; }
    try { handle(client, m); } catch (err) { console.error('handler error', err); }
  });
  ws.on('close', () => {
    client.ws = null;
    const r = client.room;
    if (r) {
      if (r.game) r.game.setBot(client.pid, true);
      // keep the seat for 60s so a refresh can rejoin; then free it
      setTimeout(() => { if (!client.ws) { leaveRoom(client); clients.delete(client.pid); } }, 60_000);
    } else clients.delete(client.pid);
  });
});

server.listen(PORT, () => console.log(`Bannerfall server on http://localhost:${PORT} (ws /ws)`));
