import type { Team } from '../types';
import type { Command, FrontlineSnap } from '../protocol';
import { angleOf, clamp, type Vec2 } from '../math';
import { TOWERS } from '../units';
import type { Game, PlayerSetup } from '../sim/game';
import type { Unit } from '../sim/world';
import {
  CASTLE, FL, FL_BANNERS, FL_BUILDINGS, FL_NODES, FL_PLOTS, FL_RESEARCH, FL_UNITS, MINE, PLAYER_COLORS, PLAYER_HEX, WATCHTOWER,
  defendX, dropPos, fortressPos, type FlBannerKey, type FlBuildingId, type FlResearch, type FlUnitId, type PlayerColor, type Stance, type Trainer,
} from './data';

export interface FlPlayer {
  pid: string;
  name: string;
  team: Team;
  slot: 0 | 1;
  color: PlayerColor;
  heroUnit: number;
  stance: Stance;
  rallyX: number;
  research: Record<FlResearch, number>;
  queues: Record<Trainer, { unit: FlUnitId; left: number }[]>;
  garrison: Unit[];
}
interface PlotState { owner: string; building: FlBuildingId | ''; progress: number; unitId: number }
interface BannerState { key: FlBannerKey; name: string; x: number; z: number; owner: number; progress: number; capTeam: number }

export interface FlUnitState {
  owner: string;
  type: FlUnitId;
  state: 'idle' | 'toNode' | 'mining' | 'toDrop';
  node: number;
  carry: number;
  t: number;
  healAt: number;
  fleeing?: boolean;
}

const TRAINERS: Trainer[] = ['castle', 'barracks', 'archery', 'sanctum', 'giantpit'];
const ROLE_ROW: Record<string, number> = { heavy: 0, melee: 0.5, ranged: 4, caster: 5.5, support: 6.5, worker: 9 };

/** The Frontline mode's systems. The Game owns units, combat and heroes; this adds economy, armies and buildings. */
export class Frontline {
  readonly players: FlPlayer[] = [];
  readonly plots: PlotState[] = FL_PLOTS.map(() => ({ owner: '', building: '', progress: 0, unitId: 0 }));
  readonly nodeMiners: Set<number>[] = FL_NODES.map(() => new Set());
  readonly banners: BannerState[] = FL_BANNERS.map((b) => ({ key: b.key, name: b.name, x: b.x, z: b.z, owner: b.startOwner, progress: 0, capTeam: -1 }));
  readonly castles: [number, number] = [0, 0];
  private goldAcc = 0;

  constructor(private g: Game) {}

  // ---------------------------------------------------------------- setup
  setup(setups: PlayerSetup[]) {
    for (const team of [0, 1] as Team[]) {
      const c = this.g.spawnStructure('fortress', team, fortressPos(team), 'castle');
      c.name = team === 0 ? 'Dawnguard Keep' : 'Duskborn Keep';
      c.radius = 6;
      c.baseStats = { ...c.baseStats, maxHp: CASTLE.hp, attackDamage: CASTLE.damage, attackRange: CASTLE.range, attackSpeed: CASTLE.attackSpeed, armor: CASTLE.armor, magicResist: CASTLE.armor, hpRegen: 4 };
      this.g.recompute(c);
      c.hp = c.stats.maxHp;
      this.castles[team] = c.id;
    }
    const slots: [number, number] = [0, 0];
    for (const s of setups) {
      const slot = Math.min(1, slots[s.team]++) as 0 | 1;
      this.players.push({
        pid: s.pid, name: s.name, team: s.team, slot, color: PLAYER_COLORS[s.team][slot], heroUnit: 0, stance: 'defend', rallyX: 0,
        research: { weapons: 0, armor: 0 }, queues: { castle: [], barracks: [], archery: [], sanctum: [], giantpit: [] }, garrison: [],
      });
    }
  }

