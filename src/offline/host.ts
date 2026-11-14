// Offline host: the real lobby and match code (src/server/rooms.ts + the shared simulation) running next to the
// client instead of on a server. Bundled by `npm run build:offline` into godot/offline/bf-offline.js, which the
// Godot client runs in an Android WebView (or in Node on desktop for tests). The client drives everything through
// one call per frame, so nothing depends on the host's own timers (a hidden WebView throttles them):
//
//   __bf.frame(messages, ms) -> server messages
//
// `messages` are the client's protocol messages since the last frame (as sent over the WebSocket), `ms` is the
// real time that passed. The result is every server message produced meanwhile, in order.
import type { ClientMsg, ServerMsg } from '../shared/protocol';
import { RoomServer, type Clock, type Peer } from '../server/rooms';

/** A clock that only moves when the client says time has passed. */
class FrameClock implements Clock {
  private t = 0;
  private seq = 0;
  private timers = new Map<number, { at: number; every: number; fn: () => void }>();
  now() { return this.t; }
  every(ms: number, fn: () => void) { const id = ++this.seq; this.timers.set(id, { at: this.t + ms, every: ms, fn }); return id; }
  after(ms: number, fn: () => void) { const id = ++this.seq; this.timers.set(id, { at: this.t + ms, every: 0, fn }); return id; }
  cancel(h: unknown) { this.timers.delete(h as number); }
  /** Runs every timer that falls due within the next `ms`, in time order. */
  advance(ms: number) {
    const end = this.t + ms;
    for (;;) {
      let next: [number, { at: number; every: number; fn: () => void }] | null = null;
      for (const e of this.timers) if (e[1].at <= end && (!next || e[1].at < next[1].at || (e[1].at === next[1].at && e[0] < next[0]))) next = e;
      if (!next) break;
      const [id, tm] = next;
      this.t = tm.at;
      if (tm.every > 0) tm.at += tm.every; else this.timers.delete(id);
      tm.fn();
    }
    this.t = end;
  }
}

/** The longest stretch one frame may simulate: a long stall (app in background) must not replay minutes at once. */
const MAX_FRAME_MS = 250;

const clock = new FrameClock();
const rooms = new RoomServer({ clock, newId: () => Math.random().toString(36).slice(2, 10), graceMs: 60 * 60_000 });
const outbox: ServerMsg[] = [];
const peer: Peer = { open: true, send: (m) => { outbox.push(m); }, backlog: () => 0, close: () => {} };
let client: ReturnType<RoomServer['connect']> | null = null;

export const bridge = {
  version: 1,
  /** Connects the local player (with its saved pid, so a resumed app keeps its seat) and returns the welcome. */
  open(pid: string | null): ServerMsg[] {
    client = rooms.connect(peer, pid);
    return outbox.splice(0);
  },
  frame(messages: ClientMsg[] | string, ms: number): ServerMsg[] {
    if (!client) client = rooms.connect(peer, null);
    const list = typeof messages === 'string' ? (JSON.parse(messages) as ClientMsg[]) : messages;
    for (const m of list ?? []) {
      if (!m || typeof m !== 'object') continue;
      try { rooms.message(client, m); } catch (err) { console.error('offline handler error', err); }
    }
    clock.advance(Math.max(0, Math.min(MAX_FRAME_MS, Number(ms) || 0)));
    return outbox.splice(0);
  },
};

(globalThis as unknown as { __bf: typeof bridge }).__bf = bridge;
