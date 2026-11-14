import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { buildSync } from 'esbuild';
import { bridge } from '../src/offline/host';
import type { ServerMsg } from '../src/shared/protocol';

const quiet = <T>(f: () => T): T => { const o = console.error; console.error = () => {}; try { return f(); } finally { console.error = o; } };

test('offline host: a quick battle against bots runs to the end with the real lobby and match code', () => quiet(() => {
  const welcome = bridge.open('offline-tester');
  assert.deepEqual(welcome.map((m) => m.t), ['welcome']);
  assert.equal((welcome[0] as Extract<ServerMsg, { t: 'welcome' }>).pid, 'offline-tester', 'a saved pid is kept');
  const room = bridge.frame([{ t: 'create', name: 'Tester' }, { t: 'hero', heroId: 'aldric' }], 16);
  assert.ok(room.some((m) => m.t === 'room'));
  const started = bridge.frame([{ t: 'start' }], 16);
  const init = started.find((m) => m.t === 'init') as Extract<ServerMsg, { t: 'init' }>;
  assert.ok(init, 'start sends init');
  const me = init.init.players.find((p) => p.playerId === 'offline-tester');
  assert.ok(me, 'the local player is in the match');
  assert.equal(init.init.players.length, 4, 'bots fill the other three seats');
  // commands go through the same path as on the server
  let snaps = 0, trained = false, replay = false, frames = 0;
  for (; frames < 40_000 && !replay; frames++) {
    const msgs = frames === 10 ? [{ t: 'cmd' as const, cmd: { c: 'train' as const, unit: 'miner' as const } }] : [];
    // 1 s per frame is clamped to 250 ms: a stalled app does not replay minutes at once
    for (const m of bridge.frame(msgs, frames < 100 ? 50 : 1000)) {
      if (m.t === 'snap') { snaps++; if (m.s.fl?.queue?.some((q) => q.unit === 'miner')) trained = true; }
      if (m.t === 'replay') replay = true;
    }
  }
  assert.ok(trained, 'the train command reached the match');
  assert.ok(snaps > 1000, `snapshots stream (${snaps})`);
  assert.ok(replay, `the match ends and sends its replay (${frames} frames)`);
}));

test('offline host: the committed bundle matches the source', () => {
  const out = buildSync({
    entryPoints: ['src/offline/host.ts'], bundle: true, format: 'iife', platform: 'browser', target: 'es2020',
    minify: true, legalComments: 'none', write: false, outfile: 'bf-offline.js',
  });
  const built = new TextDecoder().decode(out.outputFiles[0].contents);
  const committed = readFileSync('godot/offline/bf-offline.js', 'utf8');
  assert.ok(built === committed, 'godot/offline/bf-offline.js is stale: run `npm run build:offline`');
});
