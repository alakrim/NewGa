import * as THREE from 'three';
import { GLTFLoader, type GLTF } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { MeshoptDecoder } from 'three/examples/jsm/libs/meshopt_decoder.module.js';
import * as SkeletonUtils from 'three/examples/jsm/utils/SkeletonUtils.js';
import type { ModelId } from '../shared/types';

const BASE = `${import.meta.env.BASE_URL}assets/`;
export const CHARACTER_MODELS: ModelId[] = ['Knight', 'Barbarian', 'Mage', 'Rogue', 'Rogue_Hooded', 'Skeleton_Warrior', 'Skeleton_Mage', 'Skeleton_Rogue', 'Skeleton_Minion'];
const SKELETON_WEAPONS = ['Skeleton_Blade', 'Skeleton_Axe', 'Skeleton_Staff', 'Skeleton_Shield_Small_A', 'Skeleton_Shield_Large_A', 'Skeleton_Crossbow'];
const COLORS = ['blue', 'green', 'red', 'yellow'];
const COLORED = ['castle', 'tower_A', 'tower_B', 'tower_catapult', 'tower_base', 'barracks', 'blacksmith', 'market', 'church', 'archeryrange', 'tavern', 'home_A', 'mine'];
export const ENV_MODELS = [...new Set([
  ...COLORS.flatMap((c) => COLORED.map((b) => `building_${b}_${c}`)),
  'building_scaffolding', 'resource_stone',
  'building_castle_blue', 'building_castle_red', 'building_tower_A_blue', 'building_tower_A_red', 'building_tower_B_blue', 'building_tower_B_red',
  'building_tower_catapult_blue', 'building_tower_catapult_red', 'building_tower_base_blue', 'building_tower_base_red', 'building_barracks_blue', 'building_barracks_red',
  'building_blacksmith_blue', 'building_blacksmith_red', 'building_market_blue', 'building_market_red', 'building_church_blue', 'building_church_red',
  'wall_straight', 'wall_corner_A_outside', 'building_destroyed', 'building_stage_A', 'fence_stone_straight',
  'trees_A_large', 'trees_A_medium', 'trees_B_large', 'trees_B_medium', 'tree_single_A', 'tree_single_B', 'rock_single_A', 'rock_single_B', 'rock_single_C',
  'rock_single_D', 'rock_single_E', 'mountain_A_grass_trees', 'mountain_B_grass_trees', 'hills_A_trees', 'hills_B_trees', 'hill_single_A', 'cloud_big',
  'flag_blue', 'flag_red', 'flag_green', 'flag_yellow', 'barrel', 'crate_A_big', 'crate_open', 'tent', 'weaponrack', 'bucket_arrows', 'sack', 'target',
])];

const OPTIONAL_MESH = /^(1H_|2H_|Badge_Shield|Rectangle_Shield|Round_Shield|Spike_Shield|Barbarian_Round_Shield|Mug|Spellbook|Knife|Throwable|Knight_Helmet|Knight_Cape|Barbarian_Hat|Barbarian_Cape|Mage_Hat|Mage_Cape|Rogue_Cape)/;
const CLOTH = /(Cape|Hat|Helmet|Hood|Cloak|Body)/;

class Assets {
  private loader = new GLTFLoader();
  characters = new Map<string, GLTF>();
  env = new Map<string, THREE.Object3D>();
  weapons = new Map<string, THREE.Object3D>();
  private matCache = new Map<string, THREE.Material>();

  constructor() { this.loader.setMeshoptDecoder(MeshoptDecoder); }

  async loadAll(onProgress: (f: number) => void) {
    const jobs: (() => Promise<void>)[] = [];
    for (const m of CHARACTER_MODELS) jobs.push(async () => { this.characters.set(m, await this.loader.loadAsync(`${BASE}characters/${m}.glb`)); });
    for (const w of SKELETON_WEAPONS) jobs.push(async () => { this.weapons.set(w, (await this.loader.loadAsync(`${BASE}skeleton-weapons/${w}.gltf`)).scene); });
    for (const e of ENV_MODELS) jobs.push(async () => {
      const g = await this.loader.loadAsync(`${BASE}env/${e}.gltf`);
      g.scene.traverse((o) => { if ((o as THREE.Mesh).isMesh) { o.castShadow = true; o.receiveShadow = true; } });
      this.env.set(e, g.scene);
    });
    let done = 0;
    const queue = [...jobs];
    const worker = async () => {
      for (let j; (j = queue.shift()); ) {
        try { await j(); } catch (err) { console.warn('asset failed', err); }
        onProgress(++done / jobs.length);
      }
    };
    await Promise.all(Array.from({ length: 6 }, worker));
  }

  /** A fresh instance of an environment model, optionally fitted to a footprint width. */
  envModel(name: string, width?: number): THREE.Object3D {
    const src = this.env.get(name);
    if (!src) return new THREE.Group();
    const o = src.clone(true);
    if (width) {
      const box = new THREE.Box3().setFromObject(o);
      const size = box.getSize(new THREE.Vector3());
      const s = width / Math.max(size.x, size.z, 0.001);
      o.scale.setScalar(s);
    }
    return o;
  }

  private tinted(mat: THREE.Material, tint: string, amount: number): THREE.Material {
    const key = `${mat.uuid}|${tint}|${amount}`;
    let m = this.matCache.get(key);
    if (!m) {
      m = mat.clone();
      (m as THREE.MeshStandardMaterial).color = new THREE.Color('#ffffff').lerp(new THREE.Color(tint), amount);
      this.matCache.set(key, m);
    }
    return m;
  }

  /** Clones a rigged character, shows only the listed optional meshes and tints the cloth. */
  character(model: ModelId, weapons: string[], tint?: string, tintAmount = 0.55): { root: THREE.Object3D; clips: THREE.AnimationClip[] } {
    const gltf = this.characters.get(model);
    if (!gltf) return { root: new THREE.Group(), clips: [] };
    const root = SkeletonUtils.clone(gltf.scene);
    const show = new Set(weapons);
    root.traverse((o) => {
      const mesh = o as THREE.Mesh;
      if (!mesh.isMesh) return;
      mesh.castShadow = true;
      mesh.frustumCulled = false;
      if (OPTIONAL_MESH.test(o.name) && !show.has(o.name)) o.visible = false;
      if (tint && CLOTH.test(o.name)) mesh.material = this.tinted(mesh.material as THREE.Material, tint, tintAmount);
    });
    // skeletons carry weapons as separate models on the hand slots
    const hands = { r: findBone(root, ['handslotr', 'handslot.r', 'handslot_r']), l: findBone(root, ['handslotl', 'handslot.l', 'handslot_l']) };
    for (const w of weapons) {
      const src = this.weapons.get(w);
      if (!src) continue;
      const left = /Shield/.test(w);
      const bone = left ? hands.l : hands.r;
      if (!bone) continue;
      const inst = src.clone(true);
      inst.traverse((o) => { if ((o as THREE.Mesh).isMesh) o.castShadow = true; });
      bone.add(inst);
    }
    return { root, clips: gltf.animations };
  }
}

function findBone(root: THREE.Object3D, names: string[]): THREE.Object3D | null {
  let found: THREE.Object3D | null = null;
  root.traverse((o) => { if (!found && names.includes(o.name.toLowerCase())) found = o; });
  return found;
}

export const assets = new Assets();
