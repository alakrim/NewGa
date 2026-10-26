import * as THREE from 'three';
import type { GameEvent, GameInit, FlPlayerSnap, Snapshot, UnitSnap } from '../../shared/protocol';
import { F } from '../../shared/protocol';
import type { Team } from '../../shared/types';
import { HERO_BY_ID } from '../../shared/data/heroes';
import { TEAM_COLORS, TEAM_NAMES } from '../../shared/constants';
import {
  CASTLE, FL, FL_BANNERS, FL_BUILDINGS, FL_BUILDING_ORDER, FL_NODES, FL_PLOTS, FL_RESEARCH, FL_UNIT_ORDER, FL_UNITS, PLAYER_HEX, STANCES,
  type FlBuildingId, type FlResearch, type FlUnitId, type Stance,
} from '../../shared/frontline/data';
import type { Session, ChatLine } from '../net';
import type { World } from '../render/world';
import { esc, h, overlay, toast, ui } from './dom';
import type { GameHud } from './hud-api';
import { portrait } from './portraits';
import { downloadReplay, ReplaySession } from '../replay';

const fmtTime = (t: number) => `${Math.floor(t / 60)}:${String(Math.floor(t % 60)).padStart(2, '0')}`;
/** Frontline ability keys, in ability-slot order (slots Q W E R). */
export const FL_ABILITY_KEYS = ['Q', 'E', 'R', 'F'] as const;
const STANCE_ORDER: Stance[] = ['garrison', 'defend', 'hold', 'attack'];
const BANNER_NAMES: Record<string, string> = { west: 'Dawn Outpost', heart: 'Heart Banner', east: 'Dusk Outpost' };
const MINI_Z0 = -12.5, MINI_Z1 = 14;
const q5 = (f: number) => Math.round(f * 20) * 5; // progress in 5% steps, so panels re-render rarely
const TRAINER_BUILDING: Record<string, FlBuildingId> = { barracks: 'barracks', archery: 'archery', sanctum: 'sanctum', giantpit: 'giantpit' };

interface MyPlot { index: number; no: number; st: [number, string, FlBuildingId | '', number, number] }

/** The Frontline HUD: economy, army, stances, hero, build panel, lane minimap. */
export class FrontHud implements GameHud {
  snap: Snapshot | null = null;
  private root = h('div');
  private top = h('div', { class: 'fl-top panel' });
  private dock = h('div', { class: 'fl-dock' });
  private army = h('div', { class: 'fl-army panel' });
  private heroPanel = h('div', { class: 'fl-hero panel' });
  private right = h('div', { class: 'fl-right' });
  private ally = h('div', { class: 'fl-ally panel hidden' });
  private mini = h('div', { class: 'fl-mini panel' });
  private miniCanvas = document.createElement('canvas');
  private miniBg: HTMLCanvasElement;
  private miniFog = document.createElement('canvas');
  private feed = h('div', { class: 'feed fl-feed' });
  private chatBox = h('div', { class: 'chat fl-chat' });
  private chatInput: HTMLInputElement | null = null;
  private tooltip = h('div', { class: 'tooltip panel hidden' });
  private death = h('div', { class: 'fl-death hidden' });
  private rally = h('div', { class: 'rally hidden' }, '🚩<span>Rally</span>');
  private modal: HTMLElement | null = null;
  private modalKind: '' | 'build' | 'board' = '';
  private modalHtml = '';
  private endScreen: HTMLElement | null = null;
  private replayBar: HTMLElement | null = null;
  private nameplates = new Map<number, HTMLElement>();
  private spectator: boolean;
  private myTeam: Team;
  private heroId: string;
  private isHost = false;
  private selPlot: number | null = null;
  private tipFn: (() => string) | null = null;
  private tipEl: HTMLElement | null = null;
  private keepCache: { hp: number; max: number }[] = [{ hp: CASTLE.hp, max: CASTLE.hp }, { hp: CASTLE.hp, max: CASTLE.hp }];
  private unitEls = new Map<FlUnitId, HTMLElement>();
  private stanceEls = new Map<Stance, HTMLElement>();
  private heroColors = new Map<number, string>();
  /** The rally point is being placed: the next click on the battlefield (or minimap) sets it. */
  pickingRally = false;
  private mine: FlPlayerSnap | undefined;
  private myPlots: MyPlot[] = [];
  private built = new Map<FlBuildingId, { done: number; total: number }>();
  onLeave: () => void = () => {};
  onReplay: () => void = () => {};
  onWatchReplay: (() => void) | null = null;
  onMinimap: (x: number, z: number, button: number) => void = () => {};

  constructor(private init: GameInit, private session: Session, private world: World) {
    const me = init.players.find((p) => p.playerId === init.you);
    this.spectator = !me;
    this.myTeam = me?.team ?? 0;
    this.heroId = me?.heroId ?? '';
    this.miniCanvas.width = 720; this.miniCanvas.height = 150;
    this.miniFog.width = this.miniCanvas.width; this.miniFog.height = this.miniCanvas.height;
    this.miniBg = this.drawMiniBg();
    this.mini.appendChild(this.miniCanvas);
    this.buildArmy();
    this.right.append(this.ally, this.mini);
    if (this.spectator) this.dock.classList.add('spectator');
    else this.dock.append(this.army, this.heroPanel);
    this.dock.append(this.right);
    this.root.append(this.top, this.dock, this.feed, this.chatBox, this.death, this.tooltip);
    const help = h('div', { class: 'helpbox panel fl-help' }, `<b class="gold">Controls</b> <span class="muted">(F1 to hide)</span><br>
      <kbd>W A S D</kbd> / arrows move your hero<br><kbd>Right-click</kbd> move / attack · <kbd>Left-click</kbd> an enemy to attack<br>
      <kbd>Q E R F</kbd> abilities (hold to aim, release to cast)<br><kbd>1-8</kbd> train (<kbd>Shift</kbd> x5, right-click a button to cancel)<br>
      <kbd>B</kbd> build panel · <kbd>Z</kbd> garrison · <kbd>X</kbd> defend<br><kbd>C</kbd> hold line at cursor · <kbd>V</kbd> attack<br>
      <kbd>Space</kbd> centre · <kbd>Y</kbd> camera lock · <kbd>Tab</kbd> scores<br><kbd>Enter</kbd> chat · <kbd>M</kbd> mute · wheel zoom`);
    help.id = 'helpbox';
    if (this.spectator) help.classList.add('hidden');
    this.root.appendChild(help);
    ui().appendChild(this.root);
    overlay().appendChild(this.rally);
    this.miniCanvas.onmousedown = (ev) => this.minimapClick(ev);
    this.miniCanvas.oncontextmenu = (ev) => ev.preventDefault();
    session.onChat = (c) => this.chatLine(c);
  }

  destroy() { this.root.remove(); overlay().innerHTML = ''; }

