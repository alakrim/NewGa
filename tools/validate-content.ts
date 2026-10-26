// Content validator for Bannerfall heroes (and basic item checks).
//
//   npx tsx tools/validate-content.ts
//
// Exit code 1 if any ERROR is found. WARN lines are advisory (balance guide ranges, roster targets, coverage).
// Extensible: export `validateHeroes` / `validateItems`; each returns a Report you can merge.

import { pathToFileURL } from 'node:url';
import type { AbilityDef, Condition, Effect, HeroDef, ItemDef, Num, StatKey, Stats } from '../src/shared/types';
import { HEROES } from '../src/shared/data/heroes';

// ---------------------------------------------------------------------------------------------------------------
// Report helper
// ---------------------------------------------------------------------------------------------------------------

export class Report {
  errors: string[] = [];
  warnings: string[] = [];
  info: string[] = [];
  error(where: string, msg: string) { this.errors.push(`[${where}] ${msg}`); }
  warn(where: string, msg: string) { this.warnings.push(`[${where}] ${msg}`); }
  note(msg: string) { this.info.push(msg); }
  merge(o: Report) { this.errors.push(...o.errors); this.warnings.push(...o.warnings); this.info.push(...o.info); return this; }
  get ok() { return this.errors.length === 0; }
}

// ---------------------------------------------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------------------------------------------

const EXPECTED_HEROES = 20;
const ROLE_TARGETS: Record<string, number> = { Tank: 3, Fighter: 4, Assassin: 3, Mage: 4, Marksman: 3, Support: 3 };
const DIFFICULTY_TARGETS: Record<number, [number, number]> = { 1: [5, 7], 2: [8, 10], 3: [4, 6] }; // [min, max]
const MODEL_USES: [number, number] = [2, 3];
const KNOWN_FACTIONS = [
  'Dawnguard Order', 'Duskborn Pact', 'Ashen Wilds', 'Ivory Spire', 'The Hollow', 'Thornwood', 'Free City of Mareth', 'Tidewardens',
];

/** Valid optional meshes per model (docs/MODELS.md). */
export const MODEL_WEAPONS: Record<string, string[]> = {
  Knight: ['1H_Sword', '1H_Sword_Offhand', '2H_Sword', 'Badge_Shield', 'Rectangle_Shield', 'Round_Shield', 'Spike_Shield', 'Knight_Helmet', 'Knight_Cape'],
  Barbarian: ['1H_Axe', '1H_Axe_Offhand', '2H_Axe', 'Barbarian_Round_Shield', 'Mug', 'Barbarian_Hat', 'Barbarian_Cape'],
  Mage: ['1H_Wand', '2H_Staff', 'Spellbook', 'Spellbook_open', 'Mage_Hat', 'Mage_Cape'],
  Rogue: ['Knife', 'Knife_Offhand', '1H_Crossbow', '2H_Crossbow', 'Throwable', 'Rogue_Cape'],
  Rogue_Hooded: ['Knife', 'Knife_Offhand', '1H_Crossbow', '2H_Crossbow', 'Throwable', 'Rogue_Cape'],
  Skeleton_Warrior: ['Skeleton_Blade', 'Skeleton_Axe', 'Skeleton_Shield_Small_A', 'Skeleton_Shield_Large_A'],
  Skeleton_Mage: ['Skeleton_Staff', 'Skeleton_Blade'],
  Skeleton_Rogue: ['Skeleton_Blade', 'Skeleton_Axe', 'Skeleton_Crossbow'],
  Skeleton_Minion: ['Skeleton_Blade', 'Skeleton_Axe', 'Skeleton_Shield_Small_A'],
};

const STAT_KEYS: StatKey[] = [
  'maxHp', 'hpRegen', 'maxMana', 'manaRegen', 'attackDamage', 'abilityPower', 'armor', 'magicResist', 'attackSpeed',
  'attackRange', 'moveSpeed', 'critChance', 'lifesteal', 'abilityHaste', 'armorPen', 'magicPen',
];
const SCALING_KEYS = ['base', 'ad', 'bonusAd', 'ap', 'maxHp', 'bonusHp', 'targetMaxHp', 'targetMissingHp', 'armor', 'level'];
const HOSTILE_STATUS = new Set(['stun', 'root', 'slow', 'silence', 'knockup', 'taunt']);
const SUMMON_KINDS = new Set(['bone_soldier', 'bone_archer', 'wraith', 'bone_brute']);
const CONDITION_TESTS = new Set(['targetHpBelow', 'casterHpBelow', 'targetDead', 'targetIsHero', 'targetHasStatus', 'casterHasStatus', 'chance']);
const STATUS_KINDS = new Set(['stun', 'root', 'slow', 'silence', 'knockup', 'taunt', 'invulnerable', 'unstoppable', 'stealth']);
const SLOTS = ['Q', 'W', 'E', 'R'] as const;
const HEX = /^#[0-9a-fA-F]{6}$/;

