import * as THREE from 'three';
import { HEROES } from '../../shared/data/heroes';
import type { HeroDef } from '../../shared/types';
import { assets } from '../assets';

// Hero portraits are rendered from the in-game models, so they always match what you play.

const cache = new Map<string, string>();
let renderer: THREE.WebGLRenderer | null = null;

function scene(def: HeroDef, w: number, h: number, full: boolean): string {
  renderer ??= new THREE.WebGLRenderer({ antialias: true, alpha: true, preserveDrawingBuffer: true });
  renderer.setSize(w, h, false);
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  const s = new THREE.Scene();
  s.add(new THREE.HemisphereLight('#ffffff', '#445', 1.4));
  const key = new THREE.DirectionalLight('#fff1d6', 2.4);
  key.position.set(2, 4, 5);
  const rim = new THREE.DirectionalLight(def.visual.vfx, 2.5);
  rim.position.set(-3, 2, -3);
  s.add(key, rim);
  const { root, clips } = assets.character(def.visual.model, def.visual.weapons, def.visual.tint);
  const mixer = new THREE.AnimationMixer(root);
  const idle = clips.find((c) => c.name === (full ? 'Cheer' : 'Idle')) ?? clips.find((c) => c.name === 'Idle');
  if (idle) { const a = mixer.clipAction(idle); a.play(); mixer.update(full ? 0.6 : 0.3); }
  root.rotation.y = full ? 0.35 : 0.5;
  s.add(root);
  const cam = new THREE.PerspectiveCamera(full ? 30 : 24, w / h, 0.1, 50);
  if (full) { cam.position.set(0, 1.5, 6.4); cam.lookAt(0, 1.15, 0); }
  else { cam.position.set(0, 2.1, 3.6); cam.lookAt(0, 1.7, 0); }
  renderer.setClearColor(0x000000, 0);
  renderer.render(s, cam);
  const url = renderer.domElement.toDataURL('image/png');
  s.traverse((o) => { if ((o as THREE.Mesh).geometry) { /* shared with the cache, do not dispose */ } });
  return url;
}

export function portrait(id: string): string {
  const k = `p:${id}`;
  if (!cache.has(k)) {
    const def = HEROES.find((h) => h.id === id);
    cache.set(k, def ? scene(def, 160, 160, false) : '');
  }
  return cache.get(k)!;
}

export function splash(id: string): string {
  const k = `s:${id}`;
  if (!cache.has(k)) {
    const def = HEROES.find((h) => h.id === id);
    cache.set(k, def ? scene(def, 420, 300, true) : '');
  }
  return cache.get(k)!;
}

export function warmPortraits() { for (const h of HEROES) portrait(h.id); }
