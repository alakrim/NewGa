import type { AbilityDef, Effect, HeroDef, ProjectileVisual, Stats, StatusKind, StatKey, AnimName, Num, Affects, VfxSpec } from '../types';
import type { Vec2 } from '../math';
import type { LaneId, BannerKey } from '../map';
import type { TowerKind } from '../units';

export type UnitKind = 'hero' | 'minion' | 'monster' | 'tower' | 'fortress' | 'summon' | 'building';
export const NEUTRAL = 2;

export interface Buff {
  id: string;
  name?: string;
  icon?: string;
  until: number;
  stats?: Partial<Record<StatKey, number>>;
  pct?: Partial<Record<StatKey, number>>;
  stacks?: number;
}
export interface Status { kind: StatusKind; until: number; power: number; src: number }
export interface Shield { amount: number; until: number }

export type Order =
  | { type: 'idle' }
  | { type: 'move'; x: number; z: number; attackMove?: boolean }
  | { type: 'attack'; id: number }
  | { type: 'castAt'; slot: number; id: number; item?: boolean }; // walk into range of a unit, then cast

export interface Ctx {
  caster: Unit;
  target: Unit | null;
  point: Vec2;
  dir: Vec2;
  origin: Vec2;
  rank: number;
}

export interface HeroState {
  def: HeroDef;
  pid: string;
  pname: string;
  bot: boolean;
  level: number;
  xp: number;
  gold: number;
  items: (string | null)[];
  itemCd: number[];
  cd: number[]; // Q W E R remaining
  cdMax: number[];
  kills: number;
  deaths: number;
  assists: number;
  cs: number;
  streak: number;
  respawnAt: number;
  nthCounter: number;
  lowHpReadyAt: number;
  itemLowHpReadyAt: Record<string, number>;
  itemNth: Record<string, number>;
  recallUntil: number; // 0 = not recalling
  respawnAt_choice: 'fountain' | 'north' | 'south' | 'keep';
  steer: Vec2 | null; // WASD direction
  bannerPings?: number;
}

export interface Unit {
  id: number;
  kind: UnitKind;
  team: number;
  vis: string;
  name: string;
  x: number;
  z: number;
  facing: number;
  radius: number;
  baseStats: Stats;
  stats: Stats;
  hp: number;
  mana: number;
  shields: Shield[];
  statuses: Status[];
  buffs: Buff[];
  dead: boolean;
  removeAt: number;
  order: Order;
  path: Vec2[];
  pathGoal: Vec2 | null;
  repathAt: number;
  attackCd: number;
  windup: { targetId: number; t: number } | null;
  cast: { def: AbilityDef; slot: number; t: number; ctx: Ctx; item: boolean } | null;
  dash: { tx: number; tz: number; speed: number; width: number; affects: Affects; effects: Effect[]; onArrive: Effect[]; hit: Set<number>; ctx: Ctx; stopOnHit: boolean } | null;
  displaced: { vx: number; vz: number; until: number } | null;
  damagedBy: Map<number, number>; // hero unit id -> time
  lastHeroAttackOnHeroAt: number; // for tower aggro
  lastDamagedAt: number;
  moving: boolean;
  ranged: ProjectileVisual | null;
  attackAnims: AnimName[];
  attackIdx: number;
  attackDtype: 'physical' | 'magic' | 'true';
  gold: number;
  xp: number;
  empowered: { until: number; effects: Effect[]; bonusRange: number; ctx: Ctx } | null;
  hero?: HeroState;
  minion?: { lane: LaneId; wp: number; path: Vec2[] };
  camp?: { campId: string; home: Vec2; leashing: boolean; slamAt: number };
  summon?: { owner: number; until: number };
  tower?: { kind: TowerKind; level: number; pad: number; key: string; lastTarget: number; ramp: number };
  aiAt: number;
  scaleMul: number;
  siegeBonus?: number;
  stealthBrokeAt?: number;
  /** Frontline army/miner state. */
  fl?: import('../frontline/sim').FlUnitState;
  /** Basic attacks also hit enemies within this radius of the target (60% damage). */
  splash?: number;
  /** Frontline: the building plot this structure stands on. */
  flPlot?: number;
}

export interface Projectile {
  id: number;
  team: number;
  owner: number;
  x: number;
  z: number;
  dir: Vec2;
  speed: number;
  traveled: number;
  range: number;
  width: number;
  pierce: boolean;
  homing: number; // target unit id or 0
  returns: boolean;
  returning: boolean;
  toPoint: Vec2 | null;
  affects: Affects;
  effects: Effect[];
  onEnd: Effect[];
  hit: Set<number>;
  ctx: Ctx | null;
  visual: ProjectileVisual;
  attack?: { attacker: number; target: number }; // basic attack projectile
  towerShot?: boolean;
  dead: boolean;
}

export interface Zone {
  id: number;
  team: number;
  x: number;
  z: number;
  radius: number;
  until: number;
  interval: number;
  nextTick: number;
  affects: Affects;
  effects: Effect[];
  follow: number; // unit id or 0
  ctx: Ctx;
  vfx: VfxSpec;
}

export interface Scheduled { at: number; run: () => void }

export interface Banner {
  homeTeam: number;
  key: BannerKey;
  name: string;
  x: number;
  z: number;
  lane?: LaneId;
  owner: number;
  progress: number;
  capTeam: number;
}

export interface Pad { index: number; team: number; x: number; z: number; unitId: number; kind: TowerKind | ''; level: number }

export type ScalingInput = Num;
