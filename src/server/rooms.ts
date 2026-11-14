// Rooms, lobby and match loop, independent of the transport. The Node server (index.ts) plugs WebSockets and
// real timers into it; the offline host (src/offline/host.ts) plugs in an in-memory peer and a clock driven by
// the client's frames, so a phone runs the very same lobby and match code without a server.
import type { ClientMsg, LobbySlot, RoomInfo, ServerMsg } from '../shared/protocol';
import type { GameMode } from '../shared/protocol';
import type { Team } from '../shared/types';
import { MAX_PLAYERS_PER_TEAM, TICK_RATE } from '../shared/constants';
import { HEROES } from '../shared/data/heroes';
import { Game, type PlayerSetup } from '../shared/sim/game';

/** One connection to a client: a WebSocket on the server, an in-memory queue offline. */
export interface Peer {
  send(m: ServerMsg): void;
  readonly open: boolean;
  /** Bytes waiting to go out; snapshots are skipped for a peer that is hopelessly behind. */
  backlog(): number;
  close(code: number, reason: string): void;
}
/** Timers: real ones on the server, a manually advanced clock offline. */
export interface Clock {
  every(ms: number, fn: () => void): unknown;
  after(ms: number, fn: () => void): unknown;
  cancel(handle: unknown): void;
  now(): number;
}

export interface Client { peer: Peer | null; pid: string; name: string; room: Room | null; timer: unknown; alive: boolean; missed: number }
export interface Room {
  code: string;
  host: string;
  slots: LobbySlot[];
  /** pids of bots that were auto-added at match start (removed again when returning to the lobby) */
  autoBots: Set<string>;
  fillBots: boolean;
  teamSize: number;
  mode: GameMode;
  game: Game | null;
  loop: unknown;
  endedAt: number;
  clients: Map<string, Client>;
}

export interface RoomServerOptions {
  clock: Clock;
  newId: () => string;
  /** How long a dropped player keeps their seat before it is freed (ms). */
  graceMs?: number;
  /** Development only: simulate several ticks per network tick. */
  devSpeed?: number;
}

const clean = (n: unknown) => (typeof n === 'string' ? n : 'Hero').replace(/[^\p{L}\p{N} _\-.]/gu, '').trim().slice(0, 16) || 'Hero';

export class RoomServer {
  readonly rooms = new Map<string, Room>();
  readonly clients = new Map<string, Client>();
  graceMs: number;
  private clock: Clock;
  private newId: () => string;
  private devSpeed: number;

  constructor(opts: RoomServerOptions) {
    this.clock = opts.clock;
    this.newId = opts.newId;
    this.graceMs = opts.graceMs ?? 60_000;
    this.devSpeed = Math.max(1, Math.min(8, opts.devSpeed ?? 1));
  }

  private send(c: Client, m: ServerMsg) { if (c.peer && c.peer.open) c.peer.send(m); }

  // ---------------------------------------------------------------- connections
  /** A client connects (or reconnects with its pid): it gets a welcome and its room back if it had one. */
  connect(peer: Peer, want: string | null): Client {
    const valid = !!want && /^[\w-]{6,16}$/.test(want) && !want.startsWith('bot-');
    let c = valid ? this.clients.get(want!) : undefined;
    if (c?.peer) {
      // the same session reconnecting before the server noticed the old socket died (or a duplicated tab): newest wins
      const old = c.peer;
      c.peer = null;
      old.close(4001, 'replaced');
    }
    if (!c) {
      c = { peer, pid: valid && !this.clients.has(want!) ? want! : this.newId(), name: 'Hero', room: null, timer: null, alive: true, missed: 0 };
      this.clients.set(c.pid, c);
    } else {
      c.peer = peer;
      if (c.timer) { this.clock.cancel(c.timer); c.timer = null; }
    }
    c.alive = true;
    this.send(c, { t: 'welcome', pid: c.pid });
    if (c.room) this.joinRoom(c, c.room);
    return c;
  }

