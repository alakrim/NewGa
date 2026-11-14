/**
 * Bakes the KayKit 3D characters (CC0, public/assets/characters) into pixel sprite sheets: orthographic,
 * nearly side-on, facing right and turned a little toward the viewer. Runs headless Chromium (Playwright) with the project's three.js,
 * so it needs neither Godot nor a GPU. The frames then go through tools/sprite-post.py (downsample, palette,
 * outline) into one sheet per unit.
 *
 *   npx tsx tools/bake-sprites.ts [unit|hero ...] [--heroes] [--out=DIR] [--no-contact] [--cell=128] [--tint=blue] [--pitch=18] [--yaw=0.55]
 *
 * With no names it bakes all eight Frontline units in the --tint player colour (blue, purple, red, yellow, or
 * `all` for one sheet per colour in DIR/<colour>/); --heroes bakes all 20 heroes in their identity colours.
 * The game's sheets: --tint=all --out=godot/assets/baked/units --no-contact, and
 * --heroes --out=godot/assets/baked/heroes --no-contact.
 * --buildings bakes the KayKit Medieval Hexagon buildings (static models, one frame each, fitted to the frame) in the
 * four KayKit colours into DIR/<colour>/<building>.png: --buildings --out=godot/assets/baked/buildings --cell=160 --no-contact.
 * --probe prints which atlas swatches each body shows, to find the cloth swatches for CLOTH. Output: DIR/<unit>.png (one row per animation),
 * DIR/<unit>.json (rows, frame counts, fps) and DIR/contact.png. Frames are 3:2 (192x128 at the default cell).
 */
