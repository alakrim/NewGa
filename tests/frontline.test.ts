import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Game, type PlayerSetup } from '../src/shared/sim/game';
import { HEROES } from '../src/shared/data/heroes';
import { CASTLE, FL, FL_BANNERS, FL_BUILDINGS, FL_NODES, FL_PLOTS, FL_UNITS, dropPos } from '../src/shared/frontline/data';

const quiet = <T>(f: () => T): T => { const o = console.error; console.error = () => {}; try { return f(); } finally { console.error = o; } };

test('frontline: economy, training, building, research and stances work for a human player', () => quiet(() => {
  const setups: PlayerSetup[] = [
    { pid: 'me', name: 'Me', team: 0, heroId: HEROES[0].id, bot: false },
    { pid: 'ally', name: 'Ally', team: 0, heroId: HEROES[5].id, bot: true },
    { pid: 'e1', name: 'E1', team: 1, heroId: HEROES[10].id, bot: true },
    { pid: 'e2', name: 'E2', team: 1, heroId: HEROES[15].id, bot: true },
  ];
  const g = new Game(setups, 7, { mode: 'frontline' });
  const f = g.front!;
  const me = f.player('me')!;
  const purse = () => g.heroOf('me')!.hero!.gold;
  assert.equal(f.owned(me, (u) => u.fl!.type === 'miner').length, 2, 'starts with two miners');
  const plot = FL_PLOTS.find((p) => p.team === 0 && p.slot === me.slot)!;
  g.command('me', { c: 'buildAt', plot: plot.index, building: 'barracks' });
  assert.equal(f.plots[plot.index].building, 'barracks');
  g.command('me', { c: 'train', unit: 'swordsman', count: 2 });
  g.command('me', { c: 'train', unit: 'shieldbearer' }); // barracks not finished yet: refused
  assert.equal(me.queues.barracks.length, 0);
  const startGold = purse();
  for (let i = 0; i < 20 * 60; i++) { g.step(); g.flushEvents(); }
  assert.ok(f.completed(me, 'barracks') === 1, 'barracks finishes');
  assert.equal(f.owned(me, (u) => u.fl!.type === 'swordsman').length >= 1, true, 'trained swordsmen');
  assert.ok(purse() > startGold - 300, 'miners and passive income pay');
  g.heroOf('me')!.hero!.gold = 5000;
  g.command('me', { c: 'train', unit: 'shieldbearer' });
  assert.equal(me.queues.barracks.length, 1);
  g.command('me', { c: 'stance', stance: 'garrison' });
  for (let i = 0; i < 20 * 20; i++) { g.step(); g.flushEvents(); }
  assert.ok(me.garrison.length >= 3, 'units hide in the keep');
  g.command('me', { c: 'stance', stance: 'attack' });
  g.step();
  assert.equal(me.garrison.length, 0, 'garrison released');
  const snap = g.snapshot('me', 0);
  assert.ok(snap.fl && snap.fl.players.length === 4 && snap.fl.plots.length === FL_PLOTS.length);
  assert.ok(snap.fl.players.find((p) => p.team === 1)!.gold === -1, 'enemy gold hidden');
  void FL_UNITS;
}));

test('frontline: a bot match produces armies, fights and a replay that re-simulates exactly', () => quiet(() => {
  const setups: PlayerSetup[] = [0, 1, 2, 3].map((i) => ({ pid: `b${i}`, name: `B${i}`, team: (i % 2) as 0 | 1, heroId: HEROES[i * 4].id, bot: true }));
  const g = new Game(setups, 3, { mode: 'frontline' });
  for (let i = 0; i < 20 * 60 * 6 && g.winner === null; i++) { g.step(); g.flushEvents(); }
  const army = [...g.units.values()].filter((u) => u.fl && u.fl.type !== 'miner' && !u.dead).length;
  assert.ok(army > 4, `armies exist (${army})`);
  const kills = [...g.units.values()].filter((u) => u.hero).reduce((a, u) => a + u.hero!.level, 0);
  assert.ok(kills > 4, 'heroes gained levels from fighting');
  const r = JSON.parse(JSON.stringify(g.replay()));
  const h = Game.fromReplay(r);
  for (let i = 0; i < r.ticks; i++) { h.step(); h.flushEvents(); }
  const sig = (x: Game) => [...x.units.values()].filter((u) => u.hero).map((u) => `${u.x.toFixed(2)},${u.z.toFixed(2)}:${Math.round(u.hero!.gold)}`).join(' ');
  assert.equal(sig(h), sig(g));
}));

const duo = (): PlayerSetup[] => [
  { pid: 'me', name: 'Me', team: 0, heroId: HEROES[0].id, bot: false },
  { pid: 'ally', name: 'Ally', team: 0, heroId: HEROES[5].id, bot: false },
  { pid: 'e1', name: 'E1', team: 1, heroId: HEROES[10].id, bot: false },
  { pid: 'e2', name: 'E2', team: 1, heroId: HEROES[15].id, bot: false },
];
const run = (g: Game, seconds: number) => { for (let i = 0; i < seconds * 20; i++) { g.step(); g.flushEvents(); } };

test('frontline: Follow stance forms the army up behind the hero', () => quiet(() => {
  const g = new Game(duo(), 11, { mode: 'frontline' });
  const f = g.front!, me = f.player('me')!;
  const hero = g.heroOf('me')!;
  for (let i = 0; i < 6; i++) f.spawnUnit(me, 'swordsman');
  g.command('me', { c: 'stance', stance: 'follow' });
  const meanX = () => { const a = f.owned(me, (u) => u.fl!.type === 'swordsman'); return a.reduce((s, u) => s + u.x, 0) / a.length; };
  for (const x of [-40, -10]) {
    g.command('me', { c: 'move', x, z: 0 });
    run(g, 14);
    assert.ok(Math.abs(hero.x - x) < 2, `hero reached ${x} (${hero.x.toFixed(1)})`);
    assert.ok(Math.abs(meanX() - (x - FL.followOffset)) < 4, `army follows the hero to ${x} (mean ${meanX().toFixed(1)})`);
  }
}));