  /** The connection `peer` of `client` closed. The seat is kept for a grace period so the player can come back. */
  disconnect(client: Client, peer: Peer) {
    if (client.peer !== peer) return; // superseded by a newer connection
    client.peer = null;
    const r = client.room;
    if (!r) { if (this.clients.get(client.pid) === client) this.clients.delete(client.pid); return; }
    if (r.game) r.game.setBot(client.pid, true);
    if (r.host === client.pid) this.ensureHost(r);
    this.broadcastRoom(r);
    if (client.timer) this.clock.cancel(client.timer);
    client.timer = this.clock.after(this.graceMs, () => {
      client.timer = null;
      if (client.peer) return;
      this.leaveRoom(client);
      if (this.clients.get(client.pid) === client) this.clients.delete(client.pid);
    });
  }

  /** Stops every match loop and timer (server shutdown, tests). */
  close() {
    for (const r of this.rooms.values()) if (r.loop) this.clock.cancel(r.loop);
    for (const c of this.clients.values()) if (c.timer) this.clock.cancel(c.timer);
    this.rooms.clear();
    this.clients.clear();
  }

  // ---------------------------------------------------------------- rooms
  private roomCode(): string {
    const A = 'ABCDEFGHJKLMNPQRSTUVWXYZ';
    for (;;) {
      const c = Array.from({ length: 4 }, () => A[Math.floor(Math.random() * A.length)]).join('');
      if (!this.rooms.has(c)) return c;
    }
  }

  private info(r: Room): RoomInfo {
    return { code: r.code, host: r.host, slots: r.slots, started: !!r.game, fillBots: r.fillBots, teamSize: r.teamSize, mode: r.mode };
  }
  private broadcastRoom(r: Room) { for (const c of r.clients.values()) this.send(c, { t: 'room', room: this.info(r) }); }

  private teamCount(r: Room, team: Team) { return r.slots.filter((s) => s.team === team).length; }
  private humans(r: Room, team: Team) { return r.slots.filter((s) => s.team === team && !s.bot).length; }
  private teamCap(r: Room) { return r.mode === 'frontline' ? 2 : MAX_PLAYERS_PER_TEAM; }

  /** Make sure the host is someone who is actually connected (falls back to anyone still holding a seat). */
  private ensureHost(r: Room) {
    const here = r.clients.get(r.host);
    if (here?.peer) return;
    const next = [...r.clients.values()].find((x) => x.peer) ?? [...r.clients.values()][0];
    r.host = next?.pid ?? '';
  }

  private joinRoom(c: Client, r: Room): boolean {
    const known = r.slots.some((s) => s.pid === c.pid);
    let takeover: LobbySlot | undefined;
    let team: Team = 0;
    if (!known) {
      if (r.game) {
        // late join: no spectating yet, so take over a bot (preferring the team with fewer humans)
        const bots = r.slots.filter((s) => s.bot);
        takeover = bots.sort((a, b) => this.humans(r, a.team) - this.humans(r, b.team))[0];
        if (!takeover) { this.send(c, { t: 'error', msg: 'Match in progress and no bot seat to take over.' }); return false; }
      } else {
        team = this.teamCount(r, 0) <= this.teamCount(r, 1) ? 0 : 1;
        if (this.teamCount(r, team) >= this.teamCap(r)) team = team === 0 ? 1 : 0;
        if (this.teamCount(r, team) >= this.teamCap(r)) { this.send(c, { t: 'error', msg: 'Room is full.' }); return false; }
      }
    }
    if (c.room && c.room !== r) this.leaveRoom(c);
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
    if (!r.host || !r.clients.get(r.host)?.peer) r.host = c.pid; // an abandoned room is adopted by whoever arrives
    this.broadcastRoom(r);
    if (r.game) {
      this.send(c, { t: 'init', init: r.game.init(c.pid) });
      // the loop stops a few seconds after the end: give late arrivals the final state
      if (!r.loop) this.send(c, { t: 'snap', s: r.game.snapshot(c.pid, r.game.players.find((x) => x.playerId === c.pid)?.team ?? 0) });
      // teammates' init lists are stale after a takeover, so refresh everyone's roster
      if (takeover) for (const o of r.clients.values()) if (o !== c) this.send(o, { t: 'init', init: r.game.init(o.pid) });
    }
    return true;
  }