  bindHero(pid: string, unitId: number) {
    const p = this.player(pid);
    if (p) p.heroUnit = unitId;
  }

  /** Starting units, called after heroes exist. */
  start() {
    for (const p of this.players) for (let i = 0; i < 2; i++) this.spawnUnit(p, 'miner');
    for (const p of this.players) this.g.units.get(p.heroUnit)!.hero!.gold = FL.startGold;
  }

  player(pid: string) { return this.players.find((p) => p.pid === pid); }
  purse(p: FlPlayer) { return this.g.units.get(p.heroUnit)?.hero ?? null; }
  spawnPoint(team: Team): Vec2 {
    const d = dropPos(team);
    return { x: d.x + (this.g.random() - 0.5) * 3, z: d.z + (this.g.random() - 0.5) * 6 };
  }
  isHome(u: Unit) { const d = dropPos(u.team as Team); return Math.abs(u.x - d.x) < 12; }

  // ---------------------------------------------------------------- queries
  owned(p: FlPlayer, filter?: (u: Unit) => boolean): Unit[] {
    const out: Unit[] = [];
    for (const u of this.g.units.values()) if (u.fl?.owner === p.pid && !u.dead && (!filter || filter(u))) out.push(u);
    return out;
  }
  completed(p: FlPlayer, b: FlBuildingId) {
    return this.plots.filter((s) => s.owner === p.pid && s.building === b && s.progress >= 1).length;
  }
  countBuilding(p: FlPlayer, b: FlBuildingId) { return this.plots.filter((s) => s.owner === p.pid && s.building === b).length; }
  pop(p: FlPlayer) {
    let n = 0;
    for (const u of this.owned(p)) n += FL_UNITS[u.fl!.type].pop;
    for (const u of p.garrison) n += FL_UNITS[u.fl!.type].pop;
    for (const t of TRAINERS) for (const q of p.queues[t]) n += FL_UNITS[q.unit].pop;
    return n;
  }
  popCap(p: FlPlayer) { return Math.min(FL.maxPop, FL.basePop + FL.housePop * this.completed(p, 'house')); }
  trainerReady(p: FlPlayer, t: Trainer) { return t === 'castle' || this.completed(p, t) > 0; }
  income(p: FlPlayer) {
    const held = this.banners.filter((b) => b.owner === p.team);
    return FL.passiveGold + 2 * this.completed(p, 'market') + held.reduce((a, b) => a + (b.key === 'heart' ? FL.heartGold : FL.bannerGold), 0);
  }

