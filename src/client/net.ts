import type { ClientMsg, Command, GameInit, RoomInfo, ServerMsg, Snapshot } from '../shared/protocol';
import type { Team } from '../shared/types';
import { TICK_RATE } from '../shared/constants';
import { Game, type PlayerSetup } from '../shared/sim/game';

export interface ChatLine { from: string; text: string; team: boolean; teamId: Team }

/** What the game screen talks to: either the online server or an in-browser simulation. */
export interface Session {
  readonly online: boolean;
  onInit: (init: GameInit) => void;
  onSnap: (s: Snapshot) => void;
  onChat: (c: ChatLine) => void;
  send(cmd: Command): void;
  chat(text: string, team: boolean): void;
  close(): void;
  rtt: number;
}

export class LocalSession implements Session {
  readonly online = false;
  onInit: (init: GameInit) => void = () => {};
  onSnap: (s: Snapshot) => void = () => {};
  onChat: (c: ChatLine) => void = () => {};
  rtt = 0;
  private game: Game;
  private timer = 0;
  private me: PlayerSetup;
  paused = false;

  constructor(setups: PlayerSetup[], me: string) {
    this.game = new Game(setups, Math.floor(Math.random() * 1e9));
    this.me = setups.find((s) => s.pid === me)!;
  }
  start() {
    this.onInit(this.game.init(this.me.pid));
    let acc = 0, last = performance.now();
    this.timer = window.setInterval(() => {
      const now = performance.now();
      acc += Math.min(250, now - last);
      last = now;
      if (this.paused) { acc = 0; return; }
      let stepped = false;
      while (acc >= 1000 / TICK_RATE) { this.game.step(); acc -= 1000 / TICK_RATE; stepped = true; }
      if (stepped) {
        this.onSnap(this.game.snapshot(this.me.pid, this.me.team));
        this.game.flushEvents();
      }
    }, 1000 / TICK_RATE / 2);
  }
  send(cmd: Command) { this.game.command(this.me.pid, cmd); }
  chat(text: string, team: boolean) { this.onChat({ from: this.me.name, text, team, teamId: this.me.team }); }
  close() { clearInterval(this.timer); }
}

/** WebSocket connection to the Bannerfall server. Handles both lobby and in-game traffic, and transparently reconnects. */
export class NetClient implements Session {
  readonly online = true;
  onInit: (init: GameInit) => void = () => {};
  onSnap: (s: Snapshot) => void = () => {};
  onChat: (c: ChatLine) => void = () => {};
  onRoom: (r: RoomInfo) => void = () => {};
  onError: (msg: string) => void = () => {};
  /** Connection dropped (false) and we are retrying / connection is back (true). */
  onLink: (up: boolean) => void = () => {};
  /** The connection is gone for good (server unreachable, replaced by another tab, or retries exhausted). */
  onClose: (reason?: string) => void = () => {};
  rtt = 0;
  pid = '';
  /** Code of the room the server last told us we are in ('' = none). */
  roomCode = '';
  private ws!: WebSocket;
  private pingTimer = 0;
  private retryTimer = 0;
  private connected = false;
  private closing = false;
  private attempts = 0;
  private lastName = 'Hero';
  private roomSinceWelcome = false;
  private resyncing = false;
  private url: string;
  ready: Promise<void>;
  private resolveReady!: () => void;
  private rejectReady!: (e: Error) => void;

  constructor(url = NetClient.defaultUrl()) {
    this.url = url;
    this.ready = new Promise((resolve, reject) => { this.resolveReady = resolve; this.rejectReady = reject; });
    this.ready.catch(() => {});
    this.open();
    this.pingTimer = window.setInterval(() => this.raw({ t: 'ping', ts: performance.now() }), 2000);
  }

  static defaultUrl() {
    const proto = location.protocol === 'https:' ? 'wss' : 'ws';
    return `${proto}://${location.host}/ws`;
  }

