import type { Team } from './types';
import type { Vec2 } from './math';

// The Vael Crossing: two lanes (north, south), a jungle between them and the Colossus pit at the centre.
// Team 0 (Dawnguard) holds the west (negative x), team 1 (Duskborn) the east. Everything is mirrored on x.

export const MAP = { minX: -110, maxX: 110, minZ: -65, maxZ: 65 };

const mirror = (p: Vec2, team: Team): Vec2 => (team === 0 ? { ...p } : { x: -p.x, z: p.z });

export type LaneId = 0 | 1; // 0 = north, 1 = south
export const LANE_NAMES = ['North', 'South'] as const;

const NORTH_LANE: Vec2[] = [
  { x: -84, z: -6 }, { x: -76, z: -20 }, { x: -64, z: -34 }, { x: -40, z: -45 }, { x: -12, z: -48 },
  { x: 12, z: -48 }, { x: 40, z: -45 }, { x: 64, z: -34 }, { x: 76, z: -20 }, { x: 84, z: -6 },
];

/** Lane waypoints from `team`'s fortress to the enemy fortress. */
export function lanepath(lane: LaneId, team: Team): Vec2[] {
  const pts = NORTH_LANE.map((p) => ({ x: p.x, z: lane === 0 ? p.z : -p.z }));
  return team === 0 ? pts : pts.reverse();
}

export const FORTRESS: Record<Team, Vec2> = { 0: { x: -91, z: 0 }, 1: { x: 91, z: 0 } };
export const FOUNTAIN: Record<Team, Vec2> = { 0: { x: -103, z: 0 }, 1: { x: 103, z: 0 } };

export interface TowerSpot { key: string; lane: LaneId; tier: 'outer' | 'inner'; pos: Vec2 }
export function towerSpots(team: Team): TowerSpot[] {
  return [
    { key: 'outer-n', lane: 0, tier: 'outer', pos: mirror({ x: -40, z: -45 }, team) },
    { key: 'inner-n', lane: 0, tier: 'inner', pos: mirror({ x: -66, z: -31 }, team) },
    { key: 'outer-s', lane: 1, tier: 'outer', pos: mirror({ x: -40, z: 45 }, team) },
    { key: 'inner-s', lane: 1, tier: 'inner', pos: mirror({ x: -66, z: 31 }, team) },
  ].map((t) => ({ ...t, lane: t.lane as LaneId, tier: t.tier as 'outer' | 'inner' }));
}

export type BannerKey = 'north' | 'south' | 'keep';
export interface BannerSpot { key: BannerKey; name: string; pos: Vec2; lane?: LaneId }
export function bannerSpots(team: Team): BannerSpot[] {
  return [
    { key: 'north', name: 'North Banner', pos: mirror({ x: -74, z: -16 }, team), lane: 0 },
    { key: 'south', name: 'South Banner', pos: mirror({ x: -74, z: 16 }, team), lane: 1 },
    { key: 'keep', name: 'Keep Banner', pos: mirror({ x: -80, z: 0 }, team) },
  ];
}
export const BANNER_RADIUS = 5;

/** Build pads where players buy defensive towers (the tower-defense layer). */
export function buildPads(team: Team): Vec2[] {
  return [
    { x: -50, z: -38 }, { x: -50, z: 38 }, { x: -78, z: -27 }, { x: -78, z: 27 }, { x: -85, z: -11 }, { x: -85, z: 11 },
  ].map((p) => mirror(p, team));
}

export type CampKind = 'bone_pack' | 'crypt_guard' | 'ember' | 'azure' | 'colossus';
export interface CampSpot { id: string; kind: CampKind; pos: Vec2 }
export const CAMPS: CampSpot[] = (() => {
  const camps: CampSpot[] = [];
  for (const team of [0, 1] as Team[]) {
    const s = team === 0 ? 'w' : 'e';
    camps.push(
      { id: `${s}-pack-n`, kind: 'bone_pack', pos: mirror({ x: -50, z: -18 }, team) },
      { id: `${s}-pack-s`, kind: 'bone_pack', pos: mirror({ x: -50, z: 18 }, team) },
      { id: `${s}-ember`, kind: 'ember', pos: mirror({ x: -28, z: -24 }, team) },
      { id: `${s}-azure`, kind: 'azure', pos: mirror({ x: -28, z: 24 }, team) },
      { id: `${s}-crypt`, kind: 'crypt_guard', pos: mirror({ x: -18, z: 0 }, team) },
    );
  }
  camps.push({ id: 'colossus', kind: 'colossus', pos: { x: 0, z: 0 } });
  return camps;
})();

export interface Obstacle { pos: Vec2; r: number; kind: 'rock' | 'trees' | 'hill' }
export const OBSTACLES: Obstacle[] = (() => {
  const half: Obstacle[] = [
    { pos: { x: -36, z: -30 }, r: 4, kind: 'trees' },
    { pos: { x: -36, z: 30 }, r: 4, kind: 'trees' },
    { pos: { x: -60, z: 0 }, r: 7, kind: 'hill' },
    { pos: { x: -40, z: -8 }, r: 3, kind: 'rock' },
    { pos: { x: -40, z: 8 }, r: 3, kind: 'rock' },
    { pos: { x: -14, z: -30 }, r: 3.5, kind: 'trees' },
    { pos: { x: -14, z: 30 }, r: 3.5, kind: 'trees' },
    { pos: { x: -8, z: -14 }, r: 2.5, kind: 'rock' },
    { pos: { x: -8, z: 14 }, r: 2.5, kind: 'rock' },
    { pos: { x: -58, z: -52 }, r: 5, kind: 'trees' },
    { pos: { x: -58, z: 52 }, r: 5, kind: 'trees' },
    { pos: { x: -26, z: -56 }, r: 5, kind: 'trees' },
    { pos: { x: -26, z: 56 }, r: 5, kind: 'trees' },
  ];
  return [...half, ...half.map((o) => ({ ...o, pos: { x: -o.pos.x, z: o.pos.z } }))];
})();
