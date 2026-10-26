import type { AbilityDef, Effect, Role, Team } from '../types';
import type { Command } from '../protocol';
import { FOUNTAIN, lanepath, type LaneId } from '../map';
import { UPGRADES } from '../upgrades';
import { BUILD_TOWER_KINDS, TOWERS } from '../units';
import { ITEM_BY_ID } from '../data/items';
import type { Game } from './game';
import type { Unit } from './world';

const BUILDS: Record<Role, string[]> = {
  Marksman: ['stormstride_greaves', 'stormwake_recurve', 'tempest_quiver', 'bloodmoon_cleaver', 'siegebreaker_hammer', 'glasswoven_aegis'],
  Mage: ['hasteward_greaves', 'arcane_pyre_staff', 'tidecaller_lattice', 'frostbind_lance', 'glasswoven_aegis', 'shieldbearers_banner'],
  Tank: ['ironstep_greaves', 'stonebinder_bulwark', 'glasswoven_aegis', 'dawnforged_greatsword', 'siegebreaker_hammer', 'shieldbearers_banner'],
  Fighter: ['ironstep_greaves', 'dawnforged_greatsword', 'bloodmoon_cleaver', 'stonebinder_bulwark', 'siegebreaker_hammer', 'glasswoven_aegis'],
  Assassin: ['stormstride_greaves', 'veilcutter', 'bloodmoon_cleaver', 'dawnforged_greatsword', 'stormwake_recurve', 'glasswoven_aegis'],
  Support: ['hasteward_greaves', 'shieldbearers_banner', 'tidecaller_lattice', 'glasswoven_aegis', 'stonebinder_bulwark', 'arcane_pyre_staff'],
};

type Intent = 'harm' | 'help' | 'self' | 'summon';

function walk(effects: Effect[] | undefined, f: (e: Effect) => void) {
  for (const e of effects ?? []) {
    f(e);
    const n = e as unknown as Record<string, unknown>;
    for (const k of ['effects', 'onEnd', 'onArrive', 'onDepart']) if (Array.isArray(n[k])) walk(n[k] as Effect[], f);
  }
}

export function abilityIntent(def: AbilityDef): Intent {
  let harm = 0, help = 0, summon = 0;
  walk(def.effects, (e) => {
    if (e.type === 'damage' || e.type === 'displace' || (e.type === 'status' && ['stun', 'root', 'slow', 'silence', 'knockup', 'taunt'].includes(e.status))) harm++;
    if (e.type === 'heal' || e.type === 'shield' || e.type === 'cleanse') help++;
    if (e.type === 'summon') summon++;
  });
  if (def.targeting === 'ally') return 'help';
  if (summon) return 'summon';
  if (harm) return 'harm';
  if (help && def.targeting !== 'self') return 'help';
  return 'self';
}

const move = (x: number, z: number): Command => ({ c: 'move', x, z });

export class BotBrain {
  private next = 0;
  private lane: LaneId;
  private lastMove = { x: 1e9, z: 1e9 };
  private retreating = false;
  private intents: Intent[];
  private build: string[];

  constructor(private game: Game, private unitId: number) {
    const u = game.units.get(unitId)!;
    const mates = [...game.units.values()].filter((o) => o.hero && o.team === u.team && o.id !== u.id).length;
    this.lane = (mates % 2) as LaneId;
    this.intents = u.hero!.def.abilities.map(abilityIntent);
    this.build = BUILDS[u.hero!.def.role] ?? BUILDS.Fighter;
  }

  private get u(): Unit { return this.game.units.get(this.unitId)!; }
  private cmd(c: Command) { this.game.command(this.u.hero!.pid, c); }
  private go(x: number, z: number) {
    if (Math.hypot(this.lastMove.x - x, this.lastMove.z - z) < 1.5 && this.u.order.type === 'move') return;
    this.lastMove = { x, z };
    this.cmd(move(x, z));
  }