  private leaveRoom(c: Client) {
    const r = c.room;
    if (!r) return;
    c.room = null;
    r.clients.delete(c.pid);
    if (c.timer) { this.clock.cancel(c.timer); c.timer = null; }
    if (r.game) r.game.setBot(c.pid, true); // a bot takes over (the seat stays reserved for a rejoin)
    else r.slots = r.slots.filter((s) => s.pid !== c.pid);
    if (r.host === c.pid) this.ensureHost(r);
    if (!r.clients.size) {
      if (r.loop) this.clock.cancel(r.loop);
      r.loop = null;
      this.rooms.delete(r.code);
      return;
    }
    this.broadcastRoom(r);
  }

  private startGame(r: Room) {
    const taken = new Set(r.slots.map((s) => s.heroId).filter(Boolean) as string[]);
    const pickFree = () => {
      const free = HEROES.filter((h) => !taken.has(h.id));
      const h = (free.length ? free : HEROES)[Math.floor(Math.random() * (free.length || HEROES.length))];
      taken.add(h.id);
      return h.id;
    };
    if (r.fillBots) {
      const size = Math.min(this.teamCap(r), Math.max(r.teamSize, this.teamCount(r, 0), this.teamCount(r, 1)));
      for (const team of [0, 1] as Team[]) {
        let n = 1;
        while (this.teamCount(r, team) < size) {
          const pid = `bot-${this.newId()}`;
          r.autoBots.add(pid);
          r.slots.push({ pid, name: `Bot ${team === 0 ? 'Dawn' : 'Dusk'} ${n++}`, team, heroId: null, bot: true, ready: true });
        }
      }
    }
    for (const s of r.slots) if (!s.heroId) s.heroId = pickFree();
    const setups: PlayerSetup[] = r.slots.map((s) => ({ pid: s.pid, name: s.name, team: s.team, heroId: s.heroId!, bot: s.bot || !r.clients.get(s.pid)?.peer }));
    const game = new Game(setups, Math.floor(Math.random() * 1e9), { mode: r.mode });
    r.game = game;
    r.endedAt = 0;
    for (const c of r.clients.values()) this.send(c, { t: 'init', init: game.init(c.pid) });
    this.broadcastRoom(r);
    r.loop = this.clock.every(1000 / TICK_RATE, () => {
      try {
        for (let i = 0; i < this.devSpeed; i++) game.step();
        for (const c of r.clients.values()) {
          if (!c.peer || c.peer.backlog() > 4_000_000) continue; // gone or hopelessly behind
          const p = game.players.find((x) => x.playerId === c.pid);
          this.send(c, { t: 'snap', s: game.snapshot(c.pid, p?.team ?? 0) });
        }
        game.flushEvents();
      } catch (err) {
        console.error('game loop error', err);
      }
      if (game.winner !== null) {
        if (!r.endedAt) {
          r.endedAt = this.clock.now();
          const replay = game.replay();
          for (const c of r.clients.values()) this.send(c, { t: 'replay', replay });
        } else if (this.clock.now() - r.endedAt > 3000 && r.loop) { this.clock.cancel(r.loop); r.loop = null; }
      }
    });
  }

