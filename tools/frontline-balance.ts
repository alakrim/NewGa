/**
 * Frontline balance harness. Run with: npx tsx tools/frontline-balance.ts [seeds=24] [capMinutes=25]
 *
 * Plays seeded 2v2 bot matches through the real simulation and prints match length, how many matches
 * never finish, win rate per bot build plan, and where gold comes from. Deterministic per seed.
 * Pass --md to print a Markdown block for docs/BALANCE-REPORT.md.
 */
import { Game, type PlayerSetup } from '../src/shared/sim/game';
import { HEROES } from '../src/shared/data/heroes';
import { TICK_RATE } from '../src/shared/constants';
import { FL_UNITS } from '../src/shared/frontline/data';
import { PLANS } from '../src/shared/frontline/bot';

const args = process.argv.slice(2).filter((a) => !a.startsWith('--'));
const SEEDS = Number(args[0] ?? 24);
const CAP_MIN = Number(args[1] ?? 25);
const MD = process.argv.includes('--md');
console.error = () => {}; // the sim reports caught effect exceptions; they are not what we measure here

export interface MatchResult {
  seed: number;
  minutes: number; // capped at CAP_MIN when unfinished
  winner: number | null;
  plans: [number[], number[]]; // plan index of each bot, per team
  gold: { passive: number; banners: number; markets: number; mining: number; rewards: number };
  armyAt10: [number, number];
}

export function playMatch(seed: number, capMin = CAP_MIN): MatchResult {
  const setups: PlayerSetup[] = [0, 1, 2, 3].map((i) => ({
    pid: `b${i}`, name: `B${i}`, team: (i % 2) as 0 | 1, heroId: HEROES[(seed * 7 + i * 5) % HEROES.length].id, bot: true,
  }));
  const g = new Game(setups, seed, { mode: 'frontline' });
  const f = g.front!;
  const gold = { passive: 0, banners: 0, markets: 0, mining: 0, rewards: 0 };
  // instrument: rewards go through giveGold, income through Frontline.income (called once per second per player)
  const giveGold = g.giveGold.bind(g);
  g.giveGold = (u, amount) => { gold.rewards += amount; giveGold(u, amount); };
  const income = f.income.bind(f);
  f.income = (p) => {
    const total = income(p);
    const markets = 2 * f.completed(p, 'market');
    gold.markets += markets;
    gold.passive += Math.min(total - markets, 3);
    gold.banners += Math.max(0, total - markets - 3);
    return total;
  };
  const armyValue = (team: number) => {
    let v = 0;
    for (const u of g.units.values()) if (!u.dead && u.team === team && u.fl && u.fl.type !== 'miner') v += FL_UNITS[u.fl.type].cost;
    for (const p of f.players) if (p.team === team) for (const u of p.garrison) if (u.fl!.type !== 'miner') v += FL_UNITS[u.fl!.type].cost;
    return v;
  };
  let armyAt10: [number, number] = [0, 0];
  const cap = capMin * 60 * TICK_RATE;
  let t = 0;
  for (; t < cap && g.winner === null; t++) {
    g.step();
    for (const e of (g as any).events as { e: string; id: number; a: number }[]) if (e.e === 'gold' && g.units.get(e.id)?.fl) gold.mining += e.a;
    g.flushEvents();
    if (t === 10 * 60 * TICK_RATE) armyAt10 = [armyValue(0), armyValue(1)];
  }
  const plans: [number[], number[]] = [[], []];
  for (const [id, brain] of (g as any).bots as Map<number, { planIndex?: number }>) {
    const u = g.units.get(id);
    if (u && brain.planIndex !== undefined) plans[u.team as 0 | 1].push(brain.planIndex);
  }
  return { seed, minutes: t / TICK_RATE / 60, winner: g.winner, plans, gold, armyAt10 };
}

export function summarize(rs: MatchResult[], capMin = CAP_MIN) {
  const done = rs.filter((r) => r.winner !== null);
  const mins = done.map((r) => r.minutes).sort((a, b) => a - b);
  const q = (p: number) => (mins.length ? mins[Math.min(mins.length - 1, Math.floor(p * mins.length))] : NaN);
  const plan = PLANS.map(() => ({ games: 0, wins: 0 }));
  for (const r of done) for (const team of [0, 1] as const) for (const pi of r.plans[team]) { plan[pi].games++; if (r.winner === team) plan[pi].wins++; }
  const g = { passive: 0, banners: 0, markets: 0, mining: 0, rewards: 0 };
  for (const r of rs) for (const k of Object.keys(g) as (keyof typeof g)[]) g[k] += r.gold[k];
  const gt = Object.values(g).reduce((a, b) => a + b, 0) || 1;
  return {
    matches: rs.length,
    unfinished: rs.length - done.length,
    within20: done.filter((r) => r.minutes <= 20).length,
    median: q(0.5), p10: q(0.1), p90: q(0.9), capMin,
    team0Wins: done.filter((r) => r.winner === 0).length,
    plans: plan.map((p, i) => ({ plan: i, games: p.games, winRate: p.games ? p.wins / p.games : NaN })),
    goldShare: Object.fromEntries(Object.entries(g).map(([k, v]) => [k, v / gt])) as Record<keyof typeof g, number>,
  };
}

function main() {
  const rs: MatchResult[] = [];
  for (let s = 1; s <= SEEDS; s++) {
    const r = playMatch(s);
    rs.push(r);
    process.stdout.write(`seed ${s}: ${r.winner === null ? 'unfinished' : `team ${r.winner} won`} at ${r.minutes.toFixed(1)} min\n`);
  }
  const s = summarize(rs);
  const pct = (x: number) => `${Math.round(x * 100)}%`;
  const lines = [
    `| Matches | Unfinished (> ${s.capMin} min) | Finished within 20 min | Median | 10th-90th percentile | Team 0 wins |`,
    '|---|---|---|---|---|---|',
    `| ${s.matches} | ${s.unfinished} | ${s.within20} | ${s.median.toFixed(1)} min | ${s.p10.toFixed(1)}-${s.p90.toFixed(1)} min | ${s.team0Wins} |`,
    '',
    '| Bot plan | Player-games | Win rate |',
    '|---|---|---|',
    ...s.plans.map((p) => `| ${p.plan} | ${p.games} | ${Number.isNaN(p.winRate) ? 'n/a' : pct(p.winRate)} |`),
    '',
    '| Gold source | Share |',
    '|---|---|',
    ...Object.entries(s.goldShare).map(([k, v]) => `| ${k} | ${pct(v)} |`),
  ];
  process.stdout.write((MD ? '' : '\n') + lines.join('\n') + '\n');
}

if (process.argv[1] && /frontline-balance/.test(process.argv[1])) main();
