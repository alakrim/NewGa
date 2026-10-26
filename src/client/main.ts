import { HEROES } from '../shared/data/heroes';
import type { RoomInfo, GameInit } from '../shared/protocol';
import type { Team } from '../shared/types';
import { TEAM_NAMES, MAX_PLAYERS_PER_TEAM } from '../shared/constants';
import type { PlayerSetup } from '../shared/sim/game';
import { assets } from './assets';
import { GameScreen } from './game';
import { LocalSession, NetClient, safeGet, safeSet, type Session } from './net';
import { esc, h, toast, ui } from './ui/dom';
import { HeroPicker } from './ui/heroes';
import { portrait, warmPortraits } from './ui/portraits';

const canvas = document.getElementById('game') as HTMLCanvasElement;
let screen: HTMLElement | null = null;
let net: NetClient | null = null;
let game: GameScreen | null = null;

function show(el: HTMLElement) {
  screen?.remove();
  screen = el;
  ui().appendChild(el);
}

const playerName = () => safeGet('bf.name') || `Hero${Math.floor(Math.random() * 900 + 100)}`;

// ------------------------------------------------------------------ loading
async function boot() {
  const el = h('div', { class: 'screen' }, `<div class="menu-card panel"><h1 class="logo">Bannerfall</h1><p class="tagline">Raising the banners…</p><div class="loading-bar"><div></div></div></div>`);
  show(el);
  const bar = el.querySelector<HTMLElement>('.loading-bar > div')!;
  await assets.loadAll((f) => { bar.style.width = `${Math.round(f * 100)}%`; });
  warmPortraits();
  const room = new URLSearchParams(location.search).get('room');
  if (room) joinOnline(room.toUpperCase());
  else menu();
}

// ------------------------------------------------------------------ main menu
function menu() {
  const el = h('div', { class: 'screen' }, `<div class="menu-card panel">
    <h1 class="logo">Bannerfall</h1>
    <p class="tagline">20 heroes · monster waves · capture the banners · raze the fortress</p>
    <div class="col" style="margin-bottom:14px"><input class="field" id="name" maxlength="16" placeholder="Your name" value="${esc(playerName())}"></div>
    <div class="menu-buttons">
      <button class="btn primary" id="practice">⚔️ Practice vs Bots</button>
      <button class="btn" id="create">🌐 Create Online Room</button>
      <div class="join-row"><input class="field" id="code" maxlength="4" placeholder="CODE"><button class="btn" id="join">Join Room</button></div>
      <button class="btn" id="heroes">📜 Hero Codex</button>
      <button class="btn" id="how">❓ How to Play</button>
    </div>
    <p class="footer-note">Art: KayKit by Kay Lousberg (CC0). Built with Three.js.</p></div>`);
  show(el);
  const name = el.querySelector<HTMLInputElement>('#name')!;
  name.oninput = () => safeSet('bf.name', name.value.trim());
  el.querySelector<HTMLButtonElement>('#practice')!.onclick = () => practiceLobby();
  el.querySelector<HTMLButtonElement>('#create')!.onclick = () => createOnline();
  el.querySelector<HTMLButtonElement>('#join')!.onclick = () => { const c = el.querySelector<HTMLInputElement>('#code')!.value.trim().toUpperCase(); if (c.length === 4) joinOnline(c); else toast('Enter a 4-letter room code'); };
  el.querySelector<HTMLButtonElement>('#heroes')!.onclick = () => codex();
  el.querySelector<HTMLButtonElement>('#how')!.onclick = () => howTo();
}