  update(_dt: number) {
    const g = this.game;
    if (g.time < this.next) return;
    this.next = g.time + 0.25 + g.random() * 0.1;
    const u = this.u;
    if (!u || !u.hero) return;
    const h = u.hero;
    if (g.canShop(u)) this.shop();
    if (u.dead) return;
    if (h.recallUntil) return;
    if (u.cast || u.dash) return;

    const hpFrac = u.hp / u.stats.maxHp;
    const fountain = FOUNTAIN[u.team as Team];
    const atFountain = Math.hypot(u.x - fountain.x, u.z - fountain.z) < 10;

    if (atFountain && (hpFrac < 0.9 || u.mana < u.stats.maxMana * 0.5)) { this.retreating = false; return; }
    if (hpFrac < 0.28) this.retreating = true;
    if (this.retreating) {
      const threat = g.nearestEnemy(u, 9, (o) => o.kind === 'hero' || o.kind === 'tower');
      this.useDefensive(threat);
      if (!threat && g.time - u.lastDamagedAt > 3) { this.cmd({ c: 'recall' }); return; }
      this.go(fountain.x, fountain.z);
      if (atFountain) this.retreating = false;
      return;
    }

    // fight heroes
    const foe = g.nearestEnemy(u, 11, (o) => o.kind === 'hero');
    if (foe) {
      const foeFrac = foe.hp / foe.stats.maxHp;
      const underTower = this.enemyTowerNear(foe, 2);
      const allies = g.unitsNear(u, 12, (o) => o.kind === 'hero' && o.team === u.team).length;
      const enemies = g.unitsNear(u, 12, (o) => o.kind === 'hero' && o.team !== u.team && g.visibleTo(u.team, o)).length;
      const brave = hpFrac > 0.45 && (hpFrac >= foeFrac - 0.15 || allies >= enemies) && (!underTower || foeFrac < 0.25);
      if (brave) {
        this.castAt(foe);
        this.cmd({ c: 'attack', id: foe.id });
        return;
      }
      if (hpFrac < 0.5) { this.useDefensive(foe); this.go(fountain.x, fountain.z); return; }
    }
    this.helpAllies();

    // banners: defend own, capture enemy
    for (const b of g.banners) {
      const d = Math.hypot(b.x - u.x, b.z - u.z);
      if (b.owner === u.team && b.capTeam >= 0 && b.capTeam !== u.team && d < 45) { this.go(b.x, b.z); return; }
    }
    for (const b of g.banners) {
      const d = Math.hypot(b.x - u.x, b.z - u.z);
      if (b.owner !== u.team && !g.bannerLocked(b) && d < 30 && !this.enemyTowerNear(b, 1)) { this.go(b.x + (g.random() - 0.5), b.z + (g.random() - 0.5)); return; }
    }

    this.teamSpending();

    // laning
    const minion = g.nearestEnemy(u, 10, (o) => o.kind === 'minion' || o.kind === 'summon');
    if (minion && !this.enemyTowerNear(minion, 0.5)) {
      const weak = g.unitsNear(u, 10, (o) => (o.kind === 'minion') && o.team !== u.team && g.visibleTo(u.team, o)).sort((a, b) => a.hp - b.hp)[0] ?? minion;
      if (u.mana > u.stats.maxMana * 0.6 && g.unitsNear(weak, 4, (o) => o.kind === 'minion' && o.team !== u.team).length >= 3) this.castAt(weak, true);
      this.cmd({ c: 'attack', id: weak.id });
      return;
    }
    const struct = g.nearestEnemy(u, 12, (o) => o.kind === 'tower' || o.kind === 'fortress');
    if (struct) {
      const tanks = g.unitsNear(struct, struct.stats.attackRange, (o) => o.team === u.team && (o.kind === 'minion' || o.kind === 'summon')).length;
      if (tanks >= 2 || struct.hp / struct.stats.maxHp < 0.15) { this.cmd({ c: 'attack', id: struct.id }); return; }
      const away = { x: u.x - struct.x, z: u.z - struct.z };
      const l = Math.hypot(away.x, away.z) || 1;
      if (l < struct.stats.attackRange + 3) { this.go(u.x + (away.x / l) * 4, u.z + (away.z / l) * 4); return; }
    }
    // jungle when healthy and the lane is quiet
    if (hpFrac > 0.7 && h.level < 12 && (this.unitId + Math.floor(g.time / 40)) % 4 === 0) {
      const camp = g.nearestEnemy(u, 26, (o) => o.kind === 'monster' && !o.vis.startsWith('c:colossus'));
      if (camp) { this.cmd({ c: 'attack', id: camp.id }); return; }
    }
    const boss = h.level >= 9 ? g.nearestEnemy(u, 30, (o) => o.vis.startsWith('c:colossus')) : null;
    if (boss && g.unitsNear(boss, 14, (o) => o.kind === 'hero' && o.team === u.team).length >= 3) { this.castAt(boss); this.cmd({ c: 'attack', id: boss.id }); return; }

    // move to the front of our wave in this lane
    const path = lanepath(this.lane, u.team as Team);
    let front = path[1];
    let bestProgress = -1;
    for (const m of g.units.values()) {
      if (m.kind !== 'minion' || m.team !== u.team || m.dead || m.minion?.lane !== this.lane) continue;
      if (m.minion.wp > bestProgress) { bestProgress = m.minion.wp; front = { x: m.x, z: m.z }; }
    }
    if (bestProgress < 0) {
      // no wave: hold at our outer tower
      const tower = [...g.units.values()].find((t) => t.tower?.key === (this.lane === 0 ? 'outer-n' : 'outer-s') && t.team === u.team && !t.dead);
      front = tower ? { x: tower.x + (u.team === 0 ? -3 : 3), z: tower.z } : path[2];
    }
    const back = u.team === 0 ? -2 : 2;
    this.go(front.x + back + (g.random() - 0.5) * 2, front.z + (g.random() - 0.5) * 2);
  }

