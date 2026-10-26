import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Game, type PlayerSetup } from '../src/shared/sim/game';
import { HEROES } from '../src/shared/data/heroes';
import { FL_PLOTS, FL_UNITS } from '../src/shared/frontline/data';

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
