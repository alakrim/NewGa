/**
 * Bannerfall balance harness. Run with: npx tsx tools/balance.ts
 *
 * Measures every hero through the real simulation (src/shared/sim) and writes
 * docs/BALANCE-REPORT.md. Every measurement builds fresh Games with a fixed seed,
 * so runs are deterministic. Simulation internals are reached through `as any`
 * only where marked.
 */
import { writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { Game, type PlayerSetup } from '../src/shared/sim/game';
import type { Unit } from '../src/shared/sim/world';
import { HEROES } from '../src/shared/data/heroes';
import { MINIONS, SUMMONS } from '../src/shared/units';
import { TICK_RATE } from '../src/shared/constants';
import type { AbilityDef, AbilitySlot, DamageType, HeroDef, Role } from '../src/shared/types';

const SEED = 1;
const REPORT_DATE = '2026-10-26';
const DUMMY_HERO = 'aldric';
const DUMMY_DISTANCE = 4; // hero centre to dummy centre, world units
const SLOTS: AbilitySlot[] = ['Q', 'W', 'E', 'R'];
const ROLES: Role[] = ['Tank', 'Fighter', 'Assassin', 'Mage', 'Marksman', 'Support'];
const WINDOW_S = 1.5; // sim seconds between burst casts
const AUTO_BURST_S = 3; // basic attacks after the burst casts
const DPS_S = 10; // sustained auto-attack window at level 6
const ISO_S = 6; // isolated single-ability observation window
const WAVE_SCRIPT_S = 4; // scripted casts + auto window that reports kills
const WAVE_CAP_S = 60; // max total time to clear the minion cluster
const CLOSE_DISTANCE = 2; // re-check distance for zero-damage abilities (area/cone at the caster may not reach 4 units)
const OUTLIER_THRESHOLD = 0.35;
const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const TICKS = (s: number) => Math.round(s * TICK_RATE);

// Console noise: the sim reports caught effect exceptions with console.error. Count them, do not print.
let simErrors = 0;
const errorSamples: string[] = [];
console.error = (...args: unknown[]) => {
  simErrors++;
  if (errorSamples.length < 8) errorSamples.push(args.map((a) => (a instanceof Error ? a.message : String(a))).join(' ').slice(0, 300));
};
const out = (s = '') => process.stdout.write(s + '\n');

// ------------------------------------------------------------------ rigs
interface Meter { ability: number; proc: number; summon: number; auto: number; heal: number; shield: number; autoPhase: boolean }
interface Rig { game: Game; hero: Unit; dummy: Unit | null; meter: Meter }

function makeGame(setups: PlayerSetup[]): Game {
  const game = new Game(setups, SEED);
  // internals: no natural waves or jungle camps during measurements
  (game as any).nextWaveAt = Infinity;
  (game as any).camps = [];
  return game;
}

function place(game: Game, u: Unit, x: number, z: number) {
  const p = game.nav.nearestOpen({ x, z });
  u.x = p.x; u.z = p.z; u.path = []; u.pathGoal = null;
}

/**
 * The dummy is a real aldric at the same level, so it keeps real max HP, armor and magic resist (percent-of-max-HP
 * effects see a realistic target). It never attacks, never regenerates, has no low-HP passive, and cannot die:
 * its death is suppressed so that damage keeps being counted. Its HP is reset at the start of every window.
 * recompute() rebuilds hero stats from `def`, so the overrides go into a cloned def rather than into baseStats.
 */
function makeDummy(game: Game, dummy: Unit, level: number) {
  const h = dummy.hero!;
  const d = h.def;
  h.def = {
    ...d,
    base: { ...d.base, hpRegen: 0, attackDamage: 0, attackRange: 0 },
    growth: { ...d.growth, hpRegen: 0, attackDamage: 0 },
    passive: { ...d.passive, onLowHp: undefined },
  };
  h.level = level;
  game.recompute(dummy);
  dummy.hp = dummy.stats.maxHp;
  // internals: death is suppressed for the dummy so it keeps absorbing damage (hp may go negative)
  const g = game as any;
  const kill = g.kill.bind(game);
  const dummyId = dummy.id;
  g.kill = (u: Unit, src: Unit | null) => { if (u.id !== dummyId) kill(u, src); };
}

function instrument(r: Rig) {
  // internals: wrap the damage, shield entry points so damage is split into direct ability damage,
  // on-hit procs (passives and empowered next hits, which run inside a basic hit) and basic-attack damage
  const g = r.game as any;
  const heroId = r.hero.id;
  const dummyId = r.dummy?.id ?? -1;
  let basicDepth = 0;
  const basicHit = g.basicHit.bind(r.game);
  g.basicHit = (u: Unit, t: Unit) => {
    basicDepth++;
    try { basicHit(u, t); } finally { basicDepth--; }
  };
  const dealDamage = g.dealDamage.bind(r.game);
  g.dealDamage = (src: Unit | null, tgt: Unit, raw: number, dtype: DamageType, opts?: { attack?: boolean }) => {
    const dealt: number = dealDamage(src, tgt, raw, dtype, opts);
    if (tgt.id === dummyId && dealt > 0) {
      if (src?.kind === 'summon') r.meter.summon += dealt; // hits from units the kit spawned
      else if (opts?.attack) r.meter.auto += dealt;
      else if (basicDepth > 0 || r.meter.autoPhase) r.meter.proc += dealt; // delayed on-hit ticks land outside basicHit
      else r.meter.ability += dealt;
    }
    return dealt;
  };
  const addShield = g.addShield.bind(r.game);
  g.addShield = (tgt: Unit, amount: number, duration: number) => {
    if (tgt.id === heroId && amount > 0) r.meter.shield += amount;
    addShield(tgt, amount, duration);
  };
}

function rig(heroId: string, level: number): Rig {
  const game = makeGame([
    { pid: 'a', name: 'Hero', team: 0, heroId, bot: false },
    { pid: 'b', name: 'Dummy', team: 1, heroId: DUMMY_HERO, bot: false },
  ]);
  const hero = game.heroOf('a')!;
  const dummy = game.heroOf('b')!;
  hero.hero!.level = level;
  game.recompute(hero);
  hero.hp = hero.stats.maxHp;
  hero.mana = hero.stats.maxMana;
  makeDummy(game, dummy, level);
  const r: Rig = { game, hero, dummy, meter: { ability: 0, proc: 0, summon: 0, auto: 0, heal: 0, shield: 0, autoPhase: false } };
  instrument(r);
  reanchor(r);
  return r;
}

/** Puts hero and dummy back on their marks and clears movement / cast state (abilities may have dashed or knocked them). */
function reanchor(r: Rig, dist = DUMMY_DISTANCE) {
  const { game, hero, dummy } = r;
  place(game, hero, 0, 0);
  hero.facing = Math.PI / 2; // +x, toward the dummy
  hero.order = { type: 'idle' }; hero.windup = null; hero.cast = null; hero.dash = null; hero.displaced = null;
  hero.hero!.steer = null;
  if (dummy) {
    place(game, dummy, dist, 0);
    dummy.order = { type: 'idle' }; dummy.windup = null; dummy.cast = null; dummy.dash = null; dummy.displaced = null;
    dummy.statuses = [];
    dummy.shields = [];
    dummy.hp = dummy.stats.maxHp;
  }
}

/** Reads heal events for the hero (before flushing) and advances the sim one tick. */
function step(r: Rig, holdAuto: boolean) {
  // Holding attackCd high stops idle auto-attacks while we measure a cast. The engine only starts a
  // basic attack when attackCd is 0, so this removes basic-attack damage from ability windows.
  if (holdAuto) r.hero.attackCd = 1e9;
  r.game.step();
  const events = (r.game as any).events as { e: string; id?: number; a?: number }[]; // internals: event buffer
  for (const ev of events) if (ev.e === 'heal' && ev.id === r.hero.id) r.meter.heal += ev.a ?? 0;
  r.game.flushEvents();
}

/** Casts a slot at the dummy (or self for self/ally targeting). Returns true if the cast started. */
function castSlot(r: Rig, slot: number): boolean {
  const h = r.hero.hero!;
  const def = h.def.abilities[slot];
  const onSelf = def.targeting === 'self' || def.targeting === 'ally';
  const onUnit = def.targeting === 'enemy' || def.targeting === 'unit' || def.targeting === 'ally';
  const target = onSelf ? r.hero : r.dummy!;
  h.cd[slot] = 0; // cooldown reset so each slot can be tested
  r.hero.mana = r.hero.stats.maxMana;
  r.game.command('a', { c: 'cast', slot: SLOTS[slot], x: target.x, z: target.z, id: onUnit ? target.id : undefined });
  return h.cd[slot] > 0;
}

// ------------------------------------------------------------------ measurements
interface BurstResult { total: number; ability: number; proc: number; summon: number; auto: number; heal: number; shield: number; cast: boolean[]; errors: number }

/** Q, W, E, R at the dummy with 1.5s between casts, then 3s of basic attacks. HP starts at 50% so self-healing is visible. */
function burst(heroId: string, level: number): BurstResult {
  const r = rig(heroId, level);
  const e0 = simErrors;
  r.hero.hp = r.hero.stats.maxHp * 0.5;
  const cast: boolean[] = [];
  for (let s = 0; s < 4; s++) {
    reanchor(r);
    cast.push(castSlot(r, s));
    for (let i = 0; i < TICKS(WINDOW_S); i++) step(r, true);
  }
  reanchor(r);
  r.hero.attackCd = 0;
  r.meter.autoPhase = true;
  r.game.command('a', { c: 'attack', id: r.dummy!.id });
  for (let i = 0; i < TICKS(AUTO_BURST_S); i++) step(r, false);
  const m = r.meter;
  return { total: m.ability + m.proc + m.summon + m.auto, ability: m.ability, proc: m.proc, summon: m.summon, auto: m.auto, heal: m.heal, shield: m.shield, cast, errors: simErrors - e0 };
}

interface IsoResult { ok: boolean; dmg: number; summon: number }
/** One slot cast alone on a fresh game, observed for ISO_S seconds. dmg = direct + proc damage, summon = summon hits. */
function isolated(heroId: string, level: number, slot: number, dist = DUMMY_DISTANCE): IsoResult {
  const r = rig(heroId, level);
  reanchor(r, dist);
  const ok = castSlot(r, slot);
  for (let i = 0; i < TICKS(ISO_S); i++) step(r, true);
  return { ok, dmg: r.meter.ability + r.meter.proc, summon: r.meter.summon };
}

/** Level 6 basic attacks only, for DPS_S seconds. */
function sustainedDps(heroId: string): { total: number; auto: number; other: number } {
  const r = rig(heroId, 6);
  reanchor(r);
  r.meter.autoPhase = true;
  r.game.command('a', { c: 'attack', id: r.dummy!.id });
  for (let i = 0; i < TICKS(DPS_S); i++) step(r, false);
  const m = r.meter;
  return { total: (m.ability + m.proc + m.summon + m.auto) / DPS_S, auto: m.auto / DPS_S, other: (m.ability + m.proc + m.summon) / DPS_S };
}

interface WaveResult { kills4: number; killed: number; cleared: boolean; clearS: number | null; heroDead: boolean; errors: number }
/**
 * Six melee lane minions in a ring (radius 1.2) six units in front of a level-6 hero. The hero casts Q, W, E, R
 * at the cluster (unit-targeted slots go to the nearest minion) and auto-attacks the nearest live minion.
 * Kills are counted at WAVE_SCRIPT_S. The run continues to WAVE_CAP_S to find the clear time.
 */
function waveClear(heroId: string): WaveResult {
  const game = makeGame([{ pid: 'a', name: 'Hero', team: 0, heroId, bot: false }]);
  const hero = game.heroOf('a')!;
  hero.hero!.level = 6;
  game.recompute(hero);
  hero.hp = hero.stats.maxHp;
  hero.mana = hero.stats.maxMana;
  place(game, hero, 0, 0);
  hero.facing = 0; // facing 0 = +z
  const centre = { x: 0, z: 6 };
  const minions: Unit[] = [];
  for (let i = 0; i < 6; i++) {
    const a = (i / 6) * Math.PI * 2;
    // internals: spawnFromTemplate is private; it is the only way to place enemy lane minions directly
    minions.push((game as any).spawnFromTemplate('minion', 1, MINIONS.melee, 'm:melee', { x: centre.x + Math.sin(a) * 1.2, z: centre.z + Math.cos(a) * 1.2 }, 1));
  }
  const e0 = simErrors;
  const pending: number[] = [0, 1, 2, 3];
  let pendingSince = 0;
  const deathAt = new Map<number, number>();
  let kills4 = -1;
  const nearestAlive = (): Unit | null => {
    let best: Unit | null = null, bd = Infinity;
    for (const m of minions) {
      if (m.dead) continue;
      const d = Math.hypot(m.x - hero.x, m.z - hero.z);
      if (d < bd) { bd = d; best = m; }
    }
    return best;
  };
  for (let i = 0; i < TICKS(WAVE_CAP_S); i++) {
    const near = nearestAlive();
    if (pending.length && !hero.cast) {
      const s = pending[0];
      const def: AbilityDef = hero.hero!.def.abilities[s];
      const onSelf = def.targeting === 'self' || def.targeting === 'ally';
      const onUnit = def.targeting === 'enemy' || def.targeting === 'unit';
      const at = onSelf ? hero : onUnit && near ? near : centre;
      const id = onSelf ? hero.id : onUnit && near ? near.id : undefined;
      hero.hero!.cd[s] = 0;
      hero.mana = hero.stats.maxMana;
      game.command('a', { c: 'cast', slot: SLOTS[s], x: at.x, z: at.z, id });
      if (hero.hero!.cd[s] > 0) { pending.shift(); pendingSince = i; }
      else if (i - pendingSince > TICKS(2)) pending.shift(); // give up on a slot after 2s of failed attempts
    }
    // keep the current target until it dies (castAt walks must not be interrupted)
    const current = hero.order.type === 'attack' ? game.units.get(hero.order.id) : undefined;
    if (hero.order.type !== 'castAt' && near && (!current || current.dead)) game.command('a', { c: 'attack', id: near.id });
    for (const m of minions) if (m.dead && !deathAt.has(m.id)) deathAt.set(m.id, game.time);
    if (kills4 < 0 && game.time >= WAVE_SCRIPT_S) kills4 = minions.filter((m) => m.dead).length;
    if (deathAt.size === minions.length) break;
    game.step();
    game.flushEvents();
  }
  if (kills4 < 0) kills4 = minions.filter((m) => m.dead).length;
  const cleared = deathAt.size === minions.length;
  return {
    kills4,
    killed: deathAt.size,
    cleared,
    clearS: cleared ? Math.max(...deathAt.values()) : null,
    heroDead: hero.dead,
    errors: simErrors - e0,
  };
}

// ------------------------------------------------------------------ kit inspection
function walk(node: unknown, visit: (o: Record<string, any>) => void) {
  if (Array.isArray(node)) { for (const n of node) walk(n, visit); return; }
  if (node && typeof node === 'object') {
    const o = node as Record<string, any>;
    if (typeof o.type === 'string') visit(o);
    for (const v of Object.values(o)) if (v && typeof v === 'object') walk(v, visit);
  }
}

/** Does this effect tree deal damage when cast? Next-hit (empower) damage does not count. */
function hasCastDamage(node: unknown): boolean {
  if (Array.isArray(node)) return node.some(hasCastDamage);
  if (!node || typeof node !== 'object') return false;
  const o = node as Record<string, any>;
  if (o.type === 'empower') return false;
  if (o.type === 'damage') return true;
  return Object.values(o).some((v) => v && typeof v === 'object' && hasCastDamage(v));
}

interface Kit { mobility: number; dashDist: number; castDamage: boolean[] }
function kit(def: HeroDef): Kit {
  let mobility = 0, dashDist = 0;
  const visit = (o: Record<string, any>) => {
    if (o.type === 'dash' || o.type === 'blink') { mobility++; dashDist += Number(o.distance) || 0; }
  };
  for (const a of def.abilities) walk(a.effects, visit);
  walk(def.passive, visit);
  return { mobility, dashDist, castDamage: def.abilities.map((a) => hasCastDamage(a.effects)) };
}

/** Damage terms with a `base` in an ability tree, as text, for the scaling suggestions. */
function damageBases(def: AbilityDef, k: number): string[] {
  const terms: string[] = [];
  const visit = (o: Record<string, any>) => {
    if (o.type === 'damage' && o.amount && typeof o.amount === 'object' && o.amount.base !== undefined) {
      const fmtB = (b: unknown) => (Array.isArray(b) ? `[${b.join(', ')}]` : String(b));
      const scaled = Array.isArray(o.amount.base) ? o.amount.base.map((x: number) => Math.round(x * k)) : Math.round(o.amount.base * k);
      terms.push(`${def.id} base ${fmtB(o.amount.base)} -> ${fmtB(scaled)}`);
    }
  };
  walk(def.effects, visit);
  return terms.slice(0, 2);
}

// ------------------------------------------------------------------ run everything
interface HeroResult {
  id: string; name: string; role: Role; def: HeroDef;
  b6: BurstResult; b12: BurstResult;
  iso6: IsoResult[]; iso12: IsoResult[];
  dps6: number; dps6Auto: number; dps6Other: number; wave: WaveResult;
  maxHp6: number; armor6: number; ehp6: number;
  kit: Kit; errors: number;
}

const results: HeroResult[] = [];
for (const def of HEROES) {
  const e0 = simErrors;
  const probe = rig(def.id, 6).hero.stats;
  const b6 = burst(def.id, 6);
  const b12 = burst(def.id, 12);
  const iso6 = SLOTS.map((_, s) => isolated(def.id, 6, s));
  const iso12 = SLOTS.map((_, s) => isolated(def.id, 12, s));
  const dps = sustainedDps(def.id);
  const wave = waveClear(def.id);
  results.push({
    id: def.id, name: def.name, role: def.role, def,
    b6, b12, iso6, iso12, dps6: dps.total, dps6Auto: dps.auto, dps6Other: dps.other, wave,
    maxHp6: probe.maxHp, armor6: probe.armor, ehp6: probe.maxHp * (1 + probe.armor / 100),
    kit: kit(def), errors: simErrors - e0,
  });
}

// ------------------------------------------------------------------ aggregates
const mean = (xs: number[]) => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : 0);
const roleAvg = (role: Role, f: (r: HeroResult) => number) => mean(results.filter((r) => r.role === role).map(f));
const roleAvgs = Object.fromEntries(ROLES.map((role) => [role, {
  n: results.filter((r) => r.role === role).length,
  b6: roleAvg(role, (r) => r.b6.total),
  b12: roleAvg(role, (r) => r.b12.total),
  dps: roleAvg(role, (r) => r.dps6),
}])) as Record<Role, { n: number; b6: number; b12: number; dps: number }>;

