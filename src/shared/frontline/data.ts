// Frontline: a single-lane, Stick-War-style mode. Every player runs their own economy
// (miners, buildings, army) and controls one hero; teammates share a fortress.
import type { AnimName, ModelId, ProjectileVisual, Stats, Team } from '../types';
import { mkStats } from '../units';
import type { Vec2 } from '../math';

export const FL = {
  minX: -96, maxX: 96, minZ: -30, maxZ: 16,
  laneMinZ: -8, laneMaxZ: 9,
  fortressX: 86, // |x| of each castle
  dropX: 78, // |x| where miners deliver gold and new units appear
  startGold: 500,
  passiveGold: 3, // per second per player
  basePop: 12,
  housePop: 8,
  maxPop: 40,
  heroAbilityVsArmy: 0.6, // hero ability damage multiplier against army units (armies are the main force)
  killBounty: 0.2, // share of a unit's cost paid to the killer's owner
  heroKillGold: 200,
  heroRespawnBase: 8,
  heroRespawnPerLevel: 1.6,
  garrisonArrowsPerUnit: 0.12, // extra castle attack speed per garrisoned unit
  bannerGold: 1.5, // per second per member for each lane banner held
  heartGold: 3, // per second per member for the central banner
  captureTime: 5,
  bannerRadius: 4.5,
};

/** Four player colours (the Tiny Swords faction palette): team 0 = blue + purple, team 1 = red + yellow. */
export const PLAYER_COLORS = [['blue', 'purple'], ['red', 'yellow']] as const;
export const PLAYER_HEX: Record<string, string> = { blue: '#3d8bfd', purple: '#9b5de5', red: '#e5484d', yellow: '#e8b923' };
export type PlayerColor = 'blue' | 'purple' | 'red' | 'yellow';
/** The 3D web prototype's KayKit buildings come in green instead of purple. */
export const kaykitColor = (c: PlayerColor) => (c === 'purple' ? 'green' : c);

const side = (team: Team, x: number) => (team === 0 ? -x : x);
export const fortressPos = (team: Team): Vec2 => ({ x: side(team, FL.fortressX), z: -3 });
export const dropPos = (team: Team): Vec2 => ({ x: side(team, FL.dropX), z: 2 });
/** x where a team's army forms up when defending. */
export const defendX = (team: Team) => side(team, 64);

// ---------------------------------------------------------------- units
export type FlUnitId = 'miner' | 'swordsman' | 'archer' | 'shieldbearer' | 'assassin' | 'battlemage' | 'healer' | 'giant';
export type Trainer = 'castle' | 'barracks' | 'archery' | 'sanctum' | 'giantpit';
export type FlRole = 'worker' | 'melee' | 'ranged' | 'caster' | 'support' | 'heavy';

export interface FlUnitDef {
  id: FlUnitId;
  name: string;
  icon: string; // emoji fallback; the client may map it to an SVG icon
  description: string;
  cost: number;
  pop: number;
  trainTime: number; // seconds
  trainer: Trainer; // the building that trains it (castle = always available)
  role: FlRole;
  model: ModelId;
  weapons: string[];
  scale: number;
  radius: number;
  stats: Stats;
  ranged?: ProjectileVisual;
  splash?: number; // attack hits everything within this radius of the target
  heal?: { amount: number; every: number; range: number }; // healers heal instead of attacking allies
  attackAnims: AnimName[];
  /** Preferred targets (assassins dive the backline). */
  prefers?: FlRole[];
}

