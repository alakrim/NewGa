/*
 * Real-browser online multiplayer smoke test (two Chromium pages talking to one server).
 * Not part of `npm test`. Run:
 *
 *   npm run build
 *   PORT=8790 node dist/server.js &            # keep it running in the background
 *   node tests/e2e-online.cjs                  # BASE=http://localhost:8790 SHOTS=/tmp/claude-0/shots by default
 *
 * Needs the `playwright` package with a preinstalled chromium (software GL flags are passed below).
 * Screenshots land in $SHOTS as online-*.png.
 */
const { chromium } = require('playwright');
const fs = require('node:fs');
const assert = require('node:assert/strict');

const BASE = process.env.BASE || 'http://localhost:8790';
const SHOTS = process.env.SHOTS || '/tmp/claude-0/shots';
fs.mkdirSync(SHOTS, { recursive: true });

const t0 = Date.now();
const step = (m) => console.log(`[${((Date.now() - t0) / 1000).toFixed(1)}s] ${m}`);

(async () => {
  const browser = await chromium.launch({ args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
  // one context on purpose: both players share localStorage (name / hero preference), as two tabs of one browser would
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 720 } });
  const A = await ctx.newPage();
  const B = await ctx.newPage();
  const errors = [];
  for (const [n, p] of [['A', A], ['B', B]]) {
    p.on('pageerror', (e) => errors.push(`${n} pageerror: ${e.message}`));
    p.on('console', (m) => { if (m.type() === 'error') errors.push(`${n} console: ${m.text()}`); });
  }
  const shot = async (p, name) => { await p.bringToFront(); await p.screenshot({ path: `${SHOTS}/online-${name}.png`, timeout: 60000 }); };

  try {
    step('A: open menu, create room');
    await A.goto(BASE + '/');
    await A.waitForSelector('#create', { timeout: 60000 });
    await A.click('#create');
    await A.waitForSelector('.code-box', { timeout: 10000 });
    const code = (await A.textContent('.code-box')).trim();
    assert.match(code, /^[A-Z]{4}$/);
    step(`room code ${code}`);

    step('B: open invite link (auto-join)');
    await B.goto(`${BASE}/?room=${code}`);
    await B.waitForSelector('.code-box', { timeout: 60000 });
    assert.equal((await B.textContent('.code-box')).trim(), code);
    await A.waitForFunction(() => document.querySelectorAll('.slot').length >= 2, null, { timeout: 5000 });

    step('both pick heroes');
    const heroIds = await A.$$eval('[data-hero]', (els) => els.map((e) => e.dataset.hero));
    await A.click(`[data-hero="${heroIds[0]}"]`);
    await B.click(`[data-hero="${heroIds[1]}"]`);
    await A.waitForFunction((id) => document.querySelector(`[data-hero="${id}"]`)?.classList.contains('selected'), heroIds[0]);
    // the teammate's pick shows up as taken (when on the same team) or both fine; just let the lobby settle
    await A.waitForTimeout(500);
    await shot(A, 'lobby-A');
    await shot(B, 'lobby-B');
    assert.equal(await B.$('#start'), null, 'non-host has no start button');

    step('A starts the match');
    await A.click('#start');
    await A.waitForSelector('.hud-bottom', { timeout: 150000 });
    await B.waitForSelector('.hud-bottom', { timeout: 150000 });
    await A.waitForTimeout(2500);
    await shot(A, 'game-A-start');
    await shot(B, 'game-B-start');

    step('A right-clicks to move');
    const before = await A.screenshot();
    await A.mouse.click(760, 330, { button: 'right' });
    await A.waitForTimeout(2500);
    await shot(A, 'game-A-moved');
    await shot(B, 'game-B-after-A-move');
    assert.ok(!before.equals(await A.screenshot()), 'A screen changed after moving');
    const clock = async (p) => (await p.textContent('.hud-top')).replace(/\s+/g, ' ').trim();
    const c1 = await clock(A);
    await A.waitForTimeout(2200);
    assert.notEqual(c1, await clock(A), 'game clock ticks on A');
    assert.notEqual(await clock(B), '', 'B has a HUD');

    step('chat B -> A');
    await B.keyboard.press('Enter');
    await B.keyboard.type('hello from B');
    await B.keyboard.press('Enter');
    await A.waitForFunction(() => [...document.querySelectorAll('.chat .line')].some((l) => l.textContent.includes('hello from B')), null, { timeout: 5000 });
    await shot(A, 'chat-A');
    step('chat A -> B');
    await A.keyboard.press('Enter');
    await A.keyboard.type('hi back');
    await A.keyboard.press('Enter');
    await B.waitForFunction(() => [...document.querySelectorAll('.chat .line')].some((l) => l.textContent.includes('hi back')), null, { timeout: 5000 });

    step('B refreshes the page mid-game: rejoins the same hero');
    await B.reload();
    await B.waitForSelector('.hud-bottom', { timeout: 150000 }); // software GL is slow: be generous
    await B.waitForTimeout(1500);
    await shot(B, 'game-B-after-reload');
    await B.keyboard.press('Enter');
    await B.keyboard.type('i am back');
    await B.keyboard.press('Enter');
    await A.waitForFunction(() => [...document.querySelectorAll('.chat .line')].some((l) => l.textContent.includes('i am back')), null, { timeout: 5000 });

    step('bad invite link falls back to the menu');
    await A.close(); await B.close(); // software GL is slow: free the CPU for the last page
    const C = await ctx.newPage();
    await C.goto(`${BASE}/?room=QQQQ`);
    await C.waitForSelector('#create', { timeout: 90000 });
    assert.ok(!C.url().includes('room='), 'stale ?room= is cleared');
    await shot(C, 'bad-code-menu');
    await C.close();

    assert.deepEqual(errors.filter((e) => !/favicon|GPU stall|WebGL|swiftshader/i.test(e)), [], 'no page errors');
    console.log('E2E OK');
  } catch (err) {
    if (!A.isClosed()) await shot(A, 'FAIL-A').catch(() => {});
    if (!B.isClosed()) await shot(B, 'FAIL-B').catch(() => {});
    console.error('E2E FAILED:', err);
    if (errors.length) console.error(errors.slice(0, 10).join('\n'));
    process.exitCode = 1;
  } finally {
    await browser.close();
  }
})();