  // ---------------------------------------------------------------- commands
  command(hero: Unit, cmd: Command): boolean {
    const p = this.player(hero.hero!.pid);
    if (!p) return false;
    const purse = hero.hero!;
    switch (cmd.c) {
      case 'train': {
        const def = FL_UNITS[cmd.unit];
        if (!def) return true;
        for (let i = 0; i < Math.max(1, Math.min(5, cmd.count ?? 1)); i++) {
          if (!this.trainerReady(p, def.trainer)) return true;
          if (p.queues[def.trainer].length >= 5) return true;
          if (this.pop(p) + def.pop > this.popCap(p)) { this.g.emit({ e: 'msg', text: 'Population cap reached: build Houses.', color: '#ffb36b' }, { pid: p.pid }); return true; }
          if (purse.gold < def.cost) return true;
          purse.gold -= def.cost;
          p.queues[def.trainer].push({ unit: def.id, left: def.trainTime });
        }
        return true;
      }
      case 'cancelTrain': {
        const def = FL_UNITS[cmd.unit];
        const q = def && p.queues[def.trainer];
        if (!q) return true;
        for (let i = q.length - 1; i >= 0; i--) if (q[i].unit === cmd.unit) { q.splice(i, 1); purse.gold += def.cost; break; }
        return true;
      }
      case 'buildAt': {
        const spot = FL_PLOTS[cmd.plot];
        const st = this.plots[cmd.plot];
        const def = FL_BUILDINGS[cmd.building];
        if (!spot || !def || st.building || spot.team !== p.team || spot.slot !== p.slot) return true;
        if (def.requires && !this.completed(p, def.requires)) return true;
        if (def.max && this.countBuilding(p, def.id) >= def.max) return true;
        if (purse.gold < def.cost) return true;
        purse.gold -= def.cost;
        this.placeBuilding(p, cmd.plot, def.id);
        return true;
      }
      case 'research': {
        const r = FL_RESEARCH[cmd.kind];
        const lvl = p.research[cmd.kind];
        if (!r || lvl >= r.costs.length || !this.completed(p, 'forge') || purse.gold < r.costs[lvl]) return true;
        purse.gold -= r.costs[lvl];
        p.research[cmd.kind] = lvl + 1;
        for (const u of this.owned(p)) this.applyStats(p, u);
        this.g.emit({ e: 'msg', text: `${p.name} researched ${r.name} ${lvl + 1}`, color: PLAYER_HEX[p.color] }, { team: p.team });
        return true;
      }
      case 'stance': {
        p.stance = cmd.stance;
        if (cmd.x !== undefined) p.rallyX = clamp(cmd.x, FL.minX + 10, FL.maxX - 10);
        else if (cmd.stance === 'hold' && !p.rallyX) p.rallyX = defendX(p.team) + (p.team === 0 ? 20 : -20);
        if (cmd.stance !== 'garrison') this.ungarrison(p);
        return true;
      }
    }
    return false;
  }

  private placeBuilding(p: FlPlayer, plot: number, id: FlBuildingId) {
    const spot = FL_PLOTS[plot];
    const def = FL_BUILDINGS[id];
    const u = this.g.spawnBuilding(p.team, { x: spot.x, z: spot.z }, def, p.color);
    u.hp = u.stats.maxHp * 0.15;
    const st = this.plots[plot];
    st.owner = p.pid; st.building = id; st.progress = 0; st.unitId = u.id;
    u.flPlot = plot;
  }

  onBuildingDestroyed(u: Unit) {
    if (u.flPlot === undefined) return false;
    const st = this.plots[u.flPlot];
    const owner = this.player(st.owner);
    this.g.emit({ e: 'msg', text: `${owner?.name ?? 'A player'} lost a ${FL_BUILDINGS[st.building as FlBuildingId]?.name ?? 'building'}`, color: '#ff8a8d' });
    st.owner = ''; st.building = ''; st.progress = 0; st.unitId = 0;
    return true;
  }

  // ---------------------------------------------------------------- units
  applyStats(p: FlPlayer, u: Unit) {
    const def = FL_UNITS[u.fl!.type];
    const s = { ...def.stats };
    if (def.role !== 'worker') {
      s.attackDamage *= 1 + FL_RESEARCH.weapons.perLevel * p.research.weapons;
      s.armor += FL_RESEARCH.armor.perLevel * p.research.armor;
      s.magicResist += FL_RESEARCH.armor.perLevel * p.research.armor;
    }
    if (u.fl!.carry > 0) s.moveSpeed *= MINE.carrySpeedMult;
    const before = u.stats.maxHp;
    u.baseStats = s;
    this.g.recompute(u);
    if (u.stats.maxHp > before && before > 0) u.hp += u.stats.maxHp - before;
  }

  spawnUnit(p: FlPlayer, type: FlUnitId): Unit {
    const def = FL_UNITS[type];
    const u = this.g.spawnArmyUnit(p.team, def, p.color, this.spawnPoint(p.team));
    u.fl = { owner: p.pid, type, state: 'idle', node: -1, carry: 0, t: 0, healAt: 0 };
    u.splash = def.splash;
    this.applyStats(p, u);
    u.hp = u.stats.maxHp;
    return u;
  }

