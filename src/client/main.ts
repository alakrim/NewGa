import { HEROES } from '../shared/data/heroes';
import type { RoomInfo, GameInit, GameMode } from '../shared/protocol';
import type { Team } from '../shared/types';
import { TEAM_NAMES, MAX_PLAYERS_PER_TEAM } from '../shared/constants';
import type { PlayerSetup } from '../shared/sim/game';
import { assets } from './assets';
import { GameScreen } from './game';
import { ReplaySession } from './replay';
import type { Replay } from '../shared/sim/game';
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
    <p class="tagline">Mine gold · raise an army · command your hero · destroy the enemy keep</p>
    <div class="col" style="margin-bottom:14px"><input class="field" id="name" maxlength="16" placeholder="Your name" value="${esc(playerName())}"></div>
    <div class="menu-buttons">
      <button class="btn primary" id="practice">⚔️ Practice vs Bots</button>
      <button class="btn" id="create">🌐 Create Online Room</button>
      <div class="join-row"><input class="field" id="code" maxlength="4" placeholder="CODE"><button class="btn" id="join">Join Room</button></div>
      <button class="btn" id="heroes">📜 Hero Codex</button>
      <button class="btn" id="how">❓ How to Play</button>
      <label class="btn" style="display:block">🎬 Load replay<input type="file" id="replay-file" accept=".json,application/json" class="hidden"></label>
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
  el.querySelector<HTMLInputElement>('#replay-file')!.onchange = async (ev) => {
    const f = (ev.target as HTMLInputElement).files?.[0];
    if (!f) return;
    try { const r = JSON.parse(await f.text()) as Replay; if (r.v !== 1 || !r.setups) throw new Error(); watchReplay(r); } catch { toast('That is not a Bannerfall replay file', '#ff8a8d'); }
  };
}

