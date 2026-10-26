import { MAP } from '../map';
import type { Vec2 } from '../math';

/** Grid navigation: 1-unit cells, 8-way A*, then string-pulled with line-of-sight checks. */
export class NavGrid {
  readonly cell = 1;
  readonly w: number;
  readonly h: number;
  readonly blocked: Uint8Array;

  constructor() {
    this.w = Math.ceil((MAP.maxX - MAP.minX) / this.cell);
    this.h = Math.ceil((MAP.maxZ - MAP.minZ) / this.cell);
    this.blocked = new Uint8Array(this.w * this.h);
  }

  toCell(p: Vec2): [number, number] {
    return [Math.floor((p.x - MAP.minX) / this.cell), Math.floor((p.z - MAP.minZ) / this.cell)];
  }
  center(cx: number, cz: number): Vec2 {
    return { x: MAP.minX + (cx + 0.5) * this.cell, z: MAP.minZ + (cz + 0.5) * this.cell };
  }
  isBlocked(cx: number, cz: number) {
    if (cx < 0 || cz < 0 || cx >= this.w || cz >= this.h) return true;
    return this.blocked[cz * this.w + cx] !== 0;
  }
  blockedAt(p: Vec2) {
    const [cx, cz] = this.toCell(p);
    return this.isBlocked(cx, cz);
  }

  /** Marks a disc as blocked (inflated by `pad` for unit radius) or clears it. */
  setCircle(c: Vec2, r: number, value: 0 | 1, pad = 0.6) {
    const R = r + pad;
    const [x0, z0] = this.toCell({ x: c.x - R, z: c.z - R });
    const [x1, z1] = this.toCell({ x: c.x + R, z: c.z + R });
    for (let z = Math.max(0, z0); z <= Math.min(this.h - 1, z1); z++)
      for (let x = Math.max(0, x0); x <= Math.min(this.w - 1, x1); x++) {
        const p = this.center(x, z);
        if (Math.hypot(p.x - c.x, p.z - c.z) <= R) this.blocked[z * this.w + x] = value;
      }
  }

  /** Nearest unblocked cell centre to p (spiral search). */
  nearestOpen(p: Vec2): Vec2 {
    const [cx, cz] = this.toCell(p);
    if (!this.isBlocked(cx, cz)) return p;
    for (let r = 1; r < 20; r++)
      for (let dz = -r; dz <= r; dz++)
        for (let dx = -r; dx <= r; dx++) {
          if (Math.abs(dx) !== r && Math.abs(dz) !== r) continue;
          if (!this.isBlocked(cx + dx, cz + dz)) return this.center(cx + dx, cz + dz);
        }
    return p;
  }

  lineOfSight(a: Vec2, b: Vec2): boolean {
    const d = Math.hypot(b.x - a.x, b.z - a.z);
    const steps = Math.ceil(d / (this.cell * 0.5));
    for (let i = 1; i <= steps; i++) {
      const t = i / steps;
      if (this.blockedAt({ x: a.x + (b.x - a.x) * t, z: a.z + (b.z - a.z) * t })) return false;
    }
    return true;
  }

  findPath(from: Vec2, to: Vec2, maxNodes = 6000): Vec2[] {
    const goal = this.nearestOpen(to);
    if (this.lineOfSight(from, goal)) return [goal];
    const [sx, sz] = this.toCell(from);
    const [gx, gz] = this.toCell(goal);
    const W = this.w;
    const start = sz * W + sx, target = gz * W + gx;
    const g = new Map<number, number>([[start, 0]]);
    const came = new Map<number, number>();
    const open = new MinHeap();
    const hf = (i: number) => {
      const dx = Math.abs((i % W) - gx), dz = Math.abs(Math.floor(i / W) - gz);
      return dx + dz + (Math.SQRT2 - 2) * Math.min(dx, dz);
    };
    open.push(start, hf(start));
    const closed = new Set<number>();
    let found = false, expanded = 0, best = start, bestH = hf(start);
    while (open.size && expanded < maxNodes) {
      const cur = open.pop()!;
      if (cur === target) { found = true; break; }
      if (closed.has(cur)) continue;
      closed.add(cur);
      expanded++;
      const cx = cur % W, cz = Math.floor(cur / W);
      const gc = g.get(cur)!;
      for (let dz = -1; dz <= 1; dz++)
        for (let dx = -1; dx <= 1; dx++) {
          if (!dx && !dz) continue;
          const nx = cx + dx, nz = cz + dz;
          if (this.isBlocked(nx, nz)) continue;
          if (dx && dz && (this.isBlocked(cx + dx, cz) || this.isBlocked(cx, cz + dz))) continue;
          const ni = nz * W + nx;
          const ng = gc + (dx && dz ? Math.SQRT2 : 1);
          if (ng < (g.get(ni) ?? Infinity)) {
            g.set(ni, ng);
            came.set(ni, cur);
            const h = hf(ni);
            if (h < bestH) { bestH = h; best = ni; }
            open.push(ni, ng + h);
          }
        }
    }
    let node = found ? target : best;
    const cells: Vec2[] = [];
    while (node !== start && came.has(node)) {
      cells.push(this.center(node % W, Math.floor(node / W)));
      node = came.get(node)!;
    }
    cells.reverse();
    if (found) cells[cells.length - 1] = goal;
    // string pulling
    const out: Vec2[] = [];
    let anchor = from;
    for (let i = 0; i < cells.length; i++) {
      const next = cells[i + 1];
      if (!next || !this.lineOfSight(anchor, next)) {
        out.push(cells[i]);
        anchor = cells[i];
      }
    }
    return out.length ? out : [goal];
  }
}

class MinHeap {
  private ids: number[] = [];
  private keys: number[] = [];
  get size() { return this.ids.length; }
  push(id: number, key: number) {
    const a = this.ids, k = this.keys;
    a.push(id); k.push(key);
    let i = a.length - 1;
    while (i > 0) {
      const p = (i - 1) >> 1;
      if (k[p] <= k[i]) break;
      [a[p], a[i]] = [a[i], a[p]]; [k[p], k[i]] = [k[i], k[p]];
      i = p;
    }
  }
  pop(): number | undefined {
    const a = this.ids, k = this.keys;
    if (!a.length) return undefined;
    const top = a[0];
    const lastId = a.pop()!, lastK = k.pop()!;
    if (a.length) {
      a[0] = lastId; k[0] = lastK;
      let i = 0;
      for (;;) {
        const l = i * 2 + 1, r = l + 1;
        let m = i;
        if (l < a.length && k[l] < k[m]) m = l;
        if (r < a.length && k[r] < k[m]) m = r;
        if (m === i) break;
        [a[m], a[i]] = [a[i], a[m]]; [k[m], k[i]] = [k[i], k[m]];
        i = m;
      }
    }
    return top;
  }
}
