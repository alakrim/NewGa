#!/usr/bin/env node
// Downloads "Tiny Swords (Free Pack)" from itch.io into godot/assets/tinyswords_free/ (gitignored).
// The pack is free for commercial use but may NOT be redistributed, so it is fetched here and never committed.
// Run: node tools/fetch-tinyswords.mjs [--force]
import { spawnSync } from 'node:child_process';
import { copyFile, mkdir, mkdtemp, readdir, rm, writeFile } from 'node:fs/promises';
import { dirname, join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const SITE = 'https://pixelfrog-assets.itch.io';
const GAME = `${SITE}/tiny-swords`;
const UPLOAD_NAME = 'Tiny Swords (Free Pack).zip';
const TOP_DIR = 'Tiny Swords (Free Pack)';
const REPO = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const OUT = join(REPO, 'godot/assets/tinyswords_free');
const SCRATCH = '/tmp/claude-0';
const UA = 'bannerfall-asset-fetch/1.0';
const force = process.argv.includes('--force');

const log = (msg) => console.log(`fetch-tinyswords: ${msg}`);
const warn = (msg) => console.warn(`fetch-tinyswords: warning: ${msg}`);

// Minimal cookie jar. Cookies are only ever sent to itch.io hosts, never to the CDN.
class CookieJar {
  #cookies = new Map();

  store(res) {
    for (const raw of res.headers.getSetCookie()) {
      const [pair, ...attrs] = raw.split(';');
      const eq = pair.indexOf('=');
      if (eq < 1) continue;
      const name = pair.slice(0, eq).trim();
      const expired = attrs.some((a) => /^\s*max-age\s*=\s*0\s*$/i.test(a));
      if (expired) this.#cookies.delete(name);
      else this.#cookies.set(name, pair.slice(eq + 1).trim());
    }
  }

  headerFor(url) {
    if (this.#cookies.size === 0 || !isItch(url)) return undefined;
    return [...this.#cookies].map(([k, v]) => `${k}=${v}`).join('; ');
  }
}

function isItch(url) {
  const host = new URL(url).hostname;
  return host === 'itch.io' || host.endsWith('.itch.io');
}

// fetch() with manual redirect handling so every hop's Set-Cookie is captured.
async function request(jar, url, { method = 'GET', form, headers = {} } = {}) {
  let target = url;
  let verb = method;
  for (let hop = 0; hop <= 10; hop++) {
    const h = { 'User-Agent': UA, ...headers };
    const cookie = jar.headerFor(target);
    if (cookie) h.Cookie = cookie;
    const body = verb === 'POST' && form ? new URLSearchParams(form) : undefined;
    if (body) h['Content-Type'] = 'application/x-www-form-urlencoded';
    const res = await fetch(target, { method: verb, headers: h, body, redirect: 'manual' });
    jar.store(res);
    const location = res.headers.get('location');
    if (res.status >= 300 && res.status < 400 && location) {
      await res.body?.cancel();
      target = new URL(location, target).href;
      if (res.status === 303 || (verb === 'POST' && (res.status === 301 || res.status === 302))) verb = 'GET';
      continue;
    }
    return { res, url: target };
  }
  throw new Error(`too many redirects starting at ${url}`);
}

function decodeEntities(s) {
  return s
    .replace(/&quot;/g, '"')
    .replace(/&#39;|&#x27;/g, "'")
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&amp;/g, '&');
}

// itch renders the token as <meta name="csrf_token" value="..."> and leaves the form's hidden
// <input name="csrf_token" value=""> empty (JS fills it), so a non-empty input value wins, then the meta.
function findCsrf(html, where) {
  const valueOf = (tag) => {
    const m = /\svalue=(?:"([^"]*)"|'([^']*)')/i.exec(tag);
    return m ? decodeEntities(m[1] ?? m[2]) : '';
  };
  for (const tag of html.match(/<input\b[^>]*>/gi) ?? []) {
    if (/\bname=["']csrf_token["']/i.test(tag) && valueOf(tag)) return valueOf(tag);
  }
  for (const tag of html.match(/<meta\b[^>]*>/gi) ?? []) {
    if (/\bname=["']csrf_token["']/i.test(tag) && valueOf(tag)) return valueOf(tag);
  }
  throw new Error(`csrf_token not found on ${where}`);
}

// Each upload is an <a data-upload_id="N"> followed by <strong title="File name" class="name">.
function parseUploads(html) {
  const firsts = [];
  for (const hit of html.matchAll(/data-upload_id="(\d+)"/g)) {
    if (!firsts.some((f) => f.id === hit[1])) firsts.push({ id: hit[1], index: hit.index });
  }
  return firsts.map((f, i) => {
    const end = i + 1 < firsts.length ? firsts[i + 1].index : html.length;
    const title = /<strong\b[^>]*\btitle="([^"]*)"/i.exec(html.slice(f.index, end));
    return { id: f.id, name: title ? decodeEntities(title[1]) : null };
  });
}

// POST a form and expect {"url": "..."} back. itch reports failures as {"errors": [...]}.
async function postForJsonUrl(jar, url, form, referer) {
  const { res, url: final } = await request(jar, url, {
    method: 'POST',
    form,
    headers: referer ? { Referer: referer } : {},
  });
  const body = await res.text();
  let json = null;
  try {
    json = JSON.parse(body);
  } catch {
    // not JSON, handled below
  }
  const path = new URL(final).pathname;
  if (json?.errors) throw new Error(`${path} rejected the request: ${json.errors.join(', ')}`);
  if (!res.ok || typeof json?.url !== 'string') {
    throw new Error(`${path} returned HTTP ${res.status} without a url: ${body.slice(0, 200)}`);
  }
  return json.url;
}

async function hasContent(dir) {
  try {
    return (await readdir(dir)).length > 0;
  } catch {
    return false;
  }
}

const isJunk = (name) => name === '__MACOSX' || name === '.DS_Store' || name.startsWith('._');

async function copyTree(src, dst, stats) {
  await mkdir(dst, { recursive: true });
  for (const ent of await readdir(src, { withFileTypes: true })) {
    if (isJunk(ent.name)) {
      stats.junk++;
      continue;
    }
    const s = join(src, ent.name);
    const d = join(dst, ent.name);
    if (ent.isDirectory()) {
      await copyTree(s, d, stats);
    } else if (ent.isFile()) {
      await copyFile(s, d);
      stats.files++;
    }
  }
}

async function main() {
  const outRel = relative(REPO, OUT);
  if (!force && (await hasContent(OUT))) {
    log(`${outRel} already has files, nothing to do (use --force to re-download)`);
    return;
  }

  const jar = new CookieJar();
  const purchaseUrl = `${GAME}/purchase`;

  log('1/5 loading purchase page');
  const { res: purchaseRes } = await request(jar, purchaseUrl);
  if (!purchaseRes.ok) throw new Error(`purchase page returned HTTP ${purchaseRes.status}`);
  const csrfPurchase = findCsrf(await purchaseRes.text(), 'purchase page');

  log('2/5 requesting download page');
  const downloadUrl = await postForJsonUrl(jar, `${GAME}/download_url`, { csrf_token: csrfPurchase });

  log('3/5 reading upload list');
  const { res: listRes, url: downloadPage } = await request(jar, downloadUrl);
  if (!listRes.ok) throw new Error(`download page returned HTTP ${listRes.status}`);
  const listHtml = await listRes.text();
  const csrfDownload = findCsrf(listHtml, 'download page');
  const uploads = parseUploads(listHtml);
  const upload = uploads.find((u) => u.name === UPLOAD_NAME);
  if (!upload) {
    const found = uploads.map((u) => u.name ?? `(unnamed upload ${u.id})`).join(', ') || 'none';
    throw new Error(`"${UPLOAD_NAME}" not listed on ${downloadPage}. Uploads found: ${found}`);
  }
  log(`   found "${upload.name}" (upload_id ${upload.id})`);

  log('4/5 requesting signed file url');
  const fileUrl = await postForJsonUrl(
    jar,
    `${GAME}/file/${upload.id}?source=game_download`,
    { csrf_token: csrfDownload },
    downloadPage,
  );

  log('5/5 downloading and extracting');
  await mkdir(SCRATCH, { recursive: true });
  const scratch = await mkdtemp(join(SCRATCH, 'tinyswords-'));
  const { res: zipRes } = await request(jar, fileUrl);
  if (!zipRes.ok) throw new Error(`zip download returned HTTP ${zipRes.status}`);
  const zipBuf = Buffer.from(await zipRes.arrayBuffer());
  if (zipBuf.subarray(0, 4).toString('latin1') !== 'PK\x03\x04') {
    throw new Error(`download is not a zip (${zipBuf.length} bytes): ${zipBuf.subarray(0, 120).toString('utf8')}`);
  }
  const zipPath = join(scratch, UPLOAD_NAME);
  await writeFile(zipPath, zipBuf);
  log(`   saved ${zipBuf.length} bytes to ${zipPath}`);

  const extractDir = join(scratch, 'extracted');
  const unzip = spawnSync('unzip', ['-q', '-o', '-d', extractDir, zipPath, '-x', '__MACOSX/*', '*.DS_Store'], {
    encoding: 'utf8',
  });
  if (unzip.error) throw new Error(`could not run unzip: ${unzip.error.message}`);
  if (unzip.status > 1) throw new Error(`unzip failed (exit ${unzip.status}): ${unzip.stderr.trim()}`);
  if (unzip.status === 1) warn(`unzip exited with 1: ${unzip.stderr.trim() || 'no details'}`);

  // Pick the root to install: the "Tiny Swords (Free Pack)" folder, flattened into OUT.
  const top = (await readdir(extractDir, { withFileTypes: true })).filter((e) => !isJunk(e.name));
  let root = extractDir;
  const named = top.find((e) => e.isDirectory() && e.name === TOP_DIR);
  if (named) {
    root = join(extractDir, named.name);
  } else if (top.length === 1 && top[0].isDirectory()) {
    root = join(extractDir, top[0].name);
    warn(`top folder is "${top[0].name}", not "${TOP_DIR}"; flattening it anyway`);
  } else {
    warn('archive has no single top folder; installing the archive root as-is');
  }

  if (force) await rm(OUT, { recursive: true, force: true });
  const stats = { files: 0, junk: 0 };
  try {
    await copyTree(root, OUT, stats);
  } catch (err) {
    await rm(OUT, { recursive: true, force: true });
    throw err;
  }

  const topLevel = (await readdir(OUT, { withFileTypes: true }))
    .map((e) => (e.isDirectory() ? `${e.name}/` : e.name))
    .sort();
  log(`installed ${stats.files} files into ${outRel} (dropped ${stats.junk} __MACOSX/.DS_Store entries)`);
  log(`top level: ${topLevel.join(', ')}`);
  log(`archive kept at ${zipPath}`);
}

main().catch((err) => {
  console.error(`fetch-tinyswords: FAILED: ${err.message}`);
  process.exit(1);
});