/** Hard bounds (ERROR) and balance-guide bounds (WARN). */
const HARD: Partial<Record<keyof Stats, [number, number]>> = {
  maxHp: [450, 800],
  moveSpeed: [5.2, 6.8],
  attackRange: [0, 9.5],
};
const SOFT_BASE: Partial<Record<keyof Stats, [number, number]>> = {
  hpRegen: [1.5, 2.6], maxMana: [280, 460], manaRegen: [1.5, 2.4], attackDamage: [48, 66], abilityPower: [0, 0],
  armor: [22, 38], magicResist: [28, 34], attackSpeed: [0.6, 0.72],
};
const SOFT_GROWTH: Partial<Record<keyof Stats, [number, number]>> = {
  maxHp: [80, 115], hpRegen: [0.12, 0.2], maxMana: [30, 56], manaRegen: [0.08, 0.14], attackDamage: [2.8, 4.2],
  armor: [3.3, 4.8], magicResist: [1.2, 2.0], attackSpeed: [0.012, 0.02],
};

// ---------------------------------------------------------------------------------------------------------------
// Number / effect walking
// ---------------------------------------------------------------------------------------------------------------

/** Who ctx.target is at this point of the tree, from the point of view of what the simulation accepts. */
type Side = 'caster' | 'enemy' | 'ally' | 'any';

interface WalkOpts {
  rep: Report;
  where: string; // e.g. "aldric/Q"
  ranks: number; // expected length of Scaling.base arrays; 0 = arrays are not allowed (passives, items)
  targeting?: AbilityDef['targeting'];
  features: Set<string>;
}

function sideOf(affects: string | undefined): Side {
  if (affects === 'enemies') return 'enemy';
  if (affects === 'allies' || affects === 'alliesAndSelf') return 'ally';
  return 'any';
}

function firstValue(n: Num | undefined): number {
  if (n === undefined) return 0;
  if (typeof n === 'number') return n;
  if (n.base === undefined) return 0;
  return Array.isArray(n.base) ? n.base[0] ?? 0 : n.base;
}

export function checkNum(n: Num | undefined, o: WalkOpts, what: string) {
  if (n === undefined) return;
  if (typeof n === 'number') {
    if (!Number.isFinite(n)) o.rep.error(o.where, `${what}: not a finite number`);
    return;
  }
  for (const k of Object.keys(n)) if (!SCALING_KEYS.includes(k)) o.rep.error(o.where, `${what}: unknown Scaling key '${k}'`);
  if (Array.isArray(n.base)) {
    if (o.ranks === 0) o.rep.error(o.where, `${what}: Scaling.base array not allowed here (rank is always 1); use a number`);
    else if (n.base.length !== o.ranks) o.rep.error(o.where, `${what}: Scaling.base has ${n.base.length} entries, expected ${o.ranks}`);
    if (n.base.some((v) => typeof v !== 'number' || !Number.isFinite(v))) o.rep.error(o.where, `${what}: Scaling.base contains a non-number`);
    for (let i = 1; i < n.base.length; i++) {
      if (n.base[i] < n.base[i - 1] && n.base.every((v) => v >= 0)) { o.rep.warn(o.where, `${what}: Scaling.base decreases with rank (${n.base.join(', ')})`); break; }
    }
  } else if (n.base !== undefined && (typeof n.base !== 'number' || !Number.isFinite(n.base))) {
    o.rep.error(o.where, `${what}: Scaling.base is not a number`);
  }
  for (const k of SCALING_KEYS) {
    if (k === 'base') continue;
    const v = (n as unknown as Record<string, unknown>)[k];
    if (v !== undefined && (typeof v !== 'number' || !Number.isFinite(v))) o.rep.error(o.where, `${what}: Scaling.${k} is not a number`);
  }
}

function checkStatMap(map: Partial<Record<StatKey, Num>> | undefined, o: WalkOpts, what: string): number[] {
  const signs: number[] = [];
  if (!map) return signs;
  for (const [k, v] of Object.entries(map)) {
    if (!STAT_KEYS.includes(k as StatKey)) o.rep.error(o.where, `${what}: unknown stat '${k}'`);
    checkNum(v as Num, o, `${what}.${k}`);
    signs.push(Math.sign(firstValue(v as Num)));
  }
  return signs;
}

export function walkEffects(effects: Effect[] | undefined, side: Side, o: WalkOpts, path: string) {
  if (!effects) return;
  if (!Array.isArray(effects)) { o.rep.error(o.where, `${path}: effects must be an array`); return; }
  effects.forEach((e, i) => {
    walkEffect(e, side, o, `${path}[${i}]`);
    // an 'if targetDead' is evaluated when reached, so it only sees a kill made by an earlier sibling damage effect
    if (e.type === 'if' && e.cond?.test === 'targetDead' && !effects.slice(0, i).some((x) => x.type === 'damage')) {
      o.rep.warn(o.where, `${path}[${i}] (if): 'targetDead' has no damage effect before it in the same list, so nothing can have killed the target yet`);
    }
  });
}