function howTo() {
  const el = h('div', { class: 'screen' }, `<div class="menu-card panel howto" style="width:min(780px,100%);text-align:left">
    <h2 class="serif gold">How to play</h2>
    <h3 class="serif" style="margin:6px 0">⚔️ Frontline <span class="tag">main mode</span></h3>
    <p><b>Goal.</b> Destroy the enemy <b>keep</b> at the far end of the lane (2v2: you and a teammate share one). Yours falls, you lose.</p>
    <p><b>Economy.</b> You start with two <b>miners</b> (🪙150 each). They dig gold from veins near your base and carry it home; more miners, more gold. The two rich veins in the middle pay 60% more but are dangerous. A <b>Mine Shaft</b> makes every trip pay +40%, <b>Markets</b> add +2 gold/s. Everyone has their own purse, army and buildings.</p>
    <p><b>Army.</b> Train units with <kbd>1</kbd>-<kbd>8</kbd> (<kbd>Shift</kbd> = 5). Miners and Swordsmen come straight from your keep; everything else needs a building, which you place on your 7 <b>plots</b> in the <b>Build panel</b> (<kbd>B</kbd>): Barracks (Shieldbearer, Assassin), Archery Range (Archer), Arcane Sanctum (Battlemage, Healer; needs an Archery Range), Giant Pit (Giant; needs a Barracks). <b>Houses</b> raise your population cap, the <b>Forge</b> researches damage and armour, <b>Watchtowers</b> guard your gate.</p>
    <p><b>Stances.</b> <kbd>Z</kbd> <b>Garrison</b>: everyone hides in the keep and makes it shoot faster. <kbd>X</kbd> <b>Defend</b>: the army forms up in front of your base. <kbd>C</kbd> <b>Hold</b>: hold the line at a rally point you place with your cursor. <kbd>V</kbd> <b>Attack</b>: march on the enemy keep.</p>
    <p><b>Heroes.</b> You directly control one hero: <kbd>W A S D</kbd> to walk, <kbd>Right-click</kbd> to move or attack, <kbd>Q E R F</kbd> for abilities (hold to aim, release to cast; F unlocks at level 4). Your hero levels up in battle and respawns after dying. Their abilities hit armies a bit softer, so lead your troops rather than fight alone.</p>
    <p><b>Banners.</b> Three banners stand along the lane. Park soldiers or your hero beside one with no enemies near to capture it. Each banner you hold pays every teammate gold every second (the central Heart Banner pays double).</p>
    <p><b>Also.</b> <kbd>Space</kbd> centre on hero · <kbd>Y</kbd> camera lock · <kbd>Tab</kbd> scores · <kbd>Enter</kbd> chat · <kbd>M</kbd> mute · <kbd>F1</kbd> controls. Click the minimap to move the camera, right-click it to send your hero.</p>
    <details style="margin-top:10px"><summary class="gold serif" style="cursor:pointer;font-size:16px">🏰 Crossing (classic mode)</summary>
    <p><b>Goal.</b> Destroy the enemy <b>Fortress Core</b>. It is shielded by its three <b>banners</b>: while all three still fly it takes no damage; with 2 it takes 35%, with 1 it takes 60%, and with none it takes full damage.</p>
    <p><b>Banners.</b> Stand inside an enemy banner's circle with no defenders inside to capture it (6s, faster with friends). A lane banner unlocks once that lane's <b>outer tower</b> falls; the <b>Keep Banner</b> unlocks once a lane banner is taken. Each capture pays every teammate 🪙250 and each banner grants its captors a perk. You can also <b>respawn</b> at enemy banners you hold.</p>
    <p><b>Monster waves.</b> Your Bone Forge raises skeletons every 30s that march both lanes. In the Fortress panel set each lane's <b>directive</b>, upgrade the Forge, or hire Bone Brutes.</p>
    <p><b>Gold.</b> Earned passively, for last hits, kills, towers, banners and jungle camps. Spend it at the War Smithy (at your fountain) on equipment, or in the Fortress panel on team upgrades and <b>defensive towers</b>.</p>
    <p><b>Controls.</b> <kbd>Right-click</kbd> move / attack · <kbd>Q W E R</kbd> hold to aim, release to cast · <kbd>1-6</kbd> items · <kbd>B</kbd> recall · <kbd>P</kbd> shop · <kbd>U</kbd> fortress · <kbd>Tab</kbd> score · <kbd>A</kbd> attack-move · <kbd>G</kbd> ping · <kbd>Space</kbd> center camera · <kbd>Y</kbd> unlock camera · arrow keys steer.</p></details>
    <div class="row" style="margin-top:12px"><span class="spacer"></span><button class="btn primary" id="back">Back</button></div></div>`);
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

const MODE_INFO: Record<GameMode, { name: string; icon: string; text: string }> = {
  frontline: { name: 'Frontline', icon: '⚔️', text: 'One lane. Mine gold, raise an army, lead your hero and destroy the enemy keep. Up to 2v2.' },
  crossing: { name: 'Crossing', icon: '🏰', text: 'The classic: two lanes, monster waves, banners and shops. Up to 5v5.' },
};
/** Frontline has plots for two players per team; Crossing takes up to five. */
const teamSizes = (mode: GameMode) => (mode === 'frontline' ? [1, 2] : [1, 2, 3, 4, 5]);

// ------------------------------------------------------------------ practice (local, offline)
function practiceLobby() {
  let team: Team = 0;
  let mode: GameMode = 'frontline';
  const sizes: Record<GameMode, number> = { frontline: 2, crossing: 3 };
  let hero = safeGet('bf.hero') ?? HEROES[0].id;
  const el = h('div', { class: 'screen' }, `<div class="lobby">
    <div class="panel col"><h2>Practice vs Bots</h2><p class="muted">Runs entirely in your browser. Bots fill both teams.</p>
      <div><div class="muted">Mode</div><div class="row" id="modes"></div><p class="muted" id="modetext" style="font-size:12px;margin:6px 0 0"></p></div>
      <div><div class="muted">Your team</div><div class="row" id="teams"></div></div>
      <div><div class="muted">Team size</div><div class="row" id="sizes"></div></div>
      <span class="spacer"></span><button class="btn primary" id="go">Start match</button><button class="btn" id="back">Back</button></div>
    <div class="panel" id="grid"></div><div class="panel" id="detail"></div></div>`);
  show(el);
  const draw = () => {
    el.querySelector('#teams')!.innerHTML = ([0, 1] as Team[]).map((t) => `<button class="btn ${t === team ? `bg-team${t}` : ''}" data-t="${t}">${TEAM_NAMES[t]}</button>`).join('');
    el.querySelector('#modes')!.innerHTML = (['frontline', 'crossing'] as GameMode[]).map((m) => `<button class="btn ${m === mode ? 'primary' : ''}" data-mode="${m}">${MODE_INFO[m].icon} ${MODE_INFO[m].name}</button>`).join('');
    el.querySelector('#modetext')!.textContent = MODE_INFO[mode].text;
    el.querySelector('#sizes')!.innerHTML = teamSizes(mode).map((n) => `<button class="btn small ${n === sizes[mode] ? 'primary' : ''}" data-s="${n}">${n}v${n}</button>`).join('');
    el.querySelectorAll<HTMLButtonElement>('[data-mode]').forEach((b) => b.onclick = () => { mode = b.dataset.mode as GameMode; draw(); });
    el.querySelectorAll<HTMLButtonElement>('[data-t]').forEach((b) => b.onclick = () => { team = Number(b.dataset.t) as Team; draw(); });
    el.querySelectorAll<HTMLButtonElement>('[data-s]').forEach((b) => b.onclick = () => { sizes[mode] = Number(b.dataset.s); draw(); });
  };
  draw();
  const picker = new HeroPicker(el.querySelector('#grid')!, el.querySelector('#detail')!, (id) => { hero = id; safeSet('bf.hero', id); }, hero);
  picker.render();
  el.querySelector<HTMLButtonElement>('#back')!.onclick = () => menu();
  el.querySelector<HTMLButtonElement>('#go')!.onclick = () => {
    const name = playerName();
    const used = new Set([hero]);
    const pick = () => { const free = HEROES.filter((x) => !used.has(x.id)); const x = free[Math.floor(Math.random() * free.length)]; used.add(x.id); return x.id; };
    const size = sizes[mode];
    const setups: PlayerSetup[] = [{ pid: 'you', name, team, heroId: hero, bot: false }];
    for (const t of [0, 1] as Team[]) {
      const need = size - (t === team ? 1 : 0);
      for (let i = 0; i < need; i++) setups.push({ pid: `bot${t}${i}`, name: `${t === 0 ? 'Dawn' : 'Dusk'} Bot ${i + 1}`, team: t, heroId: pick(), bot: true });
    }
    const s = new LocalSession(setups, 'you', mode);
    startGame(s, () => s.start());
  };
}

// ------------------------------------------------------------------ online
let lastRoom: RoomInfo | null = null;

async function connect(): Promise<NetClient> {
  if (net) return net;
  const c = new NetClient();
  net = c;
  c.onError = (m) => {
    toast(m, '#ff8a8d');
    // a failed create/join (bad code, full room, match already running) leaves us nowhere: back to the menu
    if (!c.roomCode && !game) { history.replaceState(null, '', location.pathname); if (!screen?.querySelector('#create')) menu(); }
  };
  c.onLink = (up) => toast(up ? 'Reconnected' : 'Connection lost, reconnecting…', up ? undefined : '#ff8a8d');
  c.onClose = (why) => {
    if (net !== c) return;
    net = null;
    lastRoom = null;
    lobbyEl = null;
    toast(why ?? 'Disconnected from server', '#ff8a8d');
    if (game) { const g = game; game = null; g.dispose(false); }
    history.replaceState(null, '', location.pathname);
    menu();
  };
  c.onRoom = (r) => onlineLobby(c, r);
  try { await c.ready; } catch (err) { net = null; throw err; }
  return c;
}

async function createOnline() {
  try {
    const c = await connect();
    c.raw({ t: 'create', name: playerName() });
  } catch (err) { toast((err as Error).message, '#ff8a8d'); }
}

async function joinOnline(code: string) {
  try {
    const c = await connect();
    c.raw({ t: 'join', code, name: playerName() });
  } catch (err) { toast((err as Error).message, '#ff8a8d'); history.replaceState(null, '', location.pathname); menu(); }
}

let lobbyEl: HTMLElement | null = null;
let lobbyPicker: HeroPicker | null = null;
function onlineLobby(c: NetClient, r: RoomInfo) {
  lastRoom = r;
  if (!r.code) { lobbyEl = null; lobbyPicker = null; if (game) { const g = game; game = null; g.dispose(false); } menu(); return; }
  c.onInit = (init) => startGame(c, undefined, init);
  if (game) {
    if (r.started) { game.setHost(r.host === c.pid); return; }
    // the host sent everyone back to the room lobby ("Play again")
    const g = game;
    game = null;
    lobbyEl = null;
    g.dispose(false);
  }
  const mine = r.slots.find((s) => s.pid === c.pid);
  const isHost = r.host === c.pid;
  if (!lobbyEl || !document.body.contains(lobbyEl)) {
    lobbyEl = h('div', { class: 'screen' }, `<div class="lobby"><div class="panel col" id="side"></div><div class="panel" id="grid"></div><div class="panel" id="detail"></div></div>`);
    show(lobbyEl);
    lobbyPicker = new HeroPicker(lobbyEl.querySelector('#grid')!, lobbyEl.querySelector('#detail')!, (id) => { c.raw({ t: 'hero', heroId: id }); safeSet('bf.hero', id); }, mine?.heroId ?? null);
    const pref = safeGet('bf.hero');
    const blocked = r.slots.some((x) => x.team === mine?.team && x.pid !== c.pid && x.heroId === pref);
    if (!mine?.heroId && pref && !blocked) c.raw({ t: 'hero', heroId: pref });
    history.replaceState(null, '', `?room=${r.code}`);
  }
  const taken = new Set(r.slots.filter((s) => s.team === mine?.team && s.pid !== c.pid && s.heroId).map((s) => s.heroId!));
  if (lobbyPicker) { lobbyPicker.selected = mine?.heroId ?? lobbyPicker.selected; lobbyPicker.render(taken); }
  const side = lobbyEl.querySelector<HTMLElement>('#side')!;
  const invite = `${location.origin}${location.pathname}?room=${r.code}`;
  const cap = r.mode === 'frontline' ? 2 : MAX_PLAYERS_PER_TEAM;
  const count = (t: Team) => r.slots.filter((x) => x.team === t).length;
  const team = (t: Team) => `<div><div class="row"><h2 class="team${t}" style="margin:0">${TEAM_NAMES[t]}</h2><span class="spacer"></span>
      ${mine && mine.team !== t && count(t) < cap ? `<button class="btn small" data-team="${t}">Join</button>` : ''}${isHost && count(t) < cap ? `<button class="btn small" data-bot="${t}">+ Bot</button>` : ''}</div>
      ${r.slots.filter((s) => s.team === t).map((s) => `<div class="slot bg-team${t}">${s.heroId ? `<img src="${portrait(s.heroId)}">` : '<img>'}<span class="name">${esc(s.name)}${s.pid === r.host ? ' 👑' : ''}${s.pid === c.pid ? ' (you)' : ''}</span>
        <span class="muted">${s.heroId ? esc(HEROES.find((x) => x.id === s.heroId)?.name ?? '') : 'picking…'}</span>${s.bot && isHost ? `<button class="close" data-rm="${s.pid}">✕</button>` : ''}</div>`).join('') || '<p class="muted">Empty</p>'}</div>`;
  const over = r.mode === 'frontline' && (count(0) > 2 || count(1) > 2);
  side.innerHTML = `<div class="code-box" id="code" title="Click to copy the invite link">${r.code}</div>
    <button class="btn small" id="copy">🔗 Copy invite link</button>
    <div><div class="muted">Mode</div>${isHost
      ? `<div class="row">${(['frontline', 'crossing'] as GameMode[]).map((m) => `<button class="btn small ${m === r.mode ? 'primary' : ''}" data-mode="${m}">${MODE_INFO[m].icon} ${MODE_INFO[m].name}</button>`).join('')}</div>`
      : `<div class="gold"><b>${MODE_INFO[r.mode].icon} ${MODE_INFO[r.mode].name}</b></div>`}
      <div class="muted" style="font-size:12px;margin-top:4px">${MODE_INFO[r.mode].text}</div>
      ${over ? '<div style="color:#ffb36b;font-size:12px;margin-top:4px">Frontline holds two players per team: move someone over before starting.</div>' : ''}</div>
    ${team(0)}${team(1)}
    <div class="muted" style="font-size:12px">${isHost ? 'Empty seats are filled with bots when you start.' : 'Waiting for the host to start…'}</div>
    ${isHost ? `<label class="row"><input type="checkbox" id="fill" ${r.fillBots ? 'checked' : ''}> Fill with bots up to <select id="ts">${teamSizes(r.mode).map((n) => `<option ${n === r.teamSize ? 'selected' : ''}>${n}</option>`).join('')}</select> per team</label>` : ''}
    <span class="spacer"></span>
    ${isHost ? '<button class="btn primary" id="start">Start match</button>' : ''}
    <button class="btn" id="leave">Leave</button>`;
  const copy = () => { navigator.clipboard?.writeText(invite).then(() => toast('Invite link copied!')).catch(() => toast(invite)); };
  side.querySelector<HTMLElement>('#code')!.onclick = copy;
  side.querySelector<HTMLButtonElement>('#copy')!.onclick = copy;
  side.querySelectorAll<HTMLButtonElement>('[data-mode]').forEach((b) => b.onclick = () => c.raw({ t: 'mode', mode: b.dataset.mode as GameMode }));
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
      if (s.online) { net = null; lastRoom = null; history.replaceState(null, '', location.pathname); }
      menu();
    }, () => { if (s.online) (s as NetClient).raw({ t: 'lobbyReturn' }); });
    if (s.online) game.setHost(lastRoom?.host === (s as NetClient).pid);
    game.setWatchReplay(() => {
      const r = s.getReplay?.();
      if (!r) return;
      game?.dispose();
      game = null;
      if (s.online) { net = null; lastRoom = null; history.replaceState(null, '', location.pathname); }
      watchReplay(r);
    });
  };
  if (init) begin(init);
  else s.onInit = begin;
  after?.();
}

function watchReplay(r: Replay) {
  const rs = new ReplaySession(r);
  startGame(rs, () => rs.start());
}

boot();
