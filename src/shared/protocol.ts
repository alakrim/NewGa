import type { AbilitySlot, ModelId, Team } from './types';
import type { Replay } from './sim/game';
import type { UpgradeId } from './upgrades';
import type { TowerKind } from './units';
import type { BannerKey, LaneId } from './map';
import type { Directive } from './upgrades';
import type { FlBannerKey, FlBuildingId, FlResearch, FlUnitId, PlayerColor, Stance, Trainer } from './frontline/data';

export type GameMode = 'frontline' | 'crossing';

// ---------- in-game commands (client -> sim) ----------
export type Command =
  | { c: 'move'; x: number; z: number; attack?: boolean }
  | { c: 'dir'; x: number; z: number } // WASD steering, (0,0) releases
  | { c: 'attack'; id: number }
  | { c: 'stop' }
  | { c: 'cast'; slot: AbilitySlot; x: number; z: number; id?: number }
  | { c: 'item'; slot: number; x: number; z: number; id?: number }
  | { c: 'buy'; item: string }
  | { c: 'sell'; slot: number }
  | { c: 'upgrade'; id: UpgradeId }
  | { c: 'build'; pad: number; kind: TowerKind | 'upgrade' }
  | { c: 'hire'; lane: LaneId }
  | { c: 'recall' }
  | { c: 'ping'; x: number; z: number; kind: 'go' | 'danger' | 'help' }
  | { c: 'respawnAt'; at: 'fountain' | BannerKey }
  | { c: 'directive'; lane: LaneId; kind: Directive }
  // Frontline mode
  | { c: 'train'; unit: FlUnitId; count?: number }
  | { c: 'cancelTrain'; unit: FlUnitId }
  | { c: 'buildAt'; plot: number; building: FlBuildingId }
  | { c: 'research'; kind: FlResearch }
  | { c: 'stance'; stance: Stance; x?: number };

// ---------- static info sent at game start ----------
export interface VisualInfo { model: ModelId | 'tower' | 'fortress' | 'env'; tint?: string; scale: number; weapons: string[]; name: string; kind: string; towerKind?: TowerKind; env?: string; width?: number; color?: PlayerColor }
export interface PlayerInfo { playerId: string; name: string; team: Team; heroId: string; bot: boolean; unitId: number }
export interface GameInit { you: string; players: PlayerInfo[]; visuals: Record<string, VisualInfo>; seed: number; mode: GameMode }

// ---------- snapshots (sim -> client), filtered by the viewer's team vision ----------
/** [id, vis, team, x, z, facing, hp, maxHp, shield, flags, level] */
export type UnitSnap = [number, string, number, number, number, number, number, number, number, number, number];
export const F = {
  dead: 1, moving: 2, stunned: 4, stealth: 8, casting: 16, slowed: 32, rooted: 64, invulnerable: 128,
  dashing: 512, recalling: 1024, airborne: 2048, silenced: 4096, immune: 8192, empowered: 16384,
} as const;

/** [id, x, z, style, color, size] */
export type ProjSnap = [number, number, number, string, string, number];
/** [id, x, z, radius, style, color, team, remaining] */
export type ZoneSnap = [number, number, number, number, string, string, number, number];
/** [homeTeam, key, owner, progress 0..1, capturingTeam(-1 none), locked 0/1] */
export type BannerSnap = [number, BannerKey, number, number, number, number];
/** [padIndex, team, kind|'' , level, unitId] */
export type PadSnap = [number, number, string, number, number];

export interface HeroBoard { id: number; pid: string; name: string; hero: string; team: Team; lvl: number; k: number; d: number; a: number; cs: number; respawn: number; items: (string | null)[]; bot: boolean; gold: number }

export interface MeSnap {
  unit: number;
  gold: number;
  xp: number; xpPrev: number; xpNext: number; level: number;
  cd: number[]; cdMax: number[]; ranks: number[]; mana: number; maxMana: number;
  items: (string | null)[]; itemCd: number[];
  stats: Record<string, number>;
  respawn: number;
  respawnAt: string;
  canShop: boolean;
  recall: number; // 0..1 progress, 0 = not recalling
  buffs: [string, string, number][]; // [name, icon, remaining]
}

