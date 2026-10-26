import type { Condition, Effect, StatKey } from '../types';
import { angleOf, clamp, norm, type Vec2 } from '../math';
import type { Game } from './game';
import type { Ctx, Unit } from './world';

const CC_KINDS = ['stun', 'root', 'slow', 'silence', 'knockup', 'taunt'];

function originOf(game: Game, ctx: Ctx, at: 'caster' | 'point' | 'target'): Vec2 {
  if (at === 'caster') return { x: ctx.caster.x, z: ctx.caster.z };
  if (at === 'target' && ctx.target) return { x: ctx.target.x, z: ctx.target.z };
  void game;
  return { ...ctx.point };
}

function inShape(u: Unit, o: Vec2, dir: Vec2, e: Extract<Effect, { type: 'area' }>): boolean {
  const dx = u.x - o.x, dz = u.z - o.z;
  const d = Math.hypot(dx, dz);
  if (e.shape === 'circle') return d <= e.radius + u.radius;
  if (e.shape === 'cone') {
    if (d > e.radius + u.radius) return false;
    if (d < u.radius + 0.5) return true;
    const cos = (dx * dir.x + dz * dir.z) / d;
    const half = ((e.angle ?? 60) / 2) * (Math.PI / 180);
    return cos >= Math.cos(half + Math.atan2(u.radius, d));
  }
  // rect: from origin along dir, length = radius, width = width
  const along = dx * dir.x + dz * dir.z;
  const across = Math.abs(dx * -dir.z + dz * dir.x);
  return along >= -u.radius && along <= e.radius + u.radius && across <= (e.width ?? 2) / 2 + u.radius;
}

export function runEffects(game: Game, effects: Effect[] | undefined, ctx: Ctx) {
  if (!effects) return;
  for (const e of effects) {
    try {
      runEffect(game, e, ctx);
    } catch (err) {
      // content bugs must never crash a match
      if (typeof console !== 'undefined') console.error('effect failed', e.type, err);
    }
  }
}

