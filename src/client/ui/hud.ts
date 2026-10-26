import * as THREE from 'three';
import type { GameInit, Snapshot, GameEvent, HeroBoard } from '../../shared/protocol';
import { F } from '../../shared/protocol';
import type { AbilitySlot, ItemCategory, ItemDef, Team } from '../../shared/types';
import { HERO_BY_ID } from '../../shared/data/heroes';
import { ITEMS, ITEM_BY_ID } from '../../shared/data/items';
import { UPGRADES, MERCENARY, type UpgradeId } from '../../shared/upgrades';
import { BUILD_TOWER_KINDS, TOWERS, TOWER_UPGRADE_COST } from '../../shared/units';
import { MAP, OBSTACLES, lanepath, buildPads, LANE_NAMES } from '../../shared/map';
import { TEAM_COLORS, TEAM_NAMES } from '../../shared/constants';
import { priceFor } from '../../shared/shop';
import type { Session, ChatLine } from '../net';
import type { World } from '../render/world';
import { esc, h, overlay, ui } from './dom';
import { portrait } from './portraits';

const STAT_LABEL: Record<string, string> = {
  maxHp: 'Health', hpRegen: 'Health regen', maxMana: 'Mana', manaRegen: 'Mana regen', attackDamage: 'Attack damage', abilityPower: 'Ability power',
  armor: 'Armor', magicResist: 'Magic resist', attackSpeed: 'Attack speed', attackRange: 'Range', moveSpeed: 'Move speed', critChance: 'Crit chance',
  lifesteal: 'Lifesteal', abilityHaste: 'Ability haste', armorPen: 'Armor pen', magicPen: 'Magic pen',
};
const PCT = new Set(['critChance', 'lifesteal', 'armorPen', 'magicPen']);
export const fmtStat = (k: string, v: number) => (PCT.has(k) ? `+${Math.round(v * 100)}% ${STAT_LABEL[k] ?? k}` : `+${Math.round(v * 100) / 100} ${STAT_LABEL[k] ?? k}`);
const fmtTime = (t: number) => `${Math.floor(t / 60)}:${String(Math.floor(t % 60)).padStart(2, '0')}`;

export class Hud {
  snap: Snapshot | null = null;
  private root = h('div');
  private top = h('div', { class: 'hud-top panel' });
  private bottom = h('div', { class: 'hud-bottom panel' });
  private buffs = h('div', { class: 'buffs' });
  private feed = h('div', { class: 'feed' });
  private chatBox = h('div', { class: 'chat' });
  private chatInput: HTMLInputElement | null = null;
  private mini = h('div', { class: 'minimap panel' });
  private miniCanvas = document.createElement('canvas');
  private miniBg: HTMLCanvasElement;
  private modal: HTMLElement | null = null;
  private modalKind: '' | 'shop' | 'base' | 'board' | 'help' = '';
  private death = h('div', { class: 'death hidden' });
  private endScreen: HTMLElement | null = null;
  private recallBar = h('div', { class: 'recall-bar bar mp hidden' }, '<div class="fill" style="width:0"></div><span>Recalling…</span>');
  private tooltip = h('div', { class: 'tooltip panel hidden' });
  private nameplates = new Map<number, HTMLElement>();
  private shopSel: string | null = null;
  private shopCat: ItemCategory | 'all' = 'all';
  private myTeam: Team;
  private heroId: string;
  private lastBoard = '';
  onLeave: () => void = () => {};
  aiming: AbilitySlot | null = null;

  constructor(private init: GameInit, private session: Session, private world: World) {
    const me = init.players.find((p) => p.playerId === init.you)!;
    this.myTeam = me.team;
    this.heroId = me.heroId;
    this.miniCanvas.width = 440; this.miniCanvas.height = 260;
    this.miniBg = this.drawMiniBg();
    this.mini.appendChild(this.miniCanvas);
    this.root.append(this.top, this.bottom, this.buffs, this.feed, this.chatBox, this.mini, this.death, this.recallBar, this.tooltip);
    const help = h('div', { class: 'helpbox panel' }, `<b class="gold">Controls</b> <span class="muted">(F1 to hide)</span><br>
      <kbd>Right-click</kbd> move / attack · <kbd>A</kbd>+click attack-move<br><kbd>Q W E R</kbd> abilities (hold to aim, release to cast)<br>
      <kbd>1-6</kbd> items · <kbd>B</kbd> recall · <kbd>P</kbd> shop · <kbd>U</kbd> fortress<br><kbd>Tab</kbd> scores · <kbd>Space</kbd> center · <kbd>Y</kbd> camera lock<br>
      <kbd>G</kbd>+click ping · <kbd>Enter</kbd> chat · arrow keys steer`);
    help.id = 'helpbox';
    this.root.appendChild(help);
    const actions = h('div', { class: 'hint-actions' });
    actions.innerHTML = `<button class="btn small" data-a="shop">🛒 Shop (P)</button><button class="btn small" data-a="base">🏰 Fortress (U)</button>`;
    actions.querySelectorAll<HTMLButtonElement>('[data-a]').forEach((b) => b.onclick = () => this.toggle(b.dataset.a as 'shop'));
    actions.style.bottom = '200px';
    this.root.appendChild(actions);
    ui().appendChild(this.root);
    this.mini.onmousedown = (ev) => this.minimapClick(ev);
    this.mini.oncontextmenu = (ev) => ev.preventDefault();
    session.onChat = (c) => this.chatLine(c);
  }