function howTo() {
  const el = h('div', { class: 'screen' }, `<div class="menu-card panel" style="width:min(760px,100%);text-align:left">
    <h2 class="serif gold">How to play</h2>
    <p><b>Goal.</b> Destroy the enemy <b>Fortress Core</b>. It is shielded by its three <b>banners</b>: while all three still fly it takes no damage; with 2 it takes 50%, with 1 it takes 80%, and with none it takes 125%.</p>
    <p><b>Banners.</b> Stand inside an enemy banner's circle with no defenders inside to capture it (6s, faster with friends). A lane banner unlocks once that lane's <b>outer tower</b> falls; the <b>Keep Banner</b> unlocks once a lane banner is taken. Each capture pays every teammate 🪙250 and every held enemy banner pays your team gold every second. Defenders can recapture.</p>
    <p><b>Monster waves.</b> Your Bone Forge raises skeletons every 30s that march both lanes. Upgrade the Forge to make them bigger and add Wraiths, or hire Bone Brutes for a lane.</p>
    <p><b>Gold.</b> Earned passively, for last hits, kills, assists, towers, banners, jungle camps and the <b>Bone Colossus</b> at the centre (spawns at 5:00, empowers your whole team). Spend it at the War Smithy (at your fountain) on equipment, or in the Fortress panel on team upgrades and <b>defensive towers</b> on build pads: Arrow, Frost (slow), Cannon (splash) and Arcane (chains, anti-hero).</p>
    <p><b>Day and night.</b> Every 4 minutes night falls for 2: vision shrinks and monsters pay 50% more. Ambush time.</p>
    <p><b>Controls.</b> <kbd>Right-click</kbd> move / attack · <kbd>Q W E R</kbd> hold to aim, release to cast (R unlocks at level 4) · <kbd>1-6</kbd> items · <kbd>B</kbd> recall · <kbd>P</kbd> shop · <kbd>U</kbd> fortress · <kbd>Tab</kbd> score · <kbd>A</kbd> attack-move · <kbd>G</kbd> ping · <kbd>Space</kbd> center camera · <kbd>Y</kbd> unlock camera · mouse wheel zoom · arrow keys steer.</p>
    <div class="row"><span class="spacer"></span><button class="btn primary" id="back">Back</button></div></div>`);
  show(el);
  el.querySelector<HTMLButtonElement>('#back')!.onclick = () => menu();
}

function codex() {
  const el = h('div', { class: 'screen' }, `<div class="lobby" style="grid-template-columns: 1fr 380px"><div class="panel"><div class="row"><h2>Hero Codex</h2><span class="spacer"></span><button class="btn small" id="back">Back</button></div><div id="grid"></div></div><div class="panel" id="detail"></div></div>`);
  show(el);
  const picker = new HeroPicker(el.querySelector('#grid')!, el.querySelector('#detail')!, () => {}, HEROES[0].id);
  picker.render();
  el.querySelector<HTMLButtonElement>('#back')!.onclick = () => menu();
}

// ------------------------------------------------------------------ practice (local, offline)
function practiceLobby() {
  let team: Team = 0;
  let size = 3;
  let hero = safeGet('bf.hero') ?? HEROES[0].id;
  const el = h('div', { class: 'screen' }, `<div class="lobby">
    <div class="panel col"><h2>Practice vs Bots</h2><p class="muted">Runs entirely in your browser. Bots fill both teams.</p>
      <div><div class="muted">Your team</div><div class="row" id="teams"></div></div>
      <div><div class="muted">Team size</div><div class="row" id="sizes"></div></div>
      <span class="spacer"></span><button class="btn primary" id="go">Start match</button><button class="btn" id="back">Back</button></div>
    <div class="panel" id="grid"></div><div class="panel" id="detail"></div></div>`);
  show(el);
  const draw = () => {
    el.querySelector('#teams')!.innerHTML = ([0, 1] as Team[]).map((t) => `<button class="btn ${t === team ? `bg-team${t}` : ''}" data-t="${t}">${TEAM_NAMES[t]}</button>`).join('');
    el.querySelector('#sizes')!.innerHTML = [1, 2, 3, 4, 5].map((n) => `<button class="btn small ${n === size ? 'primary' : ''}" data-s="${n}">${n}v${n}</button>`).join('');
    el.querySelectorAll<HTMLButtonElement>('[data-t]').forEach((b) => b.onclick = () => { team = Number(b.dataset.t) as Team; draw(); });
    el.querySelectorAll<HTMLButtonElement>('[data-s]').forEach((b) => b.onclick = () => { size = Number(b.dataset.s); draw(); });
  };
  draw();
  const picker = new HeroPicker(el.querySelector('#grid')!, el.querySelector('#detail')!, (id) => { hero = id; safeSet('bf.hero', id); }, hero);
  picker.render();
  el.querySelector<HTMLButtonElement>('#back')!.onclick = () => menu();
  el.querySelector<HTMLButtonElement>('#go')!.onclick = () => {
    const name = playerName();
    const used = new Set([hero]);
    const pick = () => { const free = HEROES.filter((x) => !used.has(x.id)); const x = free[Math.floor(Math.random() * free.length)]; used.add(x.id); return x.id; };
    const setups: PlayerSetup[] = [{ pid: 'you', name, team, heroId: hero, bot: false }];
    for (const t of [0, 1] as Team[]) {
      const need = size - (t === team ? 1 : 0);
      for (let i = 0; i < need; i++) setups.push({ pid: `bot${t}${i}`, name: `${t === 0 ? 'Dawn' : 'Dusk'} Bot ${i + 1}`, team: t, heroId: pick(), bot: true });
    }
    const s = new LocalSession(setups, 'you');
    startGame(s, () => s.start());
  };
}

