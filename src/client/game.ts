import * as THREE from 'three';
import type { GameInit, Snapshot } from '../shared/protocol';
import type { AbilitySlot } from '../shared/types';
import { HERO_BY_ID } from '../shared/data/heroes';
import { MAP } from '../shared/map';
import { FL } from '../shared/frontline/data';
import { World, type UnitView } from './render/world';
import { sfx } from './sfx';
import { toast } from './ui/dom';
import { Hud } from './ui/hud';
import { FrontHud } from './ui/fl-hud';
import type { GameHud } from './ui/hud-api';
import type { Session } from './net';

const SLOT_KEYS: Record<string, AbilitySlot> = { KeyQ: 'Q', KeyW: 'W', KeyE: 'E', KeyR: 'R' };
/** Frontline puts the four abilities on Q E R F (W is for walking). */
const FL_SLOT_KEYS: Record<string, AbilitySlot> = { KeyQ: 'Q', KeyE: 'W', KeyR: 'E', KeyF: 'R' };
const FL_STANCE_KEYS = { KeyZ: 'garrison', KeyX: 'defend', KeyC: 'hold', KeyV: 'attack' } as const;
const FL_CAM_Z = -2;

/** One running match on screen: owns the World renderer, the HUD and the input mapping. */
export class GameScreen {
  private world: World;
  private hud: GameHud;
  private fh: FrontHud | null = null;
  private frontline: boolean;
  private overCanvas = false;
  private lastDir = '0,0';
  private mouse = { x: 0, y: 0, ndcX: 0, ndcY: 0 };
  private raf = 0;
  private last = performance.now();
  private camLocked = true;
  private aiming: AbilitySlot | null = null;
  private attackMove = false;
  private pingMode = false;
  private steer = { up: false, down: false, left: false, right: false };
  private dragging: { x: number; y: number; cam: THREE.Vector3 } | null = null;
  private snap: Snapshot | null = null;
  private heroId: string;
  private disposers: (() => void)[] = [];
  private rightHeld = false;
  private lastRightMove = 0;

  constructor(canvas: HTMLCanvasElement, private init: GameInit, private session: Session, onLeave: () => void, onReplay: () => void = () => {}) {
    this.world = new World(canvas, init);
    this.frontline = init.mode === 'frontline';
    if (this.frontline) { this.fh = new FrontHud(init, session, this.world); this.hud = this.fh; } else this.hud = new Hud(init, session, this.world);
    this.hud.onLeave = () => { this.dispose(); onLeave(); };
    this.hud.onReplay = () => onReplay();
    this.hud.onMinimap = (x, z, button) => {
      if (this.frontline) {
        if (button === 2) { this.session.send({ c: 'move', x, z }); this.world.showMoveMarker(x, z, false); }
        else { this.camLocked = false; this.world.camTarget.x = x; }
      } else if (button === 2) { this.session.send({ c: 'move', x, z }); this.world.showMoveMarker(x, z, false); }
      else { this.camLocked = false; this.world.camTarget.set(x, 0, z); }
    };
    this.heroId = init.players.find((p) => p.playerId === init.you)?.heroId ?? '';
    if (!this.heroId) this.camLocked = false; // spectators fly the camera freely
    if (this.frontline) {
      this.world.camTarget.z = FL_CAM_Z;
      if (!this.heroId) this.world.camTarget.x = 0;
    }
    session.onSnap = (s) => this.onSnap(s);
    this.bindInput(canvas);
    const loop = () => { this.raf = requestAnimationFrame(loop); this.frame(); };
    loop();
  }

  private onSnap(s: Snapshot) {
    this.snap = s;
    this.world.applySnapshot(s);
    for (const e of s.events) this.world.handleEvent(e);
    this.hud.update(s);
  }

  private myView(): UnitView | undefined { return this.snap?.me ? this.world.units.get(this.snap.me.unit) : undefined; }