test('frontline: Sudden Death crumbles both keeps, strips their armour and raises income', () => quiet(() => {
  const g = new Game(duo(), 5, { mode: 'frontline' });
  const f = g.front!, me = f.player('me')!;
  const keeps = f.castles.map((id) => g.units.get(id)!);
  const income = f.income(me);
  g.time = FL.suddenDeathAt - 0.5;
  run(g, 61);
  for (const k of keeps) {
    assert.ok(k.hp < k.stats.maxHp - FL.suddenDeathCrumble * 50, `keep crumbles (${Math.round(k.hp)})`);
    assert.ok(k.stats.armor < 60 && k.stats.hpRegen === 0, 'armour drops and regen stops');
  }
  assert.ok(f.income(me) >= income + 2, 'income ramps');
}));

test('frontline: garrison firepower is capped', () => quiet(() => {
  const g = new Game(duo(), 5, { mode: 'frontline' });
  const f = g.front!, me = f.player('me')!;
  for (let i = 0; i < 30; i++) f.spawnUnit(me, 'swordsman');
  g.command('me', { c: 'stance', stance: 'garrison' });
  run(g, 20);
  assert.ok(me.garrison.length > FL.garrisonArrowsCap, `units garrisoned (${me.garrison.length})`);
  const keep = g.units.get(f.castles[0])!;
  assert.ok(Math.abs(keep.baseStats.attackSpeed - CASTLE.attackSpeed * (1 + FL.garrisonArrowsPerUnit * FL.garrisonArrowsCap)) < 1e-6);
}));

test('frontline: rich veins unload at the nearest held banner', () => quiet(() => {
  const g = new Game(duo(), 5, { mode: 'frontline' });
  const f = g.front!;
  const rich = FL_NODES.find((n) => n.rich && n.x < 0)!;
  const safe = FL_NODES.find((n) => !n.rich && n.team === 0)!;
  const west = FL_BANNERS.find((b) => b.key === 'west')!;
  assert.deepEqual(f.depot(0, safe), dropPos(0), 'safe veins unload at the keep');
  assert.deepEqual(f.depot(0, rich), { x: west.x, z: west.z }, 'the Dawn Outpost serves the west rich vein');
  f.banners.find((b) => b.key === 'heart')!.owner = 0;
  assert.deepEqual(f.depot(0, rich), { x: 0, z: FL_BANNERS[1].z }, 'holding the Heart moves the depot closer');
  f.banners.forEach((b) => { b.owner = 1; });
  assert.deepEqual(f.depot(0, rich), dropPos(0), 'with no banners, back to the keep');
}));

test('frontline: losing a trainer refunds its queue; underdogs earn more', () => quiet(() => {
  const g = new Game(duo(), 5, { mode: 'frontline' });
  const f = g.front!, me = f.player('me')!;
  const purse = g.heroOf('me')!.hero!;
  purse.gold = 5000;
  const plot = FL_PLOTS.find((p) => p.team === 0 && p.slot === me.slot)!;
  g.command('me', { c: 'buildAt', plot: plot.index, building: 'barracks' });
  run(g, FL_BUILDINGS.barracks.buildTime + 1);
  assert.equal(f.completed(me, 'barracks'), 1);
  g.command('me', { c: 'train', unit: 'shieldbearer', count: 3 });
  assert.equal(me.queues.barracks.length, 3);
  const before = purse.gold;
  const b = g.units.get(f.plots[plot.index].unitId)!;
  g.dealDamage(null, b, 1e6, 'true');
  g.step();
  assert.equal(me.queues.barracks.length, 0);
  assert.equal(purse.gold, before + 3 * FL_UNITS.shieldbearer.cost);
  // underdog bounty: team 0 has no army, team 1 has one
  const foe = f.player('e1')!;
  for (let i = 0; i < 4; i++) f.spawnUnit(foe, 'swordsman');
  run(g, 1.1);
  assert.ok(f.isUnderdog(0) && !f.isUnderdog(1));
  const hero = g.heroOf('me')!, enemyHero = g.heroOf('e1')!;
  assert.equal(f.heroBounty(enemyHero, hero), Math.round(FL.heroKillGold * FL.underdogBounty));
  enemyHero.hero!.level = 3;
  assert.equal(f.heroBounty(hero, enemyHero), FL.heroKillGold * 0.5, 'a level-3 hero killing a level-1 hero gets the 0.5 floor');
}));

test('frontline: a bot match always ends (Sudden Death bounds the length)', () => quiet(() => {
  const setups: PlayerSetup[] = [0, 1, 2, 3].map((i) => ({ pid: `b${i}`, name: `B${i}`, team: (i % 2) as 0 | 1, heroId: HEROES[(1 * 7 + i * 5) % HEROES.length].id, bot: true }));
  const g = new Game(setups, 1, { mode: 'frontline' });
  const cap = (FL.suddenDeathAt + CASTLE.hp / FL.suddenDeathCrumble + 30) * 20;
  for (let i = 0; i < cap && g.winner === null; i++) { g.step(); g.flushEvents(); }
  assert.notEqual(g.winner, null, `finished within ${(cap / 20 / 60).toFixed(1)} min`);
}));