function walkEffect(e: Effect, side: Side, o: WalkOpts, path: string) {
  const err = (m: string) => o.rep.error(o.where, `${path} (${e.type}): ${m}`);
  const warn = (m: string) => o.rep.warn(o.where, `${path} (${e.type}): ${m}`);
  const needsTarget = side === 'caster' ? 'the caster' : side === 'ally' ? 'allies' : 'enemies';
  switch (e.type) {
    case 'damage':
      checkNum(e.amount, o, `${path}.amount`);
      if (side === 'caster' || side === 'ally') err(`damage here would target ${needsTarget}, which the sim ignores. Wrap it in area/projectile/zone/chain/dash`);
      if (!['physical', 'magic', 'true'].includes(e.dtype)) err(`bad dtype '${e.dtype}'`);
      break;
    case 'heal':
    case 'mana':
      checkNum(e.amount, o, `${path}.amount`);
      if (side === 'enemy') err('would target enemies, which the sim ignores');
      if (e.type === 'heal') o.features.add(side === 'ally' ? 'allyHeal' : 'selfHeal');
      break;
    case 'shield':
      checkNum(e.amount, o, `${path}.amount`);
      if (side === 'enemy') err('would target enemies, which the sim ignores');
      if (!(e.duration > 0)) err('duration must be > 0');
      o.features.add(side === 'ally' ? 'allyHeal' : 'selfHeal');
      break;
    case 'status': {
      const hostile = HOSTILE_STATUS.has(e.status);
      if (!(e.duration > 0)) err('duration must be > 0');
      if (hostile && (side === 'caster' || side === 'ally')) err(`hostile status '${e.status}' would target ${needsTarget}, which the sim ignores`);
      if (!hostile && side === 'enemy') err(`beneficial status '${e.status}' on an enemy is ignored by the sim`);
      if (e.status === 'slow' && !(e.power !== undefined && e.power > 0 && e.power <= 1)) err('slow needs power in (0, 1]');
      if (e.status === 'stealth') o.features.add('stealth');
      if (['stun', 'root', 'knockup', 'taunt'].includes(e.status) && e.duration > 2) warn(`hard CC of ${e.duration}s exceeds the 2s ultimate cap`);
      break;
    }
    case 'buff': {
      if (!e.id) err('buff needs an id');
      const signs = [...checkStatMap(e.stats, o, `${path}.stats`), ...Object.values(e.pct ?? {}).map((v) => Math.sign(v))];
      for (const [k, v] of Object.entries(e.pct ?? {})) {
        if (!STAT_KEYS.includes(k as StatKey)) err(`unknown pct stat '${k}'`);
        if (typeof v !== 'number' || !Number.isFinite(v)) err(`pct.${k} is not a number`);
      }
      if (!(e.duration > 0)) err('duration must be > 0');
      if (signs.length === 0) warn('buff has no stats or pct');
      const negative = signs.some((s) => s < 0);
      // The sim: a negative buff is a debuff that only lands on enemies, except on the caster (a self-penalty stance).
      // Caster-side effects always have ctx.target = caster, so a negative buff there is a valid trade-off; on allies it is ignored.
      if (negative && side === 'ally') err('buff with a negative value is a debuff and only lands on enemies or the caster (it would be ignored on allies)');
      if (!negative && side === 'enemy') err('positive buff here would target enemies, which the sim ignores');
      break;
    }
    case 'area': {
      if (!(e.radius > 0)) err('radius must be > 0');
      if (e.shape === 'cone' && !(e.angle && e.angle > 0 && e.angle <= 360)) err('cone needs angle');
      if (e.shape === 'rect' && !(e.width && e.width > 0)) err('rect needs width');
      if ((e.shape === 'cone' || e.shape === 'rect') && e.at === 'caster' && o.targeting === 'self') err('cone/rect from a self-targeted ability has no aim direction; use targeting: direction');
      if (e.delay !== undefined && e.delay < 0) err('delay < 0');
      if (e.at === 'target' && side === 'caster' && o.targeting !== 'self') warn("at: 'target' while ctx.target is the caster (same as at: 'caster')");
      o.features.add('area');
      walkEffects(e.effects, sideOf(e.affects), o, `${path}.effects`);
      break;
    }
    case 'projectile':
      if (!(e.speed > 0 && e.range > 0 && e.width > 0)) err('speed, range and width must be > 0');
      if (e.homing && !(o.targeting === 'enemy' || o.targeting === 'ally' || o.targeting === 'unit')) err('homing needs a unit-targeted ability');
      if (e.pierce) o.features.add('pierce');
      if (e.returns) o.features.add('returns');
      if (!HEX.test(e.visual.color)) err(`visual.color '${e.visual.color}' is not a 6-digit hex`);
      walkEffects(e.effects, sideOf(e.affects), o, `${path}.effects`);
      walkEffects(e.onEnd, 'caster', o, `${path}.onEnd`);
      if (e.effects.some((x) => x.type === 'displace' && x.toward)) o.features.add('hook');
      break;
    case 'dash':
      if (!(e.distance > 0 && e.speed > 0)) err('distance and speed must be > 0');
      if (e.to === 'target' && !(o.targeting === 'enemy' || o.targeting === 'ally' || o.targeting === 'unit')) err("to: 'target' needs a unit-targeted ability");
      if (e.to === 'point' && o.targeting !== 'point') warn("to: 'point' without a point-targeted ability");
      if (e.effects?.length && !e.affects) warn('effects without affects (defaults to enemies)');
      o.features.add('dash');
      walkEffects(e.effects, sideOf(e.affects ?? 'enemies'), o, `${path}.effects`);
      walkEffects(e.onArrive, 'caster', o, `${path}.onArrive`);
      break;
    case 'blink':
      if (!(e.distance > 0)) err('distance must be > 0');
      o.features.add('blink');
      walkEffects(e.onDepart, 'caster', o, `${path}.onDepart`);
      walkEffects(e.onArrive, 'caster', o, `${path}.onArrive`);
      break;
    case 'zone':
      if (!(e.radius > 0 && e.duration > 0)) err('radius and duration must be > 0');
      if (!(e.interval >= 0.1)) err('interval must be >= 0.1 (the sim clamps it)');
      if (e.follow && e.at === 'point') warn("follow with at: 'point' follows the caster");
      if (!HEX.test(e.vfx.color)) err(`vfx.color '${e.vfx.color}' is not a 6-digit hex`);
      o.features.add('zone');
      walkEffects(e.effects, sideOf(e.affects), o, `${path}.effects`);
      break;
    case 'summon':
      if (!SUMMON_KINDS.has(e.unit)) err(`unknown summon unit '${e.unit}'`);
      if (!(e.count >= 1 && e.duration > 0)) err('count >= 1 and duration > 0 required');
      o.features.add('summon');
      break;
    case 'displace':
      if (side === 'caster') err('displace on the caster is a no-op; wrap it in area/projectile/dash/chain');
      if (!(e.distance > 0)) err('distance must be > 0');
      break;
    case 'chain':
      if (!(e.bounces >= 1 && e.range > 0)) err('bounces >= 1 and range > 0 required');
      if (!HEX.test(e.vfx.color)) err(`vfx.color '${e.vfx.color}' is not a 6-digit hex`);
      o.features.add('chain');
      // NOTE: the sim's chain hits ctx.target first (if it matches) and then bounces `bounces` more times.
      walkEffects(e.effects, sideOf(e.affects), o, `${path}.effects`);
      break;
    case 'delay':
      if (!(e.time > 0)) err('time must be > 0');
      walkEffects(e.effects, side, o, `${path}.effects`);
      break;
    case 'repeat':
      if (!(e.count >= 1 && e.interval >= 0)) err('count >= 1 and interval >= 0 required');
      walkEffects(e.effects, side, o, `${path}.effects`);
      break;
    case 'empower':
      if (!(e.duration > 0)) err('duration must be > 0');
      walkEffects(e.effects, 'enemy', o, `${path}.effects`); // ctx.target = the unit hit by the empowered attack
      break;
    case 'cleanse':
      if (side === 'enemy') err('would target enemies, which the sim ignores');
      break;
    case 'self':
      walkEffects(e.effects, 'caster', o, `${path}.effects`);
      break;
    case 'resetCooldowns':
      for (const s of e.slots ?? []) if (!SLOTS.includes(s)) err(`bad slot '${s}'`);
      o.features.add('reset');
      break;
    case 'if': {
      const c = e.cond as Condition | undefined;
      if (!c || !CONDITION_TESTS.has(c.test)) { err(`unknown condition '${c?.test}'`); break; }
      if (c.test === 'chance' && !(c.value >= 0 && c.value <= 1)) err('chance value must be in 0..1');
      if ((c.test === 'targetHpBelow' || c.test === 'casterHpBelow') && !(c.value > 0 && c.value <= 1)) err('hp threshold must be in (0, 1]');
      if ((c.test === 'targetHasStatus' || c.test === 'casterHasStatus') && !STATUS_KINDS.has(c.status)) err(`unknown status '${c.status}'`);
      if (!Array.isArray(e.then) || (e.then.length === 0 && !e.else?.length)) err('then needs at least one effect');
      walkEffects(e.then, side, o, `${path}.then`);
      walkEffects(e.else, side, o, `${path}.else`);
      break;
    }
    default:
      err(`unknown effect type '${(e as { type: string }).type}'`);
  }
}

