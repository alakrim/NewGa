import type { Team } from '../types';
import type { Command } from '../protocol';
import type { Game } from '../sim/game';
import type { Unit } from '../sim/world';
import { abilityIntent } from '../sim/bots';
import { FL_BUILDINGS, FL_PLOTS, FL_RESEARCH, FL_UNITS, defendX, dropPos, fortressPos, type FlBuildingId, type FlUnitId, type Stance } from './data';
import type { FlPlayer } from './sim';

type Plan = { build: FlBuildingId[]; army: Partial<Record<FlUnitId, number>> };
/** A few personalities so bot opponents don't all play the same. */
const PLANS: Plan[] = [ // 7 plots per player
  { build: ['house', 'archery', 'barracks', 'house', 'forge', 'sanctum', 'house'], army: { swordsman: 3, archer: 4, shieldbearer: 2, battlemage: 1, healer: 1 } },
  { build: ['house', 'barracks', 'house', 'mineshaft', 'giantpit', 'forge', 'house'], army: { swordsman: 4, shieldbearer: 3, assassin: 2, giant: 1 } },
  { build: ['house', 'archery', 'sanctum', 'house', 'mineshaft', 'watchtower', 'house'], army: { swordsman: 3, archer: 3, battlemage: 3, healer: 2 } },
];

export class FrontlineBot {
  private next = 0;
  private econAt = 0;
  private plan: Plan;
  private retreating = false;
  private lastMove = { x: 1e9, z: 1e9 };

  constructor(private g: Game, private unitId: number) {
    this.plan = PLANS[(unitId + Math.floor(g.random() * 3)) % PLANS.length];
  }

  private get u(): Unit { return this.g.units.get(this.unitId)!; }
  private get p(): FlPlayer | undefined { return this.g.front!.player(this.u.hero!.pid); }
  private cmd(c: Command) { this.g.command(this.u.hero!.pid, c); }

  update(_dt: number) {
    const g = this.g;
    if (!this.u?.hero || !this.p) return;
    if (g.time >= this.econAt) { this.econAt = g.time + 1 + g.random() * 0.3; this.economy(); this.stance(); }
    if (g.time >= this.next) { this.next = g.time + 0.25 + g.random() * 0.1; this.hero(); }
  }

  // ---------------------------------------------------------------- economy
  private economy() {
    const f = this.g.front!, p = this.p!, gold = () => this.u.hero!.gold;
    const miners = (p.garrison.filter((u) => u.fl!.type === 'miner').length) + f.owned(p, (u) => u.fl!.type === 'miner').length
      + p.queues.castle.filter((q) => q.unit === 'miner').length;
    const want = Math.min(9, 4 + Math.floor(this.g.time / 30));
    const room = f.popCap(p) - f.pop(p);
    if (miners < want && room >= 1 && p.queues.castle.length < 2) {
      if (gold() >= 150) this.cmd({ c: 'train', unit: 'miner' });
      if (miners < 7 || gold() < 150) return; // the economy comes first early on
    }
    if (room <= 2 && f.countBuilding(p, 'house') < (FL_BUILDINGS.house.max ?? 4) && gold() >= FL_BUILDINGS.house.cost && this.freePlot()) { this.build('house'); return; }
    // next building in the plan that we don't have enough of yet; keep half its price in reserve while saving
    const counts: Partial<Record<FlBuildingId, number>> = {};
    let reserve = 0;
    for (const b of this.plan.build) {
      counts[b] = (counts[b] ?? 0) + 1;
      if (f.countBuilding(p, b) >= counts[b]!) continue;
      const def = FL_BUILDINGS[b];
      if (def.requires && !f.completed(p, def.requires)) continue;
      if (!this.freePlot()) break;
      if (gold() >= def.cost) { this.build(b); return; }
      reserve = def.cost * (this.threatened() ? 0 : 0.6);
      break;
    }
    if (f.completed(p, 'forge')) for (const k of ['weapons', 'armor'] as const) {
      const lvl = p.research[k];
      if (lvl < 3 && gold() >= FL_RESEARCH[k].costs[lvl] + 500) { this.cmd({ c: 'research', kind: k }); return; }
    }
    // army: pick the most under-represented unit (by plan weight) we can train now
    const have: Partial<Record<FlUnitId, number>> = {};
    for (const u of [...f.owned(p), ...p.garrison]) have[u.fl!.type] = (have[u.fl!.type] ?? 0) + 1;
    let best: FlUnitId | null = null, bs = Infinity;
    for (const [id, w] of Object.entries(this.plan.army) as [FlUnitId, number][]) {
      const def = FL_UNITS[id];
      if (!f.trainerReady(p, def.trainer) || p.queues[def.trainer].length >= 2 || def.pop > room) continue;
      const score = (have[id] ?? 0) / w;
      if (score < bs) { bs = score; best = id; }
    }
    if (best && gold() >= FL_UNITS[best].cost + reserve) this.cmd({ c: 'train', unit: best });
  }

  private freePlot() {
    const f = this.g.front!, p = this.p!;
    return FL_PLOTS.find((s) => s.team === p.team && s.slot === p.slot && !f.plots[s.index].building);
  }
  private build(b: FlBuildingId) {
    const plot = this.freePlot();
    if (plot) this.cmd({ c: 'buildAt', plot: plot.index, building: b });
  }

