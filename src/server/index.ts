import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';
import type { AddressInfo } from 'node:net';
import { readFile, stat } from 'node:fs/promises';
import { extname, join, normalize, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { randomBytes } from 'node:crypto';
import { WebSocketServer, WebSocket } from 'ws';
import type { ClientMsg, LobbySlot, RoomInfo, ServerMsg } from '../shared/protocol';
import type { Team } from '../shared/types';
import { MAX_PLAYERS_PER_TEAM, TICK_RATE } from '../shared/constants';
import { HEROES } from '../shared/data/heroes';
import { Game, type PlayerSetup } from '../shared/sim/game';

export interface ServerOptions {
  /** Listen port (0 = pick a free one). Defaults to $PORT or 8787. */
  port?: number;
  /** Directory with the built client. Defaults to $STATIC_DIR or ./client next to this file. May be missing. */
  staticDir?: string;
  /** How long a dropped player keeps their seat before it is freed (ms). */
  graceMs?: number;
}
export interface RunningServer { port: number; close(): Promise<void> }

let STATIC_DIR = process.env.STATIC_DIR ?? new URL('./client/', import.meta.url).pathname;
let GRACE_MS = 60_000;

// ------------------------------------------------------------------ static files (production build)
const MIME: Record<string, string> = {
  '.html': 'text/html; charset=utf-8', '.js': 'text/javascript', '.css': 'text/css', '.json': 'application/json', '.png': 'image/png',
  '.jpg': 'image/jpeg', '.webp': 'image/webp', '.svg': 'image/svg+xml', '.glb': 'model/gltf-binary', '.gltf': 'model/gltf+json',
  '.bin': 'application/octet-stream', '.ico': 'image/x-icon', '.woff2': 'font/woff2', '.mp3': 'audio/mpeg', '.ogg': 'audio/ogg',
};

async function serveStatic(req: IncomingMessage, res: ServerResponse) {
  const url = new URL(req.url ?? '/', 'http://x');
  if (url.pathname === '/health') { res.writeHead(200, { 'content-type': 'text/plain' }); res.end(`ok ${rooms.size} rooms`); return; }
  let path: string;
  try { path = normalize(decodeURIComponent(url.pathname)); } catch { res.writeHead(400); res.end('Bad request'); return; }
  if (path.endsWith('/')) path += 'index.html';
  let file = join(STATIC_DIR, path);
  if (!file.startsWith(STATIC_DIR.replace(/\/$/, ''))) { res.writeHead(403); res.end('Forbidden'); return; }
  try {
    if (!(await stat(file)).isFile()) throw new Error();
  } catch {
    // SPA fallback only for page routes (?room=CODE etc.), not for missing assets
    if (extname(path) && extname(path) !== '.html') { res.writeHead(404, { 'content-type': 'text/plain' }); res.end('Not found'); return; }
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
interface Client { ws: WebSocket | null; pid: string; name: string; room: Room | null; timer: NodeJS.Timeout | null; alive: boolean; missed: number }
interface Room {
  code: string;
  host: string;
  slots: LobbySlot[];
  /** pids of bots that were auto-added at match start (removed again when returning to the lobby) */
  autoBots: Set<string>;
  fillBots: boolean;
  teamSize: number;
  game: Game | null;
  loop: NodeJS.Timeout | null;
  endedAt: number;
  clients: Map<string, Client>;
}

const rooms = new Map<string, Room>();
const clients = new Map<string, Client>();
/** Exposed for tests only. */
export const _internals = { rooms, clients };
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
const humans = (r: Room, team: Team) => r.slots.filter((s) => s.team === team && !s.bot).length;

/** Make sure the host is someone who is actually connected (falls back to anyone still holding a seat). */
function ensureHost(r: Room) {
  const here = r.clients.get(r.host);
  if (here?.ws) return;
  const next = [...r.clients.values()].find((x) => x.ws) ?? [...r.clients.values()][0];
  r.host = next?.pid ?? '';
}

function joinRoom(c: Client, r: Room): boolean {
  const known = r.slots.some((s) => s.pid === c.pid);
  let takeover: LobbySlot | undefined;
  let team: Team = 0;
  if (!known) {
    if (r.game) {
      // late join: no spectating yet, so take over a bot (preferring the team with fewer humans)
      const bots = r.slots.filter((s) => s.bot);
      takeover = bots.sort((a, b) => humans(r, a.team) - humans(r, b.team))[0];
      if (!takeover) { send(c, { t: 'error', msg: 'Match in progress and no bot seat to take over.' }); return false; }
    } else {
      team = teamCount(r, 0) <= teamCount(r, 1) ? 0 : 1;
      if (teamCount(r, team) >= MAX_PLAYERS_PER_TEAM) team = team === 0 ? 1 : 0;
      if (teamCount(r, team) >= MAX_PLAYERS_PER_TEAM) { send(c, { t: 'error', msg: 'Room is full.' }); return false; }
    }
  }
  if (c.room && c.room !== r) leaveRoom(c);
  c.room = r;
  r.clients.set(c.pid, c);
  if (takeover) {
    const oldPid = takeover.pid;
    const g = r.game!;
    g.players.forEach((p) => { if (p.playerId === oldPid) { p.playerId = c.pid; p.name = c.name; } });
    const u = g.heroOf(c.pid);
    if (u?.hero) { u.hero.pid = c.pid; u.hero.pname = c.name; }
    g.setBot(c.pid, false);
    r.autoBots.delete(oldPid);
    takeover.pid = c.pid; takeover.name = c.name; takeover.bot = false;
  } else if (!known) {
    r.slots.push({ pid: c.pid, name: c.name, team, heroId: null, bot: false, ready: false });
  } else if (r.game) r.game.setBot(c.pid, false);
  if (!r.host || !r.clients.get(r.host)?.ws) r.host = c.pid; // an abandoned room is adopted by whoever arrives
  broadcastRoom(r);
  if (r.game) {
    send(c, { t: 'init', init: r.game.init(c.pid) });
    // the loop stops a few seconds after the end: give late arrivals the final state
    if (!r.loop) send(c, { t: 'snap', s: r.game.snapshot(c.pid, r.game.players.find((x) => x.playerId === c.pid)?.team ?? 0) });
    // teammates' init lists are stale after a takeover, so refresh everyone's roster
    if (takeover) for (const o of r.clients.values()) if (o !== c) send(o, { t: 'init', init: r.game.init(o.pid) });
  }
  return true;
}

function leaveRoom(c: Client) {
  const r = c.room;
  if (!r) return;
  c.room = null;
  r.clients.delete(c.pid);
  if (c.timer) { clearTimeout(c.timer); c.timer = null; }
  if (r.game) r.game.setBot(c.pid, true); // a bot takes over (the seat stays reserved for a rejoin)
  else r.slots = r.slots.filter((s) => s.pid !== c.pid);
  if (r.host === c.pid) ensureHost(r);
  if (!r.clients.size) {
    if (r.loop) clearInterval(r.loop);
    r.loop = null;
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
      while (teamCount(r, team) < size) {
        const pid = `bot-${newId()}`;
        r.autoBots.add(pid);
        r.slots.push({ pid, name: `Bot ${team === 0 ? 'Dawn' : 'Dusk'} ${n++}`, team, heroId: null, bot: true, ready: true });
      }
    }
  }
  for (const s of r.slots) if (!s.heroId) s.heroId = pickFree();
  const setups: PlayerSetup[] = r.slots.map((s) => ({ pid: s.pid, name: s.name, team: s.team, heroId: s.heroId!, bot: s.bot || !r.clients.get(s.pid)?.ws }));
  const game = new Game(setups, Math.floor(Math.random() * 1e9));
  r.game = game;
  r.endedAt = 0;
  for (const c of r.clients.values()) send(c, { t: 'init', init: game.init(c.pid) });
  broadcastRoom(r);
  r.loop = setInterval(() => {
    try {
      game.step();
      for (const c of r.clients.values()) {
        if (!c.ws || c.ws.bufferedAmount > 4_000_000) continue; // gone or hopelessly behind
        const p = game.players.find((x) => x.playerId === c.pid);
        send(c, { t: 'snap', s: game.snapshot(c.pid, p?.team ?? 0) });
      }
      game.flushEvents();
    } catch (err) {
      console.error('game loop error', err);
    }
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
      const room: Room = { code: roomCode(), host: c.pid, slots: [], autoBots: new Set(), fillBots: true, teamSize: 3, game: null, loop: null, endedAt: 0, clients: new Map() };
      rooms.set(room.code, room);
      if (!joinRoom(c, room)) rooms.delete(room.code);
      return;
    }
    case 'join': {
      c.name = clean(m.name);
      const room = rooms.get(String(m.code ?? '').trim().toUpperCase());
      if (!room) { send(c, { t: 'error', msg: `No room with code ${String(m.code ?? '').toUpperCase()}` }); return; }
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
      if (r.game || !slot || slot.team === m.team || (m.team !== 0 && m.team !== 1) || teamCount(r, m.team) >= MAX_PLAYERS_PER_TEAM) return;
      slot.team = m.team;
      // the hero may already belong to a new teammate
      if (slot.heroId && r.slots.some((s) => s !== slot && s.team === slot.team && s.heroId === slot.heroId)) slot.heroId = null;
      break;
    case 'hero':
      if (r.game || !slot || !HEROES.some((h) => h.id === m.heroId)) return;
      if (r.slots.some((s) => s.heroId === m.heroId && s.team === slot.team && s.pid !== c.pid)) { send(c, { t: 'error', msg: 'A teammate already picked that hero.' }); broadcastRoom(r); return; }
      slot.heroId = m.heroId;
      break;
    case 'ready': if (slot) slot.ready = !!m.ready; break;
    case 'addBot':
      if (r.game || c.pid !== r.host || (m.team !== 0 && m.team !== 1) || teamCount(r, m.team) >= MAX_PLAYERS_PER_TEAM) return;
      r.slots.push({ pid: `bot-${newId()}`, name: `Bot ${r.slots.filter((s) => s.bot).length + 1}`, team: m.team, heroId: null, bot: true, ready: true });
      break;
    case 'removeBot':
      if (r.game || c.pid !== r.host) return;
      r.slots = r.slots.filter((s) => !(s.bot && s.pid === m.pid));
      break;
    case 'fillBots':
      if (r.game || c.pid !== r.host) return;
      r.fillBots = !!m.on;
      if (m.teamSize) r.teamSize = Math.max(1, Math.min(MAX_PLAYERS_PER_TEAM, Math.floor(Number(m.teamSize)) || 3));
      break;
    case 'start':
      if (r.game) return;
      if (c.pid !== r.host) { send(c, { t: 'error', msg: 'Only the host can start the match.' }); return; }
      if (!r.fillBots && (!teamCount(r, 0) || !teamCount(r, 1))) { send(c, { t: 'error', msg: 'Both teams need at least one player or bot.' }); return; }
      startGame(r);
      return;
    case 'lobbyReturn':
      if (c.pid !== r.host || !r.game || r.game.winner === null) return;
      if (r.loop) clearInterval(r.loop);
      r.loop = null;
      r.game = null;
      r.endedAt = 0;
      // drop auto-filled bots and anyone who left; humans keep their seat and hero
      r.slots = r.slots.filter((s) => (s.bot ? !r.autoBots.has(s.pid) : r.clients.has(s.pid)));
      r.autoBots.clear();
      r.slots.forEach((s) => (s.ready = false));
      break;
    case 'cmd':
      if (r.game && m.cmd && typeof m.cmd === 'object') r.game.command(c.pid, m.cmd);
      return;
    case 'chat': {
      const text = String(m.text ?? '').slice(0, 200).trim();
      if (!text) return;
      const team = (slot?.team ?? 0) as Team;
      for (const o of r.clients.values()) {
        const os = r.slots.find((s) => s.pid === o.pid);
        if (!m.team || os?.team === team) send(o, { t: 'chat', from: c.name, text, team: !!m.team, teamId: team });
      }
      return;
    }
  }
  broadcastRoom(r);
}

const clean = (n: unknown) => (typeof n === 'string' ? n : 'Hero').replace(/[^\p{L}\p{N} _\-.]/gu, '').trim().slice(0, 16) || 'Hero';

// ------------------------------------------------------------------ boot
function onConnection(ws: WebSocket, req: IncomingMessage) {
  const url = new URL(req.url ?? '/', 'http://x');
  const want = url.searchParams.get('pid');
  const valid = !!want && /^[\w-]{6,16}$/.test(want) && !want.startsWith('bot-');
  let c = valid ? clients.get(want!) : undefined;
  if (c?.ws) {
    // the same session reconnecting before the server noticed the old socket died (or a duplicated tab): newest wins
    const old = c.ws;
    c.ws = null;
    old.close(4001, 'replaced');
  }
  if (!c) {
    c = { ws, pid: valid && !clients.has(want!) ? want! : newId(), name: 'Hero', room: null, timer: null, alive: true, missed: 0 };
    clients.set(c.pid, c);
  } else {
    c.ws = ws;
    if (c.timer) { clearTimeout(c.timer); c.timer = null; }
  }
  const client = c;
  client.alive = true;
  send(client, { t: 'welcome', pid: client.pid });
  if (client.room) joinRoom(client, client.room);
  ws.on('pong', () => { client.alive = true; });
  ws.on('message', (data) => {
    client.alive = true;
    let m: ClientMsg;
    try { m = JSON.parse(String(data)); } catch { return; }
    if (!m || typeof m !== 'object') return;
    try { handle(client, m); } catch (err) { console.error('handler error', err); }
  });
  ws.on('error', () => {});
  ws.on('close', () => {
    if (client.ws !== ws) return; // superseded by a newer connection
    client.ws = null;
    const r = client.room;
    if (!r) { if (clients.get(client.pid) === client) clients.delete(client.pid); return; }
    if (r.game) r.game.setBot(client.pid, true);
    if (r.host === client.pid) ensureHost(r);
    broadcastRoom(r);
    // keep the seat for a while so a refresh / flaky connection can come back; then free it
    if (client.timer) clearTimeout(client.timer);
    client.timer = setTimeout(() => {
      client.timer = null;
      if (client.ws) return;
      leaveRoom(client);
      if (clients.get(client.pid) === client) clients.delete(client.pid);
    }, GRACE_MS);
  });
}

export function startServer(opts: ServerOptions = {}): Promise<RunningServer> {
  if (opts.staticDir) STATIC_DIR = opts.staticDir;
  GRACE_MS = opts.graceMs ?? 60_000;
  const server = createServer((req, res) => { serveStatic(req, res).catch(() => { try { res.writeHead(500); res.end('error'); } catch { /* socket gone */ } }); });
  const wss = new WebSocketServer({ server, path: '/ws', maxPayload: 64 * 1024, perMessageDeflate: { threshold: 512 } });
  wss.on('connection', onConnection);
  // drop dead sockets within ~40s so their seats are handed to a bot / can be reclaimed quickly
  const beat = setInterval(() => {
    for (const c of clients.values()) {
      if (!c.ws) continue;
      // a busy browser tab (loading a match) can go quiet for a while: only give up after 3 silent beats
      if (!c.alive && ++c.missed >= 3) { c.ws.terminate(); continue; }
      if (c.alive) c.missed = 0;
      c.alive = false;
      c.ws.ping();
    }
  }, 10_000);
  return new Promise((resolveP, reject) => {
    server.once('error', reject);
    server.listen(opts.port ?? Number(process.env.PORT ?? 8787), () => {
      resolveP({
        port: (server.address() as AddressInfo).port,
        close: () => new Promise<void>((done) => {
          clearInterval(beat);
          for (const r of rooms.values()) if (r.loop) clearInterval(r.loop);
          for (const c of clients.values()) if (c.timer) clearTimeout(c.timer);
          rooms.clear();
          clients.clear();
          for (const ws of wss.clients) ws.terminate();
          wss.close();
          server.close(() => done());
          server.closeAllConnections?.();
        }),
      });
    });
  });
}

// auto-listen only when executed directly (node dist/server.js, tsx src/server/index.ts), not when imported by tests
const entry = process.argv[1] ? pathToFileURL(resolve(process.argv[1])).href : '';
if (import.meta.url === entry) {
  startServer().then((s) => console.log(`Bannerfall server on http://localhost:${s.port} (ws /ws)`));
}
