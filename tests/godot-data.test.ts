import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

test('godot: fl_data.gd and heroes_data.gd match what tools/gen-godot-data.ts generates', () => {
  const out = mkdtempSync(join(tmpdir(), 'gen-godot-'));
  try {
    execFileSync(process.execPath, ['--import', 'tsx', 'tools/gen-godot-data.ts'], { env: { ...process.env, GEN_OUT: out }, stdio: 'pipe' });
    for (const f of ['fl_data.gd', 'heroes_data.gd']) {
      assert.equal(readFileSync(join(out, f), 'utf8'), readFileSync(join('godot', 'scripts', f), 'utf8'), `${f} is stale: run npx tsx tools/gen-godot-data.ts`);
    }
  } finally { rmSync(out, { recursive: true, force: true }); }
});