  private enemyTowerNear(p: { x: number; z: number }, extra: number) {
    const u = this.u;
    for (const t of this.game.units.values()) {
      if ((t.kind === 'tower' || t.kind === 'fortress') && !t.dead && t.team !== u.team && Math.hypot(t.x - p.x, t.z - p.z) <= t.stats.attackRange + extra) return t;
    }
    return null;
  }

  private ready(slot: number) {
    const u = this.u, h = u.hero!;
    const def = h.def.abilities[slot];
    const rank = this.game.rank(u, slot);
    if (rank <= 0 || h.cd[slot] > 0) return false;
    return u.mana >= (def.manaCost[rank - 1] ?? 0);
  }

  private castAt(t: Unit, wave = false) {
    const u = this.u, h = u.hero!, g = this.game;
    const d = Math.hypot(t.x - u.x, t.z - u.z);
    for (let slot = 3; slot >= 0; slot--) {
      if (wave && slot === 3) continue;
      if (!this.ready(slot)) continue;
      const def = h.def.abilities[slot];
      const intent = this.intents[slot];
      if (intent === 'help') continue;
      if (intent === 'self' || intent === 'summon') {
        if (d < 7 && def.targeting === 'self') { g.command(h.pid, { c: 'cast', slot: 'QWER'[slot] as 'Q', x: u.x, z: u.z }); return; }
        if (def.targeting !== 'self' && d < def.range + 1) { g.command(h.pid, { c: 'cast', slot: 'QWER'[slot] as 'Q', x: t.x, z: t.z, id: t.id }); return; }
        continue;
      }
      const reach = def.targeting === 'self' ? (def.radius ?? 4) : def.range + 0.5;
      if (d > reach + t.radius) continue;
      // lead moving targets a little
      const lead = t.moving ? 0.25 * t.stats.moveSpeed : 0;
      const x = t.x + Math.sin(t.facing) * lead, z = t.z + Math.cos(t.facing) * lead;
      g.command(h.pid, { c: 'cast', slot: 'QWER'[slot] as 'Q', x, z, id: t.id });
      if (u.cast || h.cd[slot] > 0) return;
    }
  }

