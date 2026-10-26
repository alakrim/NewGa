// Optimizes the fetched KayKit assets into public/assets/ (committed, so the game runs without fetching).
// Characters: drop animation clips the game never plays, then meshopt-compress. Environment: copied as-is.
import { NodeIO } from '@gltf-transform/core';
import { ALL_EXTENSIONS } from '@gltf-transform/extensions';
import { dedup, prune, resample, meshopt, quantize } from '@gltf-transform/functions';
import { MeshoptEncoder, MeshoptDecoder } from 'meshoptimizer';
import { cp, mkdir, readdir, writeFile, stat } from 'node:fs/promises';
import { join } from 'node:path';

const SRC = new URL('../assets-src/', import.meta.url).pathname;
const OUT = new URL('../public/assets/', import.meta.url).pathname;

const KEEP = new Set([
  'Idle', 'Unarmed_Idle', '2H_Melee_Idle', 'Idle_Combat', 'Running_A', 'Running_B', 'Walking_A', 'Walking_D_Skeletons',
  'Death_A', 'Death_B', 'Death_C_Skeletons', 'Hit_A', 'Hit_B', 'Block', 'Cheer', 'Dodge_Forward', 'Jump_Full_Short',
  '1H_Melee_Attack_Chop', '1H_Melee_Attack_Slice_Diagonal', '1H_Melee_Attack_Slice_Horizontal', '1H_Melee_Attack_Stab',
  '2H_Melee_Attack_Chop', '2H_Melee_Attack_Slice', '2H_Melee_Attack_Spin', '2H_Melee_Attack_Spinning', '2H_Melee_Attack_Stab',
  'Dualwield_Melee_Attack_Chop', 'Dualwield_Melee_Attack_Slice', 'Dualwield_Melee_Attack_Stab',
  '1H_Ranged_Shoot', '2H_Ranged_Shoot', 'Spellcast_Shoot', 'Spellcast_Raise', 'Spellcast_Long', 'Spellcasting', 'Spellcast_Summon',
  'Throw', 'Unarmed_Melee_Attack_Punch_A', 'Unarmed_Melee_Attack_Kick', 'Use_Item', 'Interact', 'PickUp', 'Taunt',
  'Spawn_Ground', 'Spawn_Ground_Skeletons', 'Skeletons_Awaken_Standing',
]);

await MeshoptEncoder.ready;
await MeshoptDecoder.ready;
const io = new NodeIO().registerExtensions(ALL_EXTENSIONS).registerDependencies({ 'meshopt.encoder': MeshoptEncoder, 'meshopt.decoder': MeshoptDecoder });

await mkdir(join(OUT, 'characters'), { recursive: true });
const manifest = { source: 'KayKit by Kay Lousberg (CC0 1.0) via cdn.jsdelivr.net/gh/KayKit-Game-Assets', built: new Date().toISOString().slice(0, 10), files: [] };
for (const f of (await readdir(join(SRC, 'characters'))).filter((f) => f.endsWith('.glb'))) {
  const doc = await io.read(join(SRC, 'characters', f));
  for (const a of doc.getRoot().listAnimations()) if (!KEEP.has(a.getName())) a.dispose();
  await doc.transform(prune(), dedup(), resample(), quantize(), meshopt({ encoder: MeshoptEncoder, level: 'medium' }));
  const out = join(OUT, 'characters', f);
  await io.write(out, doc);
  const before = (await stat(join(SRC, 'characters', f))).size, after = (await stat(out)).size;
  manifest.files.push({ file: `characters/${f}`, before, after, clips: doc.getRoot().listAnimations().length });
  console.log(f, (before / 1e6).toFixed(2), '->', (after / 1e6).toFixed(2), 'MB');
}
for (const dir of ['env', 'skeleton-weapons']) await cp(join(SRC, dir), join(OUT, dir), { recursive: true });
await cp(join(SRC, 'LICENSE-adventurers.txt'), join(OUT, 'LICENSE-KayKit-Adventurers.txt'));
await cp(join(SRC, 'LICENSE-skeletons.txt'), join(OUT, 'LICENSE-KayKit-Skeletons.txt'));
await writeFile(join(OUT, 'manifest.json'), JSON.stringify(manifest, null, 2));
