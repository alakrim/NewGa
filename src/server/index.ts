import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';
import type { AddressInfo } from 'node:net';
import { readFile, stat } from 'node:fs/promises';
import { extname, join, normalize, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { randomBytes } from 'node:crypto';
import { WebSocketServer, WebSocket } from 'ws';
import type { ClientMsg, ServerMsg } from '../shared/protocol';
import { RoomServer, type Clock, type Peer } from './rooms';

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

// ------------------------------------------------------------------ rooms (transport-free logic in rooms.ts)
/** A WebSocket as a RoomServer peer. */
class WsPeer implements Peer {
  constructor(readonly ws: WebSocket) {}
  send(m: ServerMsg) { this.ws.send(JSON.stringify(m)); }
  get open() { return this.ws.readyState === WebSocket.OPEN; }
  backlog() { return this.ws.bufferedAmount; }
  close(code: number, reason: string) { this.ws.close(code, reason); }
}
const nodeClock: Clock = {
  every: (ms, fn) => setInterval(fn, ms),
  after: (ms, fn) => setTimeout(fn, ms),
  cancel: (h) => clearInterval(h as NodeJS.Timeout),
  now: () => Date.now(),
};
/** Development only: simulate several ticks per network tick (BF_SPEED=4 runs matches 4x faster). */
const DEV_SPEED = Math.max(1, Math.min(8, Number(process.env.BF_SPEED ?? 1) || 1));
const roomServer = new RoomServer({ clock: nodeClock, newId: () => randomBytes(6).toString('base64url'), devSpeed: DEV_SPEED });
const { rooms, clients } = roomServer;
/** Exposed for tests only. */
export const _internals = { rooms, clients };

function onConnection(ws: WebSocket, req: IncomingMessage) {
  const url = new URL(req.url ?? '/', 'http://x');
  const peer = new WsPeer(ws);
  const client = roomServer.connect(peer, url.searchParams.get('pid'));
  ws.on('pong', () => { client.alive = true; });
  ws.on('message', (data) => {
    client.alive = true;
    let m: ClientMsg;
    try { m = JSON.parse(String(data)); } catch { return; }
    if (!m || typeof m !== 'object') return;
    try { roomServer.message(client, m); } catch (err) { console.error('handler error', err); }
  });
  ws.on('error', () => {});
  const dbg = (what: string) => { if (process.env.DEBUG_NET) console.log(new Date().toISOString(), what, client.pid, client.room?.code ?? '-'); };
  dbg('open');
  ws.on('close', (code) => {
    dbg(`close ${code}${client.peer !== peer ? ' (superseded)' : ''}`);
    roomServer.disconnect(client, peer);
  });
}

export function startServer(opts: ServerOptions = {}): Promise<RunningServer> {
  if (opts.staticDir) STATIC_DIR = opts.staticDir;
  roomServer.graceMs = opts.graceMs ?? 60_000;
  const server = createServer((req, res) => { serveStatic(req, res).catch(() => { try { res.writeHead(500); res.end('error'); } catch { /* socket gone */ } }); });
  const wss = new WebSocketServer({ server, path: '/ws', maxPayload: 64 * 1024, perMessageDeflate: { threshold: 512 } });
  wss.on('connection', onConnection);
  // drop dead sockets within ~60s so their seats are handed to a bot / can be reclaimed quickly
  const beat = setInterval(() => {
    for (const c of clients.values()) {
      if (!(c.peer instanceof WsPeer)) continue;
      // a busy browser tab (loading a match) can go quiet for a while: only give up after 6 silent beats
      if (!c.alive && ++c.missed >= 6) { if (process.env.DEBUG_NET) console.log('heartbeat timeout', c.pid); c.peer.ws.terminate(); continue; }
      if (c.alive) c.missed = 0;
      c.alive = false;
      c.peer.ws.ping();
    }
  }, 10_000);
  return new Promise((resolveP, reject) => {
    server.once('error', reject);
    server.listen(opts.port ?? Number(process.env.PORT ?? 8787), () => {
      resolveP({
        port: (server.address() as AddressInfo).port,
        close: () => new Promise<void>((done) => {
          clearInterval(beat);
          roomServer.close();
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
