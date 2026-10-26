import type { ModelId, ProjectileVisual, Stats, SummonKind, AnimName } from './types';
import type { CampKind } from './map';

export const ZERO_STATS: Stats = {
  maxHp: 0, hpRegen: 0, maxMana: 0, manaRegen: 0, attackDamage: 0, abilityPower: 0, armor: 0, magicResist: 0,
  attackSpeed: 0, attackRange: 0, moveSpeed: 0, critChance: 0, lifesteal: 0, abilityHaste: 0, armorPen: 0, magicPen: 0,
};
export const mkStats = (s: Partial<Stats>): Stats => ({ ...ZERO_STATS, ...s });

/** Non-hero unit templates: lane monsters, jungle camps, summons and structures. */
export interface UnitTemplate {
  name: string;
  model: ModelId | 'tower' | 'fortress';
  weapons?: string[];
  scale: number;
  radius: number;
  stats: Stats;
  ranged?: ProjectileVisual;
  attackAnims?: AnimName[];
  gold: number;
  xp: number;
  tint?: string;
}

export type MinionKind = 'melee' | 'ranged' | 'siege' | 'elite';

export const MINIONS: Record<MinionKind, UnitTemplate> = {
  melee: {
    name: 'Bone Footman', model: 'Skeleton_Minion', weapons: ['Skeleton_Blade', 'Skeleton_Shield_Small_A'], scale: 0.85, radius: 0.7,
    stats: mkStats({ maxHp: 420, attackDamage: 14, armor: 10, magicResist: 0, attackSpeed: 0.8, attackRange: 2.0, moveSpeed: 4.6 }),
    attackAnims: ['1H_Melee_Attack_Chop', '1H_Melee_Attack_Slice_Diagonal'], gold: 21, xp: 60,
  },
  ranged: {
    name: 'Bone Hexer', model: 'Skeleton_Mage', weapons: ['Skeleton_Staff'], scale: 0.8, radius: 0.7,
    stats: mkStats({ maxHp: 300, attackDamage: 22, armor: 0, magicResist: 0, attackSpeed: 0.65, attackRange: 7, moveSpeed: 4.6 }),
    ranged: { style: 'skull', color: '#9cf06b', size: 0.5 }, attackAnims: ['Spellcast_Shoot'], gold: 15, xp: 30,
  },
  siege: {
    name: 'Bone Brute', model: 'Skeleton_Warrior', weapons: ['Skeleton_Axe'], scale: 1.35, radius: 1.1,
    stats: mkStats({ maxHp: 900, attackDamage: 40, armor: 30, magicResist: 20, attackSpeed: 0.55, attackRange: 2.4, moveSpeed: 4.4 }),
    attackAnims: ['2H_Melee_Attack_Chop'], gold: 45, xp: 90,
  },
  elite: {
    name: 'Forge Wraith', model: 'Skeleton_Rogue', weapons: ['Skeleton_Blade'], scale: 1.1, radius: 0.8,
    stats: mkStats({ maxHp: 1100, attackDamage: 45, armor: 25, magicResist: 25, attackSpeed: 0.9, attackRange: 2.2, moveSpeed: 5 }),
    attackAnims: ['Dualwield_Melee_Attack_Slice'], gold: 60, xp: 120,
  },
};

export interface CampTemplate { units: { t: UnitTemplate; offset: [number, number] }[]; buff?: 'ember' | 'azure' | 'colossus'; gold: number }