  // ------------------------------------------------------------------ static army bar
  private buildArmy() {
    this.army.innerHTML = `<div class="fl-econ">
        <span class="fl-gold" title="Your gold">🪙 <b data-e="gold">0</b></span>
        <span class="fl-inc" data-e="inc" title="Gold per second: passive income, Markets and the lane banners you hold"></span>
        <span class="fl-pop" data-e="pop" title="Population used / cap. Build Houses to raise the cap."></span>
        <span class="fl-gar hidden" data-e="gar" title="Units hiding in your keep"></span>
        <span class="spacer"></span>
        <button class="btn small" data-a="build" title="Build and research (B)">🏗️ Build <kbd>B</kbd></button>
      </div>
      <div class="fl-units">${FL_UNIT_ORDER.map((id, i) => `<button class="fl-unit" data-u="${id}"><span class="ic">${FL_UNITS[id].icon}</span><span class="k">${i + 1}</span>
        <span class="n" data-f="n"></span><span class="c" data-f="c">${FL_UNITS[id].cost}</span><span class="qb hidden" data-f="q"></span><i class="prog" data-f="p"></i></button>`).join('')}</div>
      <div class="fl-stances">${STANCE_ORDER.map((st) => `<button class="fl-stance" data-st="${st}"><span class="ic">${STANCES[st].icon}</span><span class="nm">${STANCES[st].name}</span><kbd>${STANCES[st].key}</kbd></button>`).join('')}</div>`;
    this.army.querySelectorAll<HTMLElement>('[data-u]').forEach((b) => {
      const id = b.dataset.u as FlUnitId;
      this.unitEls.set(id, b);
      b.onclick = (ev) => this.train(id, ev.shiftKey ? 5 : 1);
      b.oncontextmenu = (ev) => { ev.preventDefault(); this.session.send({ c: 'cancelTrain', unit: id }); };
      b.onmouseenter = () => this.setTip(b, () => this.unitTip(id));
      b.onmouseleave = () => this.clearTip();
    });
    this.army.querySelectorAll<HTMLElement>('[data-st]').forEach((b) => {
      const st = b.dataset.st as Stance;
      this.stanceEls.set(st, b);
      b.onclick = () => { if (st === 'hold') this.beginRally(); else this.setStance(st); };
      b.onmouseenter = () => this.setTip(b, () => `<b>${STANCES[st].icon} ${STANCES[st].name}</b> <span class="muted">[${STANCES[st].key}]</span><br>${esc(STANCES[st].text)}${st === 'hold' ? '<br><span class="gold">Click, then click the battlefield (or minimap) to place the rally point. Pressing C places it at your cursor.</span>' : ''}`);
      b.onmouseleave = () => this.clearTip();
    });
    this.army.querySelector<HTMLButtonElement>('[data-a="build"]')!.onclick = () => this.toggle('build');
  }

  // ------------------------------------------------------------------ player actions (called by hotkeys and buttons)
  /** Train `count` of a unit. Explains why when it cannot be done. */
  train(id: FlUnitId, count = 1) {
    if (this.spectator || !this.fl) return;
    const st = this.unitStatus(id);
    if (!st.ok) { toast(st.reason, '#ffb36b'); return; }
    this.session.send({ c: 'train', unit: id, count });
  }
  trainByIndex(i: number, count = 1) { const id = FL_UNIT_ORDER[i]; if (id) this.train(id, count); }

  setStance(stance: Stance, x?: number) {
    if (this.spectator) return;
    this.pickingRally = false;
    this.session.send({ c: 'stance', stance, ...(x !== undefined ? { x } : {}) });
  }
  /** Hold line with the rally point at world x. */
  setRally(x: number) { this.setStance('hold', Math.round(x)); toast('Rally point set', PLAYER_HEX[this.mine?.color ?? 'blue']); }
  beginRally() {
    if (this.spectator) return;
    this.pickingRally = true;
    toast('Click the battlefield or minimap to place the rally point (Esc cancels)');
  }
  cancelRally() { this.pickingRally = false; }

  private get fl() { return this.snap?.fl; }

  // ------------------------------------------------------------------ snapshot-driven UI
  update(s: Snapshot) {
    this.snap = s;
    const fl = s.fl;
    if (fl) {
      this.mine = fl.players.find((p) => p.pid === this.init.you);
      this.heroColors.clear();
      for (const p of fl.players) this.heroColors.set(p.hero, PLAYER_HEX[p.color]);
      this.myPlots = [];
      this.built.clear();
      if (this.mine) {
        let no = 0;
        for (const spot of FL_PLOTS.filter((p) => p.team === this.mine!.team && p.slot === this.mine!.slot)) {
          const st = fl.plots[spot.index];
          this.myPlots.push({ index: spot.index, no: ++no, st });
          if (st[2]) { const b = this.built.get(st[2]) ?? { done: 0, total: 0 }; b.total++; if (st[3] >= 1) b.done++; this.built.set(st[2], b); }
        }
      }
    }
    this.renderReplayBar();
    this.renderTop(s);
    if (!this.spectator && fl && this.mine) { this.renderArmy(s); this.renderHero(s); this.renderAlly(s); }
    for (const e of s.events) this.event(e);
    if (this.modalKind) this.refreshModal();
    if (this.tipFn && this.tipEl) this.showTip(this.tipEl, this.tipFn());
    if (s.winner !== undefined && !this.endScreen) this.showEnd(s);
  }

  private renderReplayBar() {
    const rs = this.session instanceof ReplaySession ? this.session : null;
    if (!rs) return;
    if (!this.replayBar) {
      this.replayBar = h('div', { class: 'panel replay-bar' });
      this.root.appendChild(this.replayBar);
      this.replayBar.onclick = (ev) => {
        const b = (ev.target as HTMLElement).closest<HTMLButtonElement>('[data-sp]');
        if (!b) return;
        if (b.dataset.sp === 'pause') rs.paused = !rs.paused; else rs.speed = Number(b.dataset.sp);
        this.replayBar!.dataset.h = '';
      };
      this.right.style.marginBottom = '56px';
    }
    const html = `<b class="gold">🎬 Replay</b><div class="bar" style="width:260px"><div class="fill" style="width:${Math.round(rs.progress * 100)}%;background:var(--gold)"></div></div>
      <button class="btn small" data-sp="pause">${rs.paused ? '▶️' : '⏸️'}</button>${[1, 2, 4, 8].map((n) => `<button class="btn small ${rs.speed === n ? 'primary' : ''}" data-sp="${n}">${n}x</button>`).join('')}
      <button class="btn small" id="rp-exit">Exit</button>`;
    if (this.replayBar.dataset.h !== html) {
      this.replayBar.dataset.h = html;
      this.replayBar.innerHTML = html;
      this.replayBar.querySelector<HTMLButtonElement>('#rp-exit')!.onclick = () => this.onLeave();
    }
  }