const pct = (x: number) => `${x >= 0 ? '+' : ''}${Math.round(x * 100)}%`;
const r0 = (x: number) => Math.round(x).toString();
const r1 = (x: number) => x.toFixed(1);

// ------------------------------------------------------------------ outliers
/** Hand-written investigation notes, keyed by hero id. Filled from the engine and content review. */
const HERO_NOTES: Record<string, Partial<Record<AbilitySlot, string>>> = {};
/** Zero-damage abilities that only deal damage at close range (not flagged). */
const geometryOnly: string[] = [];
/** Per-hero context for outliers (numbers are from this harness run). */
const OUTLIER_CONTEXT: Record<string, string> = {
  aldric: 'Q and E are his only direct damage (81 and 43 at L6, against 0 for W and R). Closing the 183 gap through Q alone would need Q about 3.3 times stronger, so this is a kit-design call (how much damage a tank should carry) rather than a number tweak.',
  pell: 'Pell\'s R (2 bone archers) and W (2 bone soldiers) carry most of the burst. His direct damage is small. The summon changes move the other heroes that use the same summon kinds, listed in the suggestion.',
  hallen: 'His W (2 bone soldiers) and R (bone brute) carry about half of the burst. His direct damage is Q and E. The summon changes move the other heroes listed in the suggestion.',
  sable: 'Venomed Blades procs (the on-hit repeat, three magic ticks) supply 31 of her 72 DPS, so the DPS gap is mostly the passive. Lowering base attack damage would also shrink her basic hits. Her burst is only just over the threshold (+35%), so a cut to R is not warranted on this evidence.',
};

