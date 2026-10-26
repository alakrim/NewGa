// Core data schema for Bannerfall. Heroes, abilities, passives and items are pure data:
// the simulation (src/shared/sim) interprets the Effect tree, so new content needs no code.

export type Team = 0 | 1;
export type DamageType = 'physical' | 'magic' | 'true';
export type Role = 'Tank' | 'Fighter' | 'Assassin' | 'Mage' | 'Marksman' | 'Support';

export interface Stats {
  maxHp: number;
  hpRegen: number; // per second
  maxMana: number;
  manaRegen: number; // per second
  attackDamage: number;
  abilityPower: number;
  armor: number; // damage taken x 100/(100+armor)
  magicResist: number;
  attackSpeed: number; // attacks per second
  attackRange: number; // world units (melee ~2.4, ranged 7-9)
  moveSpeed: number; // world units per second (~6)
  critChance: number; // 0..1, crits deal 175%
  lifesteal: number; // 0..1 of basic attack damage dealt
  abilityHaste: number; // cooldown x 100/(100+haste)
  armorPen: number; // 0..1, fraction of target armor ignored
  magicPen: number; // 0..1, fraction of target magic resist ignored
}
export type StatKey = keyof Stats;

/** A scaled number. All parts are summed. */
export interface Scaling {
  base?: number | number[]; // number[] = per ability rank (index 0 = rank 1)
  ad?: number; // x caster total attack damage
  bonusAd?: number; // x caster attack damage from items and buffs (level growth is NOT bonus, as in most MOBAs)
  ap?: number; // x caster ability power
  maxHp?: number; // x caster max hp
  bonusHp?: number; // x caster max hp above base
  targetMaxHp?: number; // x target max hp
  targetMissingHp?: number; // x target missing hp
  armor?: number; // x caster armor
  level?: number; // x caster level
}
export type Num = number | Scaling;

export type StatusKind =
  | 'stun' // cannot move, attack or cast
  | 'root' // cannot move
  | 'slow' // power = 0..1 move speed reduction
  | 'silence' // cannot cast
  | 'knockup' // airborne stun (cannot be reduced)
  | 'taunt' // forced to attack the source
  | 'invulnerable' // takes no damage
  | 'unstoppable' // immune to stun/root/slow/silence/knockup/taunt
  | 'stealth'; // invisible to enemies unless adjacent; broken by attacking

export type Affects = 'enemies' | 'allies' | 'alliesAndSelf' | 'all';

export type VfxStyle =
  | 'nova' | 'slash' | 'beam' | 'meteor' | 'ring' | 'spikes' | 'smoke' | 'sparkle'
  | 'vortex' | 'frost' | 'fire' | 'lightning' | 'holy' | 'shadow' | 'poison' | 'blood' | 'earth' | 'wind';
export interface VfxSpec { style: VfxStyle; color: string }

export type ProjectileStyle = 'arrow' | 'bolt' | 'orb' | 'axe' | 'dagger' | 'fireball' | 'spear' | 'wave' | 'skull' | 'shard' | 'hammer';
export interface ProjectileVisual { style: ProjectileStyle; color: string; size?: number }

export type SummonKind = 'bone_soldier' | 'bone_archer' | 'wraith' | 'bone_brute';

/**
 * Effects run in a context { caster, target, point, dir, rank }.
 * Unit effects (damage/heal/shield/status/buff/displace/cleanse/stealth) apply to ctx.target.
 * At the top level of an ability, ctx.target is the targeted unit for 'enemy'/'ally' targeting,
 * otherwise the caster. area/projectile/chain/zone/dash set ctx.target to each unit they hit.
 * Use { type: 'self' } to apply effects to the caster from inside a nested context.
 */
