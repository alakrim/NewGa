import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { offlineData, OFFLINE_DATA_PATH } from '../tools/gen-offline-data';

// The offline engine (godot/offline/engine, GDScript) reads its heroes, units and numbers from data.json, exported
// from the TypeScript. Its rules are a port of src/shared: after changing them, run the parity check in
// docs/ANDROID.md (tools/offline-parity.ts against godot/offline/tests/parity.gd).
test('offline engine data matches the TypeScript game data', () => {
  const committed = readFileSync(OFFLINE_DATA_PATH, 'utf8');
  assert.ok(committed === JSON.stringify(offlineData()) + '\n', 'godot/offline/data.json is stale: run `npm run offline:data`');
});