  destroy() { this.root.remove(); overlay().innerHTML = ''; }

  // ------------------------------------------------------------------ snapshot-driven UI
  update(s: Snapshot) {
    this.snap = s;
    this.renderTop(s);
    this.renderBottom(s);
    for (const e of s.events) this.event(e);
    if (this.modalKind === 'shop' || this.modalKind === 'base') this.refreshModal();
    if (this.modalKind === 'board') { const key = JSON.stringify(s.board.map((b) => [b.k, b.d, b.a, b.lvl, b.items, b.respawn > 0])); if (key !== this.lastBoard) { this.lastBoard = key; this.refreshModal(); } }
    const me = s.me;
    if (me) {
      this.death.classList.toggle('hidden', me.respawn <= 0);
      if (me.respawn > 0) this.death.innerHTML = `<div class="t">You have fallen<br><span class="gold">${Math.ceil(me.respawn)}</span><div class="muted" style="font: 14px Inter">You can shop while dead (P)</div></div>`;
      this.recallBar.classList.toggle('hidden', me.recall <= 0);
      (this.recallBar.firstChild as HTMLElement).style.width = `${Math.round(me.recall * 100)}%`;
      this.buffs.innerHTML = me.buffs.map(([n, i, t]) => `<span class="buff">${i} ${esc(n)} <span class="muted">${t}s</span></span>`).join('');
    }
    if (s.winner !== undefined && !this.endScreen) this.showEnd(s);
  }

  private renderTop(s: Snapshot) {
    const pip = (team: number) => s.banners.filter((b) => b[0] === team).map((b) => {
      const owner = b[2], contested = b[4] >= 0 && b[3] > 0;
      const name = { north: 'North', south: 'South', keep: 'Keep' }[b[1]];
      return `<div class="banner-pip ${owner !== team ? 'lost' : ''} ${contested ? 'contested' : ''}" title="${TEAM_NAMES[team]} ${name} Banner${owner !== team ? ' (captured!)' : ''}${b[5] ? ' (locked)' : ''}" style="background:${TEAM_COLORS[owner]}"></div>`;
    }).join('');
    const t0 = s.teams[0], t1 = s.teams[1];
    this.top.innerHTML = `<div class="banners">${pip(0)}</div><span class="team0 serif">${TEAM_NAMES[0]}</span><span class="score team0">${t0.kills}</span>
      <div class="col" style="gap:0;align-items:center"><span class="clock">${fmtTime(s.time)}</span><span class="phase" title="${s.night ? 'Night: shorter vision, richer monsters' : 'Day'}">${s.night ? '🌙' : '☀️'} <span class="muted" style="font-size:11px">${fmtTime(s.phaseLeft)}</span></span></div>
      <span class="score team1">${t1.kills}</span><span class="team1 serif">${TEAM_NAMES[1]}</span><div class="banners">${pip(1)}</div>`;
  }