  private frame() {
    const now = performance.now();
    const dt = Math.min(0.1, (now - this.last) / 1000);
    this.last = now;
    const me = this.myView();
    // camera
    const fl = this.frontline;
    if (this.camLocked && me) this.world.camTarget.lerp(new THREE.Vector3(me.pos.x, 0, fl ? FL_CAM_Z : me.pos.z), 1 - Math.exp(-dt * 8));
    else if (!this.dragging && document.hasFocus()) {
      const edge = 18, speed = this.world.camDist * 1.2 * dt;
      if (this.mouse.x < edge) this.world.camTarget.x -= speed;
      if (this.mouse.x > window.innerWidth - edge) this.world.camTarget.x += speed;
      if (!fl && this.mouse.y < edge) this.world.camTarget.z -= speed;
      if (!fl && this.mouse.y > window.innerHeight - edge) this.world.camTarget.z += speed;
    }
    if (fl) {
      this.world.camTarget.x = THREE.MathUtils.clamp(this.world.camTarget.x, FL.minX, FL.maxX);
      this.world.camTarget.z = FL_CAM_Z;
    } else {
      this.world.camTarget.x = THREE.MathUtils.clamp(this.world.camTarget.x, MAP.minX, MAP.maxX);
      this.world.camTarget.z = THREE.MathUtils.clamp(this.world.camTarget.z, MAP.minZ + 10, MAP.maxZ);
    }
    // holding right mouse keeps steering toward the cursor
    if (this.rightHeld && now - this.lastRightMove > 120) {
      this.lastRightMove = now;
      const p = this.world.pick(this.mouse.ndcX, this.mouse.ndcY);
      if (p) this.session.send({ c: 'move', x: p.x, z: p.z });
    }
    this.updateAim(me);
    this.world.update(dt);
    this.hud.frame();
  }

  private updateAim(me: UnitView | undefined) {
    if (!this.aiming || !me) { this.world.showAim('none', 0, 0, 0, 0, 0, 0); this.world.showRange(0, 0, 0); return; }
    const def = HERO_BY_ID[this.heroId].abilities['QWER'.indexOf(this.aiming)];
    const p = this.world.pick(this.mouse.ndcX, this.mouse.ndcY);
    if (!p) return;
    this.world.showRange(me.pos.x, me.pos.z, def.range);
    if (def.targeting === 'direction') {
      const first = def.effects[0] as { width?: number; radius?: number };
      this.world.showAim('line', me.pos.x, me.pos.z, p.x, p.z, Math.max(1, (first.width ?? 0.8) * 2), def.range);
    } else if (def.targeting === 'point') {
      const d = Math.hypot(p.x - me.pos.x, p.z - me.pos.z);
      const k = d > def.range ? def.range / d : 1;
      this.world.showAim('circle', me.pos.x, me.pos.z, me.pos.x + (p.x - me.pos.x) * k, me.pos.z + (p.z - me.pos.z) * k, def.radius ?? 2.5, 0);
    } else this.world.showAim('none', 0, 0, 0, 0, 0, 0);
  }

  private cursorTarget(filter: (v: UnitView) => boolean) { return this.world.pickUnit(this.mouse.ndcX, this.mouse.ndcY, filter); }

  private cast(slot: AbilitySlot) {
    const p = this.world.pick(this.mouse.ndcX, this.mouse.ndcY);
    if (!p) return;
    const def = HERO_BY_ID[this.heroId].abilities['QWER'.indexOf(slot)];
    let id: number | undefined;
    if (def.targeting === 'enemy') id = this.cursorTarget((v) => v.team !== this.world.myTeam && !v.isStructure)?.id;
    else if (def.targeting === 'ally') id = this.cursorTarget((v) => v.team === this.world.myTeam && !v.isStructure)?.id ?? this.snap?.me?.unit;
    else if (def.targeting === 'unit') id = this.cursorTarget((v) => !v.isStructure)?.id;
    this.session.send({ c: 'cast', slot, x: p.x, z: p.z, id });
  }