  // ---- top bar: keeps, banners, clock, players
  private renderTop(s: Snapshot) {
    const fl = s.fl;
    if (!fl) return;
    for (const t of [0, 1] as Team[]) {
      const u = s.units.find((x) => x[0] === fl.castles[t]);
      if (u) this.keepCache[t] = { hp: u[6], max: u[7] };
    }
    const keep = (t: Team) => {
      const k = this.keepCache[t];
      const pct = Math.max(0, Math.min(100, (k.hp / Math.max(1, k.max)) * 100));
      const low = pct < 30 ? 'low' : '';
      return `<div class="fl-keep t${t}"><span class="kn"><span class="team${t} serif">${t === 0 ? 'Dawnguard Keep' : 'Duskborn Keep'}</span>${this.myTeam === t && !this.spectator ? ' <span class="tag">you</span>' : ''}</span>
        <div class="bar hp ${low}"><div class="fill" style="width:${pct.toFixed(1)}%;background:${TEAM_COLORS[t]}"></div><span>${Math.max(0, Math.ceil(k.hp))} / ${Math.round(k.max)}</span></div></div>`;
    };
    const chips = (t: Team) => fl.players.filter((p) => p.team === t).map((p) => {
      const b = s.board.find((x) => x.pid === p.pid);
      const dead = !!b && b.respawn > 0;
      const me = p.pid === this.init.you;
      return `<span class="fl-chip ${me ? 'me' : ''} ${dead ? 'dead' : ''}" style="--pc:${PLAYER_HEX[p.color]}" title="${esc(p.name)}${b ? ` · ${esc(HERO_BY_ID[b.hero]?.name ?? '')} Lv ${b.lvl}` : ''} · ${STANCES[p.stance].name}${dead ? ` · respawning in ${Math.ceil(b!.respawn)}s` : ''}">
        <i class="dot"></i><span class="pn">${esc(p.name)}</span><span class="st">${dead ? '💀' : STANCES[p.stance].icon}</span>${b ? `<small>${b.lvl}</small>` : ''}</span>`;
    }).join('');
    const banners = fl.banners.map(([key, owner, prog, cap]) => {
      const col = (t: number) => (t < 0 ? '#8b93a7' : TEAM_COLORS[t]);
      const capping = cap >= 0 && prog > 0;
      const bg = capping ? `linear-gradient(to top, ${col(cap)} ${Math.round(prog * 100)}%, ${col(owner)} ${Math.round(prog * 100)}%)` : col(owner);
      const pays = key === 'heart' ? FL.heartGold : FL.bannerGold;
      const spot = FL_BANNERS.find((b) => b.key === key);
      return `<div class="fl-pip ${capping ? 'contested' : ''}" style="background:${bg}" title="${esc(spot?.name ?? BANNER_NAMES[key])}: ${owner < 0 ? 'neutral' : `held by ${TEAM_NAMES[owner as Team]}`}${capping ? ` · being taken by ${TEAM_NAMES[cap as Team]} ${Math.round(prog * 100)}%` : ''}. Pays ${pays} gold/s to every member of the team that holds it."></div>`;
    }).join('');
    const html = `<div class="fl-side left">${keep(0)}<div class="fl-chips">${chips(0)}</div></div>
      <div class="fl-mid"><span class="clock">${fmtTime(s.time)}</span><div class="fl-pips">${banners}</div></div>
      <div class="fl-side right">${keep(1)}<div class="fl-chips">${chips(1)}</div></div>`;
    if (this.top.dataset.h !== html) { this.top.dataset.h = html; this.top.innerHTML = html; }
  }

  // ---- army bar
  private cache = new WeakMap<Element, string>();
  private setText(el: Element | null, v: string) { if (el && this.cache.get(el) !== v) { this.cache.set(el, v); el.textContent = v; } }

  private unitStatus(id: FlUnitId): { ok: boolean; locked: boolean; reason: string } {
    const fl = this.fl, me = this.mine;
    const def = FL_UNITS[id];
    if (!fl || !me) return { ok: false, locked: false, reason: '' };
    const gold = this.snap?.me?.gold ?? me.gold;
    if (def.trainer !== 'castle') {
      const b = this.built.get(TRAINER_BUILDING[def.trainer]);
      const bd = FL_BUILDINGS[TRAINER_BUILDING[def.trainer]];
      if (!b || b.done === 0) return { ok: false, locked: true, reason: b ? `${bd.name} is still under construction` : `Needs a ${bd.name} (build one with B)` };
    }
    if (fl.queue.filter((q) => q.trainer === def.trainer).length >= 5) return { ok: false, locked: false, reason: 'Training queue is full (5)' };
    if (me.pop + def.pop > me.popCap) return { ok: false, locked: false, reason: `Population full (${me.pop}/${me.popCap}): build Houses` };
    if (gold < def.cost) return { ok: false, locked: false, reason: `Need ${def.cost - gold} more gold` };
    return { ok: true, locked: false, reason: '' };
  }

  private renderArmy(s: Snapshot) {
    const fl = s.fl!, me = this.mine!;
    const gold = s.me?.gold ?? me.gold;
    const q = (sel: string) => this.army.querySelector(sel);
    this.setText(q('[data-e="gold"]'), String(gold));
    this.setText(q('[data-e="inc"]'), `+${me.income.toFixed(1)}/s`);
    const pop = q('[data-e="pop"]');
    this.setText(pop, `👥 ${me.pop}/${me.popCap}`);
    pop?.classList.toggle('full', me.pop >= me.popCap);
    const gar = q('[data-e="gar"]');
    this.setText(gar, `🏰 ${me.garrison}`);
    gar?.classList.toggle('hidden', me.garrison === 0);
    for (const id of FL_UNIT_ORDER) {
      const el = this.unitEls.get(id)!;
      const st = this.unitStatus(id);
      const inQ = fl.queue.filter((x) => x.unit === id);
      const head = inQ[0];
      el.classList.toggle('locked', st.locked);
      el.classList.toggle('cant', !st.ok && !st.locked);
      el.classList.toggle('busy', inQ.length > 0);
      const n = me.army[id] ?? 0;
      this.setText(el.querySelector('[data-f="n"]'), n ? String(n) : '');
      const qb = el.querySelector('[data-f="q"]');
      this.setText(qb, inQ.length ? `+${inQ.length}` : '');
      qb?.classList.toggle('hidden', !inQ.length);
      const p = el.querySelector<HTMLElement>('[data-f="p"]')!;
      const w = head ? `${Math.round((1 - head.left / Math.max(0.1, head.total)) * 100)}%` : '0%';
      if (p.style.width !== w) p.style.width = w;
    }
    for (const st of STANCE_ORDER) this.stanceEls.get(st)!.classList.toggle('on', me.stance === st);
    this.stanceEls.get('hold')!.classList.toggle('picking', this.pickingRally);
    this.army.querySelector('[data-a="build"]')!.classList.toggle('primary', this.modalKind === 'build');
  }

