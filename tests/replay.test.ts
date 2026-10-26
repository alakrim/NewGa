import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Game, type PlayerSetup } from '../src/shared/sim/game';

test('a replay re-simulates the match exactly', () => {
  const setups: PlayerSetup[] = [
    { pid: 'me', name: 'Me', team: 0, heroId: 'zhal', bot: false },
    { pid: 'b1', name: 'B1', team: 1, heroId: 'aldric', bot: true },
    { pid: 'b2', name: 'B2', team: 0, heroId: 'tamsin', bot: true },
    { pid: 'b3', name: 'B3', team: 1, heroId: 'sable', bot: true },
  ];
  const g = new Game(setups, 42);
  const orig = console.error; console.error = () => {};
  for (let i = 0; i < 20 * 120; i++) {
    if (i === 100) g.command('me', { c: 'move', x: -40, z: -45 });
    if (i === 600) g.command('me', { c: 'cast', slot: 'Q', x: 0, z: -45 });
    if (i === 900) g.command('me', { c: 'buy', item: 'ley_touched_codex' });
    if (i === 1200) g.setBot('me', true);
    g.step(); g.flushEvents();
  }
  const r = JSON.parse(JSON.stringify(g.replay()));
  const h = Game.fromReplay(r);
  for (let i = 0; i < r.ticks; i++) { h.step(); h.flushEvents(); }
  console.error = orig;
  const sig = (x: Game) => [...x.units.values()].filter((u) => u.hero).map((u) => `${u.hero!.def.id}:${u.x.toFixed(3)},${u.z.toFixed(3)}:${Math.round(u.hp)}:${u.hero!.items.join('|')}`).join(' ');
  assert.equal(sig(h), sig(g));
  assert.ok(JSON.stringify(r).length < 20000, 'replays stay small');
});
