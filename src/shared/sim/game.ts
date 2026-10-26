import type { AbilityDef, AbilitySlot, Affects, DamageType, Effect, HeroDef, ItemDef, Num, Stats, StatKey, StatusKind, Team } from '../types';
import type { Command, GameEvent, GameInit, PlayerInfo, Snapshot, UnitSnap, VisualInfo, HeroBoard, MeSnap } from '../protocol';
import { F } from '../protocol';
import { COMBAT, DT, ECON, MAX_LEVEL, SIGHT, TIMING, XP, XP_TABLE } from '../constants';
import { BANNER_RADIUS, CAMPS, FORTRESS, FOUNTAIN, MAP, OBSTACLES, bannerSpots, buildPads, lanepath, towerSpots, type LaneId } from '../map';
import { CAMP_BUFFS, CAMP_TEMPLATES, MINIONS, SUMMONS, TOWERS, TOWER_LEVEL_MULT, TOWER_UPGRADE_COST, ZERO_STATS, type MinionKind, type TowerKind, type UnitTemplate } from '../units';
import { UPGRADE_BY_ID, MERCENARY, type UpgradeId } from '../upgrades';
import { HERO_BY_ID } from '../data/heroes';
import { ITEM_BY_ID } from '../data/items';
import { angleOf, clamp, dist, distToSegment, norm, rng, type Vec2 } from '../math';
import { NavGrid } from './nav';
import { priceFor } from '../shop';
import { runEffects } from './effects';
import { BotBrain } from './bots';
import { NEUTRAL, type Banner, type Ctx, type Pad, type Projectile, type Scheduled, type Unit, type UnitKind, type Zone } from './world';

const SLOTS: AbilitySlot[] = ['Q', 'W', 'E', 'R'];
const CC: StatusKind[] = ['stun', 'root', 'slow', 'silence', 'knockup', 'taunt'];
const STAT_KEYS = Object.keys(ZERO_STATS) as StatKey[];

export interface PlayerSetup { pid: string; name: string; team: Team; heroId: string; bot: boolean }

interface TeamState { kills: number; upgrades: Record<UpgradeId, number>; mercs: [number, number] }
interface CampState { id: string; aliveIds: number[]; respawnAt: number }
type Tagged = GameEvent & { _team?: number; _pid?: string; _x?: number; _z?: number };

export class Game {
  time = 0;
  tick = 0;
  winner: Team | null = null;
  readonly units = new Map<number, Unit>();
  readonly projectiles: Projectile[] = [];
  readonly zones: Zone[] = [];
  readonly banners: Banner[] = [];
  readonly pads: Pad[] = [];
  readonly nav = new NavGrid();
  readonly teams: [TeamState, TeamState];
  readonly players: PlayerInfo[] = [];
  readonly visuals: Record<string, VisualInfo> = {};
  readonly random: () => number;
  private scheduled: Scheduled[] = [];
  private events: Tagged[] = [];
  private nextId = 1;
  private nextWaveAt = TIMING.firstWave;
  private waveCount = 0;
  private camps: CampState[] = [];
  private bots = new Map<number, BotBrain>();
  private lastGoldTick = 0;
  night = false;
  private phaseEndsAt = TIMING.dayLength;
  private fortressIds: [number, number] = [0, 0];

  constructor(setups: PlayerSetup[], readonly seed = 1) {
    this.random = rng(seed);
    const up = (): Record<UpgradeId, number> => ({ forge: 0, armory: 0, bulwark: 0, treasury: 0, horn: 0, watch: 0 });
    this.teams = [{ kills: 0, upgrades: up(), mercs: [0, 0] }, { kills: 0, upgrades: up(), mercs: [0, 0] }];
    for (const o of OBSTACLES) this.nav.setCircle(o.pos, o.r, 1);
    this.buildStructures();
    for (const c of CAMPS) this.camps.push({ id: c.id, aliveIds: [], respawnAt: c.kind === 'colossus' ? TIMING.bossFirstSpawn : 20 });
    for (const s of setups) this.addHero(s);
  }

  // ------------------------------------------------------------------ setup
  private register(key: string, v: VisualInfo) { if (!this.visuals[key]) this.visuals[key] = v; }

  private buildStructures() {
    for (const team of [0, 1] as Team[]) {
      const f = this.spawnStructure('fortress', team, FORTRESS[team], 'fortress');
      this.fortressIds[team] = f.id;
      for (const t of towerSpots(team)) {
        const u = this.spawnStructure('lane', team, t.pos, t.key);
        u.name = `${t.tier === 'outer' ? 'Outer' : 'Inner'} ${t.lane === 0 ? 'North' : 'South'} Tower`;
      }
      for (const b of bannerSpots(team)) this.banners.push({ homeTeam: team, key: b.key, name: b.name, x: b.pos.x, z: b.pos.z, lane: b.lane, owner: team, progress: 0, capTeam: -1 });
      buildPads(team).forEach((p, i) => this.pads.push({ index: this.pads.length, team, x: p.x, z: p.z, unitId: 0, kind: '', level: 0 }));
      void 0;
    }
  }

  private spawnStructure(kind: TowerKind, team: Team, pos: Vec2, key: string, level = 1, pad = -1): Unit {
    const t = TOWERS[kind];
    const visKey = `tw:${kind}`;
    this.register(visKey, { model: kind === 'fortress' ? 'fortress' : 'tower', scale: 1, weapons: [], name: t.name, kind: 'tower', towerKind: kind });
    const stats = { ...t.stats };
    const mult = TOWER_LEVEL_MULT[level - 1] ?? 1;
    stats.maxHp *= mult; stats.attackDamage *= mult;
    const u = this.makeUnit(kind === 'fortress' ? 'fortress' : 'tower', team, visKey, t.name, pos, t.radius, stats);
    u.ranged = t.projectile;
    u.tower = { kind, level, pad, key, lastTarget: 0, ramp: 0 };
    u.attackDtype = t.magic ? 'magic' : 'physical';
    this.nav.setCircle(pos, t.radius, 1);
    this.applyArmory(u);
    u.hp = u.stats.maxHp;
    return u;
  }

  private makeUnit(kind: UnitKind, team: number, vis: string, name: string, pos: Vec2, radius: number, stats: Stats): Unit {
    const u: Unit = {
      id: this.nextId++, kind, team, vis, name, x: pos.x, z: pos.z, facing: team === 0 ? Math.PI / 2 : -Math.PI / 2, radius,
      baseStats: { ...stats }, stats: { ...stats }, hp: stats.maxHp, mana: stats.maxMana, shields: [], statuses: [], buffs: [],
      dead: false, removeAt: 0, order: { type: 'idle' }, path: [], pathGoal: null, repathAt: 0, attackCd: 0, windup: null, cast: null,
      dash: null, displaced: null, damagedBy: new Map(), lastHeroAttackOnHeroAt: -99, lastDamagedAt: -99, moving: false, ranged: null,
      attackAnims: ['1H_Melee_Attack_Chop'], attackIdx: 0, attackDtype: 'physical', gold: 0, xp: 0, empowered: null, aiAt: 0, scaleMul: 1,
    };
    this.units.set(u.id, u);
    return u;
  }

  private spawnFromTemplate(kind: UnitKind, team: number, t: UnitTemplate, visKey: string, pos: Vec2, statMult = 1): Unit {
    this.register(visKey, { model: t.model as VisualInfo['model'], tint: t.tint, scale: t.scale, weapons: t.weapons ?? [], name: t.name, kind });
    const s = { ...t.stats, maxHp: t.stats.maxHp * statMult, attackDamage: t.stats.attackDamage * statMult };
    const u = this.makeUnit(kind, team, visKey, t.name, this.nav.nearestOpen(pos), t.radius, s);
    u.ranged = t.ranged ?? null;
    u.attackAnims = t.attackAnims ?? ['1H_Melee_Attack_Chop'];
    u.gold = t.gold;
    u.xp = t.xp;
    return u;
  }

  addHero(s: PlayerSetup): Unit {
    const def = HERO_BY_ID[s.heroId];
    if (!def) throw new Error(`unknown hero ${s.heroId}`);
    const visKey = `h:${def.id}`;
    this.register(visKey, { model: def.visual.model, tint: def.visual.tint, scale: def.visual.scale, weapons: def.visual.weapons, name: def.name, kind: 'hero' });
    const pos = this.spawnPoint(s.team);
    const u = this.makeUnit('hero', s.team, visKey, def.name, pos, 0.8, this.heroBase(def, 1));
    u.ranged = def.attack.kind === 'ranged' ? def.attack.projectile ?? { style: 'arrow', color: '#ffffff' } : null;
    u.attackAnims = def.attack.anims.length ? def.attack.anims : ['1H_Melee_Attack_Chop'];
    u.attackDtype = def.attack.dtype ?? 'physical';
    u.hero = {
      def, pid: s.pid, pname: s.name, bot: s.bot, level: 1, xp: 0, gold: ECON.startGold, items: [null, null, null, null, null, null],
      itemCd: [0, 0, 0, 0, 0, 0], cd: [0, 0, 0, 0], cdMax: [1, 1, 1, 1], kills: 0, deaths: 0, assists: 0, cs: 0, streak: 0, respawnAt: 0,
      nthCounter: 0, lowHpReadyAt: 0, itemLowHpReadyAt: {}, itemNth: {}, recallUntil: 0, steer: null,
    };
    this.recompute(u);
    u.hp = u.stats.maxHp;
    u.mana = u.stats.maxMana;
    this.players.push({ playerId: s.pid, name: s.name, team: s.team, heroId: def.id, bot: s.bot, unitId: u.id });
    if (s.bot) this.bots.set(u.id, new BotBrain(this, u.id));
    return u;
  }

  setBot(pid: string, bot: boolean) {
    const p = this.players.find((x) => x.playerId === pid);
    if (!p) return;
    const u = this.units.get(p.unitId);
    if (!u?.hero) return;
    u.hero.bot = bot;
    p.bot = bot;
    if (bot && !this.bots.has(u.id)) this.bots.set(u.id, new BotBrain(this, u.id));
    if (!bot) this.bots.delete(u.id);
  }

  private spawnPoint(team: number): Vec2 {
    const f = FOUNTAIN[team as Team];
    const a = this.random() * Math.PI * 2;
    return this.nav.nearestOpen({ x: f.x + Math.cos(a) * 2.5, z: f.z + Math.sin(a) * 2.5 });
  }

  heroBase(def: HeroDef, level: number): Stats {
    const s = { ...ZERO_STATS, ...def.base };
    for (const k of STAT_KEYS) s[k] += (def.growth[k] ?? 0) * (level - 1);
    return s;
  }

  init(you: string): GameInit {
    return { you, players: this.players.map((p) => ({ ...p })), visuals: this.visuals, seed: this.seed };
  }

  heroOf(pid: string): Unit | undefined {
    const p = this.players.find((x) => x.playerId === pid);
    return p ? this.units.get(p.unitId) : undefined;
  }