  private unitTip(id: FlUnitId): string {
    const d = FL_UNITS[id], st = this.unitStatus(id);
    const idx = FL_UNIT_ORDER.indexOf(id) + 1;
    const from = d.trainer === 'castle' ? 'your keep' : FL_BUILDINGS[TRAINER_BUILDING[d.trainer]].name;
    const s = d.stats;
    return `<b>${d.icon} ${d.name}</b> <span class="muted">[${idx}]</span><br>${esc(d.description)}<br>
      <span class="gold">🪙 ${d.cost}</span> · 👥 ${d.pop} · ⏱ ${d.trainTime}s · from ${esc(from)}<br>
      <span class="muted">❤️ ${s.maxHp} · ⚔️ ${s.attackDamage}${d.splash ? ' (splash)' : ''} · 🛡️ ${s.armor} · 🎯 ${s.attackRange} · 👟 ${s.moveSpeed}</span><br>
      <span class="muted">Click: train 1 · Shift+click: train 5 · Right-click: cancel one</span>${st.reason ? `<br><span style="color:#ffb36b">${esc(st.reason)}</span>` : ''}`;
  }

  // ---- hero panel
  private renderHero(s: Snapshot) {
    const me = s.me;
    if (!me) return;
    const def = HERO_BY_ID[this.heroId];
    const u = s.units.find((x) => x[0] === me.unit);
    const hp = u?.[6] ?? 0, maxHp = u?.[7] ?? 1, sh = u?.[8] ?? 0;
    const xpFrac = me.xpNext > me.xpPrev ? (me.xp - me.xpPrev) / (me.xpNext - me.xpPrev) : 1;
    const ab = def.abilities.map((a, i) => {
      const rank = me.ranks[i], cd = me.cd[i];
      const cost = a.manaCost[Math.max(0, rank - 1)] ?? 0;
      const frac = cd > 0 ? cd / Math.max(0.01, me.cdMax[i]) : 0;
      const cls = rank === 0 ? 'locked' : cd > 0 ? '' : me.mana < cost ? 'nomana' : 'ready';
      return `<div class="ability ${cls}" data-ab="${i}">${a.icon}<span class="key">${FL_ABILITY_KEYS[i]}</span>${cost ? `<span class="cost">${cost}</span>` : ''}
        ${frac > 0 ? `<div class="sweep" style="background:conic-gradient(rgba(0,0,0,.72) ${(frac * 360).toFixed(0)}deg, transparent 0)"></div><div class="cd">${cd >= 1 ? Math.ceil(cd) : cd.toFixed(1)}</div>` : ''}</div>`;
    }).join('');
    if (!this.heroPanel.firstChild) {
      this.heroPanel.innerHTML = `<div class="portrait" data-s="portrait"></div><div class="col" style="gap:6px"><div class="row" style="gap:6px" data-s="abilities"></div><div class="bars" data-s="bars"></div></div>`;
      this.heroPanel.onmouseover = (ev) => {
        const abEl = (ev.target as HTMLElement).closest<HTMLElement>('[data-ab]');
        if (abEl) this.setTip(abEl, () => this.abilityTip(abEl.dataset.ab!));
        else this.clearTip();
      };
      this.heroPanel.onmouseleave = () => this.clearTip();
    }
    const part = (k: string, html: string) => { const el = this.heroPanel.querySelector<HTMLElement>(`[data-s="${k}"]`)!; if (el.dataset.h !== html) { el.innerHTML = html; el.dataset.h = html; } };
    const col = PLAYER_HEX[this.mine!.color];
    this.heroPanel.style.setProperty('--pc', col);
    part('portrait', `<img src="${portrait(this.heroId)}" alt=""><span class="lvl">${me.level}</span><div class="xp" style="width:${Math.round(xpFrac * 100)}%"></div>${me.respawn > 0 ? `<div class="rs">${Math.ceil(me.respawn)}</div>` : ''}`);
    part('abilities', `<div class="ability passive" data-ab="p">${def.passive.icon}</div><div class="abilities">${ab}</div>`);
    const tot = Math.max(maxHp, hp + sh);
    part('bars', `<div class="bar hp"><div class="fill" style="width:${(hp / tot) * 100}%"></div><div class="shield" style="left:${(hp / tot) * 100}%;width:${(sh / tot) * 100}%"></div><span>${hp} / ${maxHp}${sh ? ` (+${sh})` : ''}</span></div>
      <div class="bar mp"><div class="fill" style="width:${(me.mana / Math.max(1, me.maxMana)) * 100}%"></div><span>${me.mana} / ${me.maxMana}</span></div>`);
    this.heroPanel.classList.toggle('dead', me.respawn > 0);
    const html = me.respawn > 0 ? `<div class="t">You have fallen<br><span class="gold">${Math.ceil(me.respawn)}</span></div>` : '';
    if (this.death.dataset.h !== html) { this.death.dataset.h = html; this.death.innerHTML = html; }
    this.death.classList.toggle('hidden', me.respawn <= 0);
  }

  private abilityTip(key: string): string {
    const def = HERO_BY_ID[this.heroId];
    const me = this.snap?.me;
    if (key === 'p') return `<b>${def.passive.icon} ${esc(def.passive.name)}</b> <span class="muted">Passive</span><br>${esc(def.passive.description)}`;
    const i = Number(key), a = def.abilities[i], r = Math.max(1, me?.ranks[i] ?? 1);
    return `<b>${a.icon} ${esc(a.name)}</b> <span class="muted">[${FL_ABILITY_KEYS[i]}] rank ${me?.ranks[i] ?? 0}</span><br>${esc(a.description)}<br>
      <span class="muted">Cooldown ${a.cooldown[r - 1] ?? a.cooldown[0]}s · Mana ${a.manaCost[r - 1] ?? 0} · Range ${a.range}</span>${i === 3 ? '<br><span class="muted">Unlocks at level 4</span>' : ''}<br>
      <span class="muted">Ability damage is reduced against army units.</span>`;
  }

  // ---- teammate panel
  private renderAlly(s: Snapshot) {
    const fl = s.fl!;
    const mates = fl.players.filter((p) => p.team === this.myTeam && p.pid !== this.init.you);
    this.ally.classList.toggle('hidden', mates.length === 0);
    const html = mates.map((p) => {
      const b = s.board.find((x) => x.pid === p.pid);
      const army = FL_UNIT_ORDER.filter((id) => (p.army[id] ?? 0) > 0).map((id) => `<span title="${FL_UNITS[id].name}">${FL_UNITS[id].icon}${p.army[id]}</span>`).join('') || '<span class="muted">no units</span>';
      return `<div class="mate" style="--pc:${PLAYER_HEX[p.color]}"><div class="row" style="gap:8px"><i class="dot"></i><b class="pn">${esc(p.name)}</b>${b?.bot ? '<span class="tag">bot</span>' : ''}
        <span class="st" title="Stance: ${STANCES[p.stance].name}">${STANCES[p.stance].icon} ${STANCES[p.stance].name}</span><span class="spacer"></span>
        <span title="Population">👥 ${p.pop}/${p.popCap}</span><span class="gold" title="Their gold">🪙 ${p.gold}</span></div><div class="armyrow">${army}</div></div>`;
    }).join('');
    if (this.ally.dataset.h !== html) { this.ally.dataset.h = html; this.ally.innerHTML = html; }
  }