export const FL_UNITS: Record<FlUnitId, FlUnitDef> = {
  miner: {
    id: 'miner', name: 'Miner', icon: '⛏️', description: 'Mines gold from veins and carries it to your fortress. Your economy.', cost: 150, pop: 1, trainTime: 4, trainer: 'castle', role: 'worker',
    model: 'Barbarian', weapons: ['1H_Axe'], scale: 0.72, radius: 0.55,
    stats: mkStats({ maxHp: 170, attackDamage: 6, armor: 5, attackSpeed: 0.8, attackRange: 1.8, moveSpeed: 4.4 }), attackAnims: ['1H_Melee_Attack_Chop'],
  },
  swordsman: {
    id: 'swordsman', name: 'Swordsman', icon: '🗡️', description: 'Cheap, quick melee infantry. Strength in numbers.', cost: 125, pop: 1, trainTime: 3, trainer: 'castle', role: 'melee',
    model: 'Knight', weapons: ['1H_Sword'], scale: 0.8, radius: 0.6,
    stats: mkStats({ maxHp: 340, attackDamage: 18, armor: 10, magicResist: 5, attackSpeed: 1.0, attackRange: 1.9, moveSpeed: 5.2 }), attackAnims: ['1H_Melee_Attack_Chop', '1H_Melee_Attack_Slice_Diagonal'],
  },
  archer: {
    id: 'archer', name: 'Archer', icon: '🏹', description: 'Fragile crossbow archer. Shoots from behind the front line.', cost: 300, pop: 1, trainTime: 4, trainer: 'archery', role: 'ranged',
    model: 'Rogue', weapons: ['2H_Crossbow'], scale: 0.8, radius: 0.55,
    stats: mkStats({ maxHp: 230, attackDamage: 24, armor: 0, magicResist: 0, attackSpeed: 0.8, attackRange: 10, moveSpeed: 4.8 }),
    ranged: { style: 'arrow', color: '#f5deb3', size: 0.7 }, attackAnims: ['2H_Ranged_Shoot'],
  },
  shieldbearer: {
    id: 'shieldbearer', name: 'Shieldbearer', icon: '🛡️', description: 'Heavy armoured infantry that holds the line.', cost: 450, pop: 2, trainTime: 6, trainer: 'barracks', role: 'melee',
    model: 'Knight', weapons: ['1H_Sword', 'Rectangle_Shield', 'Knight_Helmet'], scale: 0.95, radius: 0.75,
    stats: mkStats({ maxHp: 900, attackDamage: 26, armor: 45, magicResist: 20, attackSpeed: 0.8, attackRange: 2.1, moveSpeed: 4.2 }), attackAnims: ['1H_Melee_Attack_Stab'],
  },
  assassin: {
    id: 'assassin', name: 'Assassin', icon: '🔪', description: 'Fast dual-blade killer that dives archers and mages.', cost: 275, pop: 1, trainTime: 4, trainer: 'barracks', role: 'melee',
    model: 'Rogue_Hooded', weapons: ['Knife', 'Knife_Offhand'], scale: 0.82, radius: 0.55,
    stats: mkStats({ maxHp: 270, attackDamage: 30, armor: 5, magicResist: 10, attackSpeed: 1.3, attackRange: 1.8, moveSpeed: 6.6 }),
    attackAnims: ['Dualwield_Melee_Attack_Stab', 'Dualwield_Melee_Attack_Slice'], prefers: ['ranged', 'caster', 'support', 'worker'],
  },
  battlemage: {
    id: 'battlemage', name: 'Battlemage', icon: '🔥', description: 'Hurls fireballs that burn every enemy around the target.', cost: 500, pop: 2, trainTime: 7, trainer: 'sanctum', role: 'caster',
    model: 'Mage', weapons: ['2H_Staff', 'Mage_Hat'], scale: 0.85, radius: 0.6,
    stats: mkStats({ maxHp: 280, attackDamage: 40, armor: 0, magicResist: 20, attackSpeed: 0.45, attackRange: 9, moveSpeed: 4.6 }),
    ranged: { style: 'fireball', color: '#ff7a2b', size: 0.9 }, splash: 2.8, attackAnims: ['Spellcast_Shoot'],
  },
  healer: {
    id: 'healer', name: 'Healer', icon: '✚', description: 'Mends wounded allies (heroes too) instead of fighting.', cost: 350, pop: 1, trainTime: 5, trainer: 'sanctum', role: 'support',
    model: 'Mage', weapons: ['Spellbook_open'], scale: 0.82, radius: 0.55,
    stats: mkStats({ maxHp: 260, attackDamage: 8, armor: 0, magicResist: 15, attackSpeed: 0.6, attackRange: 7, moveSpeed: 4.8 }),
    ranged: { style: 'orb', color: '#9cf0a0', size: 0.5 }, heal: { amount: 28, every: 1.4, range: 7 }, attackAnims: ['Spellcast_Raise'],
  },
  giant: {
    id: 'giant', name: 'Giant', icon: '🗿', description: 'A towering brute whose axe sweeps whole squads aside.', cost: 1500, pop: 4, trainTime: 16, trainer: 'giantpit', role: 'heavy',
    model: 'Barbarian', weapons: ['2H_Axe', 'Barbarian_Hat'], scale: 1.9, radius: 1.4,
    stats: mkStats({ maxHp: 3800, attackDamage: 95, armor: 30, magicResist: 25, attackSpeed: 0.45, attackRange: 3.2, moveSpeed: 3.6 }),
    splash: 3.2, attackAnims: ['2H_Melee_Attack_Chop', '2H_Melee_Attack_Spin'],
  },
};
export const FL_UNIT_ORDER: FlUnitId[] = ['miner', 'swordsman', 'archer', 'shieldbearer', 'assassin', 'battlemage', 'healer', 'giant'];