  private bindInput(canvas: HTMLCanvasElement) {
    const on = <K extends keyof WindowEventMap>(t: K, f: (e: WindowEventMap[K]) => void, target: Window | HTMLElement = window) => {
      target.addEventListener(t, f as EventListener);
      this.disposers.push(() => target.removeEventListener(t, f as EventListener));
    };
    on('resize', () => this.world.resize());
    on('mousemove', (e) => {
      this.mouse.x = e.clientX; this.mouse.y = e.clientY;
      this.overCanvas = e.target === canvas;
      this.mouse.ndcX = (e.clientX / window.innerWidth) * 2 - 1;
      this.mouse.ndcY = -(e.clientY / window.innerHeight) * 2 + 1;
      if (this.dragging) {
        const k = this.world.camDist / 600;
        this.world.camTarget.set(this.dragging.cam.x - (e.clientX - this.dragging.x) * k, 0, this.frontline ? FL_CAM_Z : this.dragging.cam.z - (e.clientY - this.dragging.y) * k);
      }
      canvas.style.cursor = this.attackMove || this.pingMode || this.fh?.pickingRally ? 'crosshair' : this.cursorTarget((v) => v.team !== this.world.myTeam) ? 'pointer' : 'default';
    });
    canvas.addEventListener('contextmenu', (e) => e.preventDefault());
    on('mousedown', (e) => {
      const me = this.snap?.me;
      if (e.button === 1) { this.camLocked = false; this.dragging = { x: e.clientX, y: e.clientY, cam: this.world.camTarget.clone() }; e.preventDefault(); return; }
      const p = this.world.pick(this.mouse.ndcX, this.mouse.ndcY);
      if (this.fh && e.button === 0 && this.fh.pickingRally) { if (p) this.fh.setRally(p.x); return; }
      if (!p || !me) return;
      if (e.button === 0 && this.frontline) {
        if (this.aiming) { this.cast(this.aiming); this.aiming = null; return; }
        const t = this.cursorTarget((v) => v.team !== this.world.myTeam);
        if (t) this.session.send({ c: 'attack', id: t.id }); // plain ground clicks do nothing: right-click moves
        return;
      }
      if (e.button === 0) {
        if (this.aiming) { this.cast(this.aiming); this.aiming = null; return; }
        if (this.pingMode) { this.session.send({ c: 'ping', x: p.x, z: p.z, kind: e.shiftKey ? 'danger' : 'go' }); this.pingMode = false; return; }
        if (this.attackMove) { this.session.send({ c: 'move', x: p.x, z: p.z, attack: true }); this.world.showMoveMarker(p.x, p.z, true); this.attackMove = false; return; }
      }
      if (e.button === 2) {
        this.aiming = null;
        this.fh?.cancelRally();
        this.attackMove = false;
        const t = this.cursorTarget((v) => v.team !== this.world.myTeam);
        if (t) this.session.send({ c: 'attack', id: t.id });
        else { this.session.send({ c: 'move', x: p.x, z: p.z }); this.world.showMoveMarker(p.x, p.z, false); this.rightHeld = true; this.lastRightMove = performance.now(); }
      }
    }, canvas);
    on('mouseup', (e) => { if (e.button === 1) this.dragging = null; if (e.button === 2) this.rightHeld = false; });
    on('wheel', (e) => { this.world.camDist = THREE.MathUtils.clamp(this.world.camDist + Math.sign(e.deltaY) * 3, 20, 70); }, canvas);
    on('keydown', (e) => {
      if (this.hud.chatting) return;
      const k = e.code;
      if (k === 'Tab') { e.preventDefault(); if (!e.repeat) this.hud.toggle('board'); return; }
      if (e.repeat) return;
      if (this.frontline) { this.flKeyDown(e); return; }
      if (SLOT_KEYS[k]) {
        if (!this.heroId) return;
        const slot = SLOT_KEYS[k];
        const def = HERO_BY_ID[this.heroId].abilities['QWER'.indexOf(slot)];
        if (def.targeting === 'self') this.cast(slot);
        else this.aiming = slot; // released -> cast (quick cast with indicator)
        return;
      }
      const digit = /^Digit([1-6])$/.exec(k);
      if (digit) { const p = this.world.pick(this.mouse.ndcX, this.mouse.ndcY); if (p) this.session.send({ c: 'item', slot: Number(digit[1]) - 1, x: p.x, z: p.z, id: this.cursorTarget(() => true)?.id }); return; }
      switch (k) {
        case 'Enter': e.preventDefault(); this.hud.openChat(); break;
        case 'KeyB': this.session.send({ c: 'recall' }); break;
        case 'KeyP': (this.hud as Hud).toggle('shop'); break;
        case 'KeyU': (this.hud as Hud).toggle('base'); break;
        case 'KeyA': this.attackMove = true; break;
        case 'KeyS': this.session.send({ c: 'stop' }); break;
        case 'KeyG': this.pingMode = true; break;
        case 'KeyY': this.camLocked = !this.camLocked; break;
        case 'KeyM': toast(sfx.toggleMute() ? 'Sound off (M)' : 'Sound on (M)'); break;
        case 'Space': e.preventDefault(); { const me = this.myView(); if (me) this.world.camTarget.set(me.pos.x, 0, me.pos.z); } break;
        case 'Escape': this.aiming = null; this.attackMove = false; this.pingMode = false; this.hud.closeModal(); break;
        case 'F1': e.preventDefault(); document.getElementById('helpbox')?.classList.toggle('hidden'); break;
        case 'ArrowUp': this.steer.up = true; this.sendSteer(); break;
        case 'ArrowDown': this.steer.down = true; this.sendSteer(); break;
        case 'ArrowLeft': this.steer.left = true; this.sendSteer(); break;
        case 'ArrowRight': this.steer.right = true; this.sendSteer(); break;
      }
    });
    on('keyup', (e) => {
      const k = e.code;
      if (k === 'Tab') { e.preventDefault(); this.hud.closeModal(); return; }
      if (this.frontline) { this.flKeyUp(e); return; }
      if (SLOT_KEYS[k] && this.aiming === SLOT_KEYS[k]) { this.cast(this.aiming); this.aiming = null; return; }
      if (k === 'ArrowUp') { this.steer.up = false; this.sendSteer(); }
      if (k === 'ArrowDown') { this.steer.down = false; this.sendSteer(); }
      if (k === 'ArrowLeft') { this.steer.left = false; this.sendSteer(); }
      if (k === 'ArrowRight') { this.steer.right = false; this.sendSteer(); }
    });
    on('blur', () => { this.rightHeld = false; this.steer = { up: false, down: false, left: false, right: false }; this.sendSteer(); });
  }