  // ------------------------------------------------------------------ tooltip
  private setTip(el: HTMLElement, fn: () => string) { this.tipEl = el; this.tipFn = fn; this.showTip(el, fn()); }
  private clearTip() { this.tipEl = null; this.tipFn = null; this.tooltip.classList.add('hidden'); }
  private showTip(el: HTMLElement, html: string) {
    if (this.tooltip.dataset.h !== html) { this.tooltip.dataset.h = html; this.tooltip.innerHTML = html; }
    this.tooltip.classList.remove('hidden');
    const r = el.getBoundingClientRect();
    this.tooltip.style.left = `${Math.min(window.innerWidth - 336, Math.max(8, r.left))}px`;
    this.tooltip.style.top = `${r.top - 10}px`;
    this.tooltip.style.transform = 'translateY(-100%)';
  }

  // ------------------------------------------------------------------ events
  private event(e: GameEvent) {
    const s = this.snap!;
    const nameOf = (id: number) => {
      const b = s.board.find((x) => x.id === id);
      const p = b && s.fl?.players.find((x) => x.pid === b.pid);
      if (b) return `<span style="color:${p ? PLAYER_HEX[p.color] : 'inherit'}">${esc(b.name)}</span> <span class="muted">(${esc(HERO_BY_ID[b.hero]?.name ?? '')})</span>`;
      const u = s.units.find((x) => x[0] === id);
      return u ? esc(this.init.visuals[u[1]]?.name ?? 'Something') : 'Something';
    };
    const meUnit = s.me?.unit;
    switch (e.e) {
      case 'dmg': this.floater(e.id, `${e.a}`, e.k === 0 ? '#ffb38a' : e.k === 1 ? '#c4a5ff' : '#ffffff', !!e.c, e.s === meUnit || e.id === meUnit); break;
      case 'heal': if (e.a >= 8) this.floater(e.id, `+${e.a}`, '#7cff8a', false, e.id === meUnit); break;
      case 'gold': this.floater(e.id, `+${e.a}`, '#ffd54a', false, !this.spectator, true); break;
      case 'kill': {
        const heroInvolved = s.board.some((b) => b.id === e.killer || b.id === e.victim);
        if (!heroInvolved) break;
        this.feedLine(`⚔️ ${e.killer ? nameOf(e.killer) : 'The keep'} slew ${nameOf(e.victim)}`);
        break;
      }
      case 'struct': this.feedLine(`🏚️ <span class="team${e.team}">${TEAM_NAMES[e.team]}</span> lost ${esc(e.name)}`); break;
      case 'msg': this.feedLine(`<span style="color:${e.color ?? '#e8e6df'}">${esc(e.text)}</span>`); break;
      case 'level': if (e.id === meUnit) this.floater(e.id, `Level ${e.lvl}!`, '#ffd166', true, true); break;
    }
  }

  private floater(id: number, text: string, color: string, big: boolean, mine: boolean, coin = false) {
    const v = this.world.units.get(id);
    if (!v) return;
    if (!mine && Math.random() < 0.7) return; // keep the screen readable
    const p = this.world.screenOf(new THREE.Vector3(v.pos.x, v.height + 0.6, v.pos.z));
    if (!p.visible) return;
    const el = h('div', { class: `floater ${big ? 'crit' : ''} ${coin ? 'coin' : ''}` }, esc(text));
    el.style.left = `${p.x + (Math.random() - 0.5) * (coin ? 10 : 30)}px`;
    el.style.top = `${p.y}px`;
    el.style.color = color;
    overlay().appendChild(el);
    setTimeout(() => el.remove(), 1100);
  }

  private feedLine(html: string) {
    const el = h('div', {}, html);
    this.feed.prepend(el);
    while (this.feed.children.length > 7) this.feed.lastChild!.remove();
    setTimeout(() => el.remove(), 7000);
  }

  private chatLine(c: ChatLine) {
    const el = h('div', { class: 'line' }, `${c.team ? '<span class="muted">[team]</span> ' : ''}<b class="team${c.teamId}">${esc(c.from)}:</b> ${esc(c.text)}`);
    this.chatBox.insertBefore(el, this.chatInput);
    const lines = this.chatBox.querySelectorAll('.line');
    if (lines.length > 8) lines[0].remove();
    setTimeout(() => el.remove(), 12000);
  }

  openChat() {
    if (this.chatInput) { this.chatInput.focus(); return; }
    const inp = h('input', { class: 'field', placeholder: 'Enter to send · start with /t for team chat', maxlength: '200' });
    this.chatBox.appendChild(inp);
    this.chatInput = inp;
    inp.focus();
    inp.onkeydown = (ev) => {
      ev.stopPropagation();
      if (ev.key === 'Enter') {
        const v = inp.value.trim();
        if (v) { const team = v.startsWith('/t '); this.session.chat(team ? v.slice(3) : v, team); }
        this.closeChat();
      } else if (ev.key === 'Escape') this.closeChat();
    };
  }
  private closeChat() { this.chatInput?.remove(); this.chatInput = null; }
  get chatting() { return !!this.chatInput; }

  // ------------------------------------------------------------------ per frame
  frame() {
    const s = this.snap;
    if (!s) return;
    const seen = new Set<number>();
    for (const b of s.board) {
      const v = this.world.units.get(b.id);
      if (!v || v.dead) continue;
      const p = this.world.screenOf(new THREE.Vector3(v.pos.x, v.baseY + v.height + 1.0, v.pos.z));
      if (!p.visible) continue;
      seen.add(b.id);
      let el = this.nameplates.get(b.id);
      if (!el) { el = h('div', { class: 'nameplate' }); overlay().appendChild(el); this.nameplates.set(b.id, el); }
      const col = this.heroColors.get(b.id) ?? TEAM_COLORS[b.team];
      const html = `<span class="lv">${b.lvl}</span><span style="color:${col}">${esc(b.name)}</span>`;
      if (el.innerHTML !== html) el.innerHTML = html;
      el.style.left = `${p.x}px`; el.style.top = `${p.y}px`;
    }
    for (const [id, el] of this.nameplates) if (!seen.has(id)) { el.remove(); this.nameplates.delete(id); }
    // rally flag
    const m = this.mine;
    const showRally = !!m && m.stance === 'hold' && m.rallyX !== 0;
    if (showRally) {
      const p = this.world.screenOf(new THREE.Vector3(m!.rallyX, 0, 0));
      this.rally.style.left = `${p.x}px`; this.rally.style.top = `${p.y}px`;
      this.rally.style.color = PLAYER_HEX[m!.color];
      this.rally.classList.toggle('hidden', !p.visible);
    } else this.rally.classList.add('hidden');
    this.drawMinimap(s);
  }