  private renderBottom(s: Snapshot) {
    const me = s.me;
    if (!me) return;
    const def = HERO_BY_ID[this.heroId];
    const u = s.units.find((x) => x[0] === me.unit);
    const hp = u?.[6] ?? 0, maxHp = u?.[7] ?? 1, sh = u?.[8] ?? 0;
    const xpFrac = me.xpNext > me.xpPrev ? (me.xp - me.xpPrev) / (me.xpNext - me.xpPrev) : 1;
    const ab = def.abilities.map((a, i) => {
      const rank = me.ranks[i];
      const cd = me.cd[i];
      const cost = a.manaCost[Math.max(0, rank - 1)] ?? 0;
      const frac = cd > 0 ? cd / Math.max(0.01, me.cdMax[i]) : 0;
      const pips = Array.from({ length: i === 3 ? 3 : 5 }, (_, k) => `<i class="${k < rank ? 'on' : ''}"></i>`).join('');
      const cls = rank === 0 ? 'locked' : cd > 0 ? '' : me.mana < cost ? 'nomana' : 'ready';
      return `<div class="ability ${cls}" data-ab="${i}">${a.icon}<span class="key">${'QWER'[i]}</span>${cost ? `<span class="cost">${cost}</span>` : ''}
        ${frac > 0 ? `<div class="sweep" style="background:conic-gradient(rgba(0,0,0,.72) ${frac * 360}deg, transparent 0)"></div><div class="cd">${cd >= 1 ? Math.ceil(cd) : cd.toFixed(1)}</div>` : ''}
        <div class="pips">${pips}</div></div>`;
    }).join('');
    const items = me.items.map((id, i) => {
      const it = id ? ITEM_BY_ID[id] : null;
      return `<div class="item" data-item="${i}" title="${it ? esc(it.name) : 'Empty'}">${it ? it.icon : ''}<span class="key">${i + 1}</span>${me.itemCd[i] > 0 ? `<div class="cd">${Math.ceil(me.itemCd[i])}</div>` : ''}</div>`;
    }).join('');
    const st = me.stats;
    if (!this.bottom.firstChild) {
      this.bottom.innerHTML = `<div class="portrait" data-s="portrait"></div><div class="col" style="gap:6px"><div class="row" style="gap:6px" data-s="abilities"></div><div class="bars" data-s="bars"></div></div>
        <div class="items" data-s="items"></div><div class="goldbox"><div class="gold-amt" data-s="gold"></div><div class="statline" data-s="stats"></div><button class="btn small" data-a="shop">🛒 Shop</button></div>`;
      this.bottom.querySelector<HTMLButtonElement>('[data-a="shop"]')!.onclick = () => this.toggle('shop');
      this.bottom.onmouseover = (ev) => {
        const t = ev.target as HTMLElement;
        const abEl = t.closest<HTMLElement>('[data-ab]');
        const itEl = t.closest<HTMLElement>('[data-item]');
        if (abEl) this.abilityTip(abEl, abEl.dataset.ab!);
        else if (itEl) { const id = this.snap?.me?.items[Number(itEl.dataset.item)]; if (id) this.itemTip(itEl, ITEM_BY_ID[id]); else this.tooltip.classList.add('hidden'); }
        else this.tooltip.classList.add('hidden');
      };
      this.bottom.onmouseleave = () => this.tooltip.classList.add('hidden');
    }
    const part = (k: string, html: string) => { const el = this.bottom.querySelector<HTMLElement>(`[data-s="${k}"]`)!; if (el.dataset.h !== html) { el.innerHTML = html; el.dataset.h = html; } };
    part('portrait', `<img src="${portrait(this.heroId)}" alt=""><span class="lvl">${me.level}</span><div class="xp" style="width:${Math.round(xpFrac * 100)}%"></div>`);
    part('abilities', `<div class="ability passive" data-ab="p">${def.passive.icon}</div><div class="abilities">${ab}</div>`);
    part('bars', `<div class="bar hp"><div class="fill" style="width:${(hp / Math.max(maxHp, hp + sh)) * 100}%"></div><div class="shield" style="left:${(hp / Math.max(maxHp, hp + sh)) * 100}%;width:${(sh / Math.max(maxHp, hp + sh)) * 100}%"></div><span>${hp} / ${maxHp}${sh ? ` (+${sh})` : ''}</span></div>
          <div class="bar mp"><div class="fill" style="width:${(me.mana / Math.max(1, me.maxMana)) * 100}%"></div><span>${me.mana} / ${me.maxMana}</span></div>`);
    part('items', items);
    part('gold', `🪙 ${me.gold}`);
    part('stats', `<span title="Attack damage">⚔️ <b>${Math.round(st.attackDamage)}</b></span><span title="Ability power">✨ <b>${Math.round(st.abilityPower)}</b></span><span title="Armor">🛡️ <b>${Math.round(st.armor)}</b></span>
        <span title="Magic resist">🔰 <b>${Math.round(st.magicResist)}</b></span><span title="Attack speed">⚡ <b>${st.attackSpeed.toFixed(2)}</b></span><span title="Move speed">👟 <b>${st.moveSpeed.toFixed(1)}</b></span>`);
    const shopBtn = this.bottom.querySelector<HTMLButtonElement>('[data-a="shop"]')!;
    shopBtn.textContent = me.canShop ? '🛒 Shop' : '🛒 (at base)';
  }