// ------------------------------------------------------------------ online
async function connect(): Promise<NetClient> {
  if (net) return net;
  const c = new NetClient();
  net = c;
  c.onError = (m) => toast(m, '#ff8a8d');
  c.onClose = () => { if (net === c) { net = null; if (!game) { toast('Disconnected from server', '#ff8a8d'); menu(); } } };
  try { await c.ready; } catch (err) { net = null; throw err; }
  return c;
}

async function createOnline() {
  try {
    const c = await connect();
    c.onRoom = (r) => onlineLobby(c, r);
    c.raw({ t: 'create', name: playerName() });
  } catch (err) { toast((err as Error).message, '#ff8a8d'); }
}

async function joinOnline(code: string) {
  try {
    const c = await connect();
    c.onRoom = (r) => onlineLobby(c, r);
    c.raw({ t: 'join', code, name: playerName() });
  } catch (err) { toast((err as Error).message, '#ff8a8d'); menu(); }
}

let lobbyEl: HTMLElement | null = null;
let lobbyPicker: HeroPicker | null = null;
function onlineLobby(c: NetClient, r: RoomInfo) {
  if (!r.code) { lobbyEl = null; lobbyPicker = null; menu(); return; }
  c.onInit = (init) => startGame(c, undefined, init);
  if (game) return;
  const mine = r.slots.find((s) => s.pid === c.pid);
  const isHost = r.host === c.pid;
  if (!lobbyEl || !document.body.contains(lobbyEl)) {
    lobbyEl = h('div', { class: 'screen' }, `<div class="lobby"><div class="panel col" id="side"></div><div class="panel" id="grid"></div><div class="panel" id="detail"></div></div>`);
    show(lobbyEl);
    lobbyPicker = new HeroPicker(lobbyEl.querySelector('#grid')!, lobbyEl.querySelector('#detail')!, (id) => { c.raw({ t: 'hero', heroId: id }); safeSet('bf.hero', id); }, mine?.heroId ?? null);
    const pref = safeGet('bf.hero');
    if (!mine?.heroId && pref) c.raw({ t: 'hero', heroId: pref });
    history.replaceState(null, '', `?room=${r.code}`);
  }
  const taken = new Set(r.slots.filter((s) => s.team === mine?.team && s.pid !== c.pid && s.heroId).map((s) => s.heroId!));
  if (lobbyPicker) { lobbyPicker.selected = mine?.heroId ?? lobbyPicker.selected; lobbyPicker.render(taken); }
  const side = lobbyEl.querySelector<HTMLElement>('#side')!;
  const invite = `${location.origin}${location.pathname}?room=${r.code}`;
  const team = (t: Team) => `<div><div class="row"><h2 class="team${t}" style="margin:0">${TEAM_NAMES[t]}</h2><span class="spacer"></span>
      ${mine && mine.team !== t ? `<button class="btn small" data-team="${t}">Join</button>` : ''}${isHost ? `<button class="btn small" data-bot="${t}">+ Bot</button>` : ''}</div>
      ${r.slots.filter((s) => s.team === t).map((s) => `<div class="slot bg-team${t}">${s.heroId ? `<img src="${portrait(s.heroId)}">` : '<img>'}<span class="name">${esc(s.name)}${s.pid === r.host ? ' 👑' : ''}${s.pid === c.pid ? ' (you)' : ''}</span>
        <span class="muted">${s.heroId ? esc(HEROES.find((x) => x.id === s.heroId)?.name ?? '') : 'picking…'}</span>${s.bot && isHost ? `<button class="close" data-rm="${s.pid}">✕</button>` : ''}</div>`).join('') || '<p class="muted">Empty</p>'}</div>`;
  side.innerHTML = `<div class="code-box" id="code" title="Click to copy the invite link">${r.code}</div>
    <button class="btn small" id="copy">🔗 Copy invite link</button>
    ${team(0)}${team(1)}
    <div class="muted" style="font-size:12px">${isHost ? 'Empty seats are filled with bots when you start.' : 'Waiting for the host to start…'}</div>
    ${isHost ? `<label class="row"><input type="checkbox" id="fill" ${r.fillBots ? 'checked' : ''}> Fill with bots up to <select id="ts">${[1, 2, 3, 4, 5].map((n) => `<option ${n === r.teamSize ? 'selected' : ''}>${n}</option>`).join('')}</select> per team</label>` : ''}
    <span class="spacer"></span>
    ${isHost ? '<button class="btn primary" id="start">Start match</button>' : ''}
    <button class="btn" id="leave">Leave</button>`;
  const copy = () => { navigator.clipboard?.writeText(invite).then(() => toast('Invite link copied!')).catch(() => toast(invite)); };
  side.querySelector<HTMLElement>('#code')!.onclick = copy;
  side.querySelector<HTMLButtonElement>('#copy')!.onclick = copy;
  side.querySelectorAll<HTMLButtonElement>('[data-team]').forEach((b) => b.onclick = () => c.raw({ t: 'team', team: Number(b.dataset.team) as Team }));
  side.querySelectorAll<HTMLButtonElement>('[data-bot]').forEach((b) => b.onclick = () => c.raw({ t: 'addBot', team: Number(b.dataset.bot) as Team }));
  side.querySelectorAll<HTMLButtonElement>('[data-rm]').forEach((b) => b.onclick = () => c.raw({ t: 'removeBot', pid: b.dataset.rm! }));
  const fill = side.querySelector<HTMLInputElement>('#fill');
  const ts = side.querySelector<HTMLSelectElement>('#ts');
  if (fill && ts) { const upd = () => c.raw({ t: 'fillBots', on: fill.checked, teamSize: Number(ts.value) }); fill.onchange = upd; ts.onchange = upd; }
  side.querySelector<HTMLButtonElement>('#start')?.addEventListener('click', () => c.raw({ t: 'start' }));
  side.querySelector<HTMLButtonElement>('#leave')!.onclick = () => { c.raw({ t: 'leave' }); history.replaceState(null, '', location.pathname); };
  void MAX_PLAYERS_PER_TEAM;
}

// ------------------------------------------------------------------ game
function startGame(s: Session, after?: () => void, init?: GameInit) {
  const begin = (i: GameInit) => {
    if (game) return;
    screen?.remove();
    screen = null;
    lobbyEl = null;
    game = new GameScreen(canvas, i, s, () => {
      game = null;
      if (s.online) { net = null; history.replaceState(null, '', location.pathname); }
      menu();
    });
  };
  if (init) begin(init);
  else s.onInit = begin;
  after?.();
}

boot();