/** Engine-level observations that apply across heroes. */
const ENGINE_NOTES: string[] = [
  'bonusAd ignores level growth. src/shared/sim/game.ts evalNum() takes `bonusAd` as a fraction of attackDamage above baseStats.attackDamage, but recompute() sets hero baseStats from heroBase(level), which already includes growth. Probe: with no items, bonusAd(1) is 0.00 at L1, L6 and L12 and rises by 1.00 with a +10 AD buff. src/shared/types.ts says "items/buffs/levels above base", and docs/BALANCE.md budgets 0.7-1.2 bonusAd for physical abilities, so levels should count. Effect: physical abilities with bonusAd (for example Sable Q at 0.8) get no level scaling until the hero has items. Suggested fix: measure growth against heroBase(def, 1) rather than the live baseStats.',
  'Sable W (Cloak of Thorns): its damage is an empower on her next basic hit, so it reads 0 in an isolated cast and its damage appears in the burst as procs. Designed behaviour, not flagged.',
  'Ally-targeted slots (for example Nerissa Q, a chain heal) were cast on the hero itself, so bounce or ally-only effects are under-measured.',
];

interface Finding { score: number; line: string }
const findings = new Map<string, Finding[]>();
const add = (id: string, f: Finding) => findings.set(id, [...(findings.get(id) ?? []), f]);