function runEffect(game: Game, e: Effect, ctx: Ctx) {
  const c = ctx.caster;
  const t = ctx.target;
  switch (e.type) {
    case 'damage': {
      if (!t || t.dead) return;
      if (t.id === c.id) return; // never self-damage from content
      if (t.team === c.team) return;
      game.dealDamage(c, t, game.evalNum(e.amount, ctx), e.dtype, { ability: true, vsStructures: e.vsStructures });
      return;
    }
    case 'heal': {
      if (!t) return;
      if (t.team !== c.team) return;
      game.heal(c, t, game.evalNum(e.amount, ctx));
      return;
    }
    case 'mana': {
      if (!t || t.team !== c.team) return;
      t.mana = Math.min(t.stats.maxMana, t.mana + game.evalNum(e.amount, ctx));
      return;
    }
    case 'shield': {
      if (!t || t.team !== c.team) return;
      game.addShield(t, game.evalNum(e.amount, ctx), e.duration);
      return;
    }
    case 'status': {
      if (!t) return;
      const hostile = CC_KINDS.includes(e.status);
      if (hostile && t.team === c.team) return;
      if (!hostile && t.team !== c.team) return;
      game.applyStatus(c, t, e.status, e.duration, e.power ?? 0);
      return;
    }
    case 'buff': {
      if (!t || game.isStructure(t)) return;
      const stats: Partial<Record<StatKey, number>> = {};
      for (const [k, v] of Object.entries(e.stats ?? {})) stats[k as StatKey] = game.evalNum(v, ctx);
      // a buff with negative values is a debuff: only enemies; positive buffs only allies
      const negative = Object.values(stats).some((v) => v < 0) || Object.values(e.pct ?? {}).some((v) => v < 0);
      // debuffs only land on enemies and buffs on allies, except self-inflicted trade-offs (stances)
      if (t !== c && negative !== (t.team !== c.team)) return;
      const id = `${c.id}:${e.id}`;
      let pct = e.pct ? { ...e.pct } : undefined;
      if (e.maxStacks && e.maxStacks > 1) {
        const prev = t.buffs.find((b) => b.id === id);
        const stacks = Math.min(e.maxStacks, (prev?.stacks ?? 0) + 1);
        for (const k of Object.keys(stats) as StatKey[]) stats[k]! *= stacks;
        if (pct) for (const k of Object.keys(pct) as StatKey[]) pct[k]! *= stacks;
        game.addBuff(t, id, e.duration, stats, pct);
        const b = t.buffs.find((x) => x.id === id);
        if (b) b.stacks = stacks;
        return;
      }
      game.addBuff(t, id, e.duration, stats, pct);
      return;
    }
    case 'area': {
      const o = originOf(game, ctx, e.at);
      if (e.scatter) {
        const a = game.random() * Math.PI * 2, r = Math.sqrt(game.random()) * e.scatter;
        o.x += Math.cos(a) * r; o.z += Math.sin(a) * r;
      }
      const dir = e.at === 'caster' || e.at === 'target' ? ctx.dir : e.shape === 'circle' ? ctx.dir : ctx.dir;
      const resolve = () => {
        if (c.dead && c.kind === 'hero' && e.delay) { /* delayed effects still land after death */ }
        const vfx = e.vfx ?? { style: 'nova', color: c.hero?.def.visual.vfx ?? '#ffffff' };
        game.emit({ e: 'vfx', style: vfx.style, color: vfx.color, x: o.x, z: o.z, r: e.radius, shape: e.shape, dx: dir.x, dz: dir.z, angle: e.angle, w: e.width });
        for (const u of game.unitsNear(o, e.radius + 1, (u) => game.matches(c, u, e.affects))) {
          if (!inShape(u, o, dir, e)) continue;
          if (game.isStructure(u) && !e.effects.some((x) => x.type === 'damage')) continue;
          runEffects(game, e.effects, { ...ctx, target: u, origin: o, point: o, dir });
        }
      };
      if (e.delay && e.delay > 0) {
        const vfx = e.vfx ?? { style: 'nova', color: c.hero?.def.visual.vfx ?? '#ffffff' };
        game.emit({ e: 'vfx', style: 'ring', color: vfx.color, x: o.x, z: o.z, r: e.radius, shape: e.shape, dx: dir.x, dz: dir.z, angle: e.angle, w: e.width, delay: e.delay });
        game.schedule(e.delay, resolve);
      } else resolve();
      return;
    }
    case 'projectile': {
      const start = { x: c.x, z: c.z };
      const dir = e.homing && t && t !== c ? norm({ x: t.x - c.x, z: t.z - c.z }) : ctx.dir;
      game.spawnProjectile({
        team: c.team, owner: c.id, x: start.x + dir.x * 0.8, z: start.z + dir.z * 0.8, dir, speed: e.speed, range: e.range, width: e.width,
        pierce: !!e.pierce, homing: e.homing && t && t !== c ? t.id : 0, returns: !!e.returns, toPoint: e.toPoint ? { ...ctx.point } : null,
        affects: e.affects, effects: e.effects, onEnd: e.onEnd ?? [], ctx: { ...ctx, origin: start }, visual: e.visual,
      });
      return;
    }
    case 'dash': {
      if (c.dead || game.has(c, 'root') && e.to !== 'back') return;
      let dest: Vec2;
      const dir = ctx.dir;
      if (e.to === 'target' && t && t !== c) {
        const d = norm({ x: t.x - c.x, z: t.z - c.z });
        const l = Math.min(e.distance, Math.max(0, Math.hypot(t.x - c.x, t.z - c.z) - t.radius - c.radius));
        dest = { x: c.x + d.x * l, z: c.z + d.z * l };
      } else if (e.to === 'point') {
        const l = Math.min(e.distance, Math.hypot(ctx.point.x - c.x, ctx.point.z - c.z));
        dest = { x: c.x + dir.x * l, z: c.z + dir.z * l };
      } else if (e.to === 'back') dest = { x: c.x - dir.x * e.distance, z: c.z - dir.z * e.distance };
      else dest = { x: c.x + dir.x * e.distance, z: c.z + dir.z * e.distance };
      dest = clampToMap(dest);
      c.cast = null;
      c.windup = null;
      c.path = [];
      c.dash = {
        tx: dest.x, tz: dest.z, speed: e.speed, width: e.width ?? 1.2, affects: e.affects ?? 'enemies', effects: e.effects ?? [],
        onArrive: e.onArrive ?? [], hit: new Set(), ctx: { ...ctx }, stopOnHit: !!e.stopOnHit,
      };
      c.facing = angleOf({ x: dest.x - c.x, z: dest.z - c.z });
      return;
    }
    case 'blink': {
      if (c.dead) return;
      const from = { x: c.x, z: c.z };
      runEffects(game, e.onDepart, { ...ctx, target: c, point: from, origin: from });
      const l = Math.min(e.distance, Math.hypot(ctx.point.x - c.x, ctx.point.z - c.z) || e.distance);
      let dest = clampToMap({ x: c.x + ctx.dir.x * l, z: c.z + ctx.dir.z * l });
      dest = game.nav.nearestOpen(dest);
      c.x = dest.x; c.z = dest.z; c.path = [];
      game.emit({ e: 'blink', id: c.id, x: c.x, z: c.z });
      game.emit({ e: 'vfx', style: 'smoke', color: c.hero?.def.visual.vfx ?? '#cccccc', x: from.x, z: from.z, r: 1.5 });
      runEffects(game, e.onArrive, { ...ctx, target: c, point: dest, origin: dest });
      return;
    }
    case 'zone': {
      const o = originOf(game, ctx, e.at);
      const follow = e.follow ? (e.at === 'target' && t ? t.id : c.id) : 0;
      game.addZone({
        team: c.team, x: o.x, z: o.z, radius: e.radius, until: game.time + e.duration, interval: Math.max(0.1, e.interval), nextTick: game.time,
        affects: e.affects, effects: e.effects, follow, ctx: { ...ctx }, vfx: e.vfx,
      });
      return;
    }
    case 'summon': {
      for (let i = 0; i < e.count; i++) {
        const a = (i / Math.max(1, e.count)) * Math.PI * 2 + c.facing;
        const base = e.count > 1 ? ctx.point : { x: c.x + Math.sin(c.facing) * 1.5, z: c.z + Math.cos(c.facing) * 1.5 };
        const p = game.nav.nearestOpen(clampToMap({ x: base.x + Math.sin(a) * 1.4, z: base.z + Math.cos(a) * 1.4 }));
        game.spawnSummon(c, e.unit, p, e.duration);
      }
      game.emit({ e: 'vfx', style: 'shadow', color: c.hero?.def.visual.vfx ?? '#9b5de5', x: ctx.point.x, z: ctx.point.z, r: 2 });
      return;
    }
    case 'displace': {
      if (!t || t === c || t.dead || game.isStructure(t)) return;
      if (t.team !== c.team && (game.has(t, 'unstoppable') || game.has(t, 'invulnerable'))) return;
      if (t.camp?.leashing) return;
      const o = ctx.origin;
      let d = norm({ x: t.x - o.x, z: t.z - o.z });
      if (Math.hypot(t.x - o.x, t.z - o.z) < 0.1) d = ctx.dir;
      let dist = e.distance;
      if (e.toward) {
        d = { x: -d.x, z: -d.z };
        dist = Math.min(e.distance, Math.max(0, Math.hypot(t.x - o.x, t.z - o.z) - (t.radius + 1.2)));
      }
      const dur = e.duration ?? 0.3;
      t.displaced = { vx: (d.x * dist) / dur, vz: (d.z * dist) / dur, until: game.time + dur };
      t.cast = null; t.windup = null; t.dash = null;
      if (t.hero) t.hero.recallUntil = 0;
      return;
    }
    case 'chain': {
      const hit = new Set<number>();
      let cur: Unit | null = t && t !== c && game.matches(c, t, e.affects) ? t : null;
      if (!cur) cur = nearest(game, ctx.point, e.range, (u) => game.matches(c, u, e.affects) && !game.isStructure(u) && game.visibleTo(c.team, u));
      const pts: number[] = [c.x, c.z];
      for (let i = 0; cur && i <= e.bounces; i++) {
        hit.add(cur.id);
        pts.push(cur.x, cur.z);
        runEffects(game, e.effects, { ...ctx, target: cur, origin: { x: cur.x, z: cur.z }, point: { x: cur.x, z: cur.z } });
        const from: Unit = cur;
        cur = nearest(game, from, e.range, (u) => !hit.has(u.id) && game.matches(c, u, e.affects) && !game.isStructure(u) && game.visibleTo(c.team, u));
      }
      if (pts.length > 2) game.emit({ e: 'chain', pts: pts.map((v) => Math.round(v * 10) / 10), color: e.vfx.color });
      return;
    }
    case 'delay': {
      const snap = { ...ctx };
      game.schedule(e.time, () => runEffects(game, e.effects, snap));
      return;
    }
    case 'repeat': {
      const snap = { ...ctx };
      for (let i = 0; i < e.count; i++) {
        if (i === 0) runEffects(game, e.effects, snap);
        else game.schedule(e.interval * i, () => { if (!snap.caster.dead || snap.caster.kind !== 'hero') runEffects(game, e.effects, { ...snap, origin: { x: snap.caster.x, z: snap.caster.z } }); });
      }
      return;
    }
    case 'empower': {
      c.empowered = { until: game.time + e.duration, effects: e.effects, bonusRange: e.bonusRange ?? 0, ctx: { ...ctx } };
      c.attackCd = Math.min(c.attackCd, 0.1);
      return;
    }
    case 'cleanse': {
      if (!t || t.team !== c.team) return;
      t.statuses = t.statuses.filter((s) => !CC_KINDS.includes(s.kind));
      t.displaced = null;
      game.recompute(t);
      return;
    }
    case 'self': {
      runEffects(game, e.effects, { ...ctx, target: c });
      return;
    }
    case 'if': {
      runEffects(game, test(game, e.cond, ctx) ? e.then : e.else, ctx);
      return;
    }
    case 'resetCooldowns': {
      if (!c.hero) return;
      const slots = e.slots ?? ['Q', 'W', 'E'];
      for (const s of slots) c.hero.cd['QWER'.indexOf(s)] = 0;
      return;
    }
  }
}

function test(game: Game, cond: Condition, ctx: Ctx): boolean {
  const t = ctx.target, c = ctx.caster;
  switch (cond.test) {
    case 'targetHpBelow': return !!t && !t.dead && t.hp / t.stats.maxHp < cond.value;
    case 'casterHpBelow': return c.hp / c.stats.maxHp < cond.value;
    case 'targetDead': return !!t && t.dead;
    case 'targetIsHero': return !!t && t.kind === 'hero';
    case 'targetHasStatus': return !!t && game.has(t, cond.status);
    case 'casterHasStatus': return game.has(c, cond.status);
    case 'chance': return game.random() < cond.value;
  }
}

function nearest(game: Game, p: Vec2, r: number, f: (u: Unit) => boolean): Unit | null {
  let best: Unit | null = null, bd = Infinity;
  for (const u of game.units.values()) {
    if (u.dead || !f(u)) continue;
    const d = Math.hypot(u.x - p.x, u.z - p.z);
    if (d <= r && d < bd) { bd = d; best = u; }
  }
  return best;
}

function clampToMap(p: Vec2): Vec2 {
  return { x: clamp(p.x, -108, 108), z: clamp(p.z, -63, 63) };
}