// ---------------------------------------------------------------- buildings
export type FlBuildingId = 'barracks' | 'archery' | 'sanctum' | 'giantpit' | 'house' | 'forge' | 'mineshaft' | 'watchtower' | 'market';

export interface FlBuildingDef {
  id: FlBuildingId;
  name: string;
  icon: string;
  description: string;
  cost: number;
  buildTime: number;
  /** KayKit hex-pack model, `{color}` replaced by the owner's colour. */
  model: string;
  hp: number;
  max?: number; // per player
  requires?: FlBuildingId;
}

export const FL_BUILDINGS: Record<FlBuildingId, FlBuildingDef> = {
  barracks: { id: 'barracks', name: 'Barracks', icon: '🏚️', description: 'Trains Shieldbearers and Assassins.', cost: 300, buildTime: 12, model: 'building_barracks_{color}', hp: 1500, max: 1 },
  archery: { id: 'archery', name: 'Archery Range', icon: '🎯', description: 'Trains Archers.', cost: 250, buildTime: 10, model: 'building_archeryrange_{color}', hp: 1200, max: 1 },
  sanctum: { id: 'sanctum', name: 'Arcane Sanctum', icon: '🔮', description: 'Trains Battlemages and Healers.', cost: 450, buildTime: 15, model: 'building_church_{color}', hp: 1300, max: 1, requires: 'archery' },
  giantpit: { id: 'giantpit', name: 'Giant Pit', icon: '🗿', description: 'Trains Giants.', cost: 900, buildTime: 20, model: 'building_tavern_{color}', hp: 2000, max: 1, requires: 'barracks' },
  house: { id: 'house', name: 'House', icon: '🏠', description: '+8 population cap.', cost: 150, buildTime: 8, model: 'building_home_A_{color}', hp: 800, max: 4 },
  forge: { id: 'forge', name: 'Forge', icon: '⚒️', description: 'Researches weapon and armour upgrades for your army.', cost: 400, buildTime: 12, model: 'building_blacksmith_{color}', hp: 1300, max: 1 },
  mineshaft: { id: 'mineshaft', name: 'Mine Shaft', icon: '⛏️', description: 'Miners carry +40% gold per trip.', cost: 350, buildTime: 10, model: 'building_mine_{color}', hp: 1100, max: 1 },
  watchtower: { id: 'watchtower', name: 'Watchtower', icon: '🗼', description: 'Shoots enemies that reach your base. Stack them for a deadly gate.', cost: 400, buildTime: 12, model: 'building_tower_A_{color}', hp: 1600, max: 3 },
  market: { id: 'market', name: 'Market', icon: '💰', description: '+2 gold per second.', cost: 500, buildTime: 14, model: 'building_market_{color}', hp: 1000, max: 2 },
};
export const FL_BUILDING_ORDER: FlBuildingId[] = ['house', 'barracks', 'archery', 'sanctum', 'giantpit', 'forge', 'mineshaft', 'watchtower', 'market'];