/** Collects every damaging thing that can hit more than one unit (for the wave-clear coverage check). */
function hasWaveClear(a: AbilityDef): boolean {
  let found = false;
  const visit = (effs: Effect[] | undefined, within: boolean) => {
    for (const e of effs ?? []) {
      switch (e.type) {
        case 'area': case 'zone': case 'chain':
          if (e.effects.some((x) => x.type === 'damage')) found = true;
          visit(e.effects, true); break;
        case 'projectile':
          if ((e.pierce || e.returns) && e.effects.some((x) => x.type === 'damage')) found = true;
          visit(e.effects, within); visit(e.onEnd, within); break;
        case 'dash':
          if ((e.effects ?? []).some((x) => x.type === 'damage') && !e.stopOnHit) found = true;
          visit(e.onArrive, within); break;
        case 'blink': visit(e.onDepart, within); visit(e.onArrive, within); break;
        case 'delay': case 'repeat': case 'empower': case 'self': visit(e.effects, within); break;
        case 'if': visit(e.then, within); visit(e.else, within); break;
        default: break;
      }
    }
  };
  visit(a.effects, false);
  return found;
}

// ---------------------------------------------------------------------------------------------------------------
// Hero validation
// ---------------------------------------------------------------------------------------------------------------

function graphemes(s: string): number {
  const seg = new Intl.Segmenter('en', { granularity: 'grapheme' });
  return [...seg.segment(s)].length;
}

