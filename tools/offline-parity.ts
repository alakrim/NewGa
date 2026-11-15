// Parity reference for the GDScript offline engine: plays a seeded Frontline bot match with the TypeScript engine
// and writes one digest line per tick (every unit's position, health and state, hero gold, projectile and zone
// counts, random numbers drawn). godot/offline/tests/parity.gd writes the same lines from the GDScript engine;
// tools/offline-parity-compare.mjs reports the first tick where they differ.
//   npx tsx tools/offline-parity.ts <seed> <ticks> <out.txt>
import { writeFileSync } from 'node:fs';
import { Game, type PlayerSetup } from '../src/shared/sim/game';
import { HEROES } from '../src/shared/data/heroes';

const pos = process.argv.slice(2).filter((a) => !a.startsWith('--'));
const seed = Number(pos[0] ?? 1);
const ticks = Number(pos[1] ?? 1200);
const out = pos[2] ?? 'parity-ts.txt';
console.error = () => {};
// The GDScript engine computes lengths as sqrt(x*x + z*z); Math.hypot rounds the last bit differently now and then.
// With --exact-hypot both use the same formula, so any remaining difference is a porting difference, not rounding.
if (process.argv.includes('--exact-hypot')) Math.hypot = ((a: number, b: number) => Math.sqrt(a * a + b * b)) as typeof Math.hypot;

/** The same setups the GDScript harness builds: four bots, heroes picked by seed. */
export function paritySetups(s: number): PlayerSetup[] {
  return [0, 1, 2, 3].map((i) => ({ pid: `b${i}`, name: `B${i}`, team: (i % 2) as 0 | 1, heroId: HEROES[(s * 7 + i * 5) % HEROES.length].id, bot: true }));
}

const f6 = (v: number) => (v + 0).toFixed(6);

export function digest(g: Game, calls: number): string {
  const parts: string[] = [`${g.tick}`, `r${calls}`];
  for (const u of g.units.values()) parts.push(`${u.id}:${u.kind}:${f6(u.x)}:${f6(u.z)}:${f6(u.hp)}:${u.dead ? 1 : 0}`);
  for (const u of g.units.values()) if (u.hero) parts.push(`g${u.id}:${f6(u.hero.gold)}:${u.hero.level}`);
  parts.push(`p${g.projectiles.length}`, `z${g.zones.length}`, `w${g.winner ?? '-'}`);
  return parts.join(' ');
}

if (process.argv[1] && /offline-parity\.ts$/.test(process.argv[1])) {
  const g = new Game(paritySetups(seed), seed, { mode: 'frontline' });
  let calls = 0;
  const orig = g.random;
  (g as unknown as { random: () => number }).random = () => { calls++; return orig(); };
  const lines = [digest(g, calls)];
  for (let i = 0; i < ticks && g.winner === null; i++) { g.step(); g.flushEvents(); lines.push(digest(g, calls)); }
  writeFileSync(out, lines.join('\n') + '\n');
  console.log(`wrote ${lines.length} ticks to ${out}`);
}