  private abilityTip(el: HTMLElement, key: string) {
    const def = HERO_BY_ID[this.heroId];
    const me = this.snap?.me;
    if (key === 'p') this.showTip(el, `<b>${def.passive.icon} ${esc(def.passive.name)}</b> <span class="muted">Passive</span><br>${esc(def.passive.description)}`);
    else {
      const i = Number(key), a = def.abilities[i], r = Math.max(1, me?.ranks[i] ?? 1);
      this.showTip(el, `<b>${a.icon} ${esc(a.name)}</b> <span class="muted">[${'QWER'[i]}] rank ${me?.ranks[i] ?? 0}</span><br>${esc(a.description)}<br>
        <span class="muted">Cooldown ${a.cooldown[r - 1] ?? a.cooldown[0]}s · Mana ${a.manaCost[r - 1] ?? 0} · Range ${a.range}</span>${i === 3 ? '<br><span class="muted">Unlocks at level 4</span>' : ''}`);
    }
  }
  private itemTip(el: HTMLElement, it: ItemDef) {
    const stats = Object.entries(it.stats).map(([k, v]) => fmtStat(k, v as number)).join('<br>');
    const extra = it.passive ? `<br><span class="gold">${esc(it.passive.name ?? 'Passive')}</span>: ${esc(it.passive.description ?? '')}` : '';
    const act = it.active ? `<br><span class="gold">Active, ${esc(it.active.name)}</span>: ${esc(it.active.description)} (${it.active.cooldown}s)` : '';
    this.showTip(el, `<b>${it.icon} ${esc(it.name)}</b> <span class="muted">${it.cost}g</span><br><span style="color:#b9f6ca">${stats}</span><br>${esc(it.description)}${extra}${act}`);
  }
  private showTip(el: HTMLElement, html: string) {
    this.tooltip.innerHTML = html;
    this.tooltip.classList.remove('hidden');
    const r = el.getBoundingClientRect();
    this.tooltip.style.left = `${Math.min(window.innerWidth - 330, Math.max(8, r.left))}px`;
    this.tooltip.style.top = `${r.top - 10}px`;
    this.tooltip.style.transform = 'translateY(-100%)';
  }

  // ------------------------------------------------------------------ events
  private event(e: GameEvent) {
    const s = this.snap!;
    const nameOf = (id: number) => {
      const b = s.board.find((x) => x.id === id);
      if (b) return `<span class="team${b.team}">${esc(b.name)}</span> <span class="muted">(${esc(HERO_BY_ID[b.hero]?.name ?? '')})</span>`;
      const u = s.units.find((x) => x[0] === id);
      return u ? esc(this.init.visuals[u[1]]?.name ?? 'Something') : 'Something';
    };
    switch (e.e) {
      case 'dmg': this.floater(e.id, `${e.a}`, e.k === 0 ? '#ffb38a' : e.k === 1 ? '#c4a5ff' : '#ffffff', !!e.c, e.s === this.snap?.me?.unit || e.id === this.snap?.me?.unit); break;
      case 'heal': if (e.a >= 5) this.floater(e.id, `+${e.a}`, '#7cff8a', false, true); break;
      case 'gold': this.floater(e.id, `+${e.a}g`, '#f4d58d', false, true); break;
      case 'kill': {
        const assists = e.assists.length ? ` <span class="muted">+${e.assists.length}</span>` : '';
        this.feedLine(`⚔️ ${e.killer ? nameOf(e.killer) : 'The Forge'}${assists} slew ${nameOf(e.victim)}`);
        break;
      }
      case 'struct': this.feedLine(`🏚️ <span class="team${e.team}">${TEAM_NAMES[e.team]}</span> lost ${esc(e.name)}`); break;
      case 'msg': this.feedLine(`<span style="color:${e.color ?? '#e8e6df'}">${esc(e.text)}</span>`); break;
      case 'level': if (e.id === s.me?.unit) this.floater(e.id, `Level ${e.lvl}!`, '#ffd166', true, true); break;
      case 'ping': this.ping(e.x, e.z, e.kind, e.from); break;
    }
  }

