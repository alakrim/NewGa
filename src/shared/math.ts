export interface Vec2 { x: number; z: number }

export const v2 = (x: number, z: number): Vec2 => ({ x, z });
export const dist = (a: Vec2, b: Vec2) => Math.hypot(a.x - b.x, a.z - b.z);
export const dist2 = (a: Vec2, b: Vec2) => (a.x - b.x) ** 2 + (a.z - b.z) ** 2;
export const len = (a: Vec2) => Math.hypot(a.x, a.z);
export const sub = (a: Vec2, b: Vec2): Vec2 => ({ x: a.x - b.x, z: a.z - b.z });
export const add = (a: Vec2, b: Vec2): Vec2 => ({ x: a.x + b.x, z: a.z + b.z });
export const scale = (a: Vec2, s: number): Vec2 => ({ x: a.x * s, z: a.z * s });
export function norm(a: Vec2): Vec2 {
  const l = Math.hypot(a.x, a.z);
  return l > 1e-6 ? { x: a.x / l, z: a.z / l } : { x: 1, z: 0 };
}
export const dot = (a: Vec2, b: Vec2) => a.x * b.x + a.z * b.z;
export const clamp = (v: number, lo: number, hi: number) => (v < lo ? lo : v > hi ? hi : v);
export const lerp = (a: number, b: number, t: number) => a + (b - a) * t;
export const angleOf = (d: Vec2) => Math.atan2(d.x, d.z);
export const fromAngle = (a: number): Vec2 => ({ x: Math.sin(a), z: Math.cos(a) });

/** Distance from point p to segment ab. */
export function distToSegment(p: Vec2, a: Vec2, b: Vec2) {
  const abx = b.x - a.x, abz = b.z - a.z;
  const l2 = abx * abx + abz * abz;
  let t = l2 > 0 ? ((p.x - a.x) * abx + (p.z - a.z) * abz) / l2 : 0;
  t = clamp(t, 0, 1);
  return Math.hypot(p.x - (a.x + abx * t), p.z - (a.z + abz * t));
}

/** Mulberry32 seeded RNG so matches are reproducible in tests. */
export function rng(seed: number) {
  let s = seed >>> 0;
  return () => {
    s = (s + 0x6d2b79f5) >>> 0;
    let t = s;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