  // ------------------------------------------------------------------ helpers
  emit(e: GameEvent, opts: { team?: number; pid?: string; x?: number; z?: number } = {}) {
    const t = e as Tagged;
    if (opts.team !== undefined) t._team = opts.team;
    if (opts.pid !== undefined) t._pid = opts.pid;
    if (opts.x !== undefined) { t._x = opts.x; t._z = opts.z; }
    this.events.push(t);
  }
  schedule(delay: number, run: () => void) { this.scheduled.push({ at: this.time + delay, run }); }

  has(u: Unit, k: StatusKind) { return u.statuses.some((s) => s.kind === k && s.until > this.time); }
  statusPower(u: Unit, k: StatusKind) {
    let p = 0;
    for (const s of u.statuses) if (s.kind === k && s.until > this.time) p = Math.max(p, s.power);
    return p;
  }
  isStructure(u: Unit) { return u.kind === 'tower' || u.kind === 'fortress'; }
  disabled(u: Unit) { return this.has(u, 'stun') || this.has(u, 'knockup') || !!u.displaced; }
  canAct(u: Unit) { return !u.dead && !this.disabled(u) && !u.dash; }
  rank(u: Unit, slot: number): number {
    const lvl = u.hero?.level ?? 1;
    if (slot < 3) return Math.min(5, 1 + Math.floor((lvl - 1) / 3));
    return lvl < 4 ? 0 : Math.min(3, 1 + Math.floor((lvl - 4) / 5));
  }

  evalNum(n: Num | undefined, ctx: { caster: Unit; target: Unit | null; rank: number }): number {
    if (n === undefined) return 0;
    if (typeof n === 'number') return n;
    const c = ctx.caster, t = ctx.target;
    let v = 0;
    if (n.base !== undefined) v += Array.isArray(n.base) ? n.base[clamp(ctx.rank - 1, 0, n.base.length - 1)] ?? 0 : n.base;
    if (n.ad) v += n.ad * c.stats.attackDamage;
    if (n.bonusAd) v += n.bonusAd * Math.max(0, c.stats.attackDamage - c.baseStats.attackDamage);
    if (n.ap) v += n.ap * c.stats.abilityPower;
    if (n.maxHp) v += n.maxHp * c.stats.maxHp;
    if (n.bonusHp) v += n.bonusHp * Math.max(0, c.stats.maxHp - c.baseStats.maxHp);
    if (n.armor) v += n.armor * c.stats.armor;
    if (n.level) v += n.level * (c.hero?.level ?? 1);
    if (t && !this.isStructure(t)) {
      if (n.targetMaxHp) v += n.targetMaxHp * t.stats.maxHp;
      if (n.targetMissingHp) v += n.targetMissingHp * (t.stats.maxHp - t.hp);
    }
    return v;
  }

  /** Is `u` a valid target for an effect from `caster` with `affects`? */
  matches(caster: Unit, u: Unit, affects: Affects): boolean {
    if (u.dead) return false;
    switch (affects) {
      case 'enemies': return u.team !== caster.team;
      case 'allies': return u.team === caster.team && u.id !== caster.id;
      case 'alliesAndSelf': return u.team === caster.team;
      case 'all': return true;
    }
  }

  unitsNear(p: Vec2, r: number, filter?: (u: Unit) => boolean): Unit[] {
    const out: Unit[] = [];
    for (const u of this.units.values()) {
      if (u.dead) continue;
      if (Math.hypot(u.x - p.x, u.z - p.z) <= r + u.radius && (!filter || filter(u))) out.push(u);
    }
    return out;
  }

  /** Can `team` currently see unit `u`? */
  visibleTo(team: number, u: Unit): boolean {
    if (u.team === team) return true;
    if (this.isStructure(u)) return true;
    const stealth = this.has(u, 'stealth');
    for (const s of this.sightSources(team)) {
      const d = Math.hypot(s[0] - u.x, s[1] - u.z);
      if (stealth ? d <= SIGHT.stealthReveal + u.radius : d <= s[2] + u.radius) return true;
    }
    return false;
  }
  private sightCache: { tick: number; src: [number[][], number[][]] } = { tick: -1, src: [[], []] };
  sightSources(team: number): number[][] {
    if (team !== 0 && team !== 1) return [];
    if (this.sightCache.tick !== this.tick) {
      const src: [number[][], number[][]] = [[], []];
      for (const t of [0, 1] as Team[]) {
        const watch = this.teams[t].upgrades.watch;
        for (const u of this.units.values()) {
          if (u.dead || u.team !== t) continue;
          let r = SIGHT.minion;
          if (u.kind === 'hero') r = this.night ? SIGHT.heroNight + watch * 2 : SIGHT.hero;
          else if (u.kind === 'tower') r = SIGHT.tower + watch * 4;
          else if (u.kind === 'fortress') r = SIGHT.fortress + watch * 4;
          else if (u.kind === 'summon') r = SIGHT.summon;
          src[t].push([u.x, u.z, r]);
        }
        for (const b of this.banners) if (b.owner === t) src[t].push([b.x, b.z, SIGHT.banner + watch * 4]);
      }
      this.sightCache = { tick: this.tick, src };
    }
    return this.sightCache.src[team as 0 | 1];
  }
  pointVisible(team: number, x: number, z: number) {
    return this.sightSources(team).some((s) => Math.hypot(s[0] - x, s[1] - z) <= s[2]);
  }

  // ------------------------------------------------------------------ stats
  recompute(u: Unit) {
    if (u.hero) u.baseStats = this.heroBase(u.hero.def, u.hero.level);
    const flat: Partial<Record<StatKey, number>> = {};
    const pct: Partial<Record<StatKey, number>> = {};
    const addFlat = (k: StatKey, v: number) => { flat[k] = (flat[k] ?? 0) + v; };
    if (u.hero) {
      for (const id of u.hero.items) {
        const it = id ? ITEM_BY_ID[id] : null;
        if (!it) continue;
        for (const [k, v] of Object.entries(it.stats)) addFlat(k as StatKey, v as number);
        if (it.passive?.stats) for (const [k, v] of Object.entries(it.passive.stats)) addFlat(k as StatKey, this.evalNum(v, { caster: u, target: null, rank: 1 }));
      }
      const ps = u.hero.def.passive.stats;
      if (ps) for (const [k, v] of Object.entries(ps)) addFlat(k as StatKey, this.evalNum(v, { caster: u, target: null, rank: 1 }));
    }
    for (const b of u.buffs) {
      if (b.stats) for (const [k, v] of Object.entries(b.stats)) addFlat(k as StatKey, v as number);
      if (b.pct) for (const [k, v] of Object.entries(b.pct)) pct[k as StatKey] = (pct[k as StatKey] ?? 0) + (v as number);
    }
    const s = { ...u.baseStats };
    for (const k of STAT_KEYS) s[k] = (s[k] + (flat[k] ?? 0)) * (1 + (pct[k] ?? 0));
    const slow = this.statusPower(u, 'slow');
    s.moveSpeed = Math.max(1.5, s.moveSpeed * (1 - clamp(slow, 0, 0.9)));
    s.attackSpeed = clamp(s.attackSpeed, 0.2, 2.5);
    s.critChance = clamp(s.critChance, 0, 1);
    s.armorPen = clamp(s.armorPen, 0, 0.8);
    s.magicPen = clamp(s.magicPen, 0, 0.8);
    s.lifesteal = clamp(s.lifesteal, 0, 0.6);
    const oldMax = u.stats.maxHp;
    u.stats = s;
    if (u.hp > s.maxHp) u.hp = s.maxHp;
    if (u.mana > s.maxMana) u.mana = s.maxMana;
    return oldMax;
  }

  private applyArmory(u: Unit) {
    if (!u.tower || u.kind === 'fortress' && false) return;
    const lvl = this.teams[u.team as Team].upgrades.armory;
    const bul = this.teams[u.team as Team].upgrades.bulwark;
    const t = TOWERS[u.tower.kind];
    const mult = TOWER_LEVEL_MULT[u.tower.level - 1] ?? 1;
    const b = { ...t.stats, maxHp: t.stats.maxHp * mult, attackDamage: t.stats.attackDamage * mult };
    if (u.kind === 'fortress') {
      b.armor += 25 * bul; b.magicResist += 25 * bul; b.hpRegen += 10 * bul;
      b.attackDamage *= 1 + [0, 0, 0.3, 0.6][bul];
    } else {
      b.attackDamage *= 1 + 0.2 * lvl;
      b.maxHp *= 1 + 0.15 * lvl;
    }
    const before = u.stats.maxHp;
    u.baseStats = b;
    this.recompute(u);
    if (u.stats.maxHp > before) u.hp += u.stats.maxHp - before;
  }

  // ------------------------------------------------------------------ damage & healing
  dealDamage(src: Unit | null, tgt: Unit, raw: number, dtype: DamageType, opts: { attack?: boolean; crit?: boolean; ability?: boolean } = {}): number {
    if (tgt.dead || raw <= 0) return 0;
    if (this.has(tgt, 'invulnerable')) return 0;
    let amt = raw;
    if (this.isStructure(tgt)) {
      if (opts.ability) amt *= 0.5;
      if (tgt.kind === 'fortress') {
        const held = this.banners.filter((b) => b.homeTeam === tgt.team && b.owner === tgt.team).length;
        amt *= COMBAT.fortressDamageMult[held];
        if (amt <= 0) {
          if (src?.hero && this.tick % 10 === 0) this.emit({ e: 'msg', text: 'The fortress is shielded by its banners. Capture them first!', color: '#ffd166' }, { pid: src.hero.pid });
          return 0;
        }
      }
    }
    if (dtype !== 'true') {
      const res = dtype === 'physical' ? tgt.stats.armor * (1 - (src?.stats.armorPen ?? 0)) : tgt.stats.magicResist * (1 - (src?.stats.magicPen ?? 0));
      amt *= res >= 0 ? 100 / (100 + res) : 2 - 100 / (100 - res);
    }
    if (src && src.team !== tgt.team) {
      if (src.kind === 'minion' && tgt.kind === 'hero') amt *= 0.6;
      if ((tgt.kind === 'minion' || tgt.kind === 'monster') && src.kind === 'tower') amt *= tgt.kind === 'minion' ? 1.6 : 1;
    }
    // shields
    let left = amt;
    for (const s of tgt.shields) {
      if (s.until <= this.time || left <= 0) continue;
      const a = Math.min(s.amount, left);
      s.amount -= a;
      left -= a;
    }
    tgt.shields = tgt.shields.filter((s) => s.amount > 0.5 && s.until > this.time);
    tgt.hp -= left;
    tgt.lastDamagedAt = this.time;
    if (tgt.hero && tgt.hero.recallUntil) tgt.hero.recallUntil = 0;
    const credit = src ? this.creditUnit(src) : null;
    if (credit?.hero) tgt.damagedBy.set(credit.id, this.time);
    if (src && src.kind === 'hero' && tgt.kind === 'hero') src.lastHeroAttackOnHeroAt = this.time;
    if (src) this.breakStealth(src);
    this.emit({ e: 'dmg', id: tgt.id, a: Math.round(amt), k: dtype === 'physical' ? 0 : dtype === 'magic' ? 1 : 2, ...(opts.crit ? { c: 1 as const } : {}), ...(src ? { s: src.id } : {}) });
    if (opts.attack && src && src.stats.lifesteal > 0 && !this.isStructure(tgt)) this.heal(src, src, amt * src.stats.lifesteal, true);
    if (tgt.camp && src && !tgt.camp.leashing && tgt.order.type !== 'attack') this.aggroCamp(tgt, src);
    if (tgt.hp <= 0) this.kill(tgt, src);
    else if (tgt.hero) this.checkLowHp(tgt);
    return amt;
  }

