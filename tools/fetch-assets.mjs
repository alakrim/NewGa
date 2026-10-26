// Downloads the CC0 KayKit asset packs used by Bannerfall into assets-src/.
// Source: https://github.com/KayKit-Game-Assets (Kay Lousberg, CC0 1.0), served via jsDelivr.
// Run: node tools/fetch-assets.mjs   then   node tools/build-assets.mjs
import { mkdir, writeFile, access } from 'node:fs/promises';
import { dirname, join } from 'node:path';

const CDN = 'https://cdn.jsdelivr.net/gh/KayKit-Game-Assets';
const OUT = new URL('../assets-src/', import.meta.url).pathname;

const ADV = 'KayKit-Character-Pack-Adventures-1.0@main/addons/kaykit_character_pack_adventures';
const SKL = 'KayKit-Character-Pack-Skeletons-1.0@main/addons/kaykit_character_pack_skeletons';
const HEX = 'KayKit-Medieval-Hexagon-Pack-1.0@main/addons/kaykit_medieval_hexagon_pack/Assets/gltf';

const files = [];
for (const c of ['Barbarian', 'Knight', 'Mage', 'Rogue', 'Rogue_Hooded'])
  files.push([`${ADV}/Characters/gltf/${c}.glb`, `characters/${c}.glb`]);
for (const c of ['Skeleton_Mage', 'Skeleton_Minion', 'Skeleton_Rogue', 'Skeleton_Warrior'])
  files.push([`${SKL}/Characters/gltf/${c}.glb`, `characters/${c}.glb`]);
for (const w of ['Skeleton_Blade', 'Skeleton_Axe', 'Skeleton_Staff', 'Skeleton_Shield_Small_A', 'Skeleton_Shield_Large_A', 'Skeleton_Crossbow'])
  files.push([`${SKL}/Assets/gltf/${w}.gltf`, `skeleton-weapons/${w}.gltf`], [`${SKL}/Assets/gltf/${w}.bin`, `skeleton-weapons/${w}.bin`]);
files.push([`${SKL}/Assets/gltf/skeleton_texture.png`, `skeleton-weapons/skeleton_texture.png`]);
files.push([`${ADV}/LICENSE.txt`, `LICENSE-adventurers.txt`], [`${SKL}/LICENSE.txt`, `LICENSE-skeletons.txt`]);

// Per-player building models: building_<name>_<color>, one set per Frontline player colour.
const BUILDINGS = ['castle', 'tower_A', 'tower_B', 'tower_catapult', 'tower_base', 'barracks', 'blacksmith', 'market', 'church',
  'archeryrange', 'tavern', 'home_A', 'home_B', 'mine', 'windmill', 'well', 'lumbermill'];
const env = {
  ...Object.fromEntries(['blue', 'green', 'red', 'yellow'].map((c) => [`buildings/${c}`, BUILDINGS.map((b) => `building_${b}_${c}`)])),
  'buildings/neutral': ['wall_straight', 'wall_corner_A_outside', 'building_destroyed', 'projectile_catapult', 'building_stage_A', 'fence_stone_straight',
    'building_scaffolding', 'building_stage_B', 'building_stage_C'],
  'decoration/nature': ['trees_A_large', 'trees_A_medium', 'trees_B_large', 'trees_B_medium', 'tree_single_A', 'tree_single_B',
    'rock_single_A', 'rock_single_B', 'rock_single_C', 'rock_single_D', 'rock_single_E', 'mountain_A_grass_trees',
    'mountain_B_grass_trees', 'hills_A_trees', 'hills_B_trees', 'hill_single_A', 'cloud_big', 'waterplant_A'],
  'decoration/props': ['flag_blue', 'flag_red', 'flag_green', 'flag_yellow', 'barrel', 'crate_A_big', 'crate_open', 'tent',
    'weaponrack', 'bucket_arrows', 'sack', 'target', 'resource_stone', 'resource_lumber', 'crate_B_big', 'wheelbarrow'],
};
for (const [dir, names] of Object.entries(env)) {
  for (const n of names) files.push([`${HEX}/${dir}/${n}.gltf`, `env/${n}.gltf`], [`${HEX}/${dir}/${n}.bin`, `env/${n}.bin`]);
}
files.push([`${HEX}/decoration/props/hexagons_medieval.png`, `env/hexagons_medieval.png`]);

async function exists(p) { try { await access(p); return true; } catch { return false; } }

let done = 0;
async function worker(queue) {
  for (let item; (item = queue.shift()); ) {
    const [src, dst] = item;
    const out = join(OUT, dst);
    if (await exists(out)) { done++; continue; }
    const res = await fetch(`${CDN}/${src}`);
    if (!res.ok) throw new Error(`${res.status} ${src}`);
    await mkdir(dirname(out), { recursive: true });
    await writeFile(out, Buffer.from(await res.arrayBuffer()));
    done++;
  }
}
const queue = [...files];
await Promise.all(Array.from({ length: 8 }, () => worker(queue)));
console.log(`fetched ${done}/${files.length} files into assets-src/`);