  onUnitKilled(u: Unit, src: Unit | null) {
    if (u.fl) {
      if (u.fl.node >= 0) this.nodeMiners[u.fl.node]?.delete(u.id);
      const bountyTo = this.ownerHero(src);
      if (bountyTo && bountyTo.team !== u.team) this.g.giveGold(bountyTo, Math.round(FL_UNITS[u.fl.type].cost * FL.killBounty));
    }
  }
  /** The hero whose purse gets rewards for `src`'s kills. */
  ownerHero(src: Unit | null): Unit | null {
    if (!src) return null;
    if (src.hero) return src;
    const pid = src.fl?.owner;
    if (pid) { const p = this.player(pid); return p ? this.g.units.get(p.heroUnit) ?? null : null; }
    if (src.summon) return this.g.units.get(src.summon.owner) ?? null;
    return null;
  }

  private garrisonUnit(p: FlPlayer, u: Unit) {
    if (u.fl!.node >= 0) { this.nodeMiners[u.fl!.node].delete(u.id); u.fl!.node = -1; }
    u.fl!.state = 'idle';
    this.g.units.delete(u.id);
    p.garrison.push(u);
  }
  private ungarrison(p: FlPlayer) {
    for (const u of p.garrison) {
      const s = this.spawnPoint(p.team);
      u.x = s.x; u.z = s.z; u.order = { type: 'idle' }; u.path = [];
      this.g.units.set(u.id, u);
      this.g.emit({ e: 'blink', id: u.id, x: u.x, z: u.z });
    }
    p.garrison = [];
  }

  /** Runs AI for an army or miner unit. */
  unitAI(u: Unit, dt: number) {
    const p = this.player(u.fl!.owner);
    if (!p) return;
    const def = FL_UNITS[u.fl!.type];
    const home = dropPos(p.team);
    if (p.stance === 'garrison') {
      u.order = { type: 'idle' };
      if (Math.hypot(u.x - home.x, u.z - home.z) < 3) { this.garrisonUnit(p, u); return; }
      this.g.moveToward(u, home, dt, 1);
      return;
    }
    if (def.role === 'worker') { this.minerAI(p, u, dt); return; }
    if (this.g.time >= u.aiAt) {
      u.aiAt = this.g.time + 0.25 + this.g.random() * 0.1;
      if (def.heal && this.healerAct(u, def.heal)) return;
      const t = this.pickTarget(p, u);
      u.order = t ? { type: 'attack', id: t.id } : { type: 'idle' };
    }
    if (u.order.type === 'idle') {
      const spot = this.formationSpot(p, u);
      this.g.moveToward(u, spot, dt, 0.4);
      if (!u.moving) u.facing = p.team === 0 ? Math.PI / 2 : -Math.PI / 2;
    }
  }

  private anchorX(p: FlPlayer): number {
    const dir = p.team === 0 ? 1 : -1;
    if (p.stance === 'hold') return p.rallyX || defendX(p.team);
    if (p.stance === 'attack') return fortressPos((1 - p.team) as Team).x - dir * 8;
    return defendX(p.team) + dir * (p.slot === 0 ? 2 : -2);
  }

  private formationSpot(p: FlPlayer, u: Unit): Vec2 {
    const def = FL_UNITS[u.fl!.type];
    const dir = p.team === 0 ? 1 : -1;
    const anchor = this.anchorX(p);
    const mates = this.owned(p, (o) => FL_UNITS[o.fl!.type].role === def.role);
    const i = Math.max(0, mates.indexOf(u));
    const perRow = 7;
    const row = Math.floor(i / perRow), col = i % perRow;
    const z = FL.laneMinZ + 1.5 + ((col + (p.slot === 0 ? 0 : 0.5)) / perRow) * (FL.laneMaxZ - FL.laneMinZ - 3);
    return { x: anchor - dir * (ROLE_ROW[def.role] + row * 1.6), z };
  }