  heal(src: Unit, tgt: Unit, amount: number, quiet = false) {
    if (tgt.dead || amount <= 0 || this.isStructure(tgt)) return;
    const before = tgt.hp;
    tgt.hp = Math.min(tgt.stats.maxHp, tgt.hp + amount);
    const a = Math.round(tgt.hp - before);
    if (!quiet && a > 0) this.emit({ e: 'heal', id: tgt.id, a });
  }

  creditUnit(u: Unit): Unit {
    if (u.summon) return this.units.get(u.summon.owner) ?? u;
    return u;
  }

  breakStealth(u: Unit) {
    if (u.statuses.some((s) => s.kind === 'stealth')) u.statuses = u.statuses.filter((s) => s.kind !== 'stealth');
  }

  applyStatus(src: Unit, tgt: Unit, kind: StatusKind, duration: number, power = 0) {
    if (tgt.dead || this.isStructure(tgt)) return;
    if (CC.includes(kind) && (this.has(tgt, 'unstoppable') || this.has(tgt, 'invulnerable')) && tgt.team !== src.team) return;
    if (tgt.camp?.leashing) return;
    if (kind === 'slow' && power <= 0) power = 0.3;
    tgt.statuses.push({ kind, until: this.time + duration, power, src: src.id });
    if (kind === 'taunt') tgt.order = { type: 'attack', id: src.id };
    if (kind === 'stun' || kind === 'knockup') {
      tgt.cast = null;
      tgt.windup = null;
      if (tgt.hero) tgt.hero.recallUntil = 0;
    }
    if (kind === 'stealth') tgt.order = tgt.order.type === 'attack' ? { type: 'idle' } : tgt.order;
    if (kind === 'slow') this.recompute(tgt);
  }

  addShield(tgt: Unit, amount: number, duration: number) {
    if (tgt.dead || amount <= 0) return;
    tgt.shields.push({ amount, until: this.time + duration });
  }

  addBuff(tgt: Unit, id: string, duration: number, stats?: Partial<Record<StatKey, number>>, pct?: Partial<Record<StatKey, number>>, name?: string, icon?: string) {
    if (tgt.dead) return;
    tgt.buffs = tgt.buffs.filter((b) => b.id !== id);
    tgt.buffs.push({ id, until: this.time + duration, stats, pct, name, icon });
    const before = tgt.stats.maxHp;
    this.recompute(tgt);
    if (tgt.stats.maxHp > before) tgt.hp += tgt.stats.maxHp - before;
  }

  private checkLowHp(u: Unit) {
    const h = u.hero!;
    const frac = u.hp / u.stats.maxHp;
    const p = h.def.passive.onLowHp;
    if (p && frac <= p.threshold && this.time >= h.lowHpReadyAt) {
      h.lowHpReadyAt = this.time + p.cooldown;
      runEffects(this, p.effects, this.selfCtx(u, 1));
    }
    for (const id of h.items) {
      const it = id ? ITEM_BY_ID[id] : null;
      const lp = it?.passive?.onLowHp;
      if (!it || !lp) continue;
      if (frac <= lp.threshold && this.time >= (h.itemLowHpReadyAt[it.id] ?? 0)) {
        h.itemLowHpReadyAt[it.id] = this.time + lp.cooldown;
        runEffects(this, lp.effects, this.selfCtx(u, 1));
      }
    }
  }

  selfCtx(u: Unit, rank: number): Ctx {
    const d = { x: Math.sin(u.facing), z: Math.cos(u.facing) };
    return { caster: u, target: u, point: { x: u.x, z: u.z }, dir: d, origin: { x: u.x, z: u.z }, rank };
  }

  // ------------------------------------------------------------------ death & rewards
  kill(u: Unit, src: Unit | null) {
    if (u.dead) return;
    u.dead = true;
    u.hp = 0;
    u.cast = null; u.windup = null; u.dash = null; u.path = []; u.order = { type: 'idle' };
    u.shields = []; u.statuses = [];
    this.emit({ e: 'death', id: u.id });
    const killer = src ? this.creditUnit(src) : null;
    const nightMult = this.night ? 1.5 : 1;

    if (u.kind === 'hero') this.onHeroDeath(u, killer);
    else if (u.kind === 'tower' || u.kind === 'fortress') this.onStructureDeath(u, killer);
    else {
      u.removeAt = this.time + 3;
      if (killer?.hero && killer.team !== u.team) {
        const g = Math.round(u.gold * (u.kind === 'monster' ? nightMult : 1) * (1 + Math.min(this.time / 60, 30) * 0.01));
        this.giveGold(killer, g);
        killer.hero.cs++;
      }
      // xp shared by nearby enemy heroes of the victim
      const xpTeam = killer && killer.team !== NEUTRAL ? killer.team : u.team === 0 ? 1 : 0;
      const near = this.heroesNear(u, XP.shareRadius, (h) => h.team === xpTeam);
      if (killer?.hero && killer.team === xpTeam && !near.includes(killer)) near.push(killer);
      for (const h of near) this.giveXp(h, (u.xp * (near.length > 1 ? 1.25 : 1)) / near.length);
      if (u.camp) this.onCampUnitDeath(u, killer);
      if (u.summon) u.removeAt = this.time + 1.5;
    }
    if (killer?.hero) {
      const ok = killer.hero.def.passive.onKill;
      if (ok && (u.kind === 'hero' || u.kind === 'monster' || u.kind === 'minion')) runEffects(this, ok, this.selfCtx(killer, 1));
      for (const id of killer.hero.items) {
        const it = id ? ITEM_BY_ID[id] : null;
        if (it?.passive?.onKill) runEffects(this, it.passive.onKill, this.selfCtx(killer, 1));
      }
    }
  }

  private heroesNear(p: Unit, r: number, f: (h: Unit) => boolean) {
    const out: Unit[] = [];
    for (const u of this.units.values()) if (u.kind === 'hero' && !u.dead && Math.hypot(u.x - p.x, u.z - p.z) <= r && f(u)) out.push(u);
    return out;
  }

  private onHeroDeath(u: Unit, killer: Unit | null) {
    const h = u.hero!;
    h.deaths++;
    const horn = this.teams[u.team as Team].upgrades.horn;
    const timer = (COMBAT.respawnBase + h.level * COMBAT.respawnPerLevel + Math.min(this.time / 60, 25) * 0.4) * (1 - 0.2 * horn);
    h.respawnAt = this.time + timer;
    h.recallUntil = 0;
    const enemyTeam = u.team === 0 ? 1 : 0;
    // kill credit: killer hero, otherwise the most recent enemy hero damager within 10s
    let kh = killer?.hero && killer.team !== u.team ? killer : null;
    const recent = [...u.damagedBy.entries()].filter(([id, t]) => this.time - t <= 10 && this.units.get(id)?.team === enemyTeam).sort((a, b) => b[1] - a[1]);
    if (!kh && recent.length) kh = this.units.get(recent[0][0]) ?? null;
    const assists = recent.map(([id]) => id).filter((id) => id !== kh?.id);
    const bounty = ECON.heroKill + Math.min(Math.max(0, h.streak - 1), ECON.streakCap) * ECON.streakBonus;
    if (kh?.hero) {
      kh.hero.kills++;
      kh.hero.streak++;
      this.giveGold(kh, bounty);
      if (h.streak >= 3) this.emit({ e: 'msg', text: `${kh.hero.pname} ended ${h.pname}'s rampage!`, color: '#ffd166' });
      if (kh.hero.streak === 3 || kh.hero.streak === 5) this.emit({ e: 'msg', text: `${kh.hero.pname} is ${kh.hero.streak === 3 ? 'on a rampage' : 'unstoppable'}!`, color: '#ff8fab' });
    }
    this.teams[enemyTeam].kills++;
    for (const id of assists) {
      const a = this.units.get(id);
      if (a?.hero) { a.hero.assists++; this.giveGold(a, ECON.assist); }
    }
    const xpVal = XP.heroKillBase + XP.heroKillPerLevel * h.level;
    const near = this.heroesNear(u, XP.shareRadius, (x) => x.team === enemyTeam);
    if (kh && !near.includes(kh)) near.push(kh);
    for (const x of near) this.giveXp(x, xpVal / Math.max(1, near.length * 0.75));
    h.streak = 0;
    u.damagedBy.clear();
    this.emit({ e: 'kill', killer: kh?.id ?? killer?.id ?? 0, victim: u.id, assists });
  }

  private onStructureDeath(u: Unit, killer: Unit | null) {
    const enemy = (u.team === 0 ? 1 : 0) as Team;
    this.nav.setCircle({ x: u.x, z: u.z }, u.radius, 0);
    u.removeAt = u.kind === 'fortress' ? Infinity : this.time + 600;
    this.emit({ e: 'struct', id: u.id, team: u.team as Team, name: u.name });
    if (u.kind === 'fortress') {
      this.winner = enemy;
      this.emit({ e: 'msg', text: `The ${u.team === 0 ? 'Dawnguard' : 'Duskborn'} fortress has fallen!`, color: '#ffd166' });
      return;
    }
    if (u.tower && u.tower.pad < 0) for (const h of this.units.values()) if (h.hero && h.team === enemy) this.giveGold(h, ECON.towerDestroy);
    if (u.tower && u.tower.pad >= 0) {
      const pad = this.pads[u.tower.pad];
      pad.unitId = 0; pad.kind = ''; pad.level = 0;
      if (killer?.hero) this.giveGold(killer, 120);
    }
  }

  giveGold(u: Unit, amount: number) {
    if (!u.hero || amount <= 0) return;
    u.hero.gold += amount;
    this.emit({ e: 'gold', id: u.id, a: Math.round(amount) }, { pid: u.hero.pid });
  }

  giveXp(u: Unit, amount: number) {
    const h = u.hero;
    if (!h || h.level >= MAX_LEVEL) return;
    h.xp += amount;
    while (h.level < MAX_LEVEL && h.xp >= XP_TABLE[h.level]) {
      h.level++;
      const before = u.stats.maxHp, beforeMana = u.stats.maxMana;
      this.recompute(u);
      u.hp += u.stats.maxHp - before;
      u.mana += u.stats.maxMana - beforeMana;
      this.emit({ e: 'level', id: u.id, lvl: h.level });
    }
  }

