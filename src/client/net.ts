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

/** WebSocket connection to the Bannerfall server. Handles both lobby and in-game traffic. */
export class NetClient implements Session {
  readonly online = true;
  onInit: (init: GameInit) => void = () => {};
  onSnap: (s: Snapshot) => void = () => {};
  onChat: (c: ChatLine) => void = () => {};
  onRoom: (r: RoomInfo) => void = () => {};
  onError: (msg: string) => void = () => {};
  onClose: () => void = () => {};
  rtt = 0;
  pid = '';
  private ws: WebSocket;
  private pingTimer = 0;
  ready: Promise<void>;

  constructor(url = NetClient.defaultUrl()) {
    const saved = safeGet('bf.pid');
    this.ws = new WebSocket(saved ? `${url}?pid=${encodeURIComponent(saved)}` : url);
    this.ready = new Promise((resolve, reject) => {
      this.ws.onerror = () => reject(new Error('Could not reach the game server.'));
      this.ws.onmessage = (ev) => {
        const m = JSON.parse(ev.data) as ServerMsg;
        if (m.t === 'welcome') { this.pid = m.pid; safeSet('bf.pid', m.pid); resolve(); }
        this.handle(m);
      };
    });
    this.ws.onclose = () => { clearInterval(this.pingTimer); this.onClose(); };
    this.pingTimer = window.setInterval(() => this.raw({ t: 'ping', ts: performance.now() }), 2000);
  }

  static defaultUrl() {
    const proto = location.protocol === 'https:' ? 'wss' : 'ws';
    return `${proto}://${location.host}/ws`;
  }

  private handle(m: ServerMsg) {
    switch (m.t) {
      case 'room': this.onRoom(m.room); break;
      case 'error': this.onError(m.msg); break;
      case 'init': this.onInit(m.init); break;
      case 'snap': this.onSnap(m.s); break;
      case 'chat': this.onChat(m); break;
      case 'pong': this.rtt = performance.now() - m.ts; break;
    }
  }
  raw(m: ClientMsg) { if (this.ws.readyState === WebSocket.OPEN) this.ws.send(JSON.stringify(m)); }
  send(cmd: Command) { this.raw({ t: 'cmd', cmd }); }
  chat(text: string, team: boolean) { this.raw({ t: 'chat', text, team }); }
  close() { this.ws.close(); }
}

export function safeGet(k: string): string | null { try { return localStorage.getItem(k); } catch { return null; } }
export function safeSet(k: string, v: string) { try { localStorage.setItem(k, v); } catch { /* private mode */ } }