  private pickTarget(p: FlPlayer, u: Unit): Unit | null {
    const def = FL_UNITS[u.fl!.type];
    const anchor = this.anchorX(p);
    const leash = p.stance === 'attack' ? Infinity : 16;
    const range = Math.max(9, def.stats.attackRange + 4);
    let best: Unit | null = null, bs = Infinity;
    for (const o of this.g.units.values()) {
      if (o.dead || o.team === u.team || o.team === 2) continue;
      const d = Math.hypot(o.x - u.x, o.z - u.z) - o.radius;
      const structure = this.g.isStructure(o);
      if (d > (structure ? range + 4 : range)) continue;
      if (Math.abs(o.x - anchor) > leash && !(d <= def.stats.attackRange + 1)) continue;
      if (!this.g.visibleTo(u.team, o)) continue;
      let score = d;
      if (structure) score += 12; // armies fight armies first
      if (def.prefers && o.fl && def.prefers.includes(FL_UNITS[o.fl.type].role)) score -= 6;
      if (o.hero) score -= 1;
      if (score < bs) { bs = score; best = o; }
    }
    return best;
  }

  private healerAct(u: Unit, heal: { amount: number; every: number; range: number }): boolean {
    let best: Unit | null = null, frac = 0.92;
    for (const o of this.g.units.values()) {
      if (o.dead || o.team !== u.team || this.g.isStructure(o) || o.id === u.id) continue;
      if (Math.hypot(o.x - u.x, o.z - u.z) > heal.range + 3) continue;
      const f = o.hp / o.stats.maxHp;
      if (f < frac) { frac = f; best = o; }
    }
    if (!best) return false;
    u.order = { type: 'idle' };
    const d = Math.hypot(best.x - u.x, best.z - u.z);
    if (d > heal.range) { u.order = { type: 'move', x: best.x, z: best.z }; return true; }
    if (this.g.time >= u.fl!.healAt) {
      u.fl!.healAt = this.g.time + heal.every;
      u.facing = angleOf({ x: best.x - u.x, z: best.z - u.z });
      this.g.heal(u, best, heal.amount * (1 + 0.1 * (this.player(u.fl!.owner)?.research.weapons ?? 0)));
      this.g.emit({ e: 'atk', id: u.id, anim: 'Spellcast_Raise', tid: best.id });
      this.g.emit({ e: 'vfx', style: 'holy', color: '#9cf0a0', x: best.x, z: best.z, r: 1 });
    }
    return true;
  }

  private minerAI(p: FlPlayer, u: Unit, dt: number) {
    const f = u.fl!;
    const home = dropPos(p.team);
    // miners run for the keep when soldiers or heroes come close, and go back once it's clear
    if (this.g.time >= u.aiAt) {
      u.aiAt = this.g.time + 0.4;
      const danger = this.g.nearestEnemy(u, 7, (o) => o.kind === 'hero' || (!!o.fl && o.fl.type !== 'miner') || o.kind === 'summon');
      f.fleeing = !!danger;
    }
    if (f.fleeing) {
      if (f.state === 'mining') f.state = 'toNode';
      this.g.moveToward(u, { x: home.x - (p.team === 0 ? 3 : -3), z: home.z }, dt, 1);
      return;
    }
    if (f.carry > 0) {
      f.state = 'toDrop';
      if (this.g.moveToward(u, home, dt, 1.2) || Math.hypot(u.x - home.x, u.z - home.z) < 1.8) {
        const purse = this.g.units.get(p.heroUnit);
        const amount = f.carry * (this.completed(p, 'mineshaft') ? 1.4 : 1);
        f.carry = 0;
        this.applyStats(p, u);
        if (purse?.hero) { purse.hero.gold += amount; this.g.emit({ e: 'gold', id: u.id, a: Math.round(amount) }, { pid: p.pid }); }
      }
      return;
    }
    if (f.node < 0) {
      f.node = this.pickNode(p, u);
      if (f.node < 0) { this.g.moveToward(u, { x: home.x + (p.team === 0 ? 4 : -4), z: 6 }, dt, 1); return; }
      this.nodeMiners[f.node].add(u.id);
    }
    const n = FL_NODES[f.node];
    const slot = [...this.nodeMiners[f.node]].indexOf(u.id);
    const spot = { x: n.x + (slot - 1) * 1.1, z: n.z - 1.6 - (slot % 2) * 0.6 };
    if (f.state !== 'mining') {
      f.state = 'toNode';
      if (this.g.moveToward(u, spot, dt, 0.3) || Math.hypot(u.x - spot.x, u.z - spot.z) < 0.6) { f.state = 'mining'; f.t = MINE.mineTime; }
      return;
    }
    u.facing = angleOf({ x: n.x - u.x, z: n.z - u.z });
    const before = f.t;
    f.t -= dt;
    if (Math.floor(before / 0.9) !== Math.floor(f.t / 0.9)) this.g.emit({ e: 'atk', id: u.id, anim: '1H_Melee_Attack_Chop', tid: 0 });
    if (f.t <= 0) {
      f.carry = MINE.trip * (n.rich ? 1 + MINE.richBonus : 1);
      f.state = 'toDrop';
      this.applyStats(p, u);
    }
  }