  // ------------------------------------------------------------------ camps
  private spawnCamp(c: CampState) {
    const spot = CAMPS.find((x) => x.id === c.id)!;
    const tmpl = CAMP_TEMPLATES[spot.kind];
    const mins = this.time / 60;
    c.aliveIds = tmpl.units.map((e, i) => {
      const pos = { x: spot.pos.x + e.offset[0], z: spot.pos.z + e.offset[1] };
      const u = this.spawnFromTemplate('monster', NEUTRAL, e.t, `c:${spot.kind}:${i ? 1 : 0}`, pos, 1 + mins * 0.04);
      u.camp = { campId: c.id, home: pos, leashing: false, slamAt: 0 };
      u.facing = angleOf({ x: -spot.pos.x, z: -spot.pos.z });
      return u.id;
    });
    if (spot.kind === 'colossus') this.emit({ e: 'msg', text: 'The Bone Colossus has risen at the centre of the Crossing!', color: '#d9c27a' });
  }

  private onCampUnitDeath(u: Unit, killer: Unit | null) {
    const c = this.camps.find((x) => x.id === u.camp!.campId)!;
    c.aliveIds = c.aliveIds.filter((id) => id !== u.id);
    if (c.aliveIds.length) return;
    const spot = CAMPS.find((x) => x.id === c.id)!;
    const tmpl = CAMP_TEMPLATES[spot.kind];
    c.respawnAt = this.time + (spot.kind === 'colossus' ? TIMING.bossRespawn : TIMING.campRespawn);
    if (!killer?.hero || !tmpl.buff) return;
    const b = CAMP_BUFFS[tmpl.buff];
    const stats = 'stats' in b ? { ...b.stats } : undefined;
    const pct = 'pct' in b ? { ...b.pct } : undefined;
    if (tmpl.buff === 'colossus') {
      for (const h of this.units.values()) if (h.hero && h.team === killer.team) {
        if (!h.dead) this.addBuff(h, 'colossus', b.duration, stats, pct, b.name, b.icon);
        this.giveGold(h, ECON.bossKill);
      }
      this.emit({ e: 'msg', text: `${killer.team === 0 ? 'Dawnguard' : 'Duskborn'} slew the Bone Colossus! Their heroes gain Colossus Might.`, color: '#d9c27a' });
    } else this.addBuff(killer, tmpl.buff, b.duration, stats, pct, b.name, b.icon);
  }

  private aggroCamp(u: Unit, src: Unit) {
    const c = this.camps.find((x) => x.id === u.camp!.campId);
    const attacker = src.summon ? src : this.creditUnit(src);
    for (const id of c?.aliveIds ?? [u.id]) {
      const m = this.units.get(id);
      if (m && !m.dead && m.order.type !== 'attack') m.order = { type: 'attack', id: attacker.id };
    }
  }

  // ------------------------------------------------------------------ waves
  private spawnWaves() {
    this.waveCount++;
    const n = this.waveCount;
    for (const team of [0, 1] as Team[]) {
      const forge = this.teams[team].upgrades.forge;
      const mult = (1 + 0.15 * forge) * (1 + (this.time / 60) * 0.025);
      for (const lane of [0, 1] as LaneId[]) {
        const path = lanepath(lane, team);
        const kinds: MinionKind[] = ['melee', 'melee', 'melee'];
        if (forge >= 2) kinds.push('melee');
        kinds.push('ranged', 'ranged');
        if (n % 3 === 0) kinds.push('siege');
        if (forge >= 3) kinds.push('elite');
        for (let m = 0; m < this.teams[team].mercs[lane]; m++) kinds.push('siege');
        this.teams[team].mercs[lane] = 0;
        kinds.forEach((k, i) => {
          this.schedule(i * 0.6, () => {
            if (this.winner !== null) return;
            const start = path[0];
            const u = this.spawnFromTemplate('minion', team, MINIONS[k], `m:${k}`, { x: start.x + (this.random() - 0.5) * 2, z: start.z + (this.random() - 0.5) * 2 }, mult);
            u.minion = { lane, wp: 1, path };
            u.facing = angleOf({ x: path[1].x - start.x, z: path[1].z - start.z });
          });
        });
      }
    }
  }

  // ------------------------------------------------------------------ commands
  command(pid: string, cmd: Command) {
    const u = this.heroOf(pid);
    if (!u || !u.hero || this.winner !== null) return;
    const h = u.hero;
    const cancelRecall = () => { h.recallUntil = 0; };
    switch (cmd.c) {
      case 'move':
        if (u.dead) return;
        cancelRecall();
        h.steer = null;
        u.order = { type: 'move', x: clamp(cmd.x, MAP.minX, MAP.maxX), z: clamp(cmd.z, MAP.minZ, MAP.maxZ), attackMove: cmd.attack };
        u.path = []; u.pathGoal = null;
        if (u.windup && !cmd.attack) u.windup = null;
        break;
      case 'dir': {
        if (u.dead) return;
        const l = Math.hypot(cmd.x, cmd.z);
        if (l < 0.01) { h.steer = null; if (u.order.type === 'move' && !u.order.attackMove) u.order = { type: 'idle' }; return; }
        cancelRecall();
        h.steer = { x: cmd.x / l, z: cmd.z / l };
        if (u.order.type !== 'attack') u.order = { type: 'idle' };
        if (u.windup) u.windup = null;
        break;
      }
      case 'attack': {
        const t = this.units.get(cmd.id);
        if (u.dead || !t || t.dead || t.team === u.team || !this.visibleTo(u.team, t)) return;
        cancelRecall();
        h.steer = null;
        u.order = { type: 'attack', id: t.id };
        break;
      }
      case 'stop':
        h.steer = null; u.order = { type: 'idle' }; u.path = []; u.windup = null;
        break;
      case 'cast': {
        const slot = SLOTS.indexOf(cmd.slot);
        if (slot >= 0) this.tryCast(u, slot, { x: cmd.x, z: cmd.z }, cmd.id);
        break;
      }
      case 'item': this.useItem(u, cmd.slot, { x: cmd.x, z: cmd.z }, cmd.id); break;
      case 'buy': this.buy(u, cmd.item); break;
      case 'sell': this.sell(u, cmd.slot); break;
      case 'upgrade': this.buyUpgrade(u, cmd.id); break;
      case 'build': this.build(u, cmd.pad, cmd.kind); break;
      case 'hire': this.hire(u, cmd.lane); break;
      case 'recall':
        if (u.dead || h.recallUntil) return;
        u.order = { type: 'idle' }; u.path = []; h.steer = null;
        h.recallUntil = this.time + TIMING.recallTime;
        break;
      case 'ping':
        this.emit({ e: 'ping', x: cmd.x, z: cmd.z, kind: cmd.kind, from: h.pname }, { team: u.team });
        break;
    }
  }

  canShop(u: Unit) {
    if (!u.hero) return false;
    if (u.dead) return true;
    const f = FOUNTAIN[u.team as Team];
    return Math.hypot(u.x - f.x, u.z - f.z) <= TIMING.shopRadius;
  }

  priceFor(u: Unit, itemId: string) { return priceFor(u.hero!.items, itemId); }

  buy(u: Unit, itemId: string): boolean {
    const h = u.hero!;
    const it = ITEM_BY_ID[itemId];
    if (!it || !this.canShop(u)) return false;
    const { price, consume } = this.priceFor(u, itemId);
    if (h.gold < price) return false;
    if (it.unique && h.items.some((x, i) => x && !consume.includes(i) && (x === it.id || (it.category === 'boots' && ITEM_BY_ID[x]?.category === 'boots' && ITEM_BY_ID[x].tier >= it.tier)))) return false;
    for (const i of consume) h.items[i] = null;
    const slot = h.items.indexOf(null);
    if (slot < 0) return false;
    h.gold -= price;
    h.items[slot] = it.id;
    h.itemCd[slot] = 0;
    const before = u.stats.maxHp, mb = u.stats.maxMana;
    this.recompute(u);
    u.hp += Math.max(0, u.stats.maxHp - before);
    u.mana += Math.max(0, u.stats.maxMana - mb);
    return true;
  }

  sell(u: Unit, slot: number) {
    const h = u.hero!;
    const id = h.items[slot];
    if (!id || !this.canShop(u)) return;
    h.gold += Math.floor(ITEM_BY_ID[id].cost * ECON.sellRatio);
    h.items[slot] = null;
    this.recompute(u);
  }

  private useItem(u: Unit, slot: number, point: Vec2, targetId?: number) {
    const h = u.hero!;
    const id = h.items[slot];
    const it = id ? ITEM_BY_ID[id] : null;
    if (!it || u.dead || !this.canAct(u)) return;
    if (it.consumable) {
      h.items[slot] = null;
      runEffects(this, it.consumable.effects, this.selfCtx(u, 1));
      this.recompute(u);
      return;
    }
    if (!it.active || h.itemCd[slot] > 0) return;
    const a = it.active;
    const def: AbilityDef = { id: it.id, name: a.name, description: a.description, icon: it.icon, targeting: a.targeting, range: a.range, cooldown: [a.cooldown], manaCost: [0], castTime: 0, effects: a.effects };
    if (this.startCast(u, def, slot, point, targetId, true)) h.itemCd[slot] = a.cooldown;
  }

  tryCast(u: Unit, slot: number, point: Vec2, targetId?: number): boolean {
    const h = u.hero;
    if (!h || u.dead) return false;
    const def = h.def.abilities[slot];
    const rank = this.rank(u, slot);
    if (!def || rank <= 0 || h.cd[slot] > 0) return false;
    const cost = def.manaCost[clamp(rank - 1, 0, def.manaCost.length - 1)] ?? 0;
    if (u.mana < cost) return false;
    if (!this.startCast(u, def, slot, point, targetId, false)) return false;
    u.mana -= cost;
    const cd = (def.cooldown[clamp(rank - 1, 0, def.cooldown.length - 1)] ?? 10) * (100 / (100 + u.stats.abilityHaste));
    h.cd[slot] = cd;
    h.cdMax[slot] = cd;
    return true;
  }