function checkAttackAnims(h: HeroDef, rep: Report) {
  const w = h.visual.weapons;
  const has = (...n: string[]) => n.some((x) => w.includes(x));
  const oneHandMelee = ['Knife', 'Knife_Offhand', 'Skeleton_Blade', 'Skeleton_Axe', '1H_Sword', '1H_Sword_Offhand', '1H_Axe', '1H_Axe_Offhand'];
  const count1h = w.filter((x) => oneHandMelee.includes(x)).length;
  let expected: string | null = null;
  if (h.attack.kind === 'melee') {
    if (has('2H_Sword', '2H_Axe')) expected = '2H_Melee_Attack';
    else if (count1h >= 2) expected = 'Dualwield_Melee_Attack';
    else if (count1h === 1) expected = '1H_Melee_Attack';
    else expected = 'Unarmed_Melee_Attack';
    if (h.attack.anims.some((a) => !a.startsWith(expected!))) rep.warn(h.id, `melee attack anims should start with '${expected}' for weapons [${w.join(', ')}] (got ${h.attack.anims.join(', ')})`);
  } else {
    const ok = (a: string) => {
      if (has('1H_Crossbow')) return a === '1H_Ranged_Shoot' || a === '2H_Ranged_Shoot';
      if (has('2H_Crossbow', 'Skeleton_Crossbow')) return a === '2H_Ranged_Shoot' || a === '1H_Ranged_Shoot';
      if (has('Throwable')) return a === 'Throw';
      if (has('1H_Wand', '2H_Staff', 'Spellbook', 'Spellbook_open', 'Skeleton_Staff')) return a === 'Spellcast_Shoot';
      return a === 'Throw' || a === 'Spellcast_Shoot' || a.includes('Ranged');
    };
    if (h.attack.anims.some((a) => !ok(a))) rep.warn(h.id, `ranged attack anims do not suit weapons [${w.join(', ')}] (got ${h.attack.anims.join(', ')})`);
  }
}