/** Hero ids whose kit spawns a given summon kind (a SUMMONS change moves all of them). */
function summonUsers(kind: string): string[] {
  return HEROES.filter((h) => summonKinds(h).includes(kind)).map((h) => h.id);
}

/** Summon units the kit spawns, from the effect tree. */
function summonKinds(def: HeroDef): string[] {
  const out: string[] = [];
  const visit = (o: Record<string, any>) => { if (o.type === 'summon' && typeof o.unit === 'string') out.push(o.unit); };
  for (const a of def.abilities) walk(a.effects, visit);
  walk(def.passive, visit);
  return [...new Set(out)];
}

for (const r of results) {
  const avg = roleAvgs[r.role];
  const metrics: { label: string; v: number; a: number; burst: boolean; base: 'b6' | 'b12' | 'dps' }[] = [
    { label: 'L6 burst', v: r.b6.total, a: avg.b6, burst: true, base: 'b6' },
    { label: 'L12 burst', v: r.b12.total, a: avg.b12, burst: true, base: 'b12' },
    { label: 'L6 DPS', v: r.dps6, a: avg.dps, burst: false, base: 'dps' },
  ];
  for (const m of metrics) {
    const dev = m.v / m.a - 1;
    if (Math.abs(dev) <= OUTLIER_THRESHOLD) continue;
    const delta = m.v - m.a; // positive = too high
    let sug: string;
    if (!m.burst) {
      const k = m.a / m.v;
      sug = `${r.id} base.attackDamage ${r.def.base.attackDamage} -> ${Math.round(r.def.base.attackDamage * k)} (scales auto DPS directly; ${r.name}'s on-hit procs are ${r0(r.dps6Other)} of ${r1(r.dps6)} DPS, so a passive change may be the better lever)`;
    } else {
      // pick the lever at this burst's level: summons if they carry a large share, else the top direct-damage ability
      const b = m.base === 'b12' ? r.b12 : r.b6;
      const iso = m.base === 'b12' ? r.iso12 : r.iso6;
      const lvl = m.base === 'b12' ? 12 : 6;
      const summonShare = b.summon / Math.max(1, b.total);
      const top = iso.reduce((best, x, i) => (x.dmg > iso[best].dmg ? i : best), 0);
      const topDmg = iso[top].dmg;
      const kinds = summonKinds(r.def);
      if (summonShare > 0.25 && kinds.length && b.summon - delta > 0) {
        const k = (b.summon - delta) / b.summon;
        const parts = kinds.map((u) => {
          const sd = SUMMONS[u as keyof typeof SUMMONS];
          return `SUMMONS.${u} attackDamage ${r0(sd.stats.attackDamage)} -> ${r0(sd.stats.attackDamage * k)} (also used by ${summonUsers(u).filter((x) => x !== r.id).join(', ') || 'no one else'})`;
        });
        sug = `summons supply ${Math.round(summonShare * 100)}% of L${lvl} burst (${r0(b.summon)}). Lever (src/shared/units.ts, factor ${k.toFixed(2)}): ${parts.join('; ')}`;
      } else if (topDmg > 0 && topDmg - delta > 0) {
        const k = (topDmg - delta) / topDmg;
        const big = k > 2 || k < 0.5 ? ` (factor ${k.toFixed(2)}: too large for one ability, check the kit design)` : '';
        sug = `${r.def.abilities[top].id} (${SLOTS[top]}, ${r0(topDmg)} direct at L${lvl}): ${damageBases(r.def.abilities[top], k).join('; ') || 'ratio-only damage, scale ap/bonusAd'}${big}`;
      } else sug = 'gap is larger than the top ability; spread across the kit';
    }
    add(r.id, {
      score: 100 * Math.abs(dev),
      line: `${m.label} ${m.burst ? r0(m.v) : r1(m.v)} is ${pct(dev)} vs ${r.role} avg ${m.burst ? r0(m.a) : r1(m.a)}. Suggest: ${sug}`,
    });
  }
  if (OUTLIER_CONTEXT[r.id]) add(r.id, { score: 0, line: `Context: ${OUTLIER_CONTEXT[r.id]}` });
  if (!r.wave.cleared) {
    add(r.id, {
      score: 500,
      line: `Wave clear failed: ${r.wave.kills4}/6 minions dead at ${WAVE_SCRIPT_S}s, ${r.wave.killed}/6 by the ${WAVE_CAP_S}s cap${r.wave.heroDead ? ' (hero died)' : ''}`,
    });
  }
  SLOTS.forEach((s, i) => {
    if (!r.kit.castDamage[i]) return;
    const flagged: string[] = [];
    for (const lvl of [6, 12] as const) {
      const iso = lvl === 6 ? r.iso6[i] : r.iso12[i];
      if (!iso.ok || iso.dmg + iso.summon > 0) continue;
      const close = isolated(r.id, lvl, i, CLOSE_DISTANCE);
      if (close.dmg + close.summon > 0) geometryOnly.push(`${r.name} ${s} at L${lvl}: 0 at ${DUMMY_DISTANCE} units, ${r0(close.dmg + close.summon)} at ${CLOSE_DISTANCE} units (area or cone around the caster; not flagged)`);
      else flagged.push(`L${lvl}`);
    }
    if (!flagged.length) return;
    const name = r.def.abilities[i].name;
    add(r.id, {
      score: 1000,
      line: `${s} "${name}" dealt 0 damage at ${flagged.join('/')} although it has damage effects, at ${DUMMY_DISTANCE} and ${CLOSE_DISTANCE} units. ${HERO_NOTES[r.id]?.[s] ?? 'Not yet investigated.'}`,
    });
  });
}