export type Effect =
  | { type: 'damage'; amount: Num; dtype: DamageType; vsStructures?: number } // vsStructures multiplies damage to towers/fortress (after the 50% ability penalty)
  | { type: 'heal'; amount: Num }
  | { type: 'mana'; amount: Num } // restores mana
  | { type: 'shield'; amount: Num; duration: number }
  | { type: 'status'; status: StatusKind; duration: number; power?: number }
  | {
      type: 'buff';
      id: string; // re-applying the same id refreshes instead of stacking
      duration: number;
      stats?: Partial<Record<StatKey, Num>>; // flat bonus
      pct?: Partial<Record<StatKey, number>>; // multiplicative bonus, 0.2 = +20% (negative allowed)
      vfx?: VfxSpec;
      maxStacks?: number; // re-applying adds a stack (values x stacks) up to this many, refreshing duration
    }
  | {
      type: 'area';
      shape: 'circle' | 'cone' | 'rect';
      at: 'caster' | 'point' | 'target';
      radius: number; // circle radius, cone length, rect length
      angle?: number; // cone full angle in degrees
      width?: number; // rect width (rect extends from origin along ctx.dir)
      affects: Affects;
      effects: Effect[];
      delay?: number; // seconds before it resolves (telegraphed on the ground)
      scatter?: number; // random offset of the origin within this radius each time it resolves (barrages)
      vfx?: VfxSpec;
    }
  | {
      type: 'projectile';
      speed: number;
      range: number;
      width: number; // collision radius
      pierce?: boolean; // keep going after hitting a unit
      homing?: boolean; // follows ctx.target (needs a unit target)
      returns?: boolean; // flies back to the caster after max range, hitting again
      toPoint?: boolean; // stops at ctx.point instead of max range
      affects: Affects;
      effects: Effect[]; // per unit hit
      onEnd?: Effect[]; // at the point where it stops (ctx.target = caster, ctx.point = end point)
      visual: ProjectileVisual;
    }
  | {
      type: 'dash';
      to: 'point' | 'target' | 'direction' | 'back'; // 'back' = away from ctx.dir
      distance: number; // max distance
      speed: number;
      width?: number; // hit radius for units passed through
      affects?: Affects;
      effects?: Effect[]; // per unit passed through (once each)
      onArrive?: Effect[]; // ctx.target = caster, ctx.point = arrival point
      stopOnHit?: boolean; // stop at the first unit hit
    }
  | { type: 'blink'; distance: number; onDepart?: Effect[]; onArrive?: Effect[] }
  | {
      type: 'zone';
      at: 'caster' | 'point' | 'target';
      radius: number;
      duration: number;
      interval: number; // seconds between ticks
      affects: Affects;
      effects: Effect[]; // per unit inside, each tick
      follow?: boolean; // follows the unit it was placed on
      vfx: VfxSpec;
    }
  | { type: 'summon'; unit: SummonKind; count: number; duration: number }
  | { type: 'displace'; distance: number; toward?: boolean; duration?: number } // knockback (or pull with toward), from ctx origin
  | { type: 'chain'; bounces: number; range: number; affects: Affects; effects: Effect[]; vfx: VfxSpec }
  | { type: 'delay'; time: number; effects: Effect[] }
  | { type: 'repeat'; count: number; interval: number; effects: Effect[] }
  | { type: 'empower'; duration: number; effects: Effect[]; bonusRange?: number } // next basic attack within duration also runs effects on its target
  | { type: 'cleanse' } // removes stun/root/slow/silence/taunt from ctx.target
  | { type: 'self'; effects: Effect[] }
  | { type: 'resetCooldowns'; slots?: AbilitySlot[] } // refreshes caster cooldowns (default: basic abilities)
  | { type: 'if'; cond: Condition; then: Effect[]; else?: Effect[] };

/**
 * Conditions for { type: 'if' }, evaluated in the current context at that moment
 * (so place an 'if targetDead' after the damage effect that may kill).
 */
export type Condition =
  | { test: 'targetHpBelow'; value: number } // 0..1 of max hp
  | { test: 'casterHpBelow'; value: number }
  | { test: 'targetDead' }
  | { test: 'targetIsHero' }
  | { test: 'targetHasStatus'; status: StatusKind }
  | { test: 'casterHasStatus'; status: StatusKind }
  | { test: 'chance'; value: number }; // 0..1, uses the seeded match RNG

export type AbilitySlot = 'Q' | 'W' | 'E' | 'R';
export type Targeting = 'self' | 'point' | 'direction' | 'enemy' | 'ally' | 'unit';