  private pickNode(p: FlPlayer, u: Unit): number {
    const home = dropPos(p.team);
    let best = -1, bd = Infinity;
    for (const n of FL_NODES) {
      if (n.team !== -1 && n.team !== p.team) continue;
      if (this.nodeMiners[n.index].size >= n.capacity) continue;
      // contested veins are only worth it when the middle is ours or our army is out there
      const d = Math.hypot(n.x - home.x, n.z - home.z) + (n.team === -1 ? 25 : 0);
      if (d < bd) { bd = d; best = n.index; }
    }
    void u;
    return best;
  }

  // ---------------------------------------------------------------- tick
  step(dt: number) {
    // training
    for (const p of this.players) for (const t of TRAINERS) {
      const q = p.queues[t];
      if (!q.length || !this.trainerReady(p, t)) continue;
      q[0].left -= dt;
      if (q[0].left <= 0) { const e = q.shift()!; this.spawnUnit(p, e.unit); }
    }
    // construction
    for (const st of this.plots) {
      if (!st.building || st.progress >= 1) continue;
      const u = this.g.units.get(st.unitId);
      if (!u || u.dead) continue;
      const def = FL_BUILDINGS[st.building];
      const before = st.progress;
      st.progress = Math.min(1, st.progress + dt / def.buildTime);
      u.hp = Math.min(u.stats.maxHp, u.hp + (u.stats.maxHp * 0.85 * (st.progress - before)));
      if (st.progress >= 1) this.finishBuilding(st, u);
    }
    // banners
    this.updateBanners(dt);
    // income + castle firepower from the garrison
    this.goldAcc += dt;
    if (this.goldAcc >= 1) {
      this.goldAcc -= 1;
      for (const p of this.players) { const h = this.purse(p); if (h) h.gold += this.income(p); }
      for (const team of [0, 1] as Team[]) {
        const c = this.g.units.get(this.castles[team]);
        if (!c || c.dead) continue;
        const inside = this.players.filter((p) => p.team === team).reduce((a, p) => a + p.garrison.length, 0);
        const want = CASTLE.attackSpeed * (1 + FL.garrisonArrowsPerUnit * inside);
        if (Math.abs(c.baseStats.attackSpeed - want) > 1e-3) { c.baseStats.attackSpeed = want; this.g.recompute(c); }
        // garrisoned units slowly heal
        for (const p of this.players) if (p.team === team) for (const u of p.garrison) u.hp = Math.min(u.stats.maxHp, u.hp + u.stats.maxHp * 0.05);
      }
    }
  }