const ranked = results
  .map((r) => ({ r, score: (findings.get(r.id) ?? []).reduce((a, f) => a + f.score, 0) }))
  .filter((x) => x.score > 0)
  .sort((a, b) => b.score - a.score);

// ------------------------------------------------------------------ console table
const col = (s: string, w: number) => (s.length >= w ? s.slice(0, w) : s + ' '.repeat(w - s.length));
out(`Bannerfall balance harness (seed ${SEED}, ${REPORT_DATE})`);
out(col('Hero', 10) + col('Role', 10) + col('L6 burst', 30) + col('L12 burst', 11) + col('L6 DPS', 8) + col('Wave 4s/clear', 18) + col('EHP L6', 9) + col('Sustain', 9) + col('Mobility', 14));
for (const r of results) {
  const wave = `${r.wave.kills4}/6 ${r.wave.cleared ? `${r1(r.wave.clearS!)}s` : 'no clear'}${r.wave.heroDead ? ' DEAD' : ''}`;
  out(
    col(r.name, 10) + col(r.role, 10)
    + col(`${r0(r.b6.total)} (${r0(r.b6.ability)}/${r0(r.b6.proc)}/${r0(r.b6.summon)}/${r0(r.b6.auto)})`, 30)
    + col(r0(r.b12.total), 11) + col(r1(r.dps6), 8) + col(wave, 18) + col(r0(r.ehp6), 9)
    + col(r0(r.b6.heal + r.b6.shield), 9) + col(`${r.kit.mobility} / ${r1(r.kit.dashDist)}u`, 14),
  );
}
out('');
out(`Simulation errors caught by effects.ts (console.error): ${simErrors}`);
for (const s of errorSamples) out(`  ${s}`);