  // ---------------------------------------------------------------- messages
  /** Handles one message from a connected client. */
  message(c: Client, m: ClientMsg) {
    const r = c.room;
    switch (m.t) {
      case 'create': {
        c.name = clean(m.name);
        const room: Room = { code: this.roomCode(), host: c.pid, slots: [], autoBots: new Set(), fillBots: true, teamSize: 2, mode: 'frontline', game: null, loop: null, endedAt: 0, clients: new Map() };
        this.rooms.set(room.code, room);
        if (!this.joinRoom(c, room)) this.rooms.delete(room.code);
        return;
      }
      case 'join': {
        c.name = clean(m.name);
        const room = this.rooms.get(String(m.code ?? '').trim().toUpperCase());
        if (!room) { this.send(c, { t: 'error', msg: `No room with code ${String(m.code ?? '').toUpperCase()}` }); return; }
        this.joinRoom(c, room);
        return;
      }
      case 'leave': this.leaveRoom(c); this.send(c, { t: 'room', room: { code: '', host: '', slots: [], started: false, fillBots: false, teamSize: 0, mode: 'frontline' } }); return;
      case 'ping': this.send(c, { t: 'pong', ts: m.ts }); return;
    }
    if (!r) return;
    const slot = r.slots.find((s) => s.pid === c.pid);
    switch (m.t) {
      case 'team':
        if (r.game || !slot || slot.team === m.team || (m.team !== 0 && m.team !== 1) || this.teamCount(r, m.team) >= this.teamCap(r)) return;
        slot.team = m.team;
        // the hero may already belong to a new teammate
        if (slot.heroId && r.slots.some((s) => s !== slot && s.team === slot.team && s.heroId === slot.heroId)) slot.heroId = null;
        break;
      case 'hero':
        if (r.game || !slot || !HEROES.some((h) => h.id === m.heroId)) return;
        if (r.slots.some((s) => s.heroId === m.heroId && s.team === slot.team && s.pid !== c.pid)) { this.send(c, { t: 'error', msg: 'A teammate already picked that hero.' }); this.broadcastRoom(r); return; }
        slot.heroId = m.heroId;
        break;
      case 'ready': if (slot) slot.ready = !!m.ready; break;
      case 'addBot':
        if (r.game || c.pid !== r.host || (m.team !== 0 && m.team !== 1) || this.teamCount(r, m.team) >= this.teamCap(r)) return;
        r.slots.push({ pid: `bot-${this.newId()}`, name: `Bot ${r.slots.filter((s) => s.bot).length + 1}`, team: m.team, heroId: null, bot: true, ready: true });
        break;
      case 'removeBot':
        if (r.game || c.pid !== r.host) return;
        r.slots = r.slots.filter((s) => !(s.bot && s.pid === m.pid));
        break;
      case 'fillBots':
        if (r.game || c.pid !== r.host) return;
        r.fillBots = !!m.on;
        if (m.teamSize) r.teamSize = Math.max(1, Math.min(this.teamCap(r), Math.floor(Number(m.teamSize)) || 3));
        break;
      case 'mode':
        if (r.game || c.pid !== r.host || (m.mode !== 'frontline' && m.mode !== 'crossing')) return;
        r.mode = m.mode;
        if (m.mode === 'frontline') r.teamSize = Math.min(r.teamSize, 2);
        break;
      case 'start':
        if (r.game) return;
        if (c.pid !== r.host) { this.send(c, { t: 'error', msg: 'Only the host can start the match.' }); return; }
        if (!r.fillBots && (!this.teamCount(r, 0) || !this.teamCount(r, 1))) { this.send(c, { t: 'error', msg: 'Both teams need at least one player or bot.' }); return; }
        this.startGame(r);
        return;
      case 'lobbyReturn':
        if (c.pid !== r.host || !r.game || r.game.winner === null) return;
        if (r.loop) this.clock.cancel(r.loop);
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
          if (!m.team || os?.team === team) this.send(o, { t: 'chat', from: c.name, text, team: !!m.team, teamId: team });
        }
        return;
      }
    }
    this.broadcastRoom(r);
  }
}
