/**
 * Bakes the KayKit 3D characters (CC0, public/assets/characters) into pixel sprite sheets: orthographic,
 * nearly side-on, facing right and turned a little toward the viewer. Runs headless Chromium (Playwright) with the project's three.js,
 * so it needs neither Godot nor a GPU. The frames then go through tools/sprite-post.py (downsample, palette,
 * outline) into one sheet per unit.
 *
 *   npx tsx tools/bake-sprites.ts [unit|hero ...] [--heroes] [--out=DIR] [--cell=128] [--tint=blue] [--pitch=18] [--yaw=0.55]
 *
 * With no names it bakes all eight Frontline units (in the --tint team colour); --heroes bakes all 20 heroes
 * in their own colours. Output: DIR/<unit>.png (one row per animation),
 * DIR/<unit>.json (rows, frame counts, fps) and DIR/contact.png. Frames are 3:2 (192x128 at the default cell).
 */
import { createServer } from 'node:http';
import { createReadStream, existsSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, extname, join, normalize, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { execFileSync } from 'node:child_process';
import { FL_UNITS, FL_UNIT_ORDER, PLAYER_HEX, type FlUnitId } from '../src/shared/frontline/data';
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

/** Something to bake: a Frontline unit (team tint) or a hero (its own identity tint). */
interface Subject { id: string; model: string; weapons: string[]; tint: string; idle: string; attack: string; scale: number }

function unitSubject(id: FlUnitId): Subject {
  const def = FL_UNITS[id];
  return {
    id, model: def.model, weapons: def.weapons, tint: PLAYER_HEX[TINT] ?? TINT, scale: def.scale,
    idle: def.role === 'heavy' ? '2H_Melee_Idle' : 'Idle', attack: def.heal ? 'Spellcast_Raise' : def.attackAnims[0],
  };
}
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
  return { id, model: h.visual.model, weapons: h.visual.weapons, tint: h.visual.tint, scale: h.visual.scale, idle: 'Idle', attack: heroAttack(h.visual.weapons) };
}

const names = args.filter((a) => !a.startsWith('--'));
const ids = args.includes('--heroes') ? HEROES.map((h) => h.id) : names.length ? names : FL_UNIT_ORDER;
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

  const raw = join(OUT, '_frames');
  rmSync(raw, { recursive: true, force: true });
  mkdirSync(raw, { recursive: true });
  for (const sub of list) {
    const id = sub.id;
    const rows = rowsFor(sub);
    // Sprites are billboards facing the camera, so they are drawn like the Tiny Swords art: nearly side-on
    // (PITCH above the horizon, not the 52° game camera, which would show the tops of the big chibi heads)
    // and turned YAW toward the viewer so faces read. KayKit characters are about 2.4 units tall; the frame
    // leaves room for weapons, capes and death falls.
    const spec = {
      model: sub.model, weapons: sub.weapons, tint: sub.tint, tintAmount: 0.55,
      clips: rows, cell: CELL, cellW: CELL_W, worldHeight: 3.2, pitch: PITCH, yaw: YAW, lift: 1.15,
    };
    const t0 = Date.now();
    const out = await page.evaluate((s: unknown) => (window as any).bake(s), spec);
    const meta = { id, model: sub.model, weapons: sub.weapons, tint: sub.tint, cell: [CELL_W, CELL], scale: sub.scale, rows: [] as unknown[] };
    for (const r of rows) {
      const res = out[r.name];
      if (res.error) throw new Error(`${id}: ${res.error}`);
      res.frames.forEach((url: string, i: number) => writeFileSync(join(raw, `${id}__${r.name}__${i}.png`), Buffer.from(url.split(',')[1], 'base64')));
      meta.rows.push({ name: r.name, clip: r.clip, frames: r.frames, fps: r.fps, loop: !r.once });
    }
    writeFileSync(join(OUT, `${id}.json`), JSON.stringify(meta, null, 2) + '\n');
    console.log(`baked ${id} (${sub.model}) in ${((Date.now() - t0) / 1000).toFixed(1)} s`);
  }
  await browser.close();
  server.close();
  execFileSync('python3', ['-I', join(ROOT, 'tools/sprite-post.py'), raw, OUT, String(CELL_W), String(CELL), ...list.map((x) => x.id)], { stdio: 'inherit' });
  rmSync(raw, { recursive: true, force: true });
}

main().catch((e) => { console.error(e); process.exit(1); });