export type GameEvent =
  | { e: 'dmg'; id: number; a: number; k: 0 | 1 | 2; c?: 1; s?: number }
  | { e: 'heal'; id: number; a: number }
  | { e: 'atk'; id: number; anim: string; tid: number }
  | { e: 'cast'; id: number; anim: string }
  | { e: 'vfx'; style: string; color: string; x: number; z: number; r: number; shape?: 'circle' | 'cone' | 'rect'; dx?: number; dz?: number; angle?: number; w?: number; delay?: number }
  | { e: 'chain'; pts: number[]; color: string }
  | { e: 'kill'; killer: number; victim: number; assists: number[] }
  | { e: 'death'; id: number }
  | { e: 'gold'; id: number; a: number }
  | { e: 'banner'; team: Team; key: BannerKey; by: number }
  | { e: 'struct'; id: number; team: Team; name: string }
  | { e: 'msg'; text: string; color?: string }
  | { e: 'level'; id: number; lvl: number }
  | { e: 'ping'; x: number; z: number; kind: string; from: string }
  | { e: 'blink'; id: number; x: number; z: number };

export interface TeamSnap { kills: number; upgrades: Record<string, number>; banners: number; towers: number; directives: [Directive, Directive] }

export interface Snapshot {
  tick: number;
  time: number;
  night: boolean;
  phaseLeft: number;
  units: UnitSnap[];
  projs: ProjSnap[];
  zones: ZoneSnap[];
  banners: BannerSnap[];
  pads: PadSnap[];
  teams: [TeamSnap, TeamSnap];
  board: HeroBoard[];
  events: GameEvent[];
  me?: MeSnap;
  /** Allied unit sight circles for the fog of war: [x, z, r] flattened */
  sight: number[];
  winner?: Team;
  /** Frontline mode state (absent in the Crossing mode). */
  fl?: FrontlineSnap;
}

export interface FlPlayerSnap {
  pid: string; name: string; team: Team; slot: 0 | 1; color: PlayerColor; hero: number; stance: Stance; rallyX: number;
  pop: number; popCap: number; army: Partial<Record<FlUnitId, number>>; garrison: number; research: Record<FlResearch, number>;
  gold: number; // -1 for enemies
  income: number; // gold per second (passive + markets + banners)
}
export interface FrontlineSnap {
  players: FlPlayerSnap[];
  /** Your training queues: `left` seconds for the unit in training, `total` = full train time. */
  queue: { unit: FlUnitId; trainer: Trainer; left: number; total: number }[];
  /** [plotIndex, ownerPid ('' = empty), building ('' = none), construction progress 0..1, building unit id] */
  plots: [number, string, FlBuildingId | '', number, number][];
  /** miners currently assigned to each FL_NODES entry */
  nodes: number[];
  /** [key, owner team (-1 none), capture progress 0..1, capturing team (-1 none)] */
  banners: [FlBannerKey, number, number, number][];
  /** castle unit ids, team 0 then team 1 */
  castles: [number, number];
}

// ---------- lobby / network envelope ----------
export interface LobbySlot { pid: string; name: string; team: Team; heroId: string | null; bot: boolean; ready: boolean }
export interface RoomInfo { code: string; host: string; slots: LobbySlot[]; started: boolean; fillBots: boolean; teamSize: number; mode: GameMode }

export type ClientMsg =
  | { t: 'create'; name: string }
  | { t: 'join'; code: string; name: string; pid?: string }
  | { t: 'leave' }
  | { t: 'team'; team: Team }
  | { t: 'hero'; heroId: string }
  | { t: 'ready'; ready: boolean }
  | { t: 'addBot'; team: Team }
  | { t: 'removeBot'; pid: string }
  | { t: 'fillBots'; on: boolean; teamSize?: number }
  | { t: 'mode'; mode: GameMode }
  | { t: 'start' }
  | { t: 'lobbyReturn' }
  | { t: 'cmd'; cmd: Command }
  | { t: 'chat'; text: string; team: boolean }
  | { t: 'ping'; ts: number };

export type ServerMsg =
  | { t: 'welcome'; pid: string }
  | { t: 'room'; room: RoomInfo }
  | { t: 'error'; msg: string }
  | { t: 'init'; init: GameInit }
  | { t: 'snap'; s: Snapshot }
  | { t: 'chat'; from: string; text: string; team: boolean; teamId: Team }
  | { t: 'pong'; ts: number }
  | { t: 'replay'; replay: Replay };