import { createServer } from 'node:http';
import { createReadStream, existsSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, extname, join, normalize, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { execFileSync } from 'node:child_process';
import { FL_UNITS, FL_UNIT_ORDER, FL_BUILDINGS, FL_BUILDING_ORDER, PLAYER_HEX, type FlUnitId } from '../src/shared/frontline/data';
import { HEROES } from '../src/shared/data/heroes';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const args = process.argv.slice(2);
const opt = (k: string, d: string) => args.find((a) => a.startsWith(`--${k}=`))?.slice(k.length + 3) ?? d;
const OUT = resolve(ROOT, opt('out', 'build/sprites'));
const CELL = Number(opt('cell', '128'));
const CELL_W = CELL * 3 / 2; // 3:2 frames like Tiny Swords: room for weapons swung forward and death falls
const TINT = opt('tint', 'blue');
const PITCH = Number(opt('pitch', '18'));
const YAW = Number(opt('yaw', '0.55')); // radians
const DEATH = opt('death', 'Death_B');

type Recolor = { cell: string; color: string; meshes?: string }[];
/** Something to bake: a Frontline unit (in a team colour) or a hero (in its identity colour). */
interface Subject { id: string; model: string; weapons: string[]; hide?: string[]; recolor: Recolor; idle: string; attack: string; scale: number; colors: Record<string, string> }

/**
 * Cloth swatches of each body's atlas (column, row in the 8 x 4 swatch grid), measured with --probe: `main`
 * takes the colour, `dark` takes a darker shade of it.
 */
const CLOTH: Record<string, { main: string[]; dark?: string[]; shields?: string[] }> = {
  Knight: { main: ['01'], shields: ['31'] }, // cape and emblem; 31 is the shield face, but also every blade
  Barbarian: { main: ['01', '11'] },
  Mage: { main: ['01', '21'], dark: ['11'] }, // 21 is the cape
  Rogue: { main: ['11'], dark: ['01'] },
  Rogue_Hooded: { main: ['11'], dark: ['01'] },
  Skeleton_Warrior: { main: ['22'] },
  Skeleton_Mage: { main: ['22'] },
  Skeleton_Rogue: { main: ['22'] },
  Skeleton_Minion: { main: ['50'] },
};
const shade = (hex: string, k: number) => '#' + [1, 3, 5].map((i) => Math.round(parseInt(hex.slice(i, i + 2), 16) * k).toString(16).padStart(2, '0')).join('');
function clothRecolor(model: string, color: string): Recolor {
  const c = CLOTH[model] ?? { main: [] };
  return [
    ...c.main.map((cell) => ({ cell, color })),
    ...(c.dark ?? []).map((cell) => ({ cell, color: shade(color, 0.55) })),
    ...(c.shields ?? []).map((cell) => ({ cell, color, meshes: 'Shield' })),
  ];
}

/** Extra gear on the baked units only (not in the sim data): capes carry the team colour at a distance. */
const UNIT_GEAR: Partial<Record<FlUnitId, string[]>> = {
  swordsman: ['Knight_Cape'], shieldbearer: ['Knight_Cape'], archer: ['Rogue_Cape'], assassin: ['Rogue_Cape'],
  healer: ['Mage_Cape'], giant: ['Barbarian_Cape'], miner: ['Barbarian_Cape'],
};
const COLORS = Object.keys(PLAYER_HEX);

function unitSubject(id: FlUnitId): Subject {
  const def = FL_UNITS[id];
  return {
    id, model: def.model, weapons: [...def.weapons, ...(UNIT_GEAR[id] ?? [])], recolor: [], scale: def.scale,
    idle: def.role === 'heavy' ? '2H_Melee_Idle' : 'Idle', attack: def.heal ? 'Spellcast_Raise' : def.attackAnims[0],
    colors: Object.fromEntries((TINT === 'all' ? COLORS : [TINT]).map((c) => [c, PLAYER_HEX[c] ?? c])),
  };
}

/**
 * Per-hero looks beyond the identity colour, so heroes sharing a body still read apart (free bodies only):
 * extra gear, and swatch overrides such as hair (Knight and Rogue hair is swatch 10) or a gilded armour (30).
 */
const HERO_LOOK: Record<string, { gear?: string[]; hide?: string[]; recolor?: Recolor }> = {
  aldric: { gear: ['Knight_Cape'], recolor: [{ cell: '10', color: '#7a5230' }] },
  valen: { gear: ['Knight_Helmet'], recolor: [{ cell: '10', color: '#3b2a20' }] },
  seraphine: { recolor: [{ cell: '10', color: '#f5d77e' }, { cell: '30', color: '#e6cf8a' }] },
  sable: { recolor: [{ cell: '10', color: '#1f1a1a' }] },
  tamsin: { gear: ['Rogue_Cape'], recolor: [{ cell: '10', color: '#f0c45a' }] },
  wren: { gear: ['Rogue_Cape'] },
  merrow: {},
  kaelen: { gear: ['Mage_Hat'] },
  nerissa: { recolor: [{ cell: '10', color: '#e9eef5' }] },
  skarra: { recolor: [{ cell: '10', color: '#c0392b' }] },
  hrodgar: { gear: ['Barbarian_Cape'] },
  // Hallen and Kraghul share the Skeleton_Warrior body: Hallen is the cloaked commander in pale steel
  // armour with a shield; Kraghul is the cloakless pit fighter in blackened iron with a rust-red helmet and an axe.
  hallen: { recolor: [{ cell: '30', color: '#c9d6e2' }] },
  kraghul: { hide: ['Skeleton_Warrior_Cloak'], recolor: [{ cell: '62', color: '#8a2a14' }, { cell: '30', color: '#4b3f3d' }, { cell: '40', color: '#c9b49a' }] },
};
/** Heroes have no attack animation in their data, so it follows their weapons. */
function heroAttack(weapons: string[]) {
  const has = (re: RegExp) => weapons.some((w) => re.test(w));
  if (has(/Staff|Wand/)) return 'Spellcast_Shoot';
  if (has(/Crossbow/)) return '2H_Ranged_Shoot';
  if (has(/Throwable/)) return 'Throw';
  if (has(/^Knife/)) return 'Dualwield_Melee_Attack_Stab';
  if (has(/^2H_/)) return '2H_Melee_Attack_Chop';
  return '1H_Melee_Attack_Chop';
}
function heroSubject(id: string): Subject {
  const h = HEROES.find((x) => x.id === id)!;
  const look = HERO_LOOK[id] ?? {};
  return {
    id, model: h.visual.model, weapons: [...h.visual.weapons, ...(look.gear ?? [])], hide: look.hide, recolor: look.recolor ?? [], scale: h.visual.scale,
    idle: 'Idle', attack: heroAttack(h.visual.weapons), colors: { '': h.visual.tint },
  };
}

const BUILDINGS = args.includes('--buildings');
const names = args.filter((a) => !a.startsWith('--'));
const ids = BUILDINGS ? [] : args.includes('--heroes') ? HEROES.map((h) => h.id) : names.length ? names : FL_UNIT_ORDER;
const list: Subject[] = ids.map((id) => {
  if (FL_UNITS[id as FlUnitId]) return unitSubject(id as FlUnitId);
  if (HEROES.some((h) => h.id === id)) return heroSubject(id);
  throw new Error(`unknown unit or hero ${id}; units: ${FL_UNIT_ORDER.join(', ')}; heroes: ${HEROES.map((h) => h.id).join(', ')}`);
});

/** Animation rows every subject gets: name, KayKit clip, frame count, play rate, one-shot. */
function rowsFor(s: Subject) {
  return [
    { name: 'idle', clip: s.idle, frames: 8, fps: 8 },
    { name: 'run', clip: 'Running_A', frames: 8, fps: 12 },
    { name: 'attack', clip: s.attack, frames: 6, fps: 12, once: true },
    { name: 'death', clip: DEATH, frames: 6, fps: 10, once: true },
  ];
}

const MIME: Record<string, string> = { '.html': 'text/html', '.js': 'text/javascript', '.glb': 'model/gltf-binary', '.gltf': 'model/gltf+json', '.bin': 'application/octet-stream', '.png': 'image/png', '.wasm': 'application/wasm' };
const ALLOWED = ['tools/bake/', 'node_modules/three/', 'public/assets/'];

async function main() {
  const server = createServer((req, res) => {
    const path = normalize(decodeURIComponent((req.url ?? '/').split('?')[0])).replace(/^\/+/, '');
    const file = join(ROOT, path);
    if (!ALLOWED.some((p) => path.startsWith(p)) || !existsSync(file)) { res.writeHead(404).end(); return; }
    res.writeHead(200, { 'content-type': MIME[extname(file)] ?? 'application/octet-stream' });
    createReadStream(file).pipe(res);
  });
  await new Promise<void>((r) => server.listen(0, '127.0.0.1', r));
  const port = (server.address() as { port: number }).port;

  const { chromium } = createRequire(import.meta.url)('playwright');
  const browser = await chromium.launch({ args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
  const page = await browser.newPage();
  page.on('pageerror', (e: Error) => console.error('page error:', e.message));
  await page.goto(`http://127.0.0.1:${port}/tools/bake/page.html`);
  await page.waitForFunction(() => (window as any).ready === true);

  if (args.some((a) => a.startsWith('--probe'))) {
    // which atlas swatches each body shows (pixels that change when the swatch turns magenta), hats and capes on
    // --probe=Model:Mesh,Mesh probes one body with just those meshes shown
    const one = opt('probe', '');
    const gear = ['Knight_Helmet', 'Knight_Cape', 'Barbarian_Hat', 'Barbarian_Cape', 'Mage_Hat', 'Mage_Cape', 'Rogue_Cape'];
    const models = one ? [one.split(':')[0]] : ['Knight', 'Barbarian', 'Mage', 'Rogue', 'Rogue_Hooded', 'Skeleton_Warrior', 'Skeleton_Mage', 'Skeleton_Rogue', 'Skeleton_Minion'];
    for (const model of models) {
      const usage = await page.evaluate((s: unknown) => (window as any).cellUsage(s), { model, weapons: one ? (one.split(':')[1] ?? '').split(',').filter(Boolean) : gear, cell: CELL, cellW: CELL_W, worldHeight: 3.2, pitch: PITCH, yaw: YAW, lift: 1.15 });
      console.log(model.padEnd(17), Object.entries(usage as Record<string, number>).sort((x, y) => y[1] - x[1]).map(([c, n]) => `${c}:${n}`).join(' '));
    }
    await browser.close();
    server.close();
    return;
  }
  if (BUILDINGS) {
    const rawB = join(OUT, '_frames');
    rmSync(rawB, { recursive: true, force: true });
    mkdirSync(rawB, { recursive: true });
    const made: string[] = [];
    const models: Record<string, string> = { castle: 'building_castle_{color}', ...Object.fromEntries(FL_BUILDING_ORDER.map((b) => [b, FL_BUILDINGS[b].model])) };
    for (const colour of ['blue', 'red', 'green', 'yellow']) for (const [bid, model] of Object.entries(models)) {
      const id = `${colour}/${bid}`;
      const url: string = await page.evaluate((s: unknown) => (window as any).bakeStatic(s), { url: `/public/assets/env/${model.replace('{color}', colour)}.gltf`, cell: CELL, cellW: CELL, pitch: PITCH, yaw: YAW });
      writeFileSync(join(rawB, `${id.replace('/', '--')}__idle__0.png`), Buffer.from(url.split(',')[1], 'base64'));
      mkdirSync(dirname(join(OUT, id)), { recursive: true });
      writeFileSync(join(OUT, `${id}.json`), JSON.stringify({ id, model, cell: [CELL, CELL], rows: [{ name: 'idle', clip: '', frames: 1, fps: 1, loop: false }] }, null, 2) + '\n');
      made.push(id);
    }
    await browser.close();
    server.close();
    execFileSync('python3', ['-I', join(ROOT, 'tools/sprite-post.py'), rawB, OUT, String(CELL), String(CELL), ...made], { stdio: 'inherit', env: { ...process.env, BAKE_NO_CONTACT: args.includes('--no-contact') ? '1' : '0', BAKE_PALETTE: '48' } });
    rmSync(rawB, { recursive: true, force: true });
    if (args.includes('--no-contact')) for (const n of made) rmSync(join(OUT, `${n}.json`), { force: true });
    return;
  }
  const raw = join(OUT, '_frames');
  rmSync(raw, { recursive: true, force: true });
  mkdirSync(raw, { recursive: true });
  const names: string[] = [];
  for (const sub of list) for (const [cname, chex] of Object.entries(sub.colors)) {
    // units bake once per player colour into OUT/<colour>/<unit>.png; heroes into OUT/<hero>.png
    const id = cname ? `${cname}/${sub.id}` : sub.id;
    names.push(id);
    mkdirSync(dirname(join(OUT, id)), { recursive: true });
    const rows = rowsFor(sub);
    // Sprites are billboards facing the camera, so they are drawn like the Tiny Swords art: nearly side-on
    // (PITCH above the horizon, not the 52° game camera, which would show the tops of the big chibi heads)
    // and turned YAW toward the viewer so faces read. KayKit characters are about 2.4 units tall; the frame
    // leaves room for weapons, capes and death falls.
    const spec = {
      model: sub.model, weapons: sub.weapons, hide: sub.hide ?? [], recolor: [...clothRecolor(sub.model, chex), ...sub.recolor],
      clips: rows, cell: CELL, cellW: CELL_W, worldHeight: 3.2, pitch: PITCH, yaw: YAW, lift: 1.15,
    };
    const t0 = Date.now();
    const out = await page.evaluate((s: unknown) => (window as any).bake(s), spec);
    const meta = { id, model: sub.model, weapons: sub.weapons, color: chex, cell: [CELL_W, CELL], scale: sub.scale, rows: [] as unknown[] };
    for (const r of rows) {
      const res = out[r.name];
      if (res.error) throw new Error(`${id}: ${res.error}`);
      res.frames.forEach((url: string, i: number) => writeFileSync(join(raw, `${id.replace('/', '--')}__${r.name}__${i}.png`), Buffer.from(url.split(',')[1], 'base64')));
      meta.rows.push({ name: r.name, clip: r.clip, frames: r.frames, fps: r.fps, loop: !r.once });
    }
    writeFileSync(join(OUT, `${id}.json`), JSON.stringify(meta, null, 2) + '\n');
    console.log(`baked ${id} (${sub.model}) in ${((Date.now() - t0) / 1000).toFixed(1)} s`);
  }
  await browser.close();
  server.close();
  const env = { ...process.env, BAKE_NO_CONTACT: args.includes('--no-contact') ? '1' : '0' };
  execFileSync('python3', ['-I', join(ROOT, 'tools/sprite-post.py'), raw, OUT, String(CELL_W), String(CELL), ...names], { stdio: 'inherit', env });
  rmSync(raw, { recursive: true, force: true });
  // the Godot client reads frame sizes and rows from visuals.gd; the json files are for humans and tools
  if (args.includes('--no-contact')) for (const n of names) rmSync(join(OUT, `${n}.json`), { force: true });
}

main().catch((e) => { console.error(e); process.exit(1); });
