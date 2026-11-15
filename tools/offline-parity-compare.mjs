// Compares the TypeScript and GDScript offline-engine digests (tools/offline-parity.ts, godot/offline/tests/parity.gd)
// and reports the first tick where they differ, field by field.
//   node tools/offline-parity-compare.mjs ts.txt gd.txt
import { readFileSync } from 'node:fs';

const [a, b] = process.argv.slice(2).map((f) => readFileSync(f, 'utf8').trim().split('\n'));
const n = Math.min(a.length, b.length);
for (let i = 0; i < n; i++) {
  if (a[i] === b[i]) continue;
  const fa = a[i].split(' '), fb = b[i].split(' ');
  const diffs = [];
  for (let j = 0; j < Math.max(fa.length, fb.length) && diffs.length < 8; j++) if (fa[j] !== fb[j]) diffs.push(`  ts ${fa[j]}\n  gd ${fb[j]}`);
  console.log(`first difference at line ${i} (tick ${fa[0]}):\n${diffs.join('\n')}`);
  process.exit(1);
}
console.log(a.length === b.length ? `identical for all ${n} ticks` : `identical for ${n} ticks; lengths differ (ts ${a.length}, gd ${b.length})`);
process.exit(a.length === b.length ? 0 : 1);