  // ------------------------------------------------------------------ minimap (one long lane)
  private toMini(x: number, z: number): [number, number] {
    return [((x - FL.minX) / (FL.maxX - FL.minX)) * this.miniCanvas.width, ((z - MINI_Z0) / (MINI_Z1 - MINI_Z0)) * this.miniCanvas.height];
  }
  private drawMiniBg(): HTMLCanvasElement {
    const c = document.createElement('canvas');
    c.width = this.miniCanvas.width; c.height = this.miniCanvas.height;
    const g = c.getContext('2d')!;
    g.fillStyle = '#2a4222'; g.fillRect(0, 0, c.width, c.height);
    const [, y0] = this.toMini(0, FL.laneMinZ), [, y1] = this.toMini(0, FL.laneMaxZ);
    g.fillStyle = '#8f7a4d'; g.fillRect(0, y0, c.width, y1 - y0);
    // team halves of the lane, faintly tinted
    const [mx] = this.toMini(0, 0);
    g.fillStyle = 'rgba(61,139,253,.10)'; g.fillRect(0, 0, mx, c.height);
    g.fillStyle = 'rgba(229,72,77,.10)'; g.fillRect(mx, 0, c.width - mx, c.height);
    g.strokeStyle = 'rgba(255,255,255,.12)'; g.setLineDash([4, 4]); g.beginPath(); g.moveTo(mx, 0); g.lineTo(mx, c.height); g.stroke();
    return c;
  }
  private drawMinimap(s: Snapshot) {
    const g = this.miniCanvas.getContext('2d')!;
    const W = this.miniCanvas.width, H = this.miniCanvas.height;
    g.drawImage(this.miniBg, 0, 0);
    // gold veins
    for (const n of FL_NODES) {
      const [x, y] = this.toMini(n.x, n.z);
      const miners = s.fl?.nodes[n.index] ?? 0;
      const r = n.rich ? 11 : 8;
      g.fillStyle = n.rich ? '#ffb020' : '#f0cf55';
      g.globalAlpha = miners > 0 ? 1 : 0.7;
      g.beginPath(); g.moveTo(x, y - r); g.lineTo(x + r, y); g.lineTo(x, y + r); g.lineTo(x - r, y); g.closePath(); g.fill();
      g.globalAlpha = 1;
      g.strokeStyle = '#3a2a05'; g.lineWidth = 1; g.stroke();
    }
    // banners
    for (const b of s.fl?.banners ?? []) {
      const spot = FL_BANNERS.find((x) => x.key === b[0]);
      if (!spot) continue;
      const [x, y] = this.toMini(spot.x, spot.z);
      g.fillStyle = b[1] < 0 ? '#8b93a7' : TEAM_COLORS[b[1]];
      g.fillRect(x - 7, y - 12, 14, 20);
      g.strokeStyle = '#fff'; g.lineWidth = 2; g.strokeRect(x - 7, y - 12, 14, 20);
      if (b[3] >= 0 && b[2] > 0) { g.fillStyle = TEAM_COLORS[b[3]]; g.fillRect(x - 7, y + 8 - 20 * b[2], 14, 20 * b[2]); }
    }
    // units
    const meUnit = s.me?.unit;
    let mine: UnitSnap | null = null;
    for (const u of s.units) {
      const info = this.init.visuals[u[1]];
      if (!info || (u[9] & F.dead)) continue;
      const [x, y] = this.toMini(u[3], u[4]);
      if (info.kind === 'hero') { if (u[0] === meUnit) mine = u; else this.dot(g, x, y, 10, this.heroColors.get(u[0]) ?? TEAM_COLORS[u[2] as Team], true); continue; }
      if (info.kind === 'tower') {
        const big = info.towerKind === 'fortress';
        const sz = big ? 15 : 8;
        g.fillStyle = TEAM_COLORS[u[2] as Team] ?? '#999';
        g.fillRect(x - sz, y - sz, sz * 2, sz * 2);
        g.strokeStyle = '#000'; g.lineWidth = 1.5; g.strokeRect(x - sz, y - sz, sz * 2, sz * 2);
        continue;
      }
      if (info.kind === 'building') continue;
      const col = info.color ? PLAYER_HEX[info.color] : u[2] === 2 ? '#facc15' : TEAM_COLORS[u[2] as Team] ?? '#bbb';
      const miner = info.name === 'Miner';
      g.fillStyle = col;
      const sz = miner ? 3.5 : 5.5; g.fillRect(x - sz / 2, y - sz / 2, sz, sz); if (!miner) { g.strokeStyle = 'rgba(0,0,0,.6)'; g.lineWidth = 1; g.strokeRect(x - sz / 2, y - sz / 2, sz, sz); }
    }
    if (mine) { const [x, y] = this.toMini(mine[3], mine[4]); this.dot(g, x, y, 10, this.heroColors.get(mine[0]) ?? '#7cff8a', true); g.strokeStyle = '#fff'; g.lineWidth = 2.5; g.beginPath(); g.arc(x, y, 14, 0, Math.PI * 2); g.stroke(); }
    // fog of war
    if (s.sight.length) {
      const f = this.miniFog.getContext('2d')!;
      f.globalCompositeOperation = 'source-over';
      f.clearRect(0, 0, W, H);
      f.fillStyle = 'rgba(5,8,16,0.55)'; f.fillRect(0, 0, W, H);
      f.globalCompositeOperation = 'destination-out';
      const sx = W / (FL.maxX - FL.minX), sy = H / (MINI_Z1 - MINI_Z0);
      for (let i = 0; i + 2 < s.sight.length; i += 3) {
        const [x, y] = this.toMini(s.sight[i], s.sight[i + 1]);
        f.beginPath(); f.ellipse(x, y, s.sight[i + 2] * sx, s.sight[i + 2] * sy, 0, 0, Math.PI * 2); f.fill();
      }
      g.drawImage(this.miniFog, 0, 0);
    }
    // rally flag
    const m = this.mine;
    if (m && m.stance === 'hold' && m.rallyX) {
      const [x] = this.toMini(m.rallyX, 0);
      g.strokeStyle = PLAYER_HEX[m.color]; g.lineWidth = 2; g.setLineDash([5, 4]); g.beginPath(); g.moveTo(x, 0); g.lineTo(x, H); g.stroke(); g.setLineDash([]);
      g.font = '18px serif'; g.fillText('🚩', x - 2, 18);
    }
    // camera span
    const l = this.world.pick(-1, 0), r = this.world.pick(1, 0);
    const c = this.world.camTarget;
    const x0 = l ? l.x : c.x - 22, x1 = r ? r.x : c.x + 22;
    const [px0] = this.toMini(Math.max(FL.minX, x0), 0), [px1] = this.toMini(Math.min(FL.maxX, x1), 0);
    g.strokeStyle = 'rgba(255,255,255,.85)'; g.lineWidth = 2; g.strokeRect(px0, 1, Math.max(4, px1 - px0), H - 2);
  }
  private dot(g: CanvasRenderingContext2D, x: number, y: number, r: number, col: string, ring: boolean) {
    g.fillStyle = col; g.beginPath(); g.arc(x, y, r, 0, Math.PI * 2); g.fill();
    if (ring) { g.strokeStyle = '#000'; g.lineWidth = 1.5; g.stroke(); }
  }
  private minimapClick(ev: MouseEvent) {
    ev.preventDefault();
    const r = this.miniCanvas.getBoundingClientRect();
    const x = FL.minX + ((ev.clientX - r.left) / r.width) * (FL.maxX - FL.minX);
    const z = MINI_Z0 + ((ev.clientY - r.top) / r.height) * (MINI_Z1 - MINI_Z0);
    if (this.pickingRally && ev.button === 0) { this.setRally(x); return; }
    this.onMinimap(x, Math.max(FL.laneMinZ + 1, Math.min(FL.laneMaxZ - 1, z)), ev.button);
  }

