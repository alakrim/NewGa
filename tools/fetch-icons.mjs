// Fetches the UI icons from game-icons.net (CC BY 3.0, https://game-icons.net) via jsDelivr and writes
// public/icons/: <id>.svg (full-size background path removed, fills set to currentColor so CSS can colour
// them), icons.json (id -> file, author, source name, url) and LICENSE.md (attribution).
// Run: node tools/fetch-icons.mjs
import { mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';

const CDN = 'https://cdn.jsdelivr.net/gh/game-icons/icons@master';
const OUT = new URL('../public/icons/', import.meta.url).pathname;

const AUTHOR_NAMES = { lorc: 'Lorc', delapouite: 'Delapouite' };

// id -> [author folder, game-icons name]
const ICONS = {
  // units
  miner: ['lorc', 'mining'],
  swordsman: ['lorc', 'broadsword'],
  archer: ['delapouite', 'bow-arrow'],
  shieldbearer: ['delapouite', 'roman-shield'],
  assassin: ['lorc', 'daggers'],
  battlemage: ['lorc', 'fireball'],
  healer: ['delapouite', 'caduceus'],
  giant: ['delapouite', 'giant'],
  // buildings
  house: ['delapouite', 'house'],
  barracks: ['delapouite', 'barracks'],
  archery: ['lorc', 'archery-target'],
  sanctum: ['lorc', 'magic-portal'],
  giantpit: ['delapouite', 'hole'],
  forge: ['lorc', 'anvil'],
  mineshaft: ['delapouite', 'mine-wagon'],
  watchtower: ['delapouite', 'watchtower'],
  market: ['delapouite', 'shop'],
  // stances
  garrison: ['lorc', 'castle'],
  defend: ['lorc', 'bordered-shield'],
  hold: ['lorc', 'flying-flag'],
  attack: ['lorc', 'crossed-swords'],
  // research
  weapons: ['lorc', 'pointy-sword'],
  armor: ['lorc', 'breastplate'],
  // misc
  gold: ['delapouite', 'coins'],
  population: ['delapouite', 'person'],
  'heart-banner': ['lorc', 'heart-tower'],
};

// Every game-icons SVG starts with this full-size background tile, which is removed.
const BACKGROUND = /<path\b[^>]*d="M0 0h512v512H0z"[^>]*\/>/;

await mkdir(OUT, { recursive: true });
const manifest = {};
let bytes = 0;
for (const [id, [author, name]] of Object.entries(ICONS)) {
  const url = `${CDN}/${author}/${name}.svg`;
  const res = await fetch(url);
  if (!res.ok) throw new Error(`${res.status} ${url}`);
  let svg = await res.text();
  if (!BACKGROUND.test(svg)) throw new Error(`no background tile in ${author}/${name}.svg`);
  svg = svg
    .replace(BACKGROUND, '')
    .replace(/<path\b[^>]*>/g, (tag) => tag.replace(/\sfill="[^"]*"/, '').replace('<path', '<path fill="currentColor"'))
    .trim() + '\n';
  if (/fill="(?!currentColor|none)/.test(svg)) throw new Error(`unexpected fill in ${author}/${name}.svg`);
  await writeFile(join(OUT, `${id}.svg`), svg);
  bytes += Buffer.byteLength(svg);
  manifest[id] = {
    file: `icons/${id}.svg`,
    author: AUTHOR_NAMES[author] ?? author,
    sourceName: name,
    url: `https://game-icons.net/1x1/${author}/${name}.html`,
  };
}

const authors = [...new Set(Object.values(manifest).map((m) => m.author))].sort();
const json = JSON.stringify(manifest, null, 2) + '\n';
await writeFile(join(OUT, 'icons.json'), json);
const license = `# Icon licence

Icons by ${authors.join(', ')} from [game-icons.net](https://game-icons.net), licensed under the
[Creative Commons Attribution 3.0 licence (CC BY 3.0)](https://creativecommons.org/licenses/by/3.0/).
Changes made: the full-size background tile was removed and the fills were set to \`currentColor\`.

Icons made by ${authors.join(', ')}, from game-icons.net, CC BY 3.0, https://creativecommons.org/licenses/by/3.0/

| Icon id | Source | Author |
| --- | --- | --- |
${Object.entries(manifest).map(([id, m]) => `| \`${id}\` | [${m.sourceName}](${m.url}) | ${m.author} |`).join('\n')}
`;
await writeFile(join(OUT, 'LICENSE.md'), license);
console.log(`wrote ${Object.keys(manifest).length} icons (${(bytes / 1024).toFixed(1)} KB svg) + icons.json + LICENSE.md into public/icons/`);