const packUnit: UnitTemplate = {
  name: 'Grave Rattler', model: 'Skeleton_Minion', weapons: ['Skeleton_Axe'], scale: 0.9, radius: 0.7, tint: '#9a9a8a',
  stats: mkStats({ maxHp: 520, attackDamage: 20, armor: 12, magicResist: 10, attackSpeed: 0.8, attackRange: 2.1, moveSpeed: 5 }),
  attackAnims: ['1H_Melee_Attack_Chop'], gold: 30, xp: 70,
};
const cryptGuard: UnitTemplate = {
  name: 'Crypt Guard', model: 'Skeleton_Warrior', weapons: ['Skeleton_Blade', 'Skeleton_Shield_Large_A'], scale: 1.45, radius: 1.2, tint: '#7d6b5a',
  stats: mkStats({ maxHp: 1600, attackDamage: 42, armor: 30, magicResist: 20, attackSpeed: 0.6, attackRange: 2.6, moveSpeed: 5 }),
  attackAnims: ['1H_Melee_Attack_Chop'], gold: 95, xp: 200,
};
const ember: UnitTemplate = {
  name: 'Ember Revenant', model: 'Skeleton_Mage', weapons: ['Skeleton_Staff'], scale: 1.4, radius: 1.1, tint: '#ff6a2b',
  stats: mkStats({ maxHp: 1900, attackDamage: 48, armor: 20, magicResist: 30, attackSpeed: 0.6, attackRange: 6, moveSpeed: 5 }),
  ranged: { style: 'fireball', color: '#ff7a2b', size: 0.8 }, attackAnims: ['Spellcast_Shoot'], gold: 110, xp: 240,
};
const azure: UnitTemplate = {
  name: 'Azure Wisp-Keeper', model: 'Skeleton_Rogue', weapons: ['Skeleton_Crossbow'], scale: 1.4, radius: 1.1, tint: '#38b6ff',
  stats: mkStats({ maxHp: 1800, attackDamage: 44, armor: 25, magicResist: 25, attackSpeed: 0.7, attackRange: 6.5, moveSpeed: 5 }),
  ranged: { style: 'bolt', color: '#5ad1ff', size: 0.7 }, attackAnims: ['1H_Ranged_Shoot'], gold: 110, xp: 240,
};
const colossus: UnitTemplate = {
  name: 'Bone Colossus', model: 'Skeleton_Warrior', weapons: ['Skeleton_Axe', 'Skeleton_Shield_Large_A'], scale: 3.0, radius: 2.6, tint: '#d9c27a',
  stats: mkStats({ maxHp: 9000, attackDamage: 120, armor: 60, magicResist: 50, attackSpeed: 0.45, attackRange: 4.5, moveSpeed: 4.5 }),
  attackAnims: ['2H_Melee_Attack_Chop', '2H_Melee_Attack_Spin'], gold: 0, xp: 600,
};

export const CAMP_TEMPLATES: Record<CampKind, CampTemplate> = {
  bone_pack: { units: [{ t: packUnit, offset: [0, 0] }, { t: { ...packUnit, scale: 0.75, stats: { ...packUnit.stats, maxHp: 300 } }, offset: [1.8, 1.2] }, { t: { ...packUnit, scale: 0.75, stats: { ...packUnit.stats, maxHp: 300 } }, offset: [-1.8, 1.2] }], gold: 0 },
  crypt_guard: { units: [{ t: cryptGuard, offset: [0, 0] }], gold: 0 },
  ember: { units: [{ t: ember, offset: [0, 0] }], buff: 'ember', gold: 0 },
  azure: { units: [{ t: azure, offset: [0, 0] }], buff: 'azure', gold: 0 },
  colossus: { units: [{ t: colossus, offset: [0, 0] }], buff: 'colossus', gold: 0 },
};

export const SUMMONS: Record<SummonKind, UnitTemplate> = {
  bone_soldier: {
    name: 'Bone Soldier', model: 'Skeleton_Minion', weapons: ['Skeleton_Blade'], scale: 0.8, radius: 0.6,
    stats: mkStats({ maxHp: 260, attackDamage: 18, armor: 15, magicResist: 15, attackSpeed: 0.9, attackRange: 2, moveSpeed: 6 }),
    attackAnims: ['1H_Melee_Attack_Chop'], gold: 8, xp: 10,
  },
  bone_archer: {
    name: 'Bone Archer', model: 'Skeleton_Rogue', weapons: ['Skeleton_Crossbow'], scale: 0.8, radius: 0.6,
    stats: mkStats({ maxHp: 200, attackDamage: 22, armor: 5, magicResist: 10, attackSpeed: 0.8, attackRange: 7, moveSpeed: 6 }),
    ranged: { style: 'arrow', color: '#e8e2cf', size: 0.5 }, attackAnims: ['1H_Ranged_Shoot'], gold: 8, xp: 10,
  },
  wraith: {
    name: 'Wraith', model: 'Skeleton_Rogue', weapons: ['Skeleton_Blade'], scale: 0.9, radius: 0.6, tint: '#7b5cff',
    stats: mkStats({ maxHp: 220, attackDamage: 30, armor: 10, magicResist: 30, attackSpeed: 1.1, attackRange: 2, moveSpeed: 7.5 }),
    attackAnims: ['Dualwield_Melee_Attack_Stab'], gold: 8, xp: 10,
  },
  bone_brute: {
    name: 'Bone Brute', model: 'Skeleton_Warrior', weapons: ['Skeleton_Axe'], scale: 1.25, radius: 1,
    stats: mkStats({ maxHp: 700, attackDamage: 35, armor: 35, magicResist: 25, attackSpeed: 0.6, attackRange: 2.4, moveSpeed: 5.8 }),
    attackAnims: ['2H_Melee_Attack_Chop'], gold: 15, xp: 20,
  },
};