export function validateHero(h: HeroDef, rep: Report, features: Map<string, Set<string>>) {
  const id = h.id || '<no id>';
  if (!/^[a-z]+$/.test(h.id)) rep.error(id, `id '${h.id}' must be lowercase letters only`);
  if (!h.name?.trim()) rep.error(id, 'name is empty');
  if (!h.title?.trim()) rep.error(id, 'title is empty');
  if (!h.quote?.trim()) rep.error(id, 'quote is empty');
  if (![1, 2, 3].includes(h.difficulty)) rep.error(id, `difficulty ${h.difficulty} must be 1, 2 or 3`);
  if (h.secondaryRole && h.secondaryRole === h.role) rep.error(id, 'secondaryRole equals role');
  if (!KNOWN_FACTIONS.includes(h.faction)) rep.warn(id, `faction '${h.faction}' is not in the known faction list`);

  // lore
  const paras = h.lore.split(/\n\s*\n/).map((p) => p.trim()).filter(Boolean);
  const words = h.lore.split(/\s+/).filter(Boolean).length;
  if (paras.length !== 2) rep.warn(id, `lore has ${paras.length} paragraph(s), expected 2`);
  if (words < 110 || words > 200) rep.warn(id, `lore is ${words} words, expected roughly 120-180`);

  // visuals
  const v = h.visual;
  const allowed = MODEL_WEAPONS[v.model];
  if (!allowed) rep.error(id, `unknown model '${v.model}'`);
  else {
    for (const wname of v.weapons) if (!allowed.includes(wname)) rep.error(id, `visual.weapons: '${wname}' is not a valid mesh for ${v.model} (valid: ${allowed.join(', ')})`);
    if (new Set(v.weapons).size !== v.weapons.length) rep.error(id, 'visual.weapons has duplicates');
  }
  for (const k of ['tint', 'accent', 'vfx'] as const) if (!HEX.test(v[k])) rep.error(id, `visual.${k} '${v[k]}' is not a 6-digit hex like '#3a7bd5'`);
  if (!(v.scale >= 0.9 && v.scale <= 1.25)) rep.error(id, `visual.scale ${v.scale} outside 0.9..1.25`);
  checkAttackAnims(h, rep);

  // attack
  if (h.attack.anims.length === 0) rep.error(id, 'attack.anims is empty');
  if (h.attack.kind === 'ranged') {
    if (!h.attack.projectile) rep.error(id, 'ranged hero needs attack.projectile');
    else if (!HEX.test(h.attack.projectile.color)) rep.error(id, `attack.projectile.color '${h.attack.projectile.color}' is not a 6-digit hex`);
    if (h.base.attackRange < 6.5) rep.warn(id, `ranged attackRange ${h.base.attackRange} looks short (guide: 7-9)`);
  } else {
    if (h.attack.projectile) rep.warn(id, 'melee hero has attack.projectile (ignored)');
    if (h.base.attackRange > 3) rep.warn(id, `melee attackRange ${h.base.attackRange} looks long (guide: ~2.4)`);
  }

  // stats
  for (const [k, [lo, hi]] of Object.entries(HARD) as [keyof Stats, [number, number]][]) {
    const val = h.base[k];
    if (typeof val !== 'number' || !(val >= lo && val <= hi)) rep.error(id, `base.${k} = ${val} outside ${lo}..${hi}`);
  }
  for (const k of STAT_KEYS) if (typeof h.base[k] !== 'number' || !Number.isFinite(h.base[k])) rep.error(id, `base.${k} missing or not a number`);
  for (const [k, [lo, hi]] of Object.entries(SOFT_BASE) as [keyof Stats, [number, number]][]) {
    const val = h.base[k];
    if (val < lo || val > hi) rep.warn(id, `base.${k} = ${val} outside guide range ${lo}..${hi}`);
  }
  for (const k of ['critChance', 'lifesteal', 'abilityHaste', 'armorPen', 'magicPen'] as const) {
    if (h.base[k] !== 0) rep.warn(id, `base.${k} should be 0 at level 1 (got ${h.base[k]})`);
  }
  for (const [k, val] of Object.entries(h.growth)) {
    if (!STAT_KEYS.includes(k as StatKey)) rep.error(id, `growth.${k} is not a stat`);
    else if (typeof val !== 'number') rep.error(id, `growth.${k} is not a number`);
  }
  for (const [k, [lo, hi]] of Object.entries(SOFT_GROWTH) as [keyof Stats, [number, number]][]) {
    const val = h.growth[k];
    if (val === undefined) rep.warn(id, `growth.${k} missing`);
    else if (val < lo || val > hi) rep.warn(id, `growth.${k} = ${val} outside guide range ${lo}..${hi}`);
  }

  // passive
  const feats = new Set<string>();
  features.set(h.id, feats);
  const p = h.passive;
  const pw: WalkOpts = { rep, where: `${id}/passive`, ranks: 0, features: feats };
  if (!p.name?.trim() || !p.description?.trim()) rep.error(id, 'passive needs name and description');
  if (!p.icon?.trim()) rep.error(id, 'passive icon is empty');
  else if (graphemes(p.icon) !== 1) rep.error(id, `passive icon '${p.icon}' should be a single emoji`);
  checkStatMap(p.stats, pw, 'passive.stats');
  walkEffects(p.onHit, 'enemy', pw, 'onHit');
  if (p.everyNthHit) {
    if (!(p.everyNthHit.n >= 2)) rep.error(id, 'everyNthHit.n must be >= 2');
    walkEffects(p.everyNthHit.effects, 'enemy', pw, 'everyNthHit');
  }
  walkEffects(p.onAbilityCast, 'caster', pw, 'onAbilityCast');
  walkEffects(p.onKill, 'caster', pw, 'onKill');
  if (p.onLowHp) {
    if (!(p.onLowHp.threshold > 0 && p.onLowHp.threshold < 1)) rep.error(id, 'onLowHp.threshold must be in (0,1)');
    if (!(p.onLowHp.cooldown > 0)) rep.error(id, 'onLowHp.cooldown must be > 0');
    walkEffects(p.onLowHp.effects, 'caster', pw, 'onLowHp');
  }
  if (!p.stats && !p.onHit && !p.everyNthHit && !p.onAbilityCast && !p.onKill && !p.onLowHp) rep.error(id, 'passive does nothing (no stats or triggers)');

  // abilities
  if (!Array.isArray(h.abilities) || h.abilities.length !== 4) {
    rep.error(id, `needs exactly 4 abilities (Q, W, E, R), has ${h.abilities?.length}`);
    return;
  }
  let waveClear = false;
  h.abilities.forEach((a, idx) => {
    const slot = SLOTS[idx];
    const where = `${id}/${slot}`;
    const ranks = slot === 'R' ? 3 : 5;
    const ao: WalkOpts = { rep, where, ranks, targeting: a.targeting, features: feats };
    if (a.id !== `${h.id}_${slot.toLowerCase()}`) rep.error(where, `ability id '${a.id}' should be '${h.id}_${slot.toLowerCase()}' (abilities must be in Q,W,E,R order)`);
    if (!a.name?.trim()) rep.error(where, 'name is empty');
    if (!a.description?.trim()) rep.error(where, 'description is empty');
    if (!a.icon?.trim()) rep.error(where, 'icon is empty');
    else if (graphemes(a.icon) !== 1) rep.error(where, `icon '${a.icon}' should be a single emoji`);
    if (!Array.isArray(a.cooldown) || a.cooldown.length !== ranks) rep.error(where, `cooldown needs exactly ${ranks} entries (has ${a.cooldown?.length})`);
    if (!Array.isArray(a.manaCost) || a.manaCost.length !== ranks) rep.error(where, `manaCost needs exactly ${ranks} entries (has ${a.manaCost?.length})`);
    const cd = a.cooldown ?? [];
    const mana = a.manaCost ?? [];
    if (cd.some((c) => !(c > 0))) rep.error(where, 'cooldown values must be > 0');
    if (mana.some((m) => !(m >= 0))) rep.error(where, 'manaCost values must be >= 0');
    for (let i = 1; i < cd.length; i++) if (cd[i] > cd[i - 1]) { rep.warn(where, `cooldown increases with rank (${cd.join(', ')})`); break; }
    for (let i = 1; i < mana.length; i++) if (mana[i] < mana[i - 1]) { rep.warn(where, `manaCost decreases with rank (${mana.join(', ')})`); break; }
    if (slot === 'R') {
      if (cd.some((c) => c < 60 || c > 120)) rep.warn(where, `ultimate cooldown ${cd.join('/')} outside ~70-110s guide`);
    } else {
      if (cd.some((c) => c < 5 || c > 20)) rep.warn(where, `basic cooldown ${cd.join('/')} outside the 5-16s guide`);
      if (mana.some((m) => m < 30 || m > 100)) rep.warn(where, `basic manaCost ${mana.join('/')} outside the 40-100 guide`);
    }
    // targeting / range sanity
    if (a.targeting === 'self') {
      if (a.range !== 0) rep.warn(where, `self ability should have range 0 (has ${a.range})`);
    } else if (!(a.range > 0)) rep.error(where, `${a.targeting} ability needs range > 0`);
    if (a.castTime !== undefined && !(a.castTime >= 0 && a.castTime <= 1.5)) rep.warn(where, `castTime ${a.castTime} looks off`);
    if (!a.anim) rep.warn(where, 'no anim set');
    if (a.range >= 40) feats.add('longRange');
    if (a.targeting === 'point' && !a.radius && a.effects.some((e) => e.type === 'area' || e.type === 'zone')) rep.warn(where, 'point ability with an area/zone should set radius for the ground indicator');
    if (a.radius !== undefined && a.targeting !== 'point') rep.warn(where, 'radius is only used by point abilities');

    // the effect tree
    if (!Array.isArray(a.effects) || a.effects.length === 0) rep.error(where, 'effects is empty');
    const topSide: Side = a.targeting === 'enemy' ? 'enemy' : a.targeting === 'ally' ? 'ally' : a.targeting === 'unit' ? 'any' : 'caster';
    walkEffects(a.effects, topSide, ao, 'effects');
    if (hasWaveClear(a)) waveClear = true;
  });
  if (!waveClear) rep.warn(id, 'no ability hits multiple units with damage (BALANCE: every hero needs a wave-interaction tool)');
}