  private threatened() {
    const team = this.p!.team;
    return this.armyValue((1 - team) as Team, (u) => Math.abs(u.x - defendX(team)) < 24) > 0;
  }

  // ---------------------------------------------------------------- stance
  private armyValue(team: number, filter: (u: Unit) => boolean = () => true) {
    let v = 0;
    for (const u of this.g.units.values()) if (!u.dead && u.team === team && u.fl && u.fl.type !== 'miner' && filter(u)) v += FL_UNITS[u.fl.type].cost * (u.hp / u.stats.maxHp);
    for (const pl of this.g.front!.players) if (pl.team === team) for (const u of pl.garrison) if (u.fl!.type !== 'miner') v += FL_UNITS[u.fl!.type].cost;
    return v;
  }

  private stance() {
    const p = this.p!, team = p.team, enemy = (1 - team) as Team;
    const mine = this.armyValue(team), theirs = this.armyValue(enemy);
    const raid = this.armyValue(enemy, (u) => Math.abs(u.x - defendX(team)) < 22);
    const castle = this.g.units.get(this.g.front!.castles[team]);
    const f = this.g.front!;
    const maxed = f.pop(p) >= f.popCap(p) - 1 && f.popCap(p) >= 30;
    let want: Stance = p.stance;
    if (castle && castle.hp < castle.stats.maxHp * 0.35 && raid > mine * 1.5) want = 'garrison';
    else if (raid > 0 && raid >= mine * 0.6) want = 'defend';
    else if (mine > Math.max(2400, theirs * 1.4) || (maxed && mine >= theirs * 0.8)) want = 'attack';
    else if (p.stance === 'attack' && (mine < theirs * 0.7 || mine < 900)) want = 'defend';
    else if (p.stance !== 'attack' && mine > 600) want = 'hold';
    // the hold line is the Heart Banner: fights happen in the middle of the map
    if (want !== p.stance || (want === 'hold' && Math.abs(p.rallyX) > 4)) this.cmd({ c: 'stance', stance: want, ...(want === 'hold' ? { x: team === 0 ? -2 : 2 } : {}) });
  }

  // ---------------------------------------------------------------- hero
  private go(x: number, z: number) {
    if (Math.hypot(this.lastMove.x - x, this.lastMove.z - z) < 1.5 && this.u.order.type === 'move') return;
    this.lastMove = { x, z };
    this.cmd({ c: 'move', x, z });
  }

  private hero() {
    const g = this.g, u = this.u, h = u.hero!, p = this.p!;
    if (u.dead || h.recallUntil || u.cast || u.dash) return;
    const home = dropPos(p.team);
    const hpFrac = u.hp / u.stats.maxHp;
    if (hpFrac < 0.3) this.retreating = true;
    if (this.retreating) {
      if (Math.abs(u.x - home.x) < 6) { if (hpFrac > 0.85) this.retreating = false; return; }
      const threat = g.nearestEnemy(u, 9);
      if (!threat && g.time - u.lastDamagedAt > 3) { this.cmd({ c: 'recall' }); return; }
      this.go(home.x, home.z);
      return;
    }
    const foe = g.nearestEnemy(u, 11, (o) => !g.isStructure(o)) ?? g.nearestEnemy(u, 9);
    if (foe) {
      this.castAt(foe);
      this.cmd({ c: 'attack', id: foe.id });
      return;
    }
    // stay just behind our front line (or lead the charge when attacking)
    const dir = p.team === 0 ? 1 : -1;
    let front = p.stance === 'attack' ? fortressPos((1 - p.team) as Team).x : defendX(p.team) + dir * 2;
    if (p.stance !== 'attack') {
      for (const o of g.front!.owned(p, (o) => o.fl!.type !== 'miner')) front = dir > 0 ? Math.max(front, o.x) : Math.min(front, o.x);
    }
    this.go(front - dir * 2, p.slot === 0 ? -3 : 3);
  }

  private castAt(t: Unit) {
    const g = this.g, u = this.u, h = u.hero!;
    const d = Math.hypot(t.x - u.x, t.z - u.z);
    for (let slot = 3; slot >= 0; slot--) {
      const def = h.def.abilities[slot];
      const rank = g.rank(u, slot);
      if (rank <= 0 || h.cd[slot] > 0 || u.mana < (def.manaCost[rank - 1] ?? 0)) continue;
      const intent = abilityIntent(def);
      if (intent === 'help') {
        if (u.hp < u.stats.maxHp * 0.6) g.command(h.pid, { c: 'cast', slot: 'QWER'[slot] as 'Q', x: u.x, z: u.z, id: u.id });
        continue;
      }
      if (def.targeting === 'self') { if (d < (def.radius ?? 5)) { g.command(h.pid, { c: 'cast', slot: 'QWER'[slot] as 'Q', x: u.x, z: u.z }); return; } continue; }
      if (d > def.range + t.radius + 0.5) continue;
      g.command(h.pid, { c: 'cast', slot: 'QWER'[slot] as 'Q', x: t.x, z: t.z, id: t.id });
      if (u.cast || h.cd[slot] > 0) return;
    }
  }
}