  /** Validates targeting and begins the windup. Returns false if the cast is impossible right now. */
  private startCast(u: Unit, def: AbilityDef, slot: number, point: Vec2, targetId: number | undefined, item: boolean): boolean {
    if (!this.canAct(u) || u.cast) return false;
    if (this.has(u, 'silence') && !item) return false;
    const h = u.hero!;
    let target: Unit | null = null;
    if (def.targeting === 'enemy' || def.targeting === 'ally' || def.targeting === 'unit') {
      target = targetId ? this.units.get(targetId) ?? null : null;
      if (!target || target.dead) target = this.pickTargetNear(u, def, point);
      if (!target) return false;
      if (def.targeting === 'enemy' && target.team === u.team) return false;
      if (def.targeting === 'ally' && target.team !== u.team) return false;
      if (target.team !== u.team && !this.visibleTo(u.team, target)) return false;
      const d = Math.hypot(target.x - u.x, target.z - u.z) - target.radius - u.radius;
      if (d > def.range) {
        // walk into range, then cast (cooldown/mana are only spent when the cast actually begins)
        if (!item) { u.order = { type: 'castAt', slot, id: target.id }; return false; }
        return false;
      }
      point = { x: target.x, z: target.z };
    } else if (def.targeting === 'self') {
      target = u;
      point = { x: u.x, z: u.z };
    } else {
      target = u;
      const d = Math.hypot(point.x - u.x, point.z - u.z);
      if (def.targeting === 'point' && d > def.range) {
        const n = norm({ x: point.x - u.x, z: point.z - u.z });
        point = { x: u.x + n.x * def.range, z: u.z + n.z * def.range };
      }
    }
    const dir = norm({ x: point.x - u.x, z: point.z - u.z });
    if (def.targeting !== 'self') u.facing = angleOf(dir);
    const rank = item ? 1 : this.rank(u, slot);
    const ctx: Ctx = { caster: u, target, point, dir, origin: { x: u.x, z: u.z }, rank };
    h.recallUntil = 0;
    u.windup = null;
    const castTime = def.castTime ?? 0.2;
    u.cast = { def, slot, t: castTime, ctx, item };
    this.emit({ e: 'cast', id: u.id, anim: def.anim ?? 'Spellcast_Shoot' });
    if (castTime <= 0) this.finishCast(u);
    if (u.order.type === 'castAt') u.order = { type: 'idle' };
    return true;
  }

  private pickTargetNear(u: Unit, def: AbilityDef, p: Vec2): Unit | null {
    let best: Unit | null = null, bd = 3.5;
    for (const o of this.units.values()) {
      if (o.dead || this.isStructure(o)) continue;
      if (def.targeting === 'enemy' && (o.team === u.team || !this.visibleTo(u.team, o))) continue;
      if (def.targeting === 'ally' && o.team !== u.team) continue;
      const d = Math.hypot(o.x - p.x, o.z - p.z);
      if (d < bd) { bd = d; best = o; }
    }
    return best;
  }

  private finishCast(u: Unit) {
    const c = u.cast!;
    u.cast = null;
    if (c.ctx.target && c.ctx.target !== u && c.ctx.target.dead) return;
    // re-aim unit-targeted casts at the target's current position
    if (c.ctx.target && c.ctx.target !== u) {
      c.ctx.point = { x: c.ctx.target.x, z: c.ctx.target.z };
      c.ctx.dir = norm({ x: c.ctx.point.x - u.x, z: c.ctx.point.z - u.z });
    }
    c.ctx.origin = { x: u.x, z: u.z };
    runEffects(this, c.def.effects, c.ctx);
    if (!c.item && u.hero) {
      const oc = u.hero.def.passive.onAbilityCast;
      if (oc) runEffects(this, oc, this.selfCtx(u, 1));
      for (const id of u.hero.items) {
        const it = id ? ITEM_BY_ID[id] : null;
        if (it?.passive?.onAbilityCast) runEffects(this, it.passive.onAbilityCast, this.selfCtx(u, 1));
      }
    }
  }

  private buyUpgrade(u: Unit, id: UpgradeId) {
    const def = UPGRADE_BY_ID[id];
    const h = u.hero!;
    const team = this.teams[u.team as Team];
    const lvl = team.upgrades[id];
    if (!def || lvl >= def.costs.length || h.gold < def.costs[lvl]) return;
    h.gold -= def.costs[lvl];
    team.upgrades[id] = lvl + 1;
    this.emit({ e: 'msg', text: `${h.pname} upgraded ${def.name} to level ${lvl + 1}`, color: '#9be7ff' }, { team: u.team });
    if (id === 'armory' || id === 'bulwark') for (const s of this.units.values()) if (s.tower && s.team === u.team && !s.dead) this.applyArmory(s);
  }

  private build(u: Unit, padIdx: number, kind: TowerKind | 'upgrade') {
    const pad = this.pads[padIdx];
    const h = u.hero!;
    if (!pad || pad.team !== u.team) return;
    if (kind === 'upgrade') {
      const t = this.units.get(pad.unitId);
      if (!t || t.dead || !t.tower || t.tower.level >= 3) return;
      const cost = Math.round(TOWERS[t.tower.kind].cost * TOWER_UPGRADE_COST * t.tower.level);
      if (h.gold < cost) return;
      h.gold -= cost;
      t.tower.level++;
      pad.level = t.tower.level;
      this.applyArmory(t);
      t.hp = t.stats.maxHp;
      return;
    }
    if (pad.unitId || !TOWERS[kind] || TOWERS[kind].cost <= 0) return;
    if (h.gold < TOWERS[kind].cost) return;
    h.gold -= TOWERS[kind].cost;
    const t = this.spawnStructure(kind, u.team as Team, { x: pad.x, z: pad.z }, `pad-${padIdx}`, 1, padIdx);
    pad.unitId = t.id; pad.kind = kind; pad.level = 1;
    this.emit({ e: 'msg', text: `${h.pname} built a ${TOWERS[kind].name}`, color: '#9be7ff' }, { team: u.team });
  }

  private hire(u: Unit, lane: LaneId) {
    const h = u.hero!;
    if (h.gold < MERCENARY.cost) return;
    h.gold -= MERCENARY.cost;
    this.teams[u.team as Team].mercs[lane]++;
    this.emit({ e: 'msg', text: `${h.pname} hired a Bone Brute for the ${lane === 0 ? 'north' : 'south'} lane`, color: '#9be7ff' }, { team: u.team });
  }

  // ------------------------------------------------------------------ tick
  step() {
    if (this.winner !== null) { this.tick++; return; }
    const dt = DT;
    this.time += dt;
    this.tick++;

    if (this.time >= this.phaseEndsAt) {
      this.night = !this.night;
      this.phaseEndsAt = this.time + (this.night ? TIMING.nightLength : TIMING.dayLength);
      this.emit({ e: 'msg', text: this.night ? 'Night falls over the Crossing. Vision shrinks; monsters carry more gold.' : 'Dawn breaks.', color: this.night ? '#a5b4fc' : '#ffe08a' });
    }
    if (this.time >= this.nextWaveAt) { this.nextWaveAt += TIMING.waveInterval; this.spawnWaves(); }
    for (const c of this.camps) if (!c.aliveIds.length && c.respawnAt > 0 && this.time >= c.respawnAt) { c.respawnAt = 0; this.spawnCamp(c); }

    // scheduled effects
    if (this.scheduled.length) {
      const due = this.scheduled.filter((s) => s.at <= this.time);
      if (due.length) {
        this.scheduled = this.scheduled.filter((s) => s.at > this.time);
        for (const s of due) s.run();
      }
    }

    // passive gold
    if (this.time - this.lastGoldTick >= 1) {
      this.lastGoldTick = this.time;
      for (const team of [0, 1] as Team[]) {
        const held = this.banners.filter((b) => b.homeTeam !== team && b.owner === team).length;
        const g = ECON.passiveGoldPerSec + 0.6 * this.teams[team].upgrades.treasury + held * ECON.bannerHeldPerSec;
        for (const u of this.units.values()) if (u.hero && u.team === team) u.hero.gold += g;
      }
    }

    for (const brain of this.bots.values()) brain.update(dt);

    for (const u of [...this.units.values()]) this.updateUnit(u, dt);
    this.updateProjectiles(dt);
    this.updateZones();
    this.updateBanners(dt);
    this.separate();

    for (const u of [...this.units.values()]) if (u.dead && u.removeAt && this.time >= u.removeAt && u.kind !== 'hero') this.units.delete(u.id);
  }

  private updateUnit(u: Unit, dt: number) {
    const h = u.hero;
    if (u.dead) {
      if (h && this.time >= h.respawnAt) this.respawn(u);
      return;
    }
    // expirations
    const nBuff = u.buffs.length, nStat = u.statuses.length;
    u.buffs = u.buffs.filter((b) => b.until > this.time);
    u.statuses = u.statuses.filter((s) => s.until > this.time);
    if (u.buffs.length !== nBuff || u.statuses.length !== nStat || this.tick % 10 === 0) this.recompute(u);
    if (u.summon && this.time >= u.summon.until) { this.kill(u, null); return; }

    // regen
    if (u.hp < u.stats.maxHp) u.hp = Math.min(u.stats.maxHp, u.hp + u.stats.hpRegen * dt);
    if (u.mana < u.stats.maxMana) u.mana = Math.min(u.stats.maxMana, u.mana + u.stats.manaRegen * dt);
    if (h) {
      for (let i = 0; i < 4; i++) h.cd[i] = Math.max(0, h.cd[i] - dt);
      for (let i = 0; i < 6; i++) h.itemCd[i] = Math.max(0, h.itemCd[i] - dt);
      const f = FOUNTAIN[u.team as Team];
      if (Math.hypot(u.x - f.x, u.z - f.z) <= TIMING.fountainRadius) {
        u.hp = Math.min(u.stats.maxHp, u.hp + u.stats.maxHp * 0.08 * dt);
        u.mana = Math.min(u.stats.maxMana, u.mana + u.stats.maxMana * 0.08 * dt);
      }
      if (h.recallUntil && this.time >= h.recallUntil) {
        h.recallUntil = 0;
        const p = this.spawnPoint(u.team);
        u.x = p.x; u.z = p.z; u.path = []; u.order = { type: 'idle' };
        this.emit({ e: 'blink', id: u.id, x: u.x, z: u.z });
      }
    }
    u.attackCd = Math.max(0, u.attackCd - dt);
    u.moving = false;

    if (u.displaced) {
      if (this.time >= u.displaced.until) u.displaced = null;
      else { this.moveBy(u, u.displaced.vx * dt, u.displaced.vz * dt); return; }
    }
    if (u.dash) { this.updateDash(u, dt); return; }
    if (this.disabled(u)) return;

    if (u.cast) {
      u.cast.t -= dt;
      if (u.cast.t <= 0) this.finishCast(u);
      return;
    }
    if (u.kind === 'tower' || u.kind === 'fortress') { this.updateTower(u); return; }
    if (u.kind === 'minion') this.minionAI(u);
    else if (u.kind === 'monster') this.campAI(u);
    else if (u.kind === 'summon') this.summonAI(u);

    if (h?.steer && u.order.type !== 'attack' && u.order.type !== 'castAt') {
      if (u.windup) return;
      if (!this.has(u, 'root')) this.moveDir(u, h.steer, dt);
      return;
    }

    const o = u.order;
    if (o.type === 'attack' || o.type === 'castAt') {
      const t = this.units.get(o.id);
      const forced = this.has(u, 'taunt');
      if (!t || t.dead || (t.team !== u.team && !this.visibleTo(u.team, t) && !forced)) {
        u.order = { type: 'idle' }; u.windup = null; return;
      }
      if (o.type === 'castAt') {
        const def = h!.def.abilities[o.slot];
        const d = Math.hypot(t.x - u.x, t.z - u.z) - t.radius - u.radius;
        if (d <= def.range) { this.tryCast(u, o.slot, { x: t.x, z: t.z }, t.id); if (u.order.type === 'castAt') u.order = { type: 'idle' }; }
        else this.moveToward(u, { x: t.x, z: t.z }, dt);
        return;
      }
      this.attackLogic(u, t, dt);
      return;
    }
    if (u.windup) { this.continueWindup(u); return; }
    if (o.type === 'move') {
      if (o.attackMove) {
        const t = this.nearestEnemy(u, Math.max(u.stats.attackRange + 3, 7));
        if (t) { this.attackLogic(u, t, dt); return; }
      }
      if (this.moveToward(u, { x: o.x, z: o.z }, dt)) u.order = { type: 'idle' };
    } else if (o.type === 'idle' && u.kind === 'hero' && !h?.steer) {
      // auto-attack anything that wanders into range
      if (u.lastDamagedAt > this.time - 3 || u.attackCd <= 0) {
        const t = this.nearestEnemy(u, u.stats.attackRange + 0.5);
        if (t && !h?.recallUntil) this.attackLogic(u, t, dt);
      }
    }
  }