  // ---------------------------------------------------------------- Frontline keyboard
  private flSteerKey(k: string): keyof GameScreen['steer'] | null {
    switch (k) {
      case 'KeyW': case 'ArrowUp': return 'up';
      case 'KeyS': case 'ArrowDown': return 'down';
      case 'KeyA': case 'ArrowLeft': return 'left';
      case 'KeyD': case 'ArrowRight': return 'right';
    }
    return null;
  }

  private flKeyDown(e: KeyboardEvent) {
    const k = e.code, fh = this.fh;
    if (e.ctrlKey || e.metaKey || e.altKey) return;
    const dir = this.flSteerKey(k);
    if (dir) { e.preventDefault(); this.steer[dir] = true; this.sendSteer(); return; }
    const slot = FL_SLOT_KEYS[k];
    if (slot) {
      if (!this.heroId) return;
      const def = HERO_BY_ID[this.heroId].abilities['QWER'.indexOf(slot)];
      if (def.targeting === 'self') this.cast(slot);
      else this.aiming = slot; // released -> cast
      return;
    }
    const digit = /^Digit([1-8])$/.exec(k);
    if (digit) { fh?.trainByIndex(Number(digit[1]) - 1, e.shiftKey ? 5 : 1); return; }
    const stance = FL_STANCE_KEYS[k as keyof typeof FL_STANCE_KEYS];
    if (stance && fh) {
      if (stance !== 'hold') { fh.setStance(stance); return; }
      const p = this.overCanvas ? this.world.pick(this.mouse.ndcX, this.mouse.ndcY) : null;
      if (p) fh.setRally(p.x); else fh.beginRally(); // cursor is over the HUD: pick the spot with the next click
      return;
    }
    switch (k) {
      case 'Enter': e.preventDefault(); this.hud.openChat(); break;
      case 'KeyB': fh?.toggle('build'); break;
      case 'KeyY': this.camLocked = !this.camLocked; toast(this.camLocked ? 'Camera locked to your hero (Y)' : 'Camera free: move the mouse to the screen edge (Y)'); break;
      case 'KeyM': toast(sfx.toggleMute() ? 'Sound off (M)' : 'Sound on (M)'); break;
      case 'Space': e.preventDefault(); { const me = this.myView(); if (me) this.world.camTarget.x = me.pos.x; } break;
      case 'Escape': this.aiming = null; fh?.cancelRally(); this.hud.closeModal(); break;
      case 'F1': e.preventDefault(); document.getElementById('helpbox')?.classList.toggle('hidden'); break;
    }
  }

  private flKeyUp(e: KeyboardEvent) {
    const k = e.code;
    const dir = this.flSteerKey(k);
    if (dir) { this.steer[dir] = false; this.sendSteer(); return; }
    if (FL_SLOT_KEYS[k] && this.aiming === FL_SLOT_KEYS[k]) { this.cast(this.aiming); this.aiming = null; }
  }

  private sendSteer() {
    const s = this.steer;
    const key = `${(s.right ? 1 : 0) - (s.left ? 1 : 0)},${(s.down ? 1 : 0) - (s.up ? 1 : 0)}`;
    if (this.frontline) { if (key === this.lastDir) return; this.lastDir = key; }
    this.session.send({ c: 'dir', x: (s.right ? 1 : 0) - (s.left ? 1 : 0), z: (s.down ? 1 : 0) - (s.up ? 1 : 0) });
  }

  setHost(isHost: boolean) { this.hud.setHost(isHost); }

  /** Wires the end screen's "Watch replay" button. */
  setWatchReplay(fn: () => void) { this.hud.onWatchReplay = fn; }

  /** Tear the game down but keep the (online) session alive, e.g. to return to the room lobby. */
  dispose(closeSession = true) {
    this.session.onSnap = () => {};
    this.session.onChat = () => {};
    cancelAnimationFrame(this.raf);
    for (const d of this.disposers) d();
    this.hud.destroy();
    this.world.dispose();
    if (closeSession) this.session.close();
  }
}