  private open() {
    // sessionStorage: survives a refresh of this tab, but two tabs never share one identity
    const saved = this.pid || safeSessionGet('bf.pid');
    const ws = new WebSocket(saved ? `${this.url}?pid=${encodeURIComponent(saved)}` : this.url);
    this.ws = ws;
    ws.onmessage = (ev) => {
      if (ws !== this.ws) return;
      let m: ServerMsg;
      try { m = JSON.parse(ev.data) as ServerMsg; } catch { return; }
      if (m.t === 'welcome') this.onWelcome(m.pid);
      this.handle(m);
    };
    ws.onerror = () => { if (!this.connected) this.rejectReady(new Error('Could not reach the game server.')); };
    ws.onclose = (ev) => {
      if (ws !== this.ws) return;
      if (this.closing) { this.stop(); return; }
      if (!this.connected) { this.rejectReady(new Error('Could not reach the game server.')); this.stop(); this.onClose('Could not reach the game server.'); return; }
      if (ev.code === 4001) { this.stop(); this.onClose('This session was opened in another tab.'); return; }
      this.retry();
    };
  }

  private onWelcome(pid: string) {
    this.pid = pid;
    safeSessionSet('bf.pid', pid);
    const wasDown = this.attempts > 0;
    this.attempts = 0;
    this.roomSinceWelcome = false;
    if (!this.connected) { this.connected = true; this.resolveReady(); return; }
    if (wasDown) {
      this.onLink(true);
      // The server re-seats us by pid. If it forgot us (restart / seat expired) it says nothing: ask to join again.
      if (this.roomCode) window.setTimeout(() => {
        if (this.roomSinceWelcome || this.closing || !this.roomCode) return;
        this.resyncing = true;
        this.raw({ t: 'join', code: this.roomCode, name: this.lastName });
      }, 500);
    }
  }

  private retry() {
    if (this.attempts === 0) this.onLink(false);
    if (++this.attempts > 30) { this.stop(); this.onClose('Lost connection to the server.'); return; }
    this.retryTimer = window.setTimeout(() => { if (!this.closing) this.open(); }, Math.min(3000, 400 * this.attempts));
  }

  private stop() { clearInterval(this.pingTimer); clearTimeout(this.retryTimer); }

  private handle(m: ServerMsg) {
    switch (m.t) {
      case 'room':
        this.roomSinceWelcome = true;
        this.resyncing = false;
        this.roomCode = m.room.code;
        this.onRoom(m.room);
        break;
      case 'error':
        if (this.resyncing) { this.resyncing = false; this.closing = true; this.stop(); this.ws.close(); this.onClose(m.msg); break; }
        this.onError(m.msg);
        break;
      case 'init': this.onInit(m.init); break;
      case 'snap': this.onSnap(m.s); break;
      case 'chat': this.onChat(m); break;
      case 'pong': this.rtt = performance.now() - m.ts; break;
    }
  }
  raw(m: ClientMsg) {
    if (m.t === 'create' || m.t === 'join') this.lastName = m.name;
    if (this.ws.readyState === WebSocket.OPEN) this.ws.send(JSON.stringify(m));
  }
  send(cmd: Command) { this.raw({ t: 'cmd', cmd }); }
  chat(text: string, team: boolean) { this.raw({ t: 'chat', text, team }); }
  /** Deliberate departure: tells the server so the seat is freed right away. */
  close() {
    this.closing = true;
    this.stop();
    this.raw({ t: 'leave' });
    this.ws.close();
  }
}

export function safeGet(k: string): string | null { try { return localStorage.getItem(k); } catch { return null; } }
export function safeSet(k: string, v: string) { try { localStorage.setItem(k, v); } catch { /* private mode */ } }
function safeSessionGet(k: string): string | null { try { return sessionStorage.getItem(k); } catch { return null; } }
function safeSessionSet(k: string, v: string) { try { sessionStorage.setItem(k, v); } catch { /* private mode */ } }