  private respawn(u: Unit) {
    const p = this.spawnPoint(u.team);
    u.x = p.x; u.z = p.z;
    u.dead = false;
    this.recompute(u);
    u.hp = u.stats.maxHp;
    u.mana = u.stats.maxMana;
    u.order = { type: 'idle' };
    u.path = [];
    u.hero!.steer = null;
    this.emit({ e: 'blink', id: u.id, x: u.x, z: u.z });
  }

  nearestEnemy(u: Unit, r: number, filter?: (o: Unit) => boolean): Unit | null {
    let best: Unit | null = null, bd = Infinity;
    for (const o of this.units.values()) {
      if (o.dead || o.team === u.team) continue;
      if (filter && !filter(o)) continue;
      const d = Math.hypot(o.x - u.x, o.z - u.z) - o.radius;
      if (d > r || d >= bd) continue;
      if (!this.visibleTo(u.team, o)) continue;
      bd = d; best = o;
    }
    return best;
  }

  private attackRange(u: Unit, t: Unit) {
    return u.stats.attackRange + u.radius + t.radius + (u.empowered && u.empowered.until > this.time ? u.empowered.bonusRange : 0);
  }

  private attackLogic(u: Unit, t: Unit, dt: number) {
    const d = Math.hypot(t.x - u.x, t.z - u.z);
    if (u.windup) { this.continueWindup(u); return; }
    if (d <= this.attackRange(u, t)) {
      u.facing = angleOf({ x: t.x - u.x, z: t.z - u.z });
      u.path = [];
      if (u.attackCd <= 0) {
        const period = 1 / u.stats.attackSpeed;
        u.attackCd = period;
        u.windup = { targetId: t.id, t: Math.min(0.4, period * COMBAT.meleeWindup) };
        const anim = u.attackAnims[u.attackIdx++ % u.attackAnims.length];
        this.emit({ e: 'atk', id: u.id, anim, tid: t.id });
      }
    } else if (!this.has(u, 'root')) {
      this.moveToward(u, { x: t.x, z: t.z }, dt, this.attackRange(u, t) - 0.2);
    }
  }

  private continueWindup(u: Unit) {
    const w = u.windup!;
    w.t -= DT;
    if (w.t > 0) return;
    u.windup = null;
    const t = this.units.get(w.targetId);
    if (!t || t.dead) return;
    if (Math.hypot(t.x - u.x, t.z - u.z) > this.attackRange(u, t) + 2) return;
    this.breakStealth(u);
    if (u.ranged) {
      this.projectiles.push({
        id: this.nextId++, team: u.team, owner: u.id, x: u.x, z: u.z, dir: norm({ x: t.x - u.x, z: t.z - u.z }), speed: u.tower ? 30 : 26,
        traveled: 0, range: 60, width: 0.4, pierce: false, homing: t.id, returns: false, returning: false, toPoint: null, affects: 'enemies',
        effects: [], onEnd: [], hit: new Set(), ctx: null, visual: u.ranged, attack: { attacker: u.id, target: t.id }, towerShot: !!u.tower, dead: false,
      });
    } else this.basicHit(u, t);
  }

  /** A basic attack lands. */
  basicHit(u: Unit, t: Unit) {
    if (t.dead) return;
    if (u.tower) { this.towerHit(u, t); return; }
    const crit = u.stats.critChance > 0 && this.random() < u.stats.critChance;
    let dmg = u.stats.attackDamage * (crit ? COMBAT.critMultiplier : 1);
    if (u.kind === 'minion' && t.kind === 'minion') dmg *= 1;
    this.dealDamage(u, t, dmg, u.attackDtype, { attack: true, crit });
    if (!u.hero) return;
    const h = u.hero;
    const rank1 = { caster: u, target: t, point: { x: t.x, z: t.z }, dir: norm({ x: t.x - u.x, z: t.z - u.z }), origin: { x: u.x, z: u.z }, rank: 1 };
    const p = h.def.passive;
    if (p.onHit) runEffects(this, p.onHit, { ...rank1 });
    if (p.everyNthHit) {
      h.nthCounter++;
      if (h.nthCounter >= p.everyNthHit.n) { h.nthCounter = 0; runEffects(this, p.everyNthHit.effects, { ...rank1 }); }
    }
    if (u.empowered) {
      const e = u.empowered;
      u.empowered = null;
      if (e.until >= this.time) runEffects(this, e.effects, { ...e.ctx, target: t, point: { x: t.x, z: t.z }, origin: { x: u.x, z: u.z }, dir: rank1.dir });
    }
    for (const id of h.items) {
      const it = id ? ITEM_BY_ID[id] : null;
      if (!it?.passive) continue;
      if (it.passive.onHit) runEffects(this, it.passive.onHit, { ...rank1 });
      const n = it.passive.everyNthHit;
      if (n) {
        h.itemNth[it.id] = (h.itemNth[it.id] ?? 0) + 1;
        if (h.itemNth[it.id] >= n.n) { h.itemNth[it.id] = 0; runEffects(this, n.effects, { ...rank1 }); }
      }
    }
  }

  private towerHit(u: Unit, t: Unit) {
    const spec = TOWERS[u.tower!.kind];
    let dmg = u.stats.attackDamage;
    if (t.kind === 'hero') {
      if (u.tower!.kind === 'lane' || u.tower!.kind === 'fortress') {
        if (u.tower!.lastTarget === t.id) u.tower!.ramp = Math.min(1, u.tower!.ramp + COMBAT.towerHeroRamp);
        else u.tower!.ramp = 0;
        dmg *= 1 + u.tower!.ramp;
      }
      if (spec.heroBonus) dmg *= 1 + spec.heroBonus;
    }
    u.tower!.lastTarget = t.id;
    const dtype = spec.magic ? 'magic' : 'physical';
    if (spec.splash) {
      this.emit({ e: 'vfx', style: 'fire', color: '#ffb36b', x: t.x, z: t.z, r: spec.splash });
      for (const o of this.unitsNear({ x: t.x, z: t.z }, spec.splash, (o) => o.team !== u.team && !this.isStructure(o))) this.dealDamage(u, o, o === t ? dmg : dmg * 0.6, dtype);
    } else this.dealDamage(u, t, dmg, dtype);
    if (spec.slow) this.applyStatus(u, t, 'slow', 1.5, spec.slow);
    if (spec.chain) {
      const hit = new Set([t.id]);
      let cur = t;
      const pts = [u.x, u.z, t.x, t.z];
      for (let i = 1; i < spec.chain; i++) {
        const next = this.unitsNear({ x: cur.x, z: cur.z }, 6, (o) => o.team !== u.team && !hit.has(o.id) && !this.isStructure(o) && this.visibleTo(u.team, o))[0];
        if (!next) break;
        hit.add(next.id);
        this.dealDamage(u, next, dmg * 0.6, 'magic');
        pts.push(next.x, next.z);
        cur = next;
      }
      if (pts.length > 4) this.emit({ e: 'chain', pts, color: spec.projectile.color });
    }
  }

  private updateTower(u: Unit) {
    if (u.windup) { this.continueWindup(u); return; }
    if (u.attackCd > 0) return;
    const range = u.stats.attackRange + 0.5;
    let target: Unit | null = null;
    const cur = this.units.get(u.tower!.lastTarget);
    // aggro: enemy hero hurting an allied hero in range
    for (const o of this.units.values()) {
      if (o.kind !== 'hero' || o.dead || o.team === u.team) continue;
      if (this.time - o.lastHeroAttackOnHeroAt < 1.5 && Math.hypot(o.x - u.x, o.z - u.z) <= range + o.radius && this.visibleTo(u.team, o)) {
        const victimNear = this.unitsNear({ x: u.x, z: u.z }, range + 4, (a) => a.kind === 'hero' && a.team === u.team && this.time - a.lastDamagedAt < 1.5).length;
        if (victimNear) { target = o; break; }
      }
    }
    if (!target && cur && !cur.dead && Math.hypot(cur.x - u.x, cur.z - u.z) <= range + cur.radius && this.visibleTo(u.team, cur)) target = cur;
    if (!target) target = this.nearestEnemy(u, range, (o) => o.kind !== 'hero' && !this.isStructure(o)) ?? this.nearestEnemy(u, range, (o) => !this.isStructure(o));
    if (!target) { u.tower!.ramp = 0; return; }
    u.facing = angleOf({ x: target.x - u.x, z: target.z - u.z });
    u.attackCd = 1 / u.stats.attackSpeed;
    u.windup = { targetId: target.id, t: 0.15 };
    this.emit({ e: 'atk', id: u.id, anim: '', tid: target.id });
  }

  // ------------------------------------------------------------------ AI for non-hero units
  private minionAI(u: Unit) {
    if (this.time >= u.aiAt) {
      u.aiAt = this.time + 0.25 + this.random() * 0.1;
      const cur = u.order.type === 'attack' ? this.units.get(u.order.id) : null;
      const keep = cur && !cur.dead && Math.hypot(cur.x - u.x, cur.z - u.z) < 10 && !this.has(u, 'taunt');
      if (!keep && !this.has(u, 'taunt')) {
        // prefer enemies attacking allied heroes, then minions/summons, then heroes, then structures
        const t = this.nearestEnemy(u, 8, (o) => o.kind === 'hero' && this.time - o.lastHeroAttackOnHeroAt < 2)
          ?? this.nearestEnemy(u, 8, (o) => o.kind === 'minion' || o.kind === 'summon')
          ?? this.nearestEnemy(u, 7, (o) => o.kind === 'hero')
          ?? this.nearestEnemy(u, 9, (o) => this.isStructure(o));
        u.order = t ? { type: 'attack', id: t.id } : { type: 'idle' };
      }
    }
    if (u.order.type === 'idle' && u.minion) {
      const m = u.minion;
      const wp = m.path[Math.min(m.wp, m.path.length - 1)];
      if (Math.hypot(wp.x - u.x, wp.z - u.z) < 3 && m.wp < m.path.length - 1) m.wp++;
      const target = m.wp >= m.path.length - 1 ? FORTRESS[(u.team === 0 ? 1 : 0) as Team] : m.path[m.wp];
      this.moveToward(u, target, DT);
    }
  }