  private floater(id: number, text: string, color: string, big: boolean, mine: boolean) {
    const v = this.world.units.get(id);
    if (!v) return;
    if (!mine && Math.random() < 0.6) return; // keep the screen readable
    const p = this.world.screenOf(new THREE.Vector3(v.pos.x, v.height + 0.6, v.pos.z));
    if (!p.visible) return;
    const el = h('div', { class: `floater ${big ? 'crit' : ''}` }, esc(text));
    el.style.left = `${p.x + (Math.random() - 0.5) * 30}px`;
    el.style.top = `${p.y}px`;
    el.style.color = color;
    overlay().appendChild(el);
    setTimeout(() => el.remove(), 900);
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
        if (v) {
          const team = v.startsWith('/t ');
          this.session.chat(team ? v.slice(3) : v, team);
        }
        this.closeChat();
      } else if (ev.key === 'Escape') this.closeChat();
    };
  }
  private closeChat() { this.chatInput?.remove(); this.chatInput = null; }
  get chatting() { return !!this.chatInput; }

  private ping(x: number, z: number, kind: string, from: string) {
    const icon = kind === 'danger' ? '⚠️' : kind === 'help' ? '🆘' : '🚩';
    const p = this.world.screenOf(new THREE.Vector3(x, 0, z));
    const el = h('div', { class: 'ping' }, icon);
    el.style.left = `${p.x}px`; el.style.top = `${p.y}px`;
    overlay().appendChild(el);
    setTimeout(() => el.remove(), 1600);
    this.pings.push({ x, z, until: performance.now() + 4000, icon });
    this.feedLine(`${icon} <span class="muted">${esc(from)} pinged the map</span>`);
  }
  private pings: { x: number; z: number; until: number; icon: string }[] = [];

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
      const html = `<span class="lv">${b.lvl}</span><span class="team${b.team}">${esc(b.name)}</span>`;
      if (el.innerHTML !== html) el.innerHTML = html;
      el.style.left = `${p.x}px`; el.style.top = `${p.y}px`;
    }
    for (const [id, el] of this.nameplates) if (!seen.has(id)) { el.remove(); this.nameplates.delete(id); }
    this.drawMinimap(s);
  }

  // ------------------------------------------------------------------ minimap
  private toMini(x: number, z: number): [number, number] {
    return [((x - MAP.minX) / (MAP.maxX - MAP.minX)) * this.miniCanvas.width, ((z - MAP.minZ) / (MAP.maxZ - MAP.minZ)) * this.miniCanvas.height];
  }
  private drawMiniBg(): HTMLCanvasElement {
    const c = document.createElement('canvas');
    c.width = this.miniCanvas.width; c.height = this.miniCanvas.height;
    const g = c.getContext('2d')!;
    g.fillStyle = '#2f4a25'; g.fillRect(0, 0, c.width, c.height);
    g.strokeStyle = '#a88a57'; g.lineWidth = 9; g.lineCap = 'round'; g.lineJoin = 'round';
    for (const l of [0, 1] as const) { g.beginPath(); lanepath(l, 0).forEach((p, i) => { const [x, y] = this.toMini(p.x, p.z); if (i) g.lineTo(x, y); else g.moveTo(x, y); }); g.stroke(); }
    g.fillStyle = '#1f3318';
    for (const o of OBSTACLES) { const [x, y] = this.toMini(o.pos.x, o.pos.z); g.beginPath(); g.arc(x, y, o.r * 2, 0, Math.PI * 2); g.fill(); }
    return c;
  }
  private drawMinimap(s: Snapshot) {
    const g = this.miniCanvas.getContext('2d')!;
    g.drawImage(this.miniBg, 0, 0);
    // fog
    g.save();
    g.fillStyle = 'rgba(5,8,16,0.55)';
    g.fillRect(0, 0, this.miniCanvas.width, this.miniCanvas.height);
    g.globalCompositeOperation = 'destination-out';
    const sx = this.miniCanvas.width / (MAP.maxX - MAP.minX);
    for (let i = 0; i + 2 < s.sight.length; i += 3) { const [x, y] = this.toMini(s.sight[i], s.sight[i + 1]); g.beginPath(); g.arc(x, y, s.sight[i + 2] * sx, 0, Math.PI * 2); g.fill(); }
    g.restore();
    g.globalCompositeOperation = 'source-over';
    g.drawImage(this.miniBg, 0, 0, 0, 0); // no-op keeps lint quiet
    for (const b of s.banners) {
      const spot = (b[0] === 0 || b[0] === 1) ? this.bannerPos(b[0] as Team, b[1]) : null;
      if (!spot) continue;
      const [x, y] = this.toMini(spot.x, spot.z);
      g.fillStyle = TEAM_COLORS[b[2]];
      g.fillRect(x - 4, y - 7, 8, 11);
      g.strokeStyle = '#fff'; g.lineWidth = 1; g.strokeRect(x - 4, y - 7, 8, 11);
    }
    for (const u of s.units) {
      const info = this.init.visuals[u[1]];
      if (!info || (u[9] & F.dead)) continue;
      const [x, y] = this.toMini(u[3], u[4]);
      const col = u[2] === 2 ? '#facc15' : TEAM_COLORS[u[2]];
      if (info.kind === 'hero') {
        g.fillStyle = u[0] === s.me?.unit ? '#7cff8a' : col;
        g.beginPath(); g.arc(x, y, 6, 0, Math.PI * 2); g.fill();
        g.strokeStyle = '#000'; g.lineWidth = 1.5; g.stroke();
      } else if (info.kind === 'tower') {
        g.fillStyle = col; g.fillRect(x - (info.towerKind === 'fortress' ? 8 : 4), y - (info.towerKind === 'fortress' ? 8 : 4), info.towerKind === 'fortress' ? 16 : 8, info.towerKind === 'fortress' ? 16 : 8);
        g.strokeStyle = '#000'; g.strokeRect(x - 4, y - 4, 8, 8);
      } else {
        g.fillStyle = col; g.fillRect(x - 1.5, y - 1.5, 3, 3);
      }
    }
    const now = performance.now();
    this.pings = this.pings.filter((p) => p.until > now);
    for (const p of this.pings) { const [x, y] = this.toMini(p.x, p.z); g.font = '16px serif'; g.fillText(p.icon, x - 8, y + 6); }
    // camera rectangle
    const c = this.world.camTarget;
    const [cx, cy] = this.toMini(c.x, c.z);
    const w = this.world.camDist * 1.25 * sx, hgt = this.world.camDist * 0.75 * sx;
    g.strokeStyle = 'rgba(255,255,255,.7)'; g.lineWidth = 1.5; g.strokeRect(cx - w / 2, cy - hgt / 2, w, hgt);
  }
  private bannerPos(team: Team, key: string) {
    const spots: Record<string, { x: number; z: number }> = {
      north: { x: -74, z: -16 }, south: { x: -74, z: 16 }, keep: { x: -80, z: 0 },
    };
    const p = spots[key];
    return team === 0 ? p : { x: -p.x, z: p.z };
  }
  onMinimap: (x: number, z: number, button: number) => void = () => {};
  private minimapClick(ev: MouseEvent) {
    ev.preventDefault();
    const r = this.miniCanvas.getBoundingClientRect();
    const x = MAP.minX + ((ev.clientX - r.left) / r.width) * (MAP.maxX - MAP.minX);
    const z = MAP.minZ + ((ev.clientY - r.top) / r.height) * (MAP.maxZ - MAP.minZ);
    this.onMinimap(x, z, ev.button);
  }

  // ------------------------------------------------------------------ modals
  get modalOpen() { return this.modalKind !== ''; }
  toggle(kind: 'shop' | 'base' | 'board' | 'help') {
    if (this.modalKind === kind) { this.closeModal(); return; }
    this.closeModal();
    this.modalKind = kind;
    this.modal = h('div', { class: 'modal panel' });
    this.root.appendChild(this.modal);
    this.refreshModal();
  }
  closeModal() { this.modal?.remove(); this.modal = null; this.modalKind = ''; this.modalHtml = ''; this.tooltip.classList.add('hidden'); }

  private modalHtml = '';
  /** Replaces the modal content only when it changed, so clicks are not swallowed by re-renders. */
  private setModal(html: string): boolean {
    if (html === this.modalHtml) return false;
    this.modalHtml = html;
    this.modal!.innerHTML = html;
    this.bindClose();
    return true;
  }

  private refreshModal() {
    if (!this.modal || !this.snap) return;
    const scroll = this.modal.querySelector('.body')?.scrollTop ?? 0;
    if (this.modalKind === 'shop') this.renderShop();
    else if (this.modalKind === 'base') this.renderBase();
    else if (this.modalKind === 'board') this.renderBoard();
    const body = this.modal.querySelector('.body');
    if (body) body.scrollTop = scroll;
  }

  private renderShop() {
    const me = this.snap!.me!;
    const cats: (ItemCategory | 'all')[] = ['all', 'attack', 'magic', 'defense', 'utility', 'boots', 'consumable'];
    const list = ITEMS.filter((i) => this.shopCat === 'all' || i.category === this.shopCat);
    const cell = (it: ItemDef) => {
      const { price } = priceFor(me.items, it.id);
      const owned = me.items.includes(it.id);
      return `<button class="shop-item ${this.shopSel === it.id ? 'sel' : ''} ${price > me.gold ? 'cant' : ''} ${owned ? 'owned' : ''}" data-it="${it.id}" title="${esc(it.name)}"><div class="ic">${it.icon}</div><div class="pr">${price}</div></button>`;
    };
    const tiers = [1, 2, 3].map((t) => {
      const items = list.filter((i) => i.tier === t);
      return items.length ? `<div class="shop-tier"><h4>${['', 'Basic', 'Advanced', 'Legendary'][t]}</h4><div class="shop-items">${items.map(cell).join('')}</div></div>` : '';
    }).join('');
    const sel = this.shopSel ? ITEM_BY_ID[this.shopSel] : null;
    let detail = '<p class="muted">Pick an item to see its recipe. Owned components lower the price.</p>';
    if (sel) {
      const { price } = priceFor(me.items, sel.id);
      const builds = ITEMS.filter((i) => i.components?.includes(sel.id));
      detail = `<div class="item-detail"><h3>${sel.icon} ${esc(sel.name)}</h3><div class="muted">${sel.category} · tier ${sel.tier} · total ${sel.cost}g</div>
        <div class="stats">${Object.entries(sel.stats).map(([k, v]) => fmtStat(k, v as number)).join('<br>')}</div>
        <p>${esc(sel.description)}</p>
        ${sel.passive ? `<p><span class="gold">${esc(sel.passive.name ?? 'Passive')}</span>: ${esc(sel.passive.description ?? '')}</p>` : ''}
        ${sel.active ? `<p><span class="gold">Active, ${esc(sel.active.name)}</span>: ${esc(sel.active.description)} <span class="muted">(${sel.active.cooldown}s)</span></p>` : ''}
        ${sel.components?.length ? `<div class="muted">Recipe</div><div class="recipe">${sel.components.map((c) => cell(ITEM_BY_ID[c])).join('<span>+</span>')}</div>` : ''}
        ${builds.length ? `<div class="muted">Builds into</div><div class="recipe">${builds.map(cell).join('')}</div>` : ''}
        <button class="btn primary" data-buy="${sel.id}" ${!me.canShop || price > me.gold ? 'disabled' : ''}>Buy for ${price}g</button>
        ${!me.canShop ? '<p class="muted">Return to your fountain, or wait until you respawn, to buy.</p>' : ''}</div>`;
    }
    const sell = me.items.map((id, i) => id ? `<button class="btn small" data-sell="${i}" ${me.canShop ? '' : 'disabled'}>${ITEM_BY_ID[id].icon} Sell ${Math.floor(ITEM_BY_ID[id].cost * 0.6)}g</button>` : '').join('');
    if (!this.setModal(`<header><h2>The War Smithy</h2><span class="gold-amt">🪙 ${me.gold}</span><span class="spacer"></span><button class="close">✕</button></header>
      <div class="body"><div class="shop"><div><div class="shop-cats">${cats.map((c) => `<button class="btn small ${c === this.shopCat ? 'primary' : ''}" data-cat="${c}">${c}</button>`).join('')}</div>${tiers}
      <div class="row" style="flex-wrap:wrap;gap:4px;margin-top:6px">${sell}</div></div><div>${detail}</div></div></div>`)) return;
    this.modal!.querySelectorAll<HTMLButtonElement>('[data-cat]').forEach((b) => b.onclick = () => { this.shopCat = b.dataset.cat as ItemCategory; this.renderShop(); });
    this.modal!.querySelectorAll<HTMLButtonElement>('[data-it]').forEach((b) => {
      b.onclick = () => { this.shopSel = b.dataset.it!; this.renderShop(); };
      b.ondblclick = () => this.session.send({ c: 'buy', item: b.dataset.it! });
      b.oncontextmenu = (ev) => { ev.preventDefault(); this.session.send({ c: 'buy', item: b.dataset.it! }); };
    });
    this.modal!.querySelectorAll<HTMLButtonElement>('[data-buy]').forEach((b) => b.onclick = () => this.session.send({ c: 'buy', item: b.dataset.buy! }));
    this.modal!.querySelectorAll<HTMLButtonElement>('[data-sell]').forEach((b) => b.onclick = () => this.session.send({ c: 'sell', slot: Number(b.dataset.sell) }));
  }
  private bindClose() { this.modal?.querySelectorAll<HTMLButtonElement>('.close').forEach((b) => b.onclick = () => this.closeModal()); }

  private renderBase() {
    const s = this.snap!, me = s.me!;
    const t = s.teams[this.myTeam];
    const upgrades = UPGRADES.map((u) => {
      const lvl = t.upgrades[u.id] ?? 0;
      const cost = u.costs[lvl];
      return `<div class="upg"><div class="row"><b>${u.icon} ${esc(u.name)}</b><span class="spacer"></span>${cost !== undefined ? `<button class="btn small primary" data-up="${u.id}" ${me.gold < cost ? 'disabled' : ''}>${cost}g</button>` : '<span class="tag">MAX</span>'}</div>
        <div class="muted" style="font-size:12px">${esc(u.description)}</div><div class="lv">${u.costs.map((_, i) => `<i class="${i < lvl ? 'on' : ''}"></i>`).join('')}</div>
        <ul>${u.levelText.map((x, i) => `<li class="${i < lvl ? 'done' : ''}">${esc(x)}</li>`).join('')}</ul></div>`;
    }).join('');
    const pads = s.pads.filter((p) => p[1] === this.myTeam).map((p, i) => {
      const where = ['North lane', 'South lane', 'North banner', 'South banner', 'Keep (north)', 'Keep (south)'][i] ?? `Pad ${i + 1}`;
      if (p[2]) {
        const tk = TOWERS[p[2] as keyof typeof TOWERS];
        const up = Math.round(tk.cost * TOWER_UPGRADE_COST * p[3]);
        return `<div class="upg"><b>${tk.icon} ${esc(tk.name)}</b> <span class="tag">Lv ${p[3]}</span> <span class="muted">${where}</span><div class="muted" style="font-size:12px">${esc(tk.description)}</div>
          ${p[3] < 3 ? `<button class="btn small primary" data-pad="${p[0]}" data-kind="upgrade" ${me.gold < up ? 'disabled' : ''}>Upgrade ${up}g</button>` : '<span class="tag">MAX</span>'}</div>`;
      }
      return `<div class="upg"><b>🧱 Empty pad</b> <span class="muted">${where}</span><div class="row" style="flex-wrap:wrap;gap:4px;margin-top:6px">
        ${BUILD_TOWER_KINDS.map((k) => `<button class="btn small" data-pad="${p[0]}" data-kind="${k}" title="${esc(TOWERS[k].description)}" ${me.gold < TOWERS[k].cost ? 'disabled' : ''}>${TOWERS[k].icon} ${esc(TOWERS[k].name)} ${TOWERS[k].cost}g</button>`).join('')}</div></div>`;
    }).join('');
    void buildPads;
    if (!this.setModal(`<header><h2>${TEAM_NAMES[this.myTeam]} Fortress</h2><span class="gold-amt">🪙 ${me.gold}</span><span class="muted">Upgrades are shared by your whole team. You can fund them from anywhere.</span><span class="spacer"></span><button class="close">✕</button></header>
      <div class="body"><h3 class="gold">Fortress upgrades</h3><div class="base-grid">${upgrades}</div>
      <h3 class="gold">Defensive towers</h3><div class="base-grid">${pads}</div>
      <h3 class="gold">Mercenaries</h3><div class="row">${LANE_NAMES.map((n, i) => `<button class="btn" data-hire="${i}" ${me.gold < MERCENARY.cost ? 'disabled' : ''}>💀 ${MERCENARY.name}: ${n} (${MERCENARY.cost}g)</button>`).join('')}</div>
      <p class="muted">${esc(MERCENARY.description)}</p></div>`)) return;
    this.modal!.querySelectorAll<HTMLButtonElement>('[data-up]').forEach((b) => b.onclick = () => this.session.send({ c: 'upgrade', id: b.dataset.up as UpgradeId }));
    this.modal!.querySelectorAll<HTMLButtonElement>('[data-pad]').forEach((b) => b.onclick = () => this.session.send({ c: 'build', pad: Number(b.dataset.pad), kind: b.dataset.kind as 'arrow' }));
    this.modal!.querySelectorAll<HTMLButtonElement>('[data-hire]').forEach((b) => b.onclick = () => this.session.send({ c: 'hire', lane: Number(b.dataset.hire) as 0 | 1 }));
  }

  private boardTable(board: HeroBoard[]) {
    return [0, 1].map((t) => `<h3 class="team${t} serif">${TEAM_NAMES[t]} <span class="muted" style="font-size:13px">${this.snap?.teams[t as Team].kills ?? 0} kills · ${this.snap?.teams[t as Team].towers ?? 0} towers · ${this.snap?.teams[t as Team].banners ?? 0}/3 banners</span></h3>
      <table><tr><th></th><th>Player</th><th>Lv</th><th>K / D / A</th><th>CS</th><th>Items</th><th></th></tr>
      ${board.filter((b) => b.team === t).map((b) => `<tr><td><img src="${portrait(b.hero)}"></td><td><b>${esc(b.name)}</b>${b.bot ? ' <span class="tag">bot</span>' : ''}<br><span class="muted">${esc(HERO_BY_ID[b.hero]?.name ?? '')}</span></td>
        <td>${b.lvl}</td><td>${b.k} / ${b.d} / ${b.a}</td><td>${b.cs}</td><td class="its">${b.items.map((i) => (i ? ITEM_BY_ID[i]?.icon ?? '' : '·')).join('')}</td><td>${b.respawn > 0 ? `💀 ${Math.ceil(b.respawn)}s` : ''}${b.gold >= 0 ? ` <span class="gold">${b.gold}g</span>` : ''}</td></tr>`).join('')}</table>`).join('');
  }
  private renderBoard() {
    this.setModal(`<header><h2>Scoreboard</h2><span class="spacer"></span><button class="close">✕</button></header><div class="body board">${this.boardTable(this.snap!.board)}</div>`);
  }

  private showEnd(s: Snapshot) {
    const won = s.winner === this.myTeam;
    this.closeModal();
    this.endScreen = h('div', { class: 'end-screen' }, `<div class="card panel"><h1 class="serif ${won ? 'gold' : 'team1'}">${won ? 'Victory' : 'Defeat'}</h1>
      <p class="muted">The ${TEAM_NAMES[s.winner!]} razed the enemy fortress in ${fmtTime(s.time)}.</p><div class="board">${this.boardTable(s.board)}</div>
      <div class="row" style="justify-content:center;margin-top:14px"><button class="btn primary" id="end-leave">Back to menu</button></div></div>`);
    this.root.appendChild(this.endScreen);
    this.endScreen.querySelector<HTMLButtonElement>('#end-leave')!.onclick = () => this.onLeave();
  }
}