// ------------------------------------------------------------------ report
const L: string[] = [];
L.push('# Bannerfall balance report');
L.push('');
L.push(`Date: ${REPORT_DATE}. Generated by \`tools/balance.ts\` (\`npx tsx tools/balance.ts\`). Seed ${SEED}. Measured against the working tree as found, including its uncommitted edits.`);
L.push('');
L.push('## Method');
L.push('');
L.push(`- Every measurement builds fresh \`Game\` instances with seed ${SEED}. No natural waves or jungle camps spawn during measurement.`);
L.push(`- Dummy: a real aldric at the same level, so it keeps its real max HP, armor and magic resist. It has no regeneration, no attack damage, no attack range and no low-HP passive, so it never hits back. Its death is suppressed so damage keeps being counted. Its HP is reset at the start of every window, so percent-of-HP effects act on a realistic target. Missing-HP terms see the damage taken since that reset. The hero definition is cloned for this, so global hero data is untouched. Its armor and magic resist are real, so physical damage is multiplied by about 0.63 at level 6 and 0.54 at level 12, and magic damage by about 0.71 and 0.66. Raw numbers in the tables are after these reductions.`);
L.push(`- Burst: hero at level 6 or 12, hero HP at 50% so self-healing is visible, no items. Q, W, E, R are cast at the dummy in order with ${WINDOW_S}s between casts (cooldowns and mana reset before each cast). Then ${AUTO_BURST_S}s of basic attacks. Damage to the dummy is split into direct ability damage, on-hit procs (passives and empowered next hits, which run inside a basic hit) and basic-attack damage.`);
L.push(`- Ally-targeted slots are cast on the hero itself, because no second friendly hero is placed. Bounce or ally-only effects (for example chain heals) are therefore under-measured.`);
L.push(`- Summon hits (units spawned by the kit) are their own bucket. Hero basic attacks are suppressed in ability windows, so only the kit's own damage shows.`);
L.push(`- Per-ability damage: each slot cast alone on a fresh game at L6 and L12, observed for ${ISO_S}s with basic attacks suppressed. This avoids mixing in zone ticks from earlier casts. A slot with damage effects that deals 0 is re-run at ${CLOSE_DISTANCE} units before it is flagged, because area and cone effects around the caster may not reach the 4-unit dummy.`);
L.push(`- Sustained DPS: ${DPS_S}s of basic attacks at level 6, damage divided by ${DPS_S}.`);
L.push(`- Wave clear: six melee lane minions (\`MINIONS.melee\`) in a ring of radius 1.2 about 6 units in front of a level-6 hero, with no dummy. The hero casts Q, W, E, R at the cluster (unit-targeted slots at the nearest minion) and auto-attacks the nearest live minion. Kills are counted at ${WAVE_SCRIPT_S}s. The run continues to a ${WAVE_CAP_S}s cap to find the clear time.`);
L.push('- Survivability: effective HP at level 6 is `maxHp x (1 + armor/100)`, physical only. Self-sustain at level 6 is the sum of heal events on the hero (effective healing, from the sequence) plus shield amounts added to the hero during the burst sequence.');
L.push('- Mobility: count of `dash` and `blink` effects in the kit (abilities and passive, walked recursively) and the sum of their distances.');
L.push(`- Outlier rule: a value more than ${Math.round(OUTLIER_THRESHOLD * 100)}% above or below its role average (role averages include the hero), a wave clear that does not finish within ${WAVE_CAP_S}s, or an ability with damage effects (empower damage excluded) that dealt 0 damage in a successful cast.`);
L.push('');
L.push('## Hero table');
L.push('');
L.push('| Hero | Role | L6 burst (ability / on-hit proc / summons / auto) | L12 burst | L6 DPS | Wave clear: kills at 4s / clear time | EHP L6 | Self-sustain L6 (heal + shield) | Mobility (count / distance) |');
L.push('|---|---|---|---|---|---|---|---|---|');
for (const r of results) {
  const wave = `${r.wave.kills4}/6 / ${r.wave.cleared ? `${r1(r.wave.clearS!)}s` : 'no clear'}${r.wave.heroDead ? ' (hero died)' : ''}`;
  const sustain = r.b6.heal + r.b6.shield;
  L.push(`| ${r.name} | ${r.role} | ${r0(r.b6.total)} (${r0(r.b6.ability)} / ${r0(r.b6.proc)} / ${r0(r.b6.summon)} / ${r0(r.b6.auto)}) | ${r0(r.b12.total)} | ${r1(r.dps6)} (${r1(r.dps6Auto)} auto / ${r1(r.dps6Other)} procs) | ${wave} | ${r0(r.ehp6)} | ${r0(sustain)} (${Math.round((sustain / r.maxHp6) * 100)}% of max HP) | ${r.kit.mobility} / ${r1(r.kit.dashDist)} |`);
}
L.push('');
L.push('## Role averages');
L.push('');
L.push('| Role | Heroes | L6 burst | L12 burst | L6 DPS |');
L.push('|---|---|---|---|---|');
for (const role of ROLES) {
  const a = roleAvgs[role];
  L.push(`| ${role} | ${a.n} | ${r0(a.b6)} | ${r0(a.b12)} | ${r1(a.dps)} |`);
}
L.push('');
L.push('## Per-ability damage (isolated, 6s window, basic attacks suppressed; includes summon hits)');
L.push('');
L.push('| Hero | Q L6 | W L6 | E L6 | R L6 | Q L12 | W L12 | E L12 | R L12 |');
L.push('|---|---|---|---|---|---|---|---|---|');
for (const r of results) {
  const cell = (x: IsoResult) => (x.ok ? `${r0(x.dmg)}${x.summon ? ` (+${r0(x.summon)} summon)` : ''}` : 'no cast');
  L.push(`| ${r.name} | ${r.iso6.map(cell).join(' | ')} | ${r.iso12.map(cell).join(' | ')} |`);
}
L.push('');
L.push('## Outliers (ranked)');
L.push('');
if (!ranked.length) L.push('None.');
ranked.forEach((x, i) => {
  L.push(`${i + 1}. **${x.r.name}** (${x.r.role})`);
  for (const f of (findings.get(x.r.id) ?? []).sort((a, b) => b.score - a.score)) L.push(`   - ${f.line}`);
});
L.push('');
L.push('## Engine and content notes');
L.push('');
if (!ENGINE_NOTES.length && !geometryOnly.length) L.push('None.');
for (const n of ENGINE_NOTES) L.push(`- ${n}`);
for (const g of geometryOnly) L.push(`- Geometry, not a bug: ${g}.`);
L.push('');
L.push(`Harness errors caught from the sim during measurement: ${simErrors}.`);
L.push('');

writeFileSync(resolve(ROOT, 'docs', 'BALANCE-REPORT.md'), L.join('\n'));
out('');
out(`Wrote ${resolve(ROOT, 'docs', 'BALANCE-REPORT.md')}`);
