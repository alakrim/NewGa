// Desktop stand-in for the Android WebView: runs godot/offline/bf-offline.js in Node and answers one JSON line per
// request on stdin, so the Godot client's offline mode can be tested without a phone.
//   request:  {"open": "<pid or empty>"}  or  {"msgs": [...client messages], "ms": 16.7}
//   response: one line, a JSON array of server messages
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const readline = require('node:readline');

const bundle = process.argv[2] || path.join(__dirname, '..', 'godot', 'offline', 'bf-offline.js');
vm.runInThisContext(fs.readFileSync(bundle, 'utf8'), { filename: bundle });
const bf = globalThis.__bf;

const rl = readline.createInterface({ input: process.stdin });
rl.on('line', (line) => {
  let out = [];
  try {
    const req = JSON.parse(line);
    out = 'open' in req ? bf.open(req.open || null) : bf.frame(req.msgs || [], req.ms || 0);
  } catch (err) {
    process.stderr.write(`offline-cli: ${err && err.stack ? err.stack : err}\n`);
  }
  process.stdout.write(JSON.stringify(out) + '\n');
});
