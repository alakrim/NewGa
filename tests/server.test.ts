import { test, before, after, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import WebSocket from 'ws';
import { startServer, _internals, type RunningServer } from '../src/server/index';
import type { ClientMsg, GameInit, RoomInfo, ServerMsg, Snapshot } from '../src/shared/protocol';
import { HEROES } from '../src/shared/data/heroes';

let srv: RunningServer;
const GRACE = 700;
const open: TestClient[] = [];

before(async () => { srv = await startServer({ port: 0, staticDir: '/nonexistent-static-dir', graceMs: GRACE }); });
// a failing test must not leak rooms into the next one
afterEach(() => {
  for (const c of open.splice(0)) c.ws.terminate();
  for (const r of _internals.rooms.values()) if (r.loop) clearInterval(r.loop);
  for (const c of _internals.clients.values()) if (c.timer) clearTimeout(c.timer);
  _internals.rooms.clear();
  _internals.clients.clear();
});
after(async () => { for (const c of open) c.ws.terminate(); await srv.close(); });

class TestClient {
  ws: WebSocket;
  msgs: ServerMsg[] = [];
  pid = '';
  closeCode: number | null = null;
  private waiters: { pred: (m: ServerMsg) => boolean; res: (m: ServerMsg) => void }[] = [];
  private constructor(url: string) {
    this.ws = new WebSocket(url);
    this.ws.on('message', (d) => {
      const m = JSON.parse(String(d)) as ServerMsg;
      this.msgs.push(m);
      if (m.t === 'welcome') this.pid = m.pid;
      this.waiters = this.waiters.filter((w) => (w.pred(m) ? (w.res(m), false) : true));
    });
    this.ws.on('close', (code) => { this.closeCode = code; });
    open.push(this);
  }
  static async connect(pid?: string): Promise<TestClient> {
    const c = new TestClient(`ws://127.0.0.1:${srv.port}/ws${pid ? `?pid=${pid}` : ''}`);
    await c.next((m) => m.t === 'welcome');
    return c;
  }
  send(m: ClientMsg) { this.ws.send(JSON.stringify(m)); }
  /** Resolves with the next message (after now) matching pred. */
  next<T extends ServerMsg = ServerMsg>(pred: (m: ServerMsg) => boolean, ms = 4000): Promise<T> {
    const where = new Error('timeout waiting for message');
    return new Promise((res, rej) => {
      const to = setTimeout(() => rej(where), ms);
      this.waiters.push({ pred, res: (m) => { clearTimeout(to); res(m as T); } });
    });
  }
  /** Looks through already received messages first, then waits. */
  async find<T extends ServerMsg = ServerMsg>(pred: (m: ServerMsg) => boolean, ms = 4000): Promise<T> {
    const have = this.msgs.find(pred);
    return (have as T) ?? this.next<T>(pred, ms);
  }
  last<T extends ServerMsg['t']>(t: T): Extract<ServerMsg, { t: T }> | undefined {
    for (let i = this.msgs.length - 1; i >= 0; i--) if (this.msgs[i].t === t) return this.msgs[i] as Extract<ServerMsg, { t: T }>;
    return undefined;
  }
  /** Sends and waits for the room update that satisfies pred. */
  async room(pred: (r: RoomInfo) => boolean, ms = 4000): Promise<RoomInfo> {
    const cur = this.last('room');
    if (cur && pred(cur.room)) return cur.room;
    const m = await this.next<Extract<ServerMsg, { t: 'room' }>>((x) => x.t === 'room' && pred(x.room), ms);
    return m.room;
  }
  async act(m: ClientMsg, pred: (r: RoomInfo) => boolean): Promise<RoomInfo> {
    const p = this.next<Extract<ServerMsg, { t: 'room' }>>((x) => x.t === 'room' && pred(x.room));
    this.send(m);
    return (await p).room;
  }
  close() { this.ws.close(); }
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const health = async () => (await (await fetch(`http://127.0.0.1:${srv.port}/health`)).text());
const slotOf = (r: RoomInfo, pid: string) => r.slots.find((s) => s.pid === pid)!;
const isSnap = (m: ServerMsg): m is Extract<ServerMsg, { t: 'snap' }> => m.t === 'snap';

test('http: health endpoint works and a missing static dir does not crash the server', async () => {
  assert.match(await health(), /^ok \d+ rooms$/);
  const r = await fetch(`http://127.0.0.1:${srv.port}/?room=ABCD`);
  assert.equal(r.status, 404);
  assert.equal((await fetch(`http://127.0.0.1:${srv.port}/%`)).status, 400); // malformed URL must not crash
  assert.match(await health(), /^ok/);
});

test('welcome, ping/pong, unknown room error, malformed input is ignored', async () => {
  const a = await TestClient.connect();
  assert.match(a.pid, /^[\w-]{6,16}$/);
  a.ws.send('not json');
  a.ws.send('null');
  a.ws.send(JSON.stringify({ t: 'nope' }));
  const pong = a.next<Extract<ServerMsg, { t: 'pong' }>>((m) => m.t === 'pong');
  a.send({ t: 'ping', ts: 42 });
  assert.equal((await pong).ts, 42);
  const err = a.next<Extract<ServerMsg, { t: 'error' }>>((m) => m.t === 'error');
  a.send({ t: 'join', code: 'ZZZZ', name: 'A' });
  assert.match((await err).msg, /No room/);
  a.close();
});

test('lobby: create, join by code, team switch, hero pick rules, bots, host-only controls, leaving frees the slot', async () => {
  const a = await TestClient.connect();
  const b = await TestClient.connect();
  const c = await TestClient.connect();

  const created = a.next<Extract<ServerMsg, { t: 'room' }>>((m) => m.t === 'room');
  a.send({ t: 'create', name: 'Alice' });
  const r0 = (await created).room;
  assert.match(r0.code, /^[A-Z]{4}$/);
  assert.equal(r0.host, a.pid);
  assert.equal(r0.started, false);
  assert.equal(r0.slots.length, 1);
  assert.equal(r0.slots[0].name, 'Alice');

  // lowercase code works; joiner is balanced onto the other team
  const r1 = await b.act({ t: 'join', code: r0.code.toLowerCase(), name: 'Bob' }, (r) => r.slots.length === 2);
  assert.equal(slotOf(r1, b.pid).team, 1 - slotOf(r1, a.pid).team);
  assert.equal(r1.host, a.pid);
  // A sees it too
  await a.room((r) => r.slots.length === 2);

  // team switch: both on team 0
  const r2 = await b.act({ t: 'team', team: 0 }, (r) => slotOf(r, b.pid).team === 0);
  assert.equal(slotOf(r2, a.pid).team, 0);

  // hero pick; teammate can't take the same hero
  const [h1, h2] = [HEROES[0].id, HEROES[1].id];
  await a.act({ t: 'hero', heroId: h1 }, (r) => slotOf(r, a.pid).heroId === h1);
  const dupErr = b.next<Extract<ServerMsg, { t: 'error' }>>((m) => m.t === 'error');
  b.send({ t: 'hero', heroId: h1 });
  assert.match((await dupErr).msg, /teammate/);
  const r3 = await b.act({ t: 'hero', heroId: h2 }, (r) => slotOf(r, b.pid).heroId === h2);
  assert.equal(slotOf(r3, a.pid).heroId, h1);
  // invalid hero ids are ignored
  b.send({ t: 'hero', heroId: 'nope' });
  // an enemy may pick the same hero as someone on the other team
  const r3b = await b.act({ t: 'team', team: 1 }, (r) => slotOf(r, b.pid).team === 1);
  assert.equal(slotOf(r3b, b.pid).heroId, h2);
  const r3c = await b.act({ t: 'hero', heroId: h1 }, (r) => slotOf(r, b.pid).heroId === h1);
  assert.equal(slotOf(r3c, a.pid).heroId, h1);
  // ...but switching teams onto a teammate holding your hero clears your pick instead of duplicating it
  const r3d = await b.act({ t: 'team', team: 0 }, (r) => slotOf(r, b.pid).team === 0);
  assert.equal(slotOf(r3d, b.pid).heroId, null);

  // host adds / removes bots; non-host cannot
  const r4 = await a.act({ t: 'addBot', team: 1 }, (r) => r.slots.some((s) => s.bot));
  const bot = r4.slots.find((s) => s.bot)!;
  assert.equal(bot.team, 1);
  b.send({ t: 'addBot', team: 1 });
  b.send({ t: 'removeBot', pid: bot.pid });
  await sleep(150);
  assert.equal(b.last('room')!.room.slots.filter((s) => s.bot).length, 1, 'non-host bot control must be ignored');
  const r5 = await a.act({ t: 'removeBot', pid: bot.pid }, (r) => !r.slots.some((s) => s.bot));
  assert.equal(r5.slots.length, 2);

  // fill settings are host-only
  const r6 = await a.act({ t: 'fillBots', on: true, teamSize: 2 }, (r) => r.teamSize === 2);
  assert.equal(r6.fillBots, true);
  b.send({ t: 'fillBots', on: false, teamSize: 5 });
  await sleep(100);
  assert.equal(a.last('room')!.room.teamSize, 2);

  // non-host cannot start
  const startErr = b.next<Extract<ServerMsg, { t: 'error' }>>((m) => m.t === 'error');
  b.send({ t: 'start' });
  assert.match((await startErr).msg, /host/i);
  await sleep(100);
  assert.equal(b.msgs.some((m) => m.t === 'init'), false);

  // third player joins, then leaves: slot freed
  await c.act({ t: 'join', code: r0.code, name: 'Cy' }, (r) => r.slots.length === 3);
  const left = await a.act({ t: 'leave' } as ClientMsg, () => true).catch(() => null); // host leaving: the room object goes to someone else
  void left;
  // (host left the lobby => their slot is removed, host migrated)
  const rr = await b.room((r) => !r.slots.some((s) => s.pid === a.pid));
  assert.ok(rr.host === b.pid || rr.host === c.pid, 'host migrates to a remaining player');
  const rest = [b, c].find((x) => x.pid === rr.host)!;
  const other = rest === b ? c : b;
  assert.equal(rr.slots.length, 2);

  // leaving frees the slot; the last one out deletes the room
  other.send({ t: 'leave' });
  await rest.room((r) => r.slots.length === 1);
  rest.send({ t: 'leave' });
  await sleep(150);
  assert.equal(await health(), 'ok 0 rooms');
  for (const x of [a, b, c]) x.close();
});

test('room full / one start with no bots needs both teams', async () => {
  const a = await TestClient.connect();
  const code = (await a.act({ t: 'create', name: 'H' }, () => true)).code;
  // 10 seats: fill with bots (5+5), host is one of them => 9 more
  for (let i = 0; i < 5; i++) await a.act({ t: 'addBot', team: 1 }, (r) => r.slots.filter((s) => s.team === 1).length >= Math.min(5, i + 1));
  const joiners: TestClient[] = [];
  for (let i = 0; i < 4; i++) {
    const j = await TestClient.connect();
    joiners.push(j);
    await j.act({ t: 'join', code, name: `J${i}` }, (r) => r.slots.some((s) => s.pid === j.pid));
  }
  const extra = await TestClient.connect();
  const err = extra.next<Extract<ServerMsg, { t: 'error' }>>((m) => m.t === 'error');
  extra.send({ t: 'join', code, name: 'late' });
  assert.match((await err).msg, /full/i);
  // the rejected client must not be listening to the room
  await sleep(100);
  a.send({ t: 'team', team: 0 });
  await sleep(100);
  assert.equal(extra.msgs.filter((m) => m.t === 'room').length, 0);
  for (const j of [a, ...joiners, extra]) j.close();
  await sleep(100);
});

test('full match: init, 20Hz snapshots with me, vision filter, move command, chat routing', async () => {
  const a = await TestClient.connect();
  const b = await TestClient.connect();
  const code = (await a.act({ t: 'create', name: 'Alice' }, () => true)).code;
  await b.act({ t: 'join', code, name: 'Bob' }, (r) => r.slots.length === 2);
  // ensure they are on opposite teams then both on... make A and B teammates for team chat
  const rt = await b.act({ t: 'team', team: slotOf(a.last('room')!.room, a.pid).team }, (r) => slotOf(r, b.pid).team === slotOf(r, a.pid).team);
  const aTeam = slotOf(rt, a.pid).team;
  await a.act({ t: 'hero', heroId: HEROES[2].id }, (r) => slotOf(r, a.pid).heroId === HEROES[2].id);
  await b.act({ t: 'hero', heroId: HEROES[3].id }, (r) => slotOf(r, b.pid).heroId === HEROES[3].id);
  await a.act({ t: 'mode', mode: 'crossing' }, (r) => r.mode === 'crossing'); // fog of war is a Crossing feature
  await a.act({ t: 'fillBots', on: true, teamSize: 2 }, (r) => r.teamSize === 2);

  const initA = a.next<Extract<ServerMsg, { t: 'init' }>>((m) => m.t === 'init');
  const initB = b.next<Extract<ServerMsg, { t: 'init' }>>((m) => m.t === 'init');
  a.send({ t: 'start' });
  const [ia, ib] = [(await initA).init, (await initB).init] as [GameInit, GameInit];
  assert.equal(ia.you, a.pid);
  assert.equal(ib.you, b.pid);
  assert.equal(ia.players.length, 4); // 2 humans on one team + bot fill to 2v2
  const pa = ia.players.find((p) => p.playerId === a.pid)!;
  const pb = ia.players.find((p) => p.playerId === b.pid)!;
  assert.equal(pa.heroId, HEROES[2].id);
  assert.equal(pb.heroId, HEROES[3].id);
  assert.equal(pa.team, aTeam);
  assert.equal(pa.bot, false);
  assert.equal(ia.players.filter((p) => p.bot).length, 2);
  assert.equal(new Set(ia.players.filter((p) => p.team === aTeam).map((p) => p.heroId)).size, 2);
  assert.equal((await a.room((r) => r.started)).started, true);

  // snapshots ~20Hz with me
  const t0 = a.msgs.filter(isSnap).length;
  await sleep(1500);
  const n = a.msgs.filter(isSnap).length - t0;
  assert.ok(n >= 22 && n <= 36, `expected ~30 snapshots in 1.5s, got ${n}`);
  const snapA = a.last('snap')!.s;
  const snapB = b.last('snap')!.s;
  assert.equal(snapA.me?.unit, pa.unitId);
  assert.equal(snapB.me?.unit, pb.unitId);
  assert.ok(snapA.me!.gold > 0);

  // vision: allied heroes visible, enemy heroes at the far fountain are not
  const ids = new Set(snapA.units.map((u) => u[0]));
  for (const p of ia.players) {
    if (p.team === aTeam) assert.ok(ids.has(p.unitId), `ally ${p.name} must be visible`);
    else assert.ok(!ids.has(p.unitId), `enemy ${p.name} at the far fountain must not be in the snapshot`);
  }
  assert.ok(snapA.units.every((u) => u[2] === aTeam || u[1] !== undefined));

  // move command changes position over later snapshots
  const posOf = (s: Snapshot, unit: number) => { const u = s.units.find((x) => x[0] === unit)!; return { x: u[3], z: u[4] }; };
  const before = posOf(snapA, pa.unitId);
  const target = { x: before.x * 0.7, z: before.z + 14 };
  a.send({ t: 'cmd', cmd: { c: 'move', x: target.x, z: target.z } });
  await sleep(1500);
  const after = posOf(a.last('snap')!.s, pa.unitId);
  assert.ok(Math.hypot(after.x - before.x, after.z - before.z) > 2, `hero should have moved (from ${JSON.stringify(before)} to ${JSON.stringify(after)})`);
  // B's own hero stayed put (units may be nudged apart at the spawn, but nothing like A's trip)
  const bPos0 = posOf(snapB, pb.unitId), bPos1 = posOf(b.last('snap')!.s, pb.unitId);
  assert.ok(Math.hypot(bPos1.x - bPos0.x, bPos1.z - bPos0.z) < Math.hypot(after.x - before.x, after.z - before.z) / 2);
  // and B sees A (teammates) moving
  const seenByB = posOf(b.last('snap')!.s, pa.unitId);
  assert.ok(Math.hypot(seenByB.x - before.x, seenByB.z - before.z) > 2);

  // chat: all-chat reaches everyone, team-chat only the team (A and B are teammates: use the bot-less angle by adding a spectator-free check)
  const chatB = b.next<Extract<ServerMsg, { t: 'chat' }>>((m) => m.t === 'chat');
  a.send({ t: 'chat', text: 'hello all', team: false });
  const cm = await chatB;
  assert.deepEqual([cm.from, cm.text, cm.team, cm.teamId], ['Alice', 'hello all', false, aTeam]);
  assert.ok(a.msgs.some((m) => m.t === 'chat' && m.text === 'hello all'), 'sender gets own chat echo');
  const teamB = b.next<Extract<ServerMsg, { t: 'chat' }>>((m) => m.t === 'chat' && m.team);
  a.send({ t: 'chat', text: '   ', team: false }); // empty is dropped
  a.send({ t: 'chat', text: 'secret plan', team: true });
  assert.equal((await teamB).text, 'secret plan');
  await sleep(100);
  assert.equal(a.msgs.filter((m) => m.t === 'chat').length, 2);

  // lobbyReturn before the match is over is refused
  a.send({ t: 'lobbyReturn' });
  await sleep(150);
  assert.equal(a.last('room')!.room.started, true);

  a.send({ t: 'leave' });
  b.send({ t: 'leave' });
  await sleep(150);
  assert.equal(await health(), 'ok 0 rooms');
  a.close(); b.close();
});

test('team chat does not leak to the enemy team', async () => {
  const a = await TestClient.connect();
  const b = await TestClient.connect();
  const code = (await a.act({ t: 'create', name: 'Alice' }, () => true)).code;
  const r = await b.act({ t: 'join', code, name: 'Bob' }, (x) => x.slots.length === 2);
  assert.notEqual(slotOf(r, a.pid).team, slotOf(r, b.pid).team);
  a.send({ t: 'chat', text: 'for my team', team: true });
  await sleep(200);
  assert.ok(a.msgs.some((m) => m.t === 'chat'));
  assert.ok(!b.msgs.some((m) => m.t === 'chat'));
  a.send({ t: 'leave' }); b.send({ t: 'leave' });
  await sleep(100);
  a.close(); b.close();
});

test('disconnect mid-game: bot takes over; reconnect with the same pid restores control and re-sends init', async () => {
  const a = await TestClient.connect();
  const b = await TestClient.connect();
  const code = (await a.act({ t: 'create', name: 'Alice' }, () => true)).code;
  await b.act({ t: 'join', code, name: 'Bob' }, (r) => r.slots.length === 2);
  await a.act({ t: 'fillBots', on: true, teamSize: 2 }, (r) => r.teamSize === 2);
  a.send({ t: 'start' });
  await a.find((m) => m.t === 'init');
  await b.find(isSnap);
  const bPid = b.pid;
  b.ws.terminate();
  // B's hero is bot-controlled while B is away
  const away = await a.next<Extract<ServerMsg, { t: 'snap' }>>((m) => m.t === 'snap' && m.s.board.some((x) => x.pid === bPid && x.bot));
  assert.ok(away);
  // reconnect
  const b2 = await TestClient.connect(bPid);
  assert.equal(b2.pid, bPid, 'pid is preserved');
  const rm = await b2.find((m) => m.t === 'room');
  assert.equal((rm as Extract<ServerMsg, { t: 'room' }>).room.started, true);
  const init = (await b2.find((m) => m.t === 'init')) as Extract<ServerMsg, { t: 'init' }>;
  assert.equal(init.init.you, bPid);
  const snap = (await b2.find(isSnap)) as Extract<ServerMsg, { t: 'snap' }>;
  assert.ok(snap.s.me);
  await a.next((m) => m.t === 'snap' && m.s.board.some((x) => x.pid === bPid && !x.bot));
  // control works again
  const pb = init.init.players.find((p) => p.playerId === bPid)!;
  const pos = (s: Snapshot) => { const u = s.units.find((x) => x[0] === pb.unitId)!; return { x: u[3], z: u[4] }; };
  await sleep(100);
  const p0 = pos(b2.last('snap')!.s);
  b2.send({ t: 'cmd', cmd: { c: 'move', x: p0.x * 0.8, z: p0.z + 12 } });
  await sleep(1500);
  const p1 = pos(b2.last('snap')!.s);
  assert.ok(Math.hypot(p1.x - p0.x, p1.z - p0.z) > 2);
  // the seat survives the grace period because we reconnected
  await sleep(GRACE + 300);
  assert.equal(a.last('room')!.room.slots.filter((s) => !s.bot).length, 2);

  // a second connection with the same pid replaces the first one (refresh / duplicated tab)
  const b3 = await TestClient.connect(bPid);
  assert.equal(b3.pid, bPid);
  await b3.find((m) => m.t === 'init');
  await sleep(100);
  assert.equal(b2.closeCode, 4001);

  // late joiner takes over the bot seat of the enemy team
  const c = await TestClient.connect();
  c.send({ t: 'join', code, name: 'Cy' });
  const ci = (await c.find((m) => m.t === 'init')) as Extract<ServerMsg, { t: 'init' }>;
  assert.equal(ci.init.you, c.pid);
  assert.equal(ci.init.players.filter((p) => !p.bot).length, 3);
  assert.equal(ci.init.players.length, 4);
  assert.equal(ci.init.players.filter((p) => p.playerId === c.pid).length, 1);
  await c.find(isSnap);
  assert.ok(c.last('snap')!.s.me);
  // everyone else is told about the new roster
  await a.find((m) => m.t === 'init' && m.init.players.some((p) => p.playerId === c.pid));
  // the last bot seat goes to the next late joiner; after that there is no seat left
  const d = await TestClient.connect();
  d.send({ t: 'join', code, name: 'Di' });
  assert.equal(((await d.find((m) => m.t === 'init')) as Extract<ServerMsg, { t: 'init' }>).init.players.filter((p) => !p.bot).length, 4);
  const e = await TestClient.connect();
  const eerr = e.next<Extract<ServerMsg, { t: 'error' }>>((m) => m.t === 'error');
  e.send({ t: 'join', code, name: 'Ed' });
  assert.match((await eerr).msg, /no bot seat/i);
  await sleep(100);
  assert.equal(e.msgs.filter((m) => m.t === 'room').length, 0, 'rejected joiner is not attached to the room');
  e.close();

  for (const x of [a, b3, c, d]) x.send({ t: 'leave' });
  await sleep(150);
  assert.equal(await health(), 'ok 0 rooms');
  for (const x of [a, b, b2, b3, c, d]) x.close();
});

test('a dropped player in the lobby is removed after the grace period, host migrates, empty rooms are deleted', async () => {
  const a = await TestClient.connect();
  const b = await TestClient.connect();
  const code = (await a.act({ t: 'create', name: 'Alice' }, () => true)).code;
  await b.act({ t: 'join', code, name: 'Bob' }, (r) => r.slots.length === 2);
  // host connection drops: host moves to the connected player immediately
  a.ws.terminate();
  const r = await b.room((x) => x.host === b.pid);
  assert.equal(r.slots.length, 2, 'seat is held during the grace period');
  const rr = await b.room((x) => x.slots.length === 1, GRACE + 1500);
  assert.equal(rr.slots[0].pid, b.pid);
  // the last player vanishing deletes the room after the grace period too
  b.ws.terminate();
  assert.equal(await health(), 'ok 1 rooms');
  await sleep(GRACE + 300);
  assert.equal(await health(), 'ok 0 rooms');
  // a stale reconnect to a deleted room: pid is accepted, no room, no crash
  const b2 = await TestClient.connect(b.pid);
  assert.equal(b2.msgs.some((m) => m.t === 'room'), false);
  b2.close();
});

test('end of match: host returns everyone to the lobby of the same room, then can play again', async () => {
  const a = await TestClient.connect();
  const b = await TestClient.connect();
  const code = (await a.act({ t: 'create', name: 'Alice' }, () => true)).code;
  await b.act({ t: 'join', code, name: 'Bob' }, (r) => r.slots.length === 2);
  await a.act({ t: 'hero', heroId: HEROES[4].id }, (r) => slotOf(r, a.pid).heroId === HEROES[4].id);
  await a.act({ t: 'addBot', team: 0 }, (r) => r.slots.some((s) => s.bot)); // manual bot survives a rematch
  a.send({ t: 'start' });
  await b.find((m) => m.t === 'init');
  const started = await a.room((r) => r.started);
  const nStarted = started.slots.length;
  assert.ok(nStarted > 3, 'bots were filled in');
  // force a result
  const room = _internals.rooms.get(code)!;
  room.game!.winner = 0;
  await a.next((m) => m.t === 'snap' && m.s.winner === 0);
  await b.next((m) => m.t === 'snap' && m.s.winner === 0);
  // non-host cannot return
  b.send({ t: 'lobbyReturn' });
  await sleep(150);
  assert.equal(a.last('room')!.room.started, true);
  // host can
  const back = await a.act({ t: 'lobbyReturn' }, (r) => !r.started);
  await b.room((r) => !r.started);
  assert.equal(back.code, code);
  assert.equal(back.slots.filter((s) => !s.bot).length, 2);
  assert.equal(back.slots.filter((s) => s.bot).length, 1, 'only the manually added bot remains');
  assert.equal(slotOf(back, a.pid).heroId, HEROES[4].id, 'hero pick is remembered');
  assert.equal(room.loop, null);
  // everything works again: start a second match
  const init2 = b.next<Extract<ServerMsg, { t: 'init' }>>((m) => m.t === 'init');
  a.send({ t: 'start' });
  assert.equal((await init2).init.you, b.pid);
  const s = await b.next<Extract<ServerMsg, { t: 'snap' }>>((m) => m.t === 'snap');
  assert.equal(s.s.winner, undefined);
  assert.ok(s.s.me);
  a.send({ t: 'leave' }); b.send({ t: 'leave' });
  await sleep(100);
  a.close(); b.close();
});