export function validateHeroes(heroes: HeroDef[]): Report {
  const rep = new Report();
  const features = new Map<string, Set<string>>();

  if (heroes.length !== EXPECTED_HEROES) rep.error('roster', `expected ${EXPECTED_HEROES} heroes, found ${heroes.length}`);

  const ids = new Set<string>();
  const names = new Set<string>();
  const abilityIds = new Set<string>();
  const icons = new Map<string, string[]>();
  for (const h of heroes) {
    if (ids.has(h.id)) rep.error('roster', `duplicate hero id '${h.id}'`);
    ids.add(h.id);
    const nm = h.name?.toLowerCase();
    if (names.has(nm)) rep.error('roster', `duplicate hero name '${h.name}'`);
    names.add(nm);
    validateHero(h, rep, features);
    for (const a of h.abilities ?? []) {
      if (abilityIds.has(a.id)) rep.error('roster', `duplicate ability id '${a.id}'`);
      abilityIds.add(a.id);
      if (a.icon) icons.set(a.icon, [...(icons.get(a.icon) ?? []), `${a.id}`]);
    }
    if (h.passive?.icon) icons.set(h.passive.icon, [...(icons.get(h.passive.icon) ?? []), `${h.id}/passive`]);
  }
  for (const [ic, users] of icons) if (users.length > 1) rep.warn('icons', `icon ${ic} is used by ${users.join(', ')}`);

  // roster composition (advisory)
  const count = <T>(f: (h: HeroDef) => T) => {
    const m = new Map<T, number>();
    for (const h of heroes) m.set(f(h), (m.get(f(h)) ?? 0) + 1);
    return m;
  };
  const roles = count((h) => h.role);
  for (const [r, n] of Object.entries(ROLE_TARGETS)) if ((roles.get(r as never) ?? 0) !== n) rep.warn('roster', `role ${r}: ${roles.get(r as never) ?? 0} heroes, target ${n}`);
  const models = count((h) => h.visual.model);
  for (const m of Object.keys(MODEL_WEAPONS)) {
    const n = models.get(m as never) ?? 0;
    if (n < MODEL_USES[0] || n > MODEL_USES[1]) rep.warn('roster', `model ${m} used ${n} times, target ${MODEL_USES[0]}-${MODEL_USES[1]}`);
  }
  const diffs = count((h) => h.difficulty);
  for (const [d, [lo, hi]] of Object.entries(DIFFICULTY_TARGETS)) {
    const n = diffs.get(Number(d) as never) ?? 0;
    if (n < lo || n > hi) rep.warn('roster', `difficulty ${d}: ${n} heroes, target ${lo}-${hi}`);
  }
  // same-model heroes should look different
  const byModel = new Map<string, HeroDef[]>();
  for (const h of heroes) byModel.set(h.visual.model, [...(byModel.get(h.visual.model) ?? []), h]);
  for (const [m, list] of byModel) {
    for (let i = 0; i < list.length; i++) for (let j = i + 1; j < list.length; j++) {
      if (list[i].visual.tint.toLowerCase() === list[j].visual.tint.toLowerCase()) rep.warn('visuals', `${list[i].id} and ${list[j].id} (${m}) share a tint`);
      else if (hueDistance(list[i].visual.tint, list[j].visual.tint) < 25 && Math.abs(list[i].visual.scale - list[j].visual.scale) < 0.05 && sameSet(list[i].visual.weapons, list[j].visual.weapons)) {
        rep.warn('visuals', `${list[i].id} and ${list[j].id} (${m}) look very similar (close hue, same scale and weapons)`);
      }
    }
  }

  // design coverage (advisory)
  const have = (f: string) => heroes.filter((h) => features.get(h.id)?.has(f)).map((h) => h.id);
  const cov: [string, string[], number][] = [
    ['summons', have('summon'), 3],
    ['stealth or blink', heroes.filter((h) => features.get(h.id)?.has('stealth') || features.get(h.id)?.has('blink')).map((h) => h.id), 3],
    ['hooks (projectile + displace toward)', have('hook'), 2],
    ['zones', have('zone'), 3],
    ['very long range (>= 40)', have('longRange'), 2],
    ['ally heal/shield', have('allyHeal'), 2],
    ['cooldown reset', have('reset'), 1],
  ];
  for (const [label, who, min] of cov) {
    rep.note(`coverage: ${label}: ${who.length} (${who.join(', ')})`);
    if (who.length < min) rep.warn('coverage', `${label}: only ${who.length}, wanted >= ${min}`);
  }
  return rep;
}