  private campAI(u: Unit) {
    const c = u.camp!;
    const dHome = Math.hypot(u.x - c.home.x, u.z - c.home.z);
    if (c.leashing) {
      u.hp = Math.min(u.stats.maxHp, u.hp + u.stats.maxHp * 0.2 * DT);
      if (this.moveToward(u, c.home, DT) || dHome < 1) { c.leashing = false; u.order = { type: 'idle' }; u.hp = u.stats.maxHp; }
      return;
    }
    if (u.order.type === 'attack') {
      const t = this.units.get(u.order.id);
      if (!t || t.dead || dHome > 14 || Math.hypot(t.x - c.home.x, t.z - c.home.z) > 16) {
        const other = this.nearestEnemy(u, 6, (o) => o.kind === 'hero' || o.kind === 'summon');
        if (other && dHome < 10) u.order = { type: 'attack', id: other.id };
        else { c.leashing = true; u.order = { type: 'idle' }; u.windup = null; }
      } else if (u.vis.startsWith('c:colossus') && this.time >= c.slamAt) {
        c.slamAt = this.time + 7;
        this.emit({ e: 'vfx', style: 'earth', color: '#d9c27a', x: u.x, z: u.z, r: 6, delay: 1 });
        this.emit({ e: 'cast', id: u.id, anim: '2H_Melee_Attack_Spin' });
        this.schedule(1, () => {
          if (u.dead) return;
          for (const o of this.unitsNear({ x: u.x, z: u.z }, 6, (o) => o.team !== NEUTRAL)) {
            this.dealDamage(u, o, 160 + this.time * 0.15, 'physical');
            this.applyStatus(u, o, 'knockup', 0.75);
          }
        });
      }
    }
  }

  private summonAI(u: Unit) {
    const owner = this.units.get(u.summon!.owner);
    if (this.time >= u.aiAt) {
      u.aiAt = this.time + 0.3;
      let t: Unit | null = null;
      if (owner && owner.order.type === 'attack') {
        const ot = this.units.get(owner.order.id);
        if (ot && !ot.dead) t = ot;
      }
      t ??= this.nearestEnemy(u, 8, (o) => !this.isStructure(o)) ?? this.nearestEnemy(u, 8);
      if (owner && !owner.dead && Math.hypot(owner.x - u.x, owner.z - u.z) > 14) t = null;
      u.order = t ? { type: 'attack', id: t.id } : owner && !owner.dead && Math.hypot(owner.x - u.x, owner.z - u.z) > 4
        ? { type: 'move', x: owner.x + (this.random() - 0.5) * 3, z: owner.z + (this.random() - 0.5) * 3 } : { type: 'idle' };
    }
  }

  spawnSummon(owner: Unit, kind: keyof typeof SUMMONS, at: Vec2, duration: number): Unit {
    const t = SUMMONS[kind];
    const lvl = owner.hero?.level ?? 1;
    const u = this.spawnFromTemplate('summon', owner.team, t, `s:${kind}`, at, 1);
    u.baseStats.maxHp *= 1 + 0.09 * (lvl - 1);
    u.baseStats.attackDamage = u.baseStats.attackDamage * (1 + 0.07 * (lvl - 1)) + owner.stats.abilityPower * 0.15;
    this.recompute(u);
    u.hp = u.stats.maxHp;
    u.summon = { owner: owner.id, until: this.time + duration };
    u.facing = owner.facing;
    return u;
  }

  // ------------------------------------------------------------------ movement
  /** Returns true when the destination is reached. */
  moveToward(u: Unit, goal: Vec2, dt: number, stopAt = 0.15): boolean {
    if (this.has(u, 'root')) return false;
    const d = Math.hypot(goal.x - u.x, goal.z - u.z);
    if (d <= stopAt) { u.path = []; return true; }
    const needPath = !u.pathGoal || Math.hypot(u.pathGoal.x - goal.x, u.pathGoal.z - goal.z) > 1.5 || this.time >= u.repathAt;
    if (needPath) {
      u.pathGoal = { ...goal };
      u.repathAt = this.time + (u.kind === 'hero' ? 0.5 : 1);
      u.path = this.nav.lineOfSight(u, goal) ? [goal] : this.nav.findPath(u, goal, u.kind === 'hero' ? 6000 : 1500);
    }
    let next = u.path[0] ?? goal;
    while (u.path.length > 1 && Math.hypot(next.x - u.x, next.z - u.z) < 0.4) { u.path.shift(); next = u.path[0]; }
    const remaining = Math.hypot(next.x - u.x, next.z - u.z);
    const step = Math.min(u.stats.moveSpeed * dt, u.path.length <= 1 ? Math.max(0, d - stopAt + 0.05) : remaining);
    if (remaining < 1e-4) { u.path.shift(); return u.path.length === 0 && d <= stopAt + 0.3; }
    const dir = { x: (next.x - u.x) / remaining, z: (next.z - u.z) / remaining };
    u.facing = angleOf(dir);
    this.moveBy(u, dir.x * step, dir.z * step);
    u.moving = true;
    return false;
  }

  private moveDir(u: Unit, dir: Vec2, dt: number) {
    u.facing = angleOf(dir);
    const s = u.stats.moveSpeed * dt;
    this.moveBy(u, dir.x * s, dir.z * s);
    u.moving = true;
  }

  /** Moves with sliding against blocked cells. */
  moveBy(u: Unit, dx: number, dz: number) {
    const nx = clamp(u.x + dx, MAP.minX + 1, MAP.maxX - 1), nz = clamp(u.z + dz, MAP.minZ + 1, MAP.maxZ - 1);
    if (!this.nav.blockedAt({ x: nx, z: nz })) { u.x = nx; u.z = nz; return; }
    if (!this.nav.blockedAt({ x: nx, z: u.z })) { u.x = nx; return; }
    if (!this.nav.blockedAt({ x: u.x, z: nz })) { u.z = nz; return; }
    if (this.nav.blockedAt(u)) { const p = this.nav.nearestOpen(u); u.x = p.x; u.z = p.z; }
  }

  private updateDash(u: Unit, dt: number) {
    const d = u.dash!;
    const dx = d.tx - u.x, dz = d.tz - u.z;
    const l = Math.hypot(dx, dz);
    const step = d.speed * dt;
    const px = u.x, pz = u.z;
    if (l <= step) { u.x = d.tx; u.z = d.tz; }
    else this.moveBy(u, (dx / l) * step, (dz / l) * step);
    u.facing = angleOf({ x: dx, z: dz });
    u.moving = true;
    let stopped = Math.hypot(u.x - px, u.z - pz) < step * 0.2 || l <= step;
    if (d.effects.length || d.stopOnHit) {
      for (const o of this.unitsNear(u, d.width, (o) => this.matches(u, o, d.affects) && !d.hit.has(o.id) && o.id !== u.id)) {
        if (distToSegment(o, { x: px, z: pz }, u) > d.width + o.radius) continue;
        d.hit.add(o.id);
        runEffects(this, d.effects, { ...d.ctx, target: o, origin: { x: u.x, z: u.z } });
        if (d.stopOnHit) { stopped = true; break; }
      }
    }
    if (stopped) {
      u.dash = null;
      runEffects(this, d.onArrive, { ...d.ctx, target: u, point: { x: u.x, z: u.z }, origin: { x: u.x, z: u.z } });
    }
  }

  private separate() {
    const list = [...this.units.values()].filter((u) => !u.dead && !this.isStructure(u) && !u.dash);
    for (let i = 0; i < list.length; i++) {
      const a = list[i];
      for (let j = i + 1; j < list.length; j++) {
        const b = list[j];
        const dx = b.x - a.x, dz = b.z - a.z;
        const min = (a.radius + b.radius) * 0.85;
        if (Math.abs(dx) > min || Math.abs(dz) > min) continue;
        const d = Math.hypot(dx, dz);
        if (d >= min || d < 1e-5) continue;
        const push = (min - d) * 0.5;
        const nx = dx / d, nz = dz / d;
        const wa = a.kind === 'hero' && b.kind !== 'hero' ? 0.3 : 1, wb = b.kind === 'hero' && a.kind !== 'hero' ? 0.3 : 1;
        this.moveBy(a, -nx * push * wa, -nz * push * wa);
        this.moveBy(b, nx * push * wb, nz * push * wb);
      }
    }
  }

  // ------------------------------------------------------------------ projectiles & zones
  spawnProjectile(p: Omit<Projectile, 'id' | 'dead' | 'hit' | 'traveled' | 'returning'>) {
    this.projectiles.push({ ...p, id: this.nextId++, dead: false, hit: new Set(), traveled: 0, returning: false });
  }

  private updateProjectiles(dt: number) {
    for (const p of this.projectiles) {
      if (p.dead) continue;
      const owner = this.units.get(p.owner);
      if (p.homing) {
        const t = this.units.get(p.homing);
        if (!t || t.dead) { p.dead = true; continue; }
        const dx = t.x - p.x, dz = t.z - p.z;
        const l = Math.hypot(dx, dz);
        const step = p.speed * dt;
        if (l <= step + t.radius) {
          p.dead = true;
          if (p.attack) { if (owner && !owner.dead || owner?.tower) owner && this.basicHit(owner, t); }
          else if (p.ctx) runEffects(this, p.effects, { ...p.ctx, target: t, origin: { x: p.x, z: p.z } });
          continue;
        }
        p.dir = { x: dx / l, z: dz / l };
        p.x += p.dir.x * step; p.z += p.dir.z * step;
        continue;
      }
      let dir = p.dir;
      if (p.returning) {
        if (!owner || owner.dead) { p.dead = true; continue; }
        const dx = owner.x - p.x, dz = owner.z - p.z;
        const l = Math.hypot(dx, dz);
        if (l < 1) { p.dead = true; continue; }
        dir = { x: dx / l, z: dz / l };
        p.dir = dir;
      }
      const step = p.speed * dt;
      const ox = p.x, oz = p.z;
      p.x += dir.x * step; p.z += dir.z * step;
      p.traveled += step;
      if (p.ctx) {
        for (const o of this.unitsNear(p, p.width + 1.5, (o) => !p.hit.has(o.id) && this.matches(p.ctx!.caster, o, p.affects) && (!this.isStructure(o) || p.affects === 'enemies'))) {
          if (distToSegment(o, { x: ox, z: oz }, p) > p.width + o.radius) continue;
          if (this.isStructure(o) && !p.pierce) continue; // skillshots fly past towers
          p.hit.add(o.id);
          runEffects(this, p.effects, { ...p.ctx, target: o, origin: { x: p.x, z: p.z }, point: { x: p.x, z: p.z } });
          if (!p.pierce) { p.dead = true; break; }
        }
      }
      if (p.dead) {
        if (p.onEnd.length && p.ctx) runEffects(this, p.onEnd, { ...p.ctx, target: p.ctx.caster, point: { x: p.x, z: p.z }, origin: { x: p.x, z: p.z } });
        continue;
      }
      const reachedPoint = p.toPoint && Math.hypot(p.toPoint.x - p.x, p.toPoint.z - p.z) <= step;
      if (!p.returning && (p.traveled >= p.range || reachedPoint || p.x < MAP.minX || p.x > MAP.maxX || p.z < MAP.minZ || p.z > MAP.maxZ)) {
        if (p.onEnd.length && p.ctx) runEffects(this, p.onEnd, { ...p.ctx, target: p.ctx.caster, point: { x: p.x, z: p.z }, origin: { x: p.x, z: p.z } });
        if (p.returns) { p.returning = true; p.hit.clear(); }
        else p.dead = true;
      }
    }
    for (let i = this.projectiles.length - 1; i >= 0; i--) if (this.projectiles[i].dead) this.projectiles.splice(i, 1);
  }

