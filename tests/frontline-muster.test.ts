import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Game, type PlayerSetup } from '../src/shared/sim/game';
import { HEROES } from '../src/shared/data/heroes';
import { FL, FL_BUILDINGS, FL_PLOTS } from '../src/shared/frontline/data';

const quiet = <T>(f: () => T): T => { const o = console.error; console.error = () => {}; try { return f(); } finally { console.error = o; } };
const duo = (): PlayerSetup[] => [
  { pid: 'me', name: 'Me', team: 0, heroId: HEROES[0].id, bot: false },
  { pid: 'ally', name: 'Ally', team: 0, heroId: HEROES[5].id, bot: false },
  { pid: 'e1', name: 'E1', team: 1, heroId: HEROES[10].id, bot: false },
  { pid: 'e2', name: 'E2', team: 1, heroId: HEROES[15].id, bot: false },
];
const run = (g: Game, seconds: number) => { for (let i = 0; i < seconds * 20; i++) { g.step(); g.flushEvents(); } };

test('frontline: garrisoned units keep a flag, count for pop, get research and come back clean', () => quiet(() => {
  const g = new Game(duo(), 5, { mode: 'frontline' });
  const f = g.front!, me = f.player('me')!;
  const purse = g.heroOf('me')!.hero!;
  purse.gold = 5000;
  const plot = FL_PLOTS.find((p) => p.team === 0 && p.slot === me.slot)!;
  g.command('me', { c: 'buildAt', plot: plot.index, building: 'forge' });
  run(g, FL_BUILDINGS.forge.buildTime + 1);
  purse.gold = 5000;
  for (let i = 0; i < 4; i++) f.spawnUnit(me, 'swordsman');
  g.command('me', { c: 'stance', stance: 'garrison' });
  run(g, 20);
  assert.ok(me.garrison.length >= 4, 'units hide in the keep');
  assert.ok(me.garrison.every((u) => u.fl!.garrisoned && !g.units.has(u.id)), 'flagged and parked');
  assert.equal(f.everyone(me, (u) => u.fl!.type === 'swordsman').length, 4);
  const pop = f.pop(me);
  const sword = me.garrison.find((u) => u.fl!.type === 'swordsman')!;
  const dmg = sword.stats.attackDamage;
  g.command('me', { c: 'research', kind: 'weapons' });
  assert.ok(sword.stats.attackDamage > dmg, 'research reaches garrisoned units');
  assert.equal(f.pop(me), pop, 'population is unchanged');
  sword.statuses.push({ kind: 'slow', until: g.time + 1000 } as never);
  g.command('me', { c: 'stance', stance: 'defend' });
  assert.equal(me.garrison.length, 0);
  assert.ok(g.units.has(sword.id) && !sword.fl!.garrisoned, 'back in the world, flag cleared');
  assert.equal(sword.statuses.length, 0, 'stale statuses dropped');
}));

test('frontline: in Attack, new units muster until a group forms, then march together', () => quiet(() => {
  const g = new Game(duo(), 9, { mode: 'frontline' });
  const f = g.front!, me = f.player('me')!;
  g.command('me', { c: 'stance', stance: 'attack' });
  const first = f.spawnUnit(me, 'swordsman');
  assert.ok(first.fl!.muster, 'reinforcement starts mustering');
  assert.ok(!f.spawnUnit(me, 'miner').fl!.muster, 'miners never muster');
  const mx = f.musterX(0);
  run(g, 20);
  assert.ok(first.fl!.muster, 'still waiting alone');
  assert.ok(Math.abs(first.x - mx) < 14, `waits near the muster point (${first.x.toFixed(1)} vs ${mx})`);
  for (let i = 0; i < FL.musterGroup - 1; i++) f.spawnUnit(me, 'swordsman');
  run(g, 40);
  const army = f.owned(me, (u) => u.fl!.type === 'swordsman');
  assert.ok(army.every((u) => !u.fl!.muster), 'group released once enough gathered');
  assert.ok(army.every((u) => u.x > mx + 5), 'and they march on the enemy');
  // leaving Attack releases waiting units
  const late = f.spawnUnit(me, 'archer');
  assert.ok(late.fl!.muster);
  g.command('me', { c: 'stance', stance: 'defend' });
  run(g, 1);
  assert.ok(!late.fl!.muster);
}));

test('frontline: giveGold sends 100-gold chunks to the teammate only', () => quiet(() => {
  const g = new Game(duo(), 5, { mode: 'frontline' });
  const me = g.heroOf('me')!.hero!, ally = g.heroOf('ally')!.hero!, foe = g.heroOf('e1')!.hero!;
  me.gold = 450; ally.gold = 0; foe.gold = 0;
  g.command('me', { c: 'giveGold' });
  assert.deepEqual([me.gold, ally.gold], [350, 100]);
  g.command('me', { c: 'giveGold', chunks: 3 });
  assert.deepEqual([me.gold, ally.gold], [50, 400]);
  g.command('me', { c: 'giveGold' }); // not enough
  g.command('me', { c: 'giveGold', chunks: -2 });
  g.command('me', { c: 'giveGold', chunks: NaN });
  assert.deepEqual([me.gold, ally.gold, foe.gold], [50, 400, 0]);
  me.gold = 10000;
  g.command('me', { c: 'giveGold', chunks: 99 });
  assert.equal(me.gold, 10000 - FL.giveChunk * FL.giveMaxChunks, 'capped per command');
  assert.equal(foe.gold, 0);
  const r = JSON.parse(JSON.stringify(g.replay()));
  assert.ok(r.log.some((e: { c: { c: string } }) => e.c.c === 'giveGold'), 'logged for replays');
}));

test('frontline: giveGold is a no-op without a teammate', () => quiet(() => {
  const g = new Game([
    { pid: 'me', name: 'Me', team: 0, heroId: HEROES[0].id, bot: false },
    { pid: 'e1', name: 'E1', team: 1, heroId: HEROES[10].id, bot: false },
  ], 5, { mode: 'frontline' });
  const me = g.heroOf('me')!.hero!, foe = g.heroOf('e1')!.hero!;
  me.gold = 500; foe.gold = 0;
  g.command('me', { c: 'giveGold', chunks: 2 });
  assert.deepEqual([me.gold, foe.gold], [500, 0]);
}));