export type TowerKind = 'lane' | 'arrow' | 'frost' | 'cannon' | 'arcane' | 'fortress';
export interface TowerTemplate {
  name: string; description: string; icon: string; cost: number; radius: number;
  stats: Stats; projectile: ProjectileVisual;
  splash?: number; slow?: number; chain?: number; heroBonus?: number; magic?: boolean;
}
export const TOWERS: Record<TowerKind, TowerTemplate> = {
  lane: {
    name: 'Bastion Tower', description: 'Guards the lane. Its shots ramp up against heroes.', icon: '🏰', cost: 0, radius: 1.8,
    stats: mkStats({ maxHp: 3500, attackDamage: 150, armor: 40, magicResist: 40, attackSpeed: 0.85, attackRange: 11 }),
    projectile: { style: 'bolt', color: '#ffe08a', size: 0.9 },
  },
  fortress: {
    name: 'Fortress Core', description: 'Destroy it to win. Shielded by its banners.', icon: '🏯', cost: 0, radius: 6,
    stats: mkStats({ maxHp: 8000, attackDamage: 220, armor: 60, magicResist: 60, attackSpeed: 1, attackRange: 13, hpRegen: 8 }),
    projectile: { style: 'orb', color: '#fff2b0', size: 1.2 },
  },
  arrow: {
    name: 'Arrow Tower', description: 'Cheap, fast single-target shots.', icon: '🏹', cost: 400, radius: 1.3,
    stats: mkStats({ maxHp: 1400, attackDamage: 45, armor: 25, magicResist: 25, attackSpeed: 1.6, attackRange: 10 }),
    projectile: { style: 'arrow', color: '#f5deb3', size: 0.6 },
  },
  frost: {
    name: 'Frost Spire', description: 'Slows everything it hits by 35%.', icon: '❄️', cost: 500, radius: 1.3,
    stats: mkStats({ maxHp: 1400, attackDamage: 55, armor: 25, magicResist: 25, attackSpeed: 0.9, attackRange: 9.5 }),
    projectile: { style: 'shard', color: '#9be7ff', size: 0.7 }, slow: 0.35, magic: true,
  },
  cannon: {
    name: 'Cannon Bastion', description: 'Slow shots that explode, damaging every enemy nearby.', icon: '💣', cost: 550, radius: 1.5,
    stats: mkStats({ maxHp: 1800, attackDamage: 110, armor: 35, magicResist: 20, attackSpeed: 0.5, attackRange: 11 }),
    projectile: { style: 'orb', color: '#555555', size: 1.0 }, splash: 3.5,
  },
  arcane: {
    name: 'Arcane Obelisk', description: 'Magic bolts chain between 3 enemies and deal +60% to heroes.', icon: '🔮', cost: 650, radius: 1.3,
    stats: mkStats({ maxHp: 1300, attackDamage: 70, armor: 20, magicResist: 40, attackSpeed: 0.8, attackRange: 10 }),
    projectile: { style: 'bolt', color: '#c77dff', size: 0.8 }, chain: 3, heroBonus: 0.6, magic: true,
  },
};
export const BUILD_TOWER_KINDS: TowerKind[] = ['arrow', 'frost', 'cannon', 'arcane'];
/** Built towers level 1..3; upgrade cost = cost x this, stat multiplier per level. */
export const TOWER_UPGRADE_COST = 0.6;
export const TOWER_LEVEL_MULT = [1, 1.45, 1.95];

export const CAMP_BUFFS = {
  ember: { name: 'Ember Brand', icon: '🔥', duration: 90, pct: { attackDamage: 0.15, abilityPower: 0.15 } },
  azure: { name: 'Azure Insight', icon: '💠', duration: 90, stats: { abilityHaste: 20, manaRegen: 4 } },
  colossus: { name: 'Colossus Might', icon: '💀', duration: 150, pct: { attackDamage: 0.2, abilityPower: 0.2, armor: 0.15, magicResist: 0.15 } },
} as const;