  // ------------------------------------------------------------------ modals
  get modalOpen() { return this.modalKind !== ''; }
  toggle(kind: 'build' | 'board') {
    if (this.spectator && kind !== 'board') return;
    if (this.modalKind === kind) { this.closeModal(); return; }
    this.closeModal();
    this.modalKind = kind;
    this.modal = h('div', { class: `modal panel ${kind === 'build' ? 'fl-build' : 'fl-board'}` });
    this.root.appendChild(this.modal);
    // act on mousedown: the panel can be refreshed by a snapshot between mousedown and mouseup
    this.modal.onmousedown = (ev) => { if (ev.button === 0) this.modalClick(ev); };
    this.refreshModal();
  }
  closeModal() { this.modal?.remove(); this.modal = null; this.modalKind = ''; this.modalHtml = ''; this.clearTip(); }

  /** Replaces the panel only when its structure changed; `dyn` values (gold, pop...) are patched in place so clicks never land on a stale node. */
  private setModal(html: string, dyn: Record<string, string> = {}): boolean {
    this.patchModal(dyn);
    if (html === this.modalHtml || !this.modal) return false;
    const body = this.modal.querySelector('.body');
    const scroll = body?.scrollTop ?? 0;
    this.modalHtml = html;
    this.modal.innerHTML = html;
    const nb = this.modal.querySelector('.body');
    if (nb) nb.scrollTop = scroll;
    this.modal.querySelectorAll<HTMLButtonElement>('.close').forEach((b) => b.onclick = () => this.closeModal());
    this.patchModal(dyn);
    return true;
  }
  private patchModal(dyn: Record<string, string>) {
    for (const [k, v] of Object.entries(dyn)) {
      const el = this.modal?.querySelector(`[data-m="${k}"]`);
      if (el && el.textContent !== v) el.textContent = v;
    }
  }

  private refreshModal() {
    if (!this.modal || !this.snap) return;
    if (this.modalKind === 'build') this.renderBuild();
    else if (this.modalKind === 'board') this.setModal(`<header><h2>Scoreboard</h2><span class="spacer"></span><button class="close">✕</button></header><div class="body board">${this.boardTable(this.snap)}</div>`);
  }

  private modalClick(ev: MouseEvent) {
    const t = ev.target as HTMLElement;
    const plot = t.closest<HTMLElement>('[data-plot]');
    if (plot) { this.selPlot = Number(plot.dataset.plot); this.refreshModal(); return; }
    const b = t.closest<HTMLElement>('[data-b]');
    if (b) {
      const id = b.dataset.b as FlBuildingId;
      const why = this.buildBlock(id);
      if (why) { toast(why, '#ffb36b'); return; }
      this.session.send({ c: 'buildAt', plot: this.curPlot()!.index, building: id });
      this.selPlot = null; // jump to the next empty plot
      return;
    }
    const r = t.closest<HTMLElement>('[data-r]');
    if (r) {
      const kind = r.dataset.r as FlResearch;
      const why = this.researchBlock(kind);
      if (why) { toast(why, '#ffb36b'); return; }
      this.session.send({ c: 'research', kind });
    }
  }

  private curPlot(): MyPlot | undefined {
    return this.myPlots.find((p) => p.index === this.selPlot) ?? this.myPlots.find((p) => !p.st[2]) ?? this.myPlots[0];
  }
  private gold() { return this.snap?.me?.gold ?? this.mine?.gold ?? 0; }

  /** Why a building cannot be placed on the selected plot right now ('' = fine). */
  private buildBlock(id: FlBuildingId): string {
    const d = FL_BUILDINGS[id];
    const cur = this.curPlot();
    if (!cur) return 'No plot available';
    if (cur.st[2]) return 'This plot is already in use';
    const have = this.built.get(id)?.total ?? 0;
    if (d.max && have >= d.max) return `${d.name}: limit reached (${have}/${d.max})`;
    if (d.requires && !(this.built.get(d.requires)?.done)) return `${d.name} needs a finished ${FL_BUILDINGS[d.requires].name}`;
    if (this.gold() < d.cost) return `Need ${d.cost - this.gold()} more gold`;
    return '';
  }
  private researchBlock(kind: FlResearch): string {
    const r = FL_RESEARCH[kind], lvl = this.mine?.research[kind] ?? 0;
    if (!this.built.get('forge')?.done) return 'Needs a finished Forge';
    if (lvl >= r.costs.length) return 'Already at maximum level';
    if (this.gold() < r.costs[lvl]) return `Need ${r.costs[lvl] - this.gold()} more gold`;
    return '';
  }