// color helpers for the similarity check
function hueDistance(a: string, b: string): number {
  const d = Math.abs(hue(a) - hue(b));
  return Math.min(d, 360 - d);
}
function hue(hex: string): number {
  const r = parseInt(hex.slice(1, 3), 16) / 255, g = parseInt(hex.slice(3, 5), 16) / 255, bl = parseInt(hex.slice(5, 7), 16) / 255;
  const mx = Math.max(r, g, bl), mn = Math.min(r, g, bl), d = mx - mn;
  if (d === 0) return 0;
  let h = mx === r ? ((g - bl) / d) % 6 : mx === g ? (bl - r) / d + 2 : (r - g) / d + 4;
  h *= 60;
  return h < 0 ? h + 360 : h;
}
function sameSet(a: string[], b: string[]) { return a.length === b.length && a.every((x) => b.includes(x)); }

// ---------------------------------------------------------------------------------------------------------------
// Item validation (basic checks; extend as the item pool grows)
// ---------------------------------------------------------------------------------------------------------------

export function validateItems(items: ItemDef[]): Report {
  const rep = new Report();
  const byId = new Map<string, ItemDef>();
  const names = new Set<string>();
  for (const it of items) {
    if (byId.has(it.id)) rep.error('items', `duplicate item id '${it.id}'`);
    byId.set(it.id, it);
    const nm = it.name?.toLowerCase();
    if (names.has(nm)) rep.warn('items', `duplicate item name '${it.name}'`);
    names.add(nm);
  }
  const feats = new Set<string>();
  for (const it of items) {
    const w = `item:${it.id}`;
    if (!it.name?.trim()) rep.error(w, 'name is empty');
    if (!it.icon?.trim()) rep.error(w, 'icon is empty');
    if (!it.description?.trim()) rep.error(w, 'description is empty');
    if (![1, 2, 3].includes(it.tier)) rep.error(w, `tier ${it.tier} must be 1, 2 or 3`);
    if (!(it.cost >= 0)) rep.error(w, 'cost must be >= 0');
    for (const k of Object.keys(it.stats ?? {})) if (!STAT_KEYS.includes(k as StatKey)) rep.error(w, `unknown stat '${k}'`);
    if (it.tier === 1 && it.components?.length) rep.warn(w, 'tier 1 item has components');
    let sum = 0;
    for (const cid of it.components ?? []) {
      const c = byId.get(cid);
      if (!c) { rep.error(w, `component '${cid}' does not exist`); continue; }
      sum += c.cost;
      if (c.tier >= it.tier) rep.warn(w, `component '${cid}' (tier ${c.tier}) is not lower tier than the item (tier ${it.tier})`);
    }
    if (it.components?.length && it.cost < sum) rep.error(w, `cost ${it.cost} is less than the sum of its components (${sum})`);
    const o: WalkOpts = { rep, where: w, ranks: 0, features: feats };
    if (it.passive) {
      checkStatMap(it.passive.stats, o, 'passive.stats');
      walkEffects(it.passive.onHit, 'enemy', o, 'passive.onHit');
      walkEffects(it.passive.everyNthHit?.effects, 'enemy', o, 'passive.everyNthHit');
      walkEffects(it.passive.onAbilityCast, 'caster', o, 'passive.onAbilityCast');
      walkEffects(it.passive.onKill, 'caster', o, 'passive.onKill');
      walkEffects(it.passive.onLowHp?.effects, 'caster', o, 'passive.onLowHp');
    }
    if (it.active) {
      const ao: WalkOpts = { ...o, targeting: it.active.targeting };
      const side: Side = it.active.targeting === 'enemy' ? 'enemy' : it.active.targeting === 'ally' ? 'ally' : it.active.targeting === 'unit' ? 'any' : 'caster';
      walkEffects(it.active.effects, side, ao, 'active.effects');
    }
    if (it.consumable) walkEffects(it.consumable.effects, 'caster', o, 'consumable.effects');
  }
  return rep;
}

// ---------------------------------------------------------------------------------------------------------------
// CLI
// ---------------------------------------------------------------------------------------------------------------

async function main() {
  const rep = validateHeroes(HEROES);
  let itemCount = 0;
  try {
    const mod = (await import('../src/shared/data/items')) as { ITEMS?: ItemDef[] };
    if (mod.ITEMS) {
      itemCount = mod.ITEMS.length;
      rep.merge(validateItems(mod.ITEMS));
    }
  } catch {
    rep.note('items: src/shared/data/items.ts not found, skipping item checks');
  }

  for (const m of rep.info) console.log(`  ${m}`);
  for (const m of rep.warnings) console.log(`WARN  ${m}`);
  for (const m of rep.errors) console.log(`ERROR ${m}`);
  console.log(`\n${HEROES.length} heroes${itemCount ? `, ${itemCount} items` : ''}: ${rep.errors.length} error(s), ${rep.warnings.length} warning(s)`);
  if (!rep.ok) {
    console.log('FAILED');
    process.exit(1);
  }
  console.log('OK');
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  void main();
}