/** Forge research, per player. Levels apply to all of that player's army (not miners). */
export const FL_RESEARCH = {
  weapons: { name: 'Sharpened Steel', icon: '⚔️', costs: [300, 550, 900], perLevel: 0.15, text: '+15% army damage per level' },
  armor: { name: 'Tempered Plate', icon: '🛡️', costs: [300, 550, 900], perLevel: 8, text: '+8 armor and magic resist per level' },
} as const;
export type FlResearch = keyof typeof FL_RESEARCH;

export const WATCHTOWER = { damage: 34, range: 13, attackSpeed: 1.1, projectile: { style: 'arrow', color: '#ffe08a', size: 0.8 } as ProjectileVisual };
export const CASTLE = { hp: 7000, damage: 60, range: 14, attackSpeed: 0.9, armor: 60 };

// ---------------------------------------------------------------- map features
/** Building plots: each player owns 7 behind their half of the fortress. Index order is stable. */
export interface FlPlot { index: number; team: Team; slot: 0 | 1; x: number; z: number }
export const FL_PLOTS: FlPlot[] = (() => {
  const out: FlPlot[] = [];
  for (const team of [0, 1] as Team[]) for (const slot of [0, 1] as const) {
    const xs = [80, 74, 68, 62, 56, 50, 44];
    const z = slot === 0 ? -15 : -21;
    xs.forEach((x) => out.push({ index: out.length, team, slot, x: side(team, x), z }));
  }
  return out;
})();

export interface FlNode { index: number; x: number; z: number; capacity: number; rich: boolean; team: Team | -1 }
/** Gold veins: four safe ones per side (4 miners each), two rich contested ones near the middle. */
export const FL_NODES: FlNode[] = (() => {
  const out: FlNode[] = [];
  for (const team of [0, 1] as Team[]) for (const [x, z] of [[68, 11], [60, 11], [52, 11], [44, 11]]) out.push({ index: out.length, x: side(team, x), z, capacity: 4, rich: false, team });
  out.push({ index: out.length, x: -14, z: 11, capacity: 4, rich: true, team: -1 }, { index: out.length + 1, x: 14, z: 11, capacity: 4, rich: true, team: -1 });
  return out;
})();
export const MINE = { trip: 15, richBonus: 0.6, mineTime: 2.6, carrySpeedMult: 0.85 };

export type FlBannerKey = 'west' | 'heart' | 'east';
export interface FlBannerSpot { key: FlBannerKey; name: string; x: number; z: number; startOwner: Team | -1 }
export const FL_BANNERS: FlBannerSpot[] = [
  { key: 'west', name: 'Dawn Outpost', x: -34, z: -5, startOwner: 0 },
  { key: 'heart', name: 'Heart Banner', x: 0, z: -5, startOwner: -1 },
  { key: 'east', name: 'Dusk Outpost', x: 34, z: -5, startOwner: 1 },
];

export type Stance = 'garrison' | 'defend' | 'hold' | 'attack';
export const STANCES: Record<Stance, { name: string; icon: string; key: string; text: string }> = {
  garrison: { name: 'Garrison', icon: '🏰', key: 'Z', text: 'Everyone (miners too) hides inside the fortress. Each garrisoned unit makes the castle shoot faster.' },
  defend: { name: 'Defend', icon: '🛡️', key: 'X', text: 'The army forms a line in front of your base. Miners keep mining.' },
  hold: { name: 'Hold line', icon: '🚩', key: 'C', text: 'The army holds the line at your rally point (set it by pressing C over the battlefield).' },
  attack: { name: 'Attack', icon: '⚔️', key: 'V', text: 'The army marches on the enemy fortress and fights everything on the way.' },
};