  private finishBuilding(st: PlotState, u: Unit) {
    const p = this.player(st.owner);
    const def = FL_BUILDINGS[st.building as FlBuildingId];
    u.hp = Math.max(u.hp, u.stats.maxHp * 0.95);
    if (st.building === 'watchtower') {
      u.kind = 'tower';
      u.baseStats = { ...u.baseStats, attackDamage: WATCHTOWER.damage, attackRange: WATCHTOWER.range, attackSpeed: WATCHTOWER.attackSpeed };
      u.ranged = WATCHTOWER.projectile;
      u.tower = { kind: 'arrow', level: 1, pad: -2, key: `plot-${u.flPlot}`, lastTarget: 0, ramp: 0 };
      this.g.recompute(u);
    }
    if (p) this.g.emit({ e: 'msg', text: `${p.name}'s ${def.name} is ready`, color: PLAYER_HEX[p.color] }, { team: p.team });
  }

  private updateBanners(dt: number) {
    for (const b of this.banners) {
      const near = this.g.unitsNear(b, FL.bannerRadius, (u) => (u.kind === 'hero' || (!!u.fl && u.fl.type !== 'miner')) && u.team !== 2);
      const teams = new Set(near.map((u) => u.team));
      if (teams.size !== 1) { if (!near.length) b.progress = Math.max(0, b.progress - dt / FL.captureTime / 2); continue; }
      const team = [...teams][0];
      if (team === b.owner) { b.progress = Math.max(0, b.progress - dt / FL.captureTime); continue; }
      if (b.capTeam !== team) { b.capTeam = team; b.progress = 0; }
      b.progress += (dt / FL.captureTime) * (1 + 0.15 * (near.length - 1));
      if (b.progress >= 1) {
        b.owner = team; b.progress = 0; b.capTeam = -1;
        this.g.emit({ e: 'msg', text: `${team === 0 ? 'Dawnguard' : 'Duskborn'} captured the ${b.name}!`, color: team === 0 ? '#7cb8ff' : '#ff8a8d' });
        this.g.emit({ e: 'banner', team: team as Team, key: 'keep', by: near[0].id });
        for (const p of this.players) if (p.team === team) { const h = this.g.units.get(p.heroUnit); if (h) this.g.giveGold(h, 150); }
      }
    }
  }

  // ---------------------------------------------------------------- snapshot
  snapshot(pid: string | null, team: number): FrontlineSnap {
    const me = pid ? this.player(pid) : undefined;
    const players = this.players.map((p) => {
      const army: Partial<Record<FlUnitId, number>> = {};
      for (const u of [...this.owned(p), ...p.garrison]) army[u.fl!.type] = (army[u.fl!.type] ?? 0) + 1;
      const h = this.purse(p);
      return {
        pid: p.pid, name: p.name, team: p.team, slot: p.slot, color: p.color, hero: p.heroUnit, stance: p.stance, rallyX: Math.round(p.rallyX * 10) / 10,
        pop: this.pop(p), popCap: this.popCap(p), army, garrison: p.garrison.length, research: { ...p.research },
        gold: p.team === team || team < 0 ? Math.floor(h?.gold ?? 0) : -1, income: Math.round(this.income(p) * 10) / 10,
      };
    });
    const queue = me ? TRAINERS.flatMap((t) => me.queues[t].map((q, i) => ({ unit: q.unit, trainer: t, left: i === 0 ? Math.round(q.left * 10) / 10 : FL_UNITS[q.unit].trainTime, total: FL_UNITS[q.unit].trainTime }))) : [];
    return {
      players, queue,
      plots: this.plots.map((s, i) => [i, s.owner, s.building, Math.round(s.progress * 100) / 100, s.unitId] as FrontlineSnap['plots'][number]),
      nodes: this.nodeMiners.map((s) => s.size),
      banners: this.banners.map((b) => [b.key, b.owner, Math.round(b.progress * 100) / 100, b.capTeam] as FrontlineSnap['banners'][number]),
      castles: [this.castles[0], this.castles[1]],
    };
  }
}