/** Animation clips available on every KayKit character. */
export type AnimName =
  | 'Idle' | 'Unarmed_Idle' | '2H_Melee_Idle' | 'Running_A' | 'Running_B' | 'Walking_A'
  | 'Death_A' | 'Death_B' | 'Hit_A' | 'Hit_B' | 'Block' | 'Cheer' | 'Dodge_Forward' | 'Jump_Full_Short'
  | '1H_Melee_Attack_Chop' | '1H_Melee_Attack_Slice_Diagonal' | '1H_Melee_Attack_Slice_Horizontal' | '1H_Melee_Attack_Stab'
  | '2H_Melee_Attack_Chop' | '2H_Melee_Attack_Slice' | '2H_Melee_Attack_Spin' | '2H_Melee_Attack_Spinning' | '2H_Melee_Attack_Stab'
  | 'Dualwield_Melee_Attack_Chop' | 'Dualwield_Melee_Attack_Slice' | 'Dualwield_Melee_Attack_Stab'
  | '1H_Ranged_Shoot' | '2H_Ranged_Shoot' | 'Spellcast_Shoot' | 'Spellcast_Raise' | 'Spellcast_Long' | 'Spellcasting'
  | 'Throw' | 'Unarmed_Melee_Attack_Punch_A' | 'Unarmed_Melee_Attack_Kick' | 'Use_Item' | 'Interact' | 'PickUp';

export interface AbilityDef {
  id: string;
  name: string;
  description: string; // player-facing, mention numbers loosely ("deals magic damage and slows")
  icon: string; // a single emoji
  targeting: Targeting;
  range: number; // max cast range (point/unit), aim length (direction), 0 for self
  radius?: number; // ground indicator radius for point abilities
  cooldown: number[]; // seconds, per rank (5 ranks for Q/W/E, 3 for R)
  manaCost: number[];
  castTime?: number; // windup in seconds (default 0.2); the caster is rooted while casting
  anim?: AnimName;
  effects: Effect[];
}

export interface PassiveDef {
  name: string;
  description: string;
  icon: string;
  stats?: Partial<Record<StatKey, Num>>; // permanent; Scaling.level works here
  onHit?: Effect[]; // every basic attack hit; ctx.target = victim
  everyNthHit?: { n: number; effects: Effect[] }; // ctx.target = victim
  onAbilityCast?: Effect[]; // ctx.target = caster
  onKill?: Effect[]; // hero or monster kill; ctx.target = caster
  onLowHp?: { threshold: number; cooldown: number; effects: Effect[] }; // threshold 0..1 of max hp; ctx.target = caster
}

export type ModelId =
  | 'Knight' | 'Barbarian' | 'Mage' | 'Rogue' | 'Rogue_Hooded'
  | 'Skeleton_Warrior' | 'Skeleton_Mage' | 'Skeleton_Rogue' | 'Skeleton_Minion';

export interface HeroVisual {
  model: ModelId;
  tint: string; // hex, applied to cloth pieces (cape, hat, hood, body)
  accent: string; // hex, secondary color used by UI / name plate
  scale: number; // 1 = default (0.9..1.25)
  weapons: string[]; // weapon/accessory mesh names to show (see docs/MODELS.md); all others are hidden
  vfx: string; // hex, default color for this hero's effects
}

export interface HeroDef {
  id: string;
  name: string;
  title: string;
  role: Role;
  secondaryRole?: Role;
  difficulty: 1 | 2 | 3;
  faction: string;
  lore: string;
  quote: string;
  visual: HeroVisual;
  attack: {
    kind: 'melee' | 'ranged';
    anims: AnimName[]; // cycled per attack
    projectile?: ProjectileVisual; // ranged only
    dtype?: DamageType; // default physical
  };
  base: Stats;
  growth: Partial<Stats>; // added per level above 1
  passive: PassiveDef;
  abilities: [AbilityDef, AbilityDef, AbilityDef, AbilityDef]; // Q, W, E, R
}

export type ItemCategory = 'attack' | 'magic' | 'defense' | 'utility' | 'boots' | 'consumable';

export interface ItemDef {
  id: string;
  name: string;
  tier: 1 | 2 | 3; // 1 = basic component, 2 = advanced, 3 = legendary
  category: ItemCategory;
  cost: number; // total price including components; buying with components owned pays the difference
  components?: string[]; // item ids consumed when this is bought
  stats: Partial<Stats>;
  icon: string; // emoji
  description: string;
  passive?: Omit<PassiveDef, 'icon'>;
  active?: { name: string; description: string; cooldown: number; targeting: Targeting; range: number; effects: Effect[] };
  consumable?: { effects: Effect[] }; // used on purchase-slot activation, then removed
  unique?: boolean; // only one copy per hero
}