  addZone(z: Omit<Zone, 'id'>) { this.zones.push({ ...z, id: this.nextId++ }); }

  private updateZones() {
    for (const z of this.zones) {
      if (z.follow) {
        const f = this.units.get(z.follow);
        if (f && !f.dead) { z.x = f.x; z.z = f.z; } else z.until = 0;
      }
      if (this.time >= z.nextTick && this.time < z.until) {
        z.nextTick = this.time + z.interval;
        for (const o of this.unitsNear(z, z.radius, (o) => this.matches(z.ctx.caster, o, z.affects) && !this.isStructure(o)))
          runEffects(this, z.effects, { ...z.ctx, target: o, origin: { x: z.x, z: z.z }, point: { x: z.x, z: z.z } });
      }
    }
    for (let i = this.zones.length - 1; i >= 0; i--) if (this.time >= this.zones[i].until) this.zones.splice(i, 1);
  }

  // ------------------------------------------------------------------ banners
  bannerLocked(b: Banner): boolean {
    if (b.owner !== b.homeTeam) return false; // recapturing your own banner is always allowed
    if (b.key === 'keep') return !this.banners.some((o) => o.homeTeam === b.homeTeam && o.key !== 'keep' && o.owner !== b.homeTeam);
    const key = b.lane === 0 ? 'outer-n' : 'outer-s';
    return [...this.units.values()].some((u) => u.tower?.key === key && u.team === b.homeTeam && !u.dead);
  }

  private updateBanners(dt: number) {
    for (const b of this.banners) {
      const heroes = this.unitsNear(b, BANNER_RADIUS, (u) => u.kind === 'hero');
      const holders = heroes.filter((u) => u.team === b.owner).length;
      const attackers = heroes.filter((u) => u.team !== b.owner);
      const locked = this.bannerLocked(b);
      if (attackers.length && !holders && !locked) {
        const team = attackers[0].team;
        if (b.capTeam !== team) { b.capTeam = team; b.progress = 0; }
        b.progress += (dt / TIMING.bannerCaptureTime) * (1 + 0.25 * (attackers.length - 1));
        if (b.progress >= 1) {
          b.owner = team;
          b.progress = 0;
          b.capTeam = -1;
          const back = team === b.homeTeam;
          this.emit({ e: 'banner', team: team as Team, key: b.key, by: attackers[0].id });
          this.emit({ e: 'msg', text: back ? `${team === 0 ? 'Dawnguard' : 'Duskborn'} reclaimed their ${b.name}!` : `${team === 0 ? 'Dawnguard' : 'Duskborn'} captured the enemy ${b.name}!`, color: team === 0 ? '#7cb8ff' : '#ff8a8d' });
          for (const h of this.units.values()) if (h.hero && h.team === team) this.giveGold(h, back ? ECON.bannerCapture / 2 : ECON.bannerCapture);
        }
      } else if (!attackers.length) {
        b.progress = Math.max(0, b.progress - (dt / TIMING.bannerCaptureTime) * 0.5);
        if (b.progress === 0) b.capTeam = -1;
      }
    }
  }

  // ------------------------------------------------------------------ snapshots
  private unitSnap(u: Unit, viewer: number): UnitSnap {
    let f = 0;
    if (u.dead) f |= F.dead;
    if (u.moving) f |= F.moving;
    if (this.has(u, 'stun')) f |= F.stunned;
    if (this.has(u, 'knockup') || u.displaced) f |= F.airborne;
    if (this.has(u, 'stealth')) f |= F.stealth;
    if (u.cast) f |= F.casting;
    if (this.has(u, 'slow')) f |= F.slowed;
    if (this.has(u, 'root')) f |= F.rooted;
    if (this.has(u, 'silence')) f |= F.silenced;
    if (this.has(u, 'invulnerable')) f |= F.invulnerable;
    if (this.has(u, 'unstoppable')) f |= F.immune;
    if (u.dash) f |= F.dashing;
    if (u.hero?.recallUntil) f |= F.recalling;
    if (u.empowered && u.empowered.until > this.time) f |= F.empowered;
    const sh = u.shields.reduce((a, s) => a + (s.until > this.time ? s.amount : 0), 0);
    const r = (n: number) => Math.round(n * 100) / 100;
    void viewer;
    return [u.id, u.vis, u.team, r(u.x), r(u.z), Math.round(u.facing * 100) / 100, Math.ceil(u.hp), Math.round(u.stats.maxHp), Math.round(sh), f, u.hero?.level ?? u.tower?.level ?? 0];
  }

  /** Builds the snapshot for one viewer and clears nothing; call flushEvents() once per tick after all snapshots. */
  snapshot(pid: string | null, team: number): Snapshot {
    const units: UnitSnap[] = [];
    for (const u of this.units.values()) if (team < 0 || this.visibleTo(team, u) || (u.dead && u.kind === 'hero')) {
      if (u.dead && u.kind === 'hero' && u.team !== team && team >= 0) continue;
      units.push(this.unitSnap(u, team));
    }
    const projs = this.projectiles.filter((p) => team < 0 || p.team === team || this.pointVisible(team, p.x, p.z))
      .map((p) => [p.id, Math.round(p.x * 10) / 10, Math.round(p.z * 10) / 10, p.visual.style, p.visual.color, p.visual.size ?? 1] as Snapshot['projs'][number]);
    const zones = this.zones.filter((z) => team < 0 || z.team === team || this.pointVisible(team, z.x, z.z))
      .map((z) => [z.id, Math.round(z.x * 10) / 10, Math.round(z.z * 10) / 10, z.radius, z.vfx.style, z.vfx.color, z.team, Math.max(0, z.until - this.time)] as Snapshot['zones'][number]);
    const banners = this.banners.map((b) => [b.homeTeam, b.key, b.owner, Math.round(b.progress * 100) / 100, b.capTeam, this.bannerLocked(b) ? 1 : 0] as Snapshot['banners'][number]);
    const pads = this.pads.map((p) => [p.index, p.team, p.kind, p.level, p.unitId] as Snapshot['pads'][number]);
    const teamSnap = (t: Team) => ({
      kills: this.teams[t].kills, upgrades: { ...this.teams[t].upgrades },
      banners: this.banners.filter((b) => b.homeTeam === t && b.owner === t).length,
      towers: [...this.units.values()].filter((u) => u.kind === 'tower' && u.team === t && !u.dead && u.tower?.pad === -1).length,
    });
    const board: HeroBoard[] = [];
    for (const u of this.units.values()) if (u.hero) {
      const h = u.hero;
      board.push({ id: u.id, pid: h.pid, name: h.pname, hero: h.def.id, team: u.team as Team, lvl: h.level, k: h.kills, d: h.deaths, a: h.assists, cs: h.cs, respawn: u.dead ? Math.max(0, h.respawnAt - this.time) : 0, items: [...h.items], bot: h.bot, gold: u.team === team ? Math.floor(h.gold) : -1 });
    }
    const events = this.events.filter((e) => {
      if (team < 0) return true;
      if (e._pid !== undefined) return e._pid === pid;
      if (e._team !== undefined) return e._team === team;
      if ('id' in e && typeof e.id === 'number') {
        const u = this.units.get(e.id);
        return !u || this.visibleTo(team, u) || e.e === 'death';
      }
      if (e.e === 'vfx') return this.pointVisible(team, e.x, e.z) || this.pointVisible(team, e.x + (e.dx ?? 0) * e.r, e.z + (e.dz ?? 0) * e.r);
      return true;
    }).map((e) => { const { _team, _pid, _x, _z, ...rest } = e; void _team; void _pid; void _x; void _z; return rest as GameEvent; });
    const sight = team >= 0 ? this.sightSources(team).flatMap((s) => [Math.round(s[0]), Math.round(s[1]), s[2]]) : [];
    const snap: Snapshot = {
      tick: this.tick, time: Math.round(this.time * 100) / 100, night: this.night, phaseLeft: Math.max(0, this.phaseEndsAt - this.time),
      units, projs, zones, banners, pads, teams: [teamSnap(0), teamSnap(1)], board, events, sight,
    };
    if (this.winner !== null) snap.winner = this.winner;
    const me = pid ? this.heroOf(pid) : undefined;
    if (me?.hero) snap.me = this.meSnap(me);
    return snap;
  }

  private meSnap(u: Unit): MeSnap {
    const h = u.hero!;
    const s: Record<string, number> = {};
    for (const k of STAT_KEYS) s[k] = Math.round(u.stats[k] * 100) / 100;
    return {
      unit: u.id, gold: Math.floor(h.gold), xp: Math.floor(h.xp), xpPrev: XP_TABLE[h.level - 1] ?? 0, xpNext: XP_TABLE[h.level] ?? XP_TABLE[XP_TABLE.length - 1], level: h.level,
      cd: h.cd.map((c) => Math.round(c * 10) / 10), cdMax: h.cdMax.map((c) => Math.round(c * 10) / 10), ranks: [0, 1, 2, 3].map((i) => this.rank(u, i)),
      mana: Math.floor(u.mana), maxMana: Math.round(u.stats.maxMana), items: [...h.items], itemCd: h.itemCd.map((c) => Math.round(c * 10) / 10), stats: s,
      respawn: u.dead ? Math.max(0, h.respawnAt - this.time) : 0, canShop: this.canShop(u),
      recall: h.recallUntil ? 1 - (h.recallUntil - this.time) / TIMING.recallTime : 0,
      buffs: u.buffs.filter((b) => b.name).map((b) => [b.name!, b.icon ?? '✨', Math.round(b.until - this.time)]),
    };
  }

  flushEvents() { this.events = []; }

  // exposed for effects/bots
  newId() { return this.nextId++; }
  itemDef(id: string): ItemDef | undefined { return ITEM_BY_ID[id]; }
}