  private renderBuild() {
    const s = this.snap!, me = this.mine;
    if (!me) return;
    const cur = this.curPlot();
    const tiles = this.myPlots.map((p) => {
      const [, , b, prog] = p.st;
      const wip = b && prog < 1;
      return `<button class="fl-plot ${cur && cur.index === p.index ? 'sel' : ''} ${b ? 'built' : ''} ${wip ? 'wip' : ''}" data-plot="${p.index}" title="Plot ${p.no}${b ? `: ${FL_BUILDINGS[b].name}` : ' (empty)'}">
        <span class="ic">${b ? FL_BUILDINGS[b].icon : '+'}</span><span class="pn">${p.no}</span>${wip ? `<i class="prog" style="width:${q5(prog)}%"></i>` : ''}</button>`;
    }).join('');
    let detail = '';
    if (cur) {
      const [, , b, prog, uid] = cur.st;
      if (!b) {
        detail = `<div class="muted" style="margin-bottom:6px">Plot ${cur.no}: choose a building</div><div class="fl-bopts">${FL_BUILDING_ORDER.map((id) => {
          const d = FL_BUILDINGS[id];
          const why = this.buildBlock(id);
          const have = this.built.get(id)?.total ?? 0;
          const reqOk = !d.requires || !!this.built.get(d.requires)?.done;
          const note = d.requires ? '1' : '';
          const lim = d.max ? `<span class="muted">${have}/${d.max}</span>` : '';
          return `<button class="fl-bopt ${why ? 'cant' : ''}" data-b="${id}"><span class="ic">${d.icon}</span>
            <span class="bt"><b>${d.name}</b> ${lim}<br><span class="desc">${esc(d.description)}</span>${note ? `<span class="${reqOk ? 'ok' : 'bad'}" style="font-size:11px">· Requires ${FL_BUILDINGS[d.requires!].name}</span>` : ''}</span>
            <span class="bc ${this.gold() < d.cost ? 'bad' : ''}">🪙 ${d.cost}<br><small>${d.buildTime}s</small></span></button>`;
        }).join('')}</div>`;
      } else {
        const d = FL_BUILDINGS[b];
        const u = s.units.find((x) => x[0] === uid);
        const hpPct = u ? Math.round((u[6] / Math.max(1, u[7])) * 20) * 5 : 100;
        detail = `<div class="fl-bdetail"><div class="row"><span class="bigic">${d.icon}</span><div><b>${d.name}</b><br><span class="muted">${esc(d.description)}</span></div></div>
          ${prog < 1 ? `<div class="muted" style="margin-top:8px">Under construction ${q5(prog)}%</div><div class="bar mp"><div class="fill" style="width:${q5(prog)}%;background:var(--gold)"></div></div>` : '<div class="ok" style="margin-top:8px">Ready</div>'}
          <div class="muted" style="margin-top:6px">Health ${hpPct}%</div><div class="bar hp"><div class="fill" style="width:${hpPct}%"></div></div></div>`;
      }
    }
    const forge = !!this.built.get('forge')?.done;
    const research = (Object.keys(FL_RESEARCH) as FlResearch[]).map((k) => {
      const r = FL_RESEARCH[k], lvl = me.research[k];
      const max = lvl >= r.costs.length;
      const why = this.researchBlock(k);
      return `<div class="fl-res"><span class="ic">${r.icon}</span><div class="bt"><b>${r.name}</b> <span class="muted">${r.text}</span><br>
        <span class="pips">${r.costs.map((_, i) => `<i class="${i < lvl ? 'on' : ''}"></i>`).join('')}</span></div>
        ${max ? '<span class="tag">MAX</span>' : `<button class="btn small ${why ? '' : 'primary'}" data-r="${k}" ${forge ? '' : 'disabled'}>🪙 ${r.costs[lvl]}</button>`}</div>`;
    }).join('');
    this.setModal(`<header><h2>Build</h2><span class="gold-amt">🪙 <b data-m="gold"></b></span><span class="muted">👥 <span data-m="pop"></span></span><span class="spacer"></span><button class="close">✕</button></header>
      <div class="body"><div class="fl-plots">${tiles}</div>${detail}
      <h3 class="gold" style="margin:12px 0 6px;font-size:15px">Forge research</h3>${forge ? research : '<p class="muted" style="margin:0">Build and finish a Forge to research weapon and armour upgrades.</p>'}</div>`, { gold: String(this.gold()), pop: `${me.pop}/${me.popCap}` });
  }

  // ------------------------------------------------------------------ scoreboard + end screen
  private boardTable(s: Snapshot) {
    const fl = s.fl;
    return ([0, 1] as Team[]).map((t) => `<h3 class="team${t} serif">${TEAM_NAMES[t]}</h3>
      <table class="fl-t"><tr><th></th><th>Player</th><th>Lv</th><th>K / D / A</th><th>Pop</th><th>Army</th><th>Upgrades</th><th></th></tr>
      ${s.board.filter((b) => b.team === t).map((b) => {
        const p = fl?.players.find((x) => x.pid === b.pid);
        const army = p ? FL_UNIT_ORDER.filter((id) => (p.army[id] ?? 0) > 0).map((id) => `<span title="${FL_UNITS[id].name}">${FL_UNITS[id].icon}${p.army[id]}</span>`).join(' ') : '';
        return `<tr><td><img src="${portrait(b.hero)}"></td><td><b style="color:${p ? PLAYER_HEX[p.color] : 'inherit'}">${esc(b.name)}</b>${b.bot ? ' <span class="tag">bot</span>' : ''}<br><span class="muted">${esc(HERO_BY_ID[b.hero]?.name ?? '')}</span></td>
          <td>${b.lvl}</td><td>${b.k} / ${b.d} / ${b.a}</td><td>${p ? `${p.pop}/${p.popCap}` : ''}</td><td class="its">${army}</td>
          <td>${p ? `⚔️${p.research.weapons} 🛡️${p.research.armor}` : ''}</td><td>${b.respawn > 0 ? `💀 ${Math.ceil(b.respawn)}s` : ''}${b.gold >= 0 ? ` <span class="gold">${b.gold}g</span>` : ''}</td></tr>`;
      }).join('')}</table>`).join('');
  }

  private showEnd(s: Snapshot) {
    const won = s.winner === this.myTeam;
    this.closeModal();
    const title = this.spectator ? `${TEAM_NAMES[s.winner!]} win` : won ? 'Victory' : 'Defeat';
    this.endScreen = h('div', { class: 'end-screen' }, `<div class="card panel"><h1 class="serif ${won || this.spectator ? 'gold' : 'team1'}">${title}</h1>
      <p class="muted">The ${TEAM_NAMES[s.winner!]} destroyed the enemy keep in ${fmtTime(s.time)}.</p><div class="board">${this.boardTable(s)}</div>
      <div class="row" style="justify-content:center;margin-top:14px"><button class="btn primary" id="end-leave">Back to menu</button><span id="end-again"></span>
      <button class="btn" id="end-watch" style="margin-left:10px">🎬 Watch replay</button><button class="btn" id="end-dl" style="margin-left:10px">💾 Save replay</button></div></div>`);
    this.root.appendChild(this.endScreen);
    this.endScreen.querySelector<HTMLButtonElement>('#end-leave')!.onclick = () => this.onLeave();
    const watch = this.endScreen.querySelector<HTMLButtonElement>('#end-watch')!;
    const dl = this.endScreen.querySelector<HTMLButtonElement>('#end-dl')!;
    const refreshReplay = () => {
      const r = this.session.getReplay?.() ?? null;
      watch.disabled = dl.disabled = !r || !this.onWatchReplay;
      if (!r) setTimeout(refreshReplay, 500); // online: the server sends it right after the match ends
    };
    refreshReplay();
    watch.onclick = () => this.onWatchReplay?.();
    dl.onclick = () => { const r = this.session.getReplay?.(); if (r) downloadReplay(r); };
    this.refreshEndActions();
  }

  setHost(isHost: boolean) { this.isHost = isHost; this.refreshEndActions(); }
  private refreshEndActions() {
    const slot = this.endScreen?.querySelector<HTMLElement>('#end-again');
    if (!slot || !this.session.online) return;
    if (this.isHost) {
      slot.innerHTML = '<button class="btn primary" id="end-replay" style="margin-left:10px">Play again</button>';
      slot.querySelector<HTMLButtonElement>('#end-replay')!.onclick = () => this.onReplay();
    } else slot.innerHTML = '<span class="muted" style="margin-left:12px">Waiting for the host to start another round…</span>';
  }
}