  private useDefensive(threat: Unit | null) {
    const u = this.u, h = u.hero!;
    for (let slot = 0; slot < 4; slot++) {
      if (!this.ready(slot)) continue;
      const def = h.def.abilities[slot];
      const intent = this.intents[slot];
      if (intent === 'help' || (intent === 'self' && def.targeting === 'self')) { this.game.command(h.pid, { c: 'cast', slot: 'QWER'[slot] as 'Q', x: u.x, z: u.z, id: u.id }); return; }
      if (threat && intent === 'harm' && def.effects.some((e) => e.type === 'dash' || e.type === 'blink')) {
        const f = FOUNTAIN[u.team as Team];
        this.game.command(h.pid, { c: 'cast', slot: 'QWER'[slot] as 'Q', x: f.x, z: f.z });
        return;
      }
    }
    // potions
    h.items.forEach((id, i) => { if (id && ITEM_BY_ID[id]?.consumable && u.hp < u.stats.maxHp * 0.5) this.game.command(h.pid, { c: 'item', slot: i, x: u.x, z: u.z }); });
  }

  private helpAllies() {
    const u = this.u, h = u.hero!, g = this.game;
    for (let slot = 0; slot < 4; slot++) {
      if (this.intents[slot] !== 'help' || !this.ready(slot)) continue;
      const def = h.def.abilities[slot];
      const hurt = g.unitsNear(u, Math.max(def.range, 6), (o) => o.kind === 'hero' && o.team === u.team && o.hp < o.stats.maxHp * 0.6)[0];
      if (hurt) { g.command(h.pid, { c: 'cast', slot: 'QWER'[slot] as 'Q', x: hurt.x, z: hurt.z, id: hurt.id }); return; }
    }
  }

  private shop() {
    const u = this.u, h = u.hero!, g = this.game;
    for (let guard = 0; guard < 6; guard++) {
      const target = this.build.find((id) => ITEM_BY_ID[id] && !h.items.includes(id));
      if (!target) return;
      // try the full item, then its most expensive affordable missing part
      const parts: string[] = [];
      const collect = (id: string) => { parts.push(id); for (const c of ITEM_BY_ID[id]?.components ?? []) collect(c); };
      collect(target);
      const free = h.items.filter((x) => !x).length;
      const options = parts.filter((id) => !h.items.includes(id) || id === target)
        .map((id) => ({ id, ...g.priceFor(u, id) }))
        .filter((o) => o.price <= h.gold && (o.consume.length > 0 || free > 0))
        .sort((a, b) => ITEM_BY_ID[b.id].cost - ITEM_BY_ID[a.id].cost);
      if (!options.length || !g.buy(u, options[0].id)) return;
    }
  }

  private teamSpending() {
    const u = this.u, h = u.hero!, g = this.game;
    if (h.gold < 1400 || g.random() > 0.08) return;
    const team = g.teams[u.team as Team];
    const pads = g.pads.filter((p) => p.team === u.team && !p.unitId);
    if (pads.length && g.random() < 0.5) {
      const kind = BUILD_TOWER_KINDS[Math.floor(g.random() * BUILD_TOWER_KINDS.length)];
      if (h.gold >= TOWERS[kind].cost + 800) { this.cmd({ c: 'build', pad: pads[0].index, kind }); return; }
    }
    const opts = UPGRADES.filter((x) => team.upgrades[x.id] < x.costs.length).sort((a, b) => a.costs[team.upgrades[a.id]] - b.costs[team.upgrades[b.id]]);
    if (opts[0] && h.gold >= opts[0].costs[team.upgrades[opts[0].id]] + 900) this.cmd({ c: 'upgrade', id: opts[0].id });
  }
}
