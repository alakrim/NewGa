import type { Team } from '../types';
import type { Command, FrontlineSnap } from '../protocol';
import { angleOf, clamp, type Vec2 } from '../math';
import { TOWERS } from '../units';
import type { Game, PlayerSetup } from '../sim/game';
import type { Unit } from '../sim/world';
import {
  CASTLE, FL, FL_BANNERS, FL_BUILDINGS, FL_NODES, FL_PLOTS, FL_RESEARCH, FL_UNITS, MINE, PLAYER_COLORS, PLAYER_HEX, WATCHTOWER,
  defendX, dropPos, fortressPos, type FlBannerKey, type FlNode, type FlBuildingId, type FlResearch, type FlUnitId, type PlayerColor, type Stance, type Trainer,
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
  /** Game time the oldest waiting reinforcement started mustering (0 = nobody waiting). */
  musterSince: number;
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
  /** Attack stance: a reinforcement waiting at the muster point for a group to form. */
  muster?: boolean;
  /** Inside the keep (the unit is parked in `FlPlayer.garrison`, not in `Game.units`). */
  garrisoned?: boolean;
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
  /** Each team's army value (cost × health, miners excluded), refreshed once a second. */
  readonly armyValue: [number, number] = [0, 0];
  private goldAcc = 0;
  private suddenDeath = false;
  /** Index of each army unit among its owner's units of the same role, rebuilt every step (formation slots). */
  private roleSlot = new Map<number, number>();

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
        research: { weapons: 0, armor: 0 }, queues: { castle: [], barracks: [], archery: [], sanctum: [], giantpit: [] }, garrison: [], musterSince: 0,
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
  /** Every unit of the player, garrisoned ones included (they are parked outside `Game.units`). */
  everyone(p: FlPlayer, filter?: (u: Unit) => boolean): Unit[] {
    const out = this.owned(p, filter);
    for (const u of p.garrison) if (!filter || filter(u)) out.push(u);
    return out;
  }
  completed(p: FlPlayer, b: FlBuildingId) {
    return this.plots.filter((s) => s.owner === p.pid && s.building === b && s.progress >= 1).length;
  }
  countBuilding(p: FlPlayer, b: FlBuildingId) { return this.plots.filter((s) => s.owner === p.pid && s.building === b).length; }
  pop(p: FlPlayer) {
    let n = 0;
    for (const u of this.everyone(p)) n += FL_UNITS[u.fl!.type].pop;
    for (const t of TRAINERS) for (const q of p.queues[t]) n += FL_UNITS[q.unit].pop;
    return n;
  }
  popCap(p: FlPlayer) { return Math.min(FL.maxPop, FL.basePop + FL.housePop * this.completed(p, 'house')); }
  trainerReady(p: FlPlayer, t: Trainer) { return t === 'castle' || this.completed(p, t) > 0; }
  income(p: FlPlayer) {
    const held = this.banners.filter((b) => b.owner === p.team);
    return FL.passiveGold + this.suddenDeathGold() + 2 * this.completed(p, 'market') + held.reduce((a, b) => a + (b.key === 'heart' ? FL.heartGold : FL.bannerGold), 0);
  }
  /** Extra passive gold per second once Sudden Death starts: +1 at once, +1 more each minute. */
  suddenDeathGold() {
    const t = this.g.time - FL.suddenDeathAt;
    return t < 0 ? 0 : FL.suddenDeathGoldPerMin * (Math.floor(t / 60) + 1);
  }
  /** True while `team`'s army is worth clearly less than the enemy's: its kills pay the underdog bounty. */
  isUnderdog(team: number) {
    return this.armyValue[team as Team] < FL.underdogBelow * this.armyValue[(1 - team) as Team];
  }
  /** Gold for killing a hero: more for killing someone above your level, and more for the underdog. */
  heroBounty(victim: Unit, killer: Unit) {
    const ratio = clamp((victim.hero?.level ?? 1) / Math.max(1, killer.hero?.level ?? 1), 0.5, 1.5);
    return Math.round(FL.heroKillGold * ratio * (this.isUnderdog(killer.team) ? FL.underdogBounty : 1));
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
        for (const u of this.everyone(p)) this.applyStats(p, u); // garrisoned units too
        this.g.emit({ e: 'msg', text: `${p.name} researched ${r.name} ${lvl + 1}`, color: PLAYER_HEX[p.color] }, { team: p.team });
        return true;
      }
      case 'giveGold': {
        const mate = this.players.find((o) => o.team === p.team && o.pid !== p.pid);
        const to = mate && this.purse(mate);
        const chunks = Math.floor(Number(cmd.chunks ?? 1));
        if (!mate || !to || !(chunks >= 1)) return true;
        const amount = FL.giveChunk * Math.min(chunks, FL.giveMaxChunks);
        if (purse.gold < amount) return true;
        purse.gold -= amount; to.gold += amount;
        this.g.emit({ e: 'msg', text: `${p.name} sent ${amount} gold to ${mate.name}`, color: PLAYER_HEX[p.color] }, { team: p.team });
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
    // units queued at a trainer that is gone would wait forever: refund them
    const t = st.building as Trainer;
    if (owner && TRAINERS.includes(t) && owner.queues[t].length && this.completed(owner, st.building as FlBuildingId) <= (st.progress >= 1 ? 1 : 0)) {
      const purse = this.purse(owner);
      const refund = owner.queues[t].reduce((a, q) => a + FL_UNITS[q.unit].cost, 0);
      owner.queues[t] = [];
      if (purse) purse.gold += refund;
      this.g.emit({ e: 'msg', text: `Training queue refunded (${refund} gold)`, color: '#ffd166' }, { pid: owner.pid });
    }
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
    if (p.stance === 'attack' && def.role !== 'worker') u.fl.muster = true;
    u.splash = def.splash;
    this.applyStats(p, u);
    u.hp = u.stats.maxHp;
    return u;
  }

  onUnitKilled(u: Unit, src: Unit | null) {
    if (u.fl) {
      if (u.fl.node >= 0) this.nodeMiners[u.fl.node]?.delete(u.id);
      const bountyTo = this.ownerHero(src);
      const mult = bountyTo && this.isUnderdog(bountyTo.team) ? FL.underdogBounty : 1;
      if (bountyTo && bountyTo.team !== u.team) this.g.giveGold(bountyTo, Math.round(FL_UNITS[u.fl.type].cost * FL.killBounty * mult));
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
    u.fl!.garrisoned = true;
    u.fl!.muster = false;
    this.g.units.delete(u.id);
    p.garrison.push(u);
  }
  private ungarrison(p: FlPlayer) {
    for (const u of p.garrison) {
      const s = this.spawnPoint(p.team);
      u.x = s.x; u.z = s.z; u.order = { type: 'idle' }; u.path = [];
      // timers did not run while parked: start clean (statuses and buffs are absolute-time and may be stale)
      u.fl!.garrisoned = false;
      u.windup = null; u.cast = null; u.dash = null; u.displaced = null; u.attackCd = 0; u.aiAt = 0;
      u.statuses = []; u.buffs = []; u.shields = [];
      this.applyStats(p, u);
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

  /** Where reinforcements gather in Attack: a little on our side of the Heart Banner. */
  musterX(team: Team): number { return (team === 0 ? -1 : 1) * FL.musterX; }

  /** Attack stance: waiting units are released once a group has formed, the front group is near, or the wait ran long. */
  private updateMuster(p: FlPlayer) {
    const waiting = this.owned(p, (u) => !!u.fl!.muster);
    if (!waiting.length) { p.musterSince = 0; return; }
    if (p.stance !== 'attack') { for (const u of waiting) u.fl!.muster = false; p.musterSince = 0; return; }
    if (!p.musterSince) p.musterSince = this.g.time;
    const mx = this.musterX(p.team);
    // the front group: any of our team's army units (not waiting, not miners) near the muster point
    const frontNear = this.players.some((o) => o.team === p.team && this.owned(o, (u) => !u.fl!.muster && u.fl!.type !== 'miner').some((u) => Math.abs(u.x - mx) < FL.musterJoin));
    const ready = waiting.filter((u) => Math.abs(u.x - mx) < 8).length;
    if (ready >= FL.musterGroup || frontNear || this.g.time - p.musterSince >= FL.musterMaxWait) {
      for (const u of waiting) u.fl!.muster = false;
      p.musterSince = 0;
    }
  }

  private anchorX(p: FlPlayer, u?: Unit): number {
    const dir = p.team === 0 ? 1 : -1;
    if (u?.fl?.muster) return this.musterX(p.team);
    if (p.stance === 'hold') return p.rallyX || defendX(p.team);
    if (p.stance === 'attack') return fortressPos((1 - p.team) as Team).x - dir * 8;
    if (p.stance === 'follow') {
      const h = this.g.units.get(p.heroUnit);
      if (h && !h.dead) return clamp(h.x - dir * FL.followOffset, FL.minX + 6, FL.maxX - 6);
    }
    return defendX(p.team) + dir * (p.slot === 0 ? 2 : -2);
  }

  private formationSpot(p: FlPlayer, u: Unit): Vec2 {
    const def = FL_UNITS[u.fl!.type];
    const dir = p.team === 0 ? 1 : -1;
    const anchor = this.anchorX(p, u);
    const i = this.roleSlot.get(u.id) ?? 0;
    const perRow = 7;
    const row = Math.floor(i / perRow), col = i % perRow;
    const z = FL.laneMinZ + 1.5 + ((col + (p.slot === 0 ? 0 : 0.5)) / perRow) * (FL.laneMaxZ - FL.laneMinZ - 3);
    return { x: anchor - dir * (ROLE_ROW[def.role] + row * 1.6), z };
  }

  private pickTarget(p: FlPlayer, u: Unit): Unit | null {
    const def = FL_UNITS[u.fl!.type];
    const anchor = this.anchorX(p, u);
    const leash = p.stance === 'attack' && !u.fl!.muster ? Infinity : 16;
    const range = Math.max(9, def.stats.attackRange + 4);
    let best: Unit | null = null, bs = Infinity;
    for (const o of this.g.units.values()) {
      if (o.dead || o.team === u.team || o.team === 2) continue;
      const d = Math.hypot(o.x - u.x, o.z - u.z) - o.radius;
      const structure = this.g.isStructure(o);
      if (d > (structure ? range + 4 : range)) continue;
      if (structure && !this.g.inReach(u, o)) continue; // melee can't climb to the build plots
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
      const depot = f.node >= 0 ? this.depot(p.team, FL_NODES[f.node]) : home;
      if (this.g.moveToward(u, depot, dt, 1.2) || Math.hypot(u.x - depot.x, u.z - depot.z) < 1.8) {
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

  /** Where a miner from vein `n` unloads: the keep, or for a rich vein the nearest banner its team holds. */
  depot(team: Team, n: FlNode): Vec2 {
    const home = dropPos(team);
    if (!n.rich) return home;
    let best = home, bd = Math.hypot(n.x - home.x, n.z - home.z);
    for (const b of this.banners) {
      if (b.owner !== team) continue;
      const d = Math.hypot(n.x - b.x, n.z - b.z);
      if (d < bd) { bd = d; best = { x: b.x, z: b.z }; }
    }
    return best;
  }

  /** The free vein with the best gold per second of a round trip (rich veins count a risk detour). */
  private pickNode(p: FlPlayer, u: Unit): number {
    let best = -1, bs = Infinity;
    const speed = FL_UNITS.miner.stats.moveSpeed * (1 + MINE.carrySpeedMult) / 2;
    for (const n of FL_NODES) {
      if (n.team !== -1 && n.team !== p.team) continue;
      if (this.nodeMiners[n.index].size >= n.capacity) continue;
      const dep = this.depot(p.team, n);
      const leg = Math.hypot(n.x - dep.x, n.z - dep.z) + (n.rich ? MINE.richRisk : 0);
      const score = (2 * leg / speed + MINE.mineTime) / (MINE.trip * (n.rich ? 1 + MINE.richBonus : 1));
      if (score < bs) { bs = score; best = n.index; }
    }
    void u;
    return best;
  }

  // ---------------------------------------------------------------- tick
  step(dt: number) {
    // formation slots: each army unit's index among its owner's units of the same role
    this.roleSlot.clear();
    const counts = new Map<string, number>();
    for (const u of this.g.units.values()) {
      if (!u.fl || u.dead) continue;
      const key = u.fl.owner + '|' + FL_UNITS[u.fl.type].role;
      const i = counts.get(key) ?? 0;
      counts.set(key, i + 1);
      this.roleSlot.set(u.id, i);
    }
    for (const p of this.players) this.updateMuster(p);
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
      this.armyValue[0] = this.armyValue[1] = 0;
      for (const u of this.g.units.values()) if (!u.dead && u.fl && u.fl.type !== 'miner' && u.team !== 2) this.armyValue[u.team as Team] += FL_UNITS[u.fl.type].cost * (u.hp / u.stats.maxHp);
      for (const p of this.players) for (const u of p.garrison) if (u.fl!.type !== 'miner') this.armyValue[p.team] += FL_UNITS[u.fl!.type].cost;
      const sd = this.g.time >= FL.suddenDeathAt;
      if (sd && !this.suddenDeath) {
        this.suddenDeath = true;
        this.g.emit({ e: 'msg', text: 'Sudden Death! Both keeps crumble, their walls weaken and gold flows faster.', color: '#ff9f43' });
      }
      for (const team of [0, 1] as Team[]) {
        const c = this.g.units.get(this.castles[team]);
        if (!c || c.dead) continue;
        const inside = this.players.filter((p) => p.team === team).reduce((a, p) => a + p.garrison.length, 0);
        const want = CASTLE.attackSpeed * (1 + FL.garrisonArrowsPerUnit * Math.min(inside, FL.garrisonArrowsCap));
        let dirty = false;
        if (Math.abs(c.baseStats.attackSpeed - want) > 1e-3) { c.baseStats.attackSpeed = want; dirty = true; }
        if (sd) {
          const armor = Math.max(0, CASTLE.armor - FL.suddenDeathArmorLoss * Math.floor((this.g.time - FL.suddenDeathAt) / 30 + 1));
          if (c.baseStats.armor !== armor || c.baseStats.hpRegen !== 0) { c.baseStats = { ...c.baseStats, armor, magicResist: armor, hpRegen: 0 }; dirty = true; }
        }
        if (dirty) this.g.recompute(c);
        if (sd) this.g.dealDamage(null, c, FL.suddenDeathCrumble, 'true');
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
        this.g.emit({ e: 'banner', team: team as Team, key: b.key, by: near[0].id });
        for (const p of this.players) if (p.team === team) { const h = this.g.units.get(p.heroUnit); if (h) this.g.giveGold(h, 150); }
      }
    }
  }

  // ---------------------------------------------------------------- snapshot
  snapshot(pid: string | null, team: number): FrontlineSnap {
    const me = pid ? this.player(pid) : undefined;
    const players = this.players.map((p) => {
      const army: Partial<Record<FlUnitId, number>> = {};
      for (const u of this.everyone(p)) army[u.fl!.type] = (army[u.fl!.type] ?? 0) + 1;
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
