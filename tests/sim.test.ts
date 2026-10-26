import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Game, type PlayerSetup } from '../src/shared/sim/game';
import { HEROES } from '../src/shared/data/heroes';
import { TICK_RATE } from '../src/shared/constants';

function botMatch(seed: number, perTeam = 5): Game {
  const setups: PlayerSetup[] = [];
  for (let i = 0; i < perTeam * 2; i++) {
    const h = HEROES[(i * 7 + seed) % HEROES.length];
    setups.push({ pid: `b${i}`, name: `Bot${i}`, team: (i % 2) as 0 | 1, heroId: h.id, bot: true });
  }
  return new Game(setups, seed);
}

test('a full bot match runs without errors and produces a game', () => {
  const g = botMatch(3);
  const errors: unknown[] = [];
  const orig = console.error;
  console.error = (...a: unknown[]) => { errors.push(a); };
  const t0 = performance.now();
  const minutes = Number(process.env.SIM_MINUTES ?? 12);
  let snapBytes = 0;
  for (let i = 0; i < minutes * 60 * TICK_RATE && g.winner === null; i++) {
    g.step();
    if (i % 200 === 0) snapBytes = Math.max(snapBytes, JSON.stringify(g.snapshot('b0', 0)).length);
    g.flushEvents();
  }
  console.error = orig;
  const ms = performance.now() - t0;
  const heroes = [...g.units.values()].filter((u) => u.hero);
  const kills = heroes.reduce((a, u) => a + u.hero!.kills, 0);
  const levels = heroes.map((u) => u.hero!.level);
  const items = heroes.map((u) => u.hero!.items.filter(Boolean).length);
  const towersDown = [...g.units.values()].filter((u) => u.kind === 'tower' && u.dead).length;
  const captured = g.banners.filter((b) => b.owner !== b.homeTeam).length;
  console.log({ simMinutes: (g.time / 60).toFixed(1), msPerTick: (ms / g.tick).toFixed(3), kills, levels, items, towersDown, captured, winner: g.winner, maxSnapKB: (snapBytes / 1024).toFixed(1), units: g.units.size, errors: errors.length });
  if (errors.length) console.log(errors.slice(0, 5));
  assert.equal(errors.length, 0, 'effects threw errors');
  assert.ok(kills > 0, 'heroes should fight');
  assert.ok(Math.max(...levels) >= 6, 'heroes should level');
  assert.ok(items.some((n) => n >= 2), 'bots should buy items');
  assert.ok(ms / g.tick < 8, 'sim must stay well under the 50ms tick budget');
});

test('every hero ability can be cast without throwing', () => {
  for (const def of HEROES) {
    const g = new Game([
      { pid: 'a', name: 'A', team: 0, heroId: def.id, bot: false },
      { pid: 'b', name: 'B', team: 1, heroId: HEROES[0].id === def.id ? HEROES[1].id : HEROES[0].id, bot: false },
    ], 1);
    const a = g.heroOf('a')!, b = g.heroOf('b')!;
    a.x = 0; a.z = -40; b.x = 4; b.z = -40;
    a.hero!.level = 15; g.recompute(a); a.hp = a.stats.maxHp; a.mana = a.stats.maxMana;
    const errs: unknown[] = [];
    const orig = console.error;
    console.error = (...x: unknown[]) => errs.push(x);
    for (const slot of ['Q', 'W', 'E', 'R'] as const) {
      a.hero!.cd = [0, 0, 0, 0]; a.mana = a.stats.maxMana; a.statuses = []; a.cast = null; a.dash = null; a.displaced = null;
      g.command('a', { c: 'cast', slot, x: b.x, z: b.z, id: b.id });
      for (let i = 0; i < 60; i++) { g.step(); g.flushEvents(); }
      b.hp = b.stats.maxHp; b.dead = false;
    }
    console.error = orig;
    assert.equal(errs.length, 0, `${def.id}: ${JSON.stringify(errs[0])?.slice(0, 300)}`);
  }
});
