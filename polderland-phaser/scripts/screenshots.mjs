/**
 * App Store screenshots, at Apple's exact pixel sizes, in every language the
 * game ships in.
 *
 * The five shots are staged by driving the running simulation rather than by
 * playing, so the same frames come out every time and the Dutch set is the
 * same five moments as the English one.
 *
 *   node scripts/screenshots.mjs [outDir] [lang ...]
 *
 * Expects a static server on the build: `npx vite preview --port 8099` or
 * `python3 -m http.server 8099` inside dist/.
 *
 * Playwright is deliberately not a dependency of this package — it would pull
 * a browser download into every CI install for a script CI never runs. Install
 * it globally (`npm i -g playwright`) and, if node cannot resolve it from
 * here, point NODE_PATH at that global tree. Set CHROME_PATH if the browser
 * it should drive is not one Playwright installed itself.
 */

import { mkdir } from 'node:fs/promises';
import { existsSync, readdirSync } from 'node:fs';
import { chromium } from 'playwright';

const OUT = process.argv[2] || 'store/screenshots';
const LANGS = process.argv.slice(3).length ? process.argv.slice(3) : ['en', 'nl'];
const URL = process.env.GAME_URL || 'http://localhost:8099/';
/** ONLY=02 (or any part of a shot's name) re-takes just the matching shots. */
const ONLY = process.env.ONLY || '';
/** DEVICE=iphone limits the run to devices whose folder name contains it. */
const DEVICE = process.env.DEVICE || '';
/**
 * Where to find Chromium: CHROME_PATH if it is set, otherwise a browser under
 * PLAYWRIGHT_BROWSERS_PATH, otherwise whatever Playwright resolves for itself.
 * The middle case covers machines that pre-install browsers system-wide under
 * a version Playwright's own lookup does not expect.
 */
function chromePath() {
  if (process.env.CHROME_PATH) return process.env.CHROME_PATH;
  const root = process.env.PLAYWRIGHT_BROWSERS_PATH;
  if (!root || !existsSync(root)) return null;
  for (const entry of readdirSync(root)) {
    if (!entry.startsWith('chromium-')) continue;
    const exe = `${root}/${entry}/chrome-linux/chrome`;
    if (existsSync(exe)) return exe;
  }
  return null;
}

/**
 * CSS size x scale must equal the pixel size Apple asks for.
 *
 * The iPhone is portrait, because that is how the app is played on a phone,
 * and is driven as a touch device so the HUD is the one a player gets. No
 * notch insets are applied: with them the shot carries a dead dark band top
 * and bottom, which looks like a rendering fault on a store page. The iPad
 * shots stay landscape.
 */
const DEVICES = [
  {
    dir: 'iphone-6.9', width: 440, height: 956, scale: 3, touch: true,   // 1320 x 2868
  },
  { dir: 'ipad-13', width: 1376, height: 1032, scale: 2 },              // 2752 x 2064
];

/** Each shot stages the game, then names the file it produces. */
const SHOTS = [
  {
    name: '01-title',
    async run(page) {
      await page.waitForTimeout(600);
    },
  },
  {
    name: '02-polder',
    async run(page) {
      await startScenario(page);
      await page.evaluate(() => {
        const g = window.__polderland;
        const s = g.scene.getScene('GameScene');
        const sim = s.sim;
        // A polder somebody has been running well: the canal extended, a full
        // set of pumps working off it, and the land still dry. This is the
        // shot that has to say "you can win this".
        sim.money = 20000;
        for (let pass = 0; pass < 3; pass++) {
          for (const t of sim.canalTiles.slice()) {
            for (const [dx, dy] of [[1, 0], [0, 1], [-1, 0], [0, -1]]) {
              const row = sim.tiles[t.x + dx];
              const n = row && row[t.y + dy];
              if (n && sim.canalTiles.length < 18 && !sim.validate('canal', n)) sim.build('canal', n);
            }
          }
        }
        for (let x = 2; x < 14; x++) {
          for (let y = 2; y < 14; y++) {
            const t = sim.tiles[x][y];
            if (sim.pumps.length < 7 && !sim.validate('pump', t)
              && !sim.pumps.some((p) => Math.abs(p.x - x) + Math.abs(p.y - y) < 4)) sim.build('pump', t);
          }
        }
        sim.money = 5200;
        sim.stats.spent = 0;
        // Long enough that the works are visibly doing something, short
        // enough that they are still winning.
        for (let i = 0; i < 260; i++) sim.update(0.1, 2);
        window.__stageClean(true);
        s.refreshAllTiles();
      });
      await cleanHud(page);
      await freeze(page);
      await page.waitForTimeout(900);
    },
  },
  {
    name: '03-storm',
    async run(page) {
      await startScenario(page);
      await page.evaluate(() => {
        const s = window.__polderland.scene.getScene('GameScene');
        s.sim.stormState = 'active';
        s.sim.stormDaysLeft = 2.1;
        s.sim.stormDir = 'ym';
        s.sim.events.push({ type: 'stormStart', dir: 'ym' });
      });
      await cleanHud(page);
      await freeze(page);
      await page.waitForTimeout(900);
    },
  },
  {
    name: '04-flood',
    async run(page) {
      await startScenario(page);
      await page.evaluate(() => {
        const s = window.__polderland.scene.getScene('GameScene');
        const sim = s.sim;
        // Open the dike and let the sea in, which is the picture that sells
        // what the simulation actually does.
        const breach = sim.dikes.find((t) => t.edges && t.edges.includes('ym'));
        if (breach) { breach.dike.broken = true; sim.stats.breaches = 1; }
        sim.stormState = 'active';
        sim.stormDaysLeft = 1.6;
        sim.stormDir = 'ym';
        sim.surge = 2.0;
        // Run until the polder is plainly under water but the scenario is not
        // yet lost: a screenshot of a finished game shows a dead build bar.
        for (let i = 0; i < 1400; i++) {
          sim.update(0.1, 2);
          if (sim.outcome || sim.floodedTileCount() > sim.landTileCount() * 0.55) break;
        }
        window.__stageClean(false);
        s.refreshAllTiles();
      });
      await cleanHud(page, { repair: false });
      await freeze(page);
      await page.waitForTimeout(900);
    },
  },
  {
    name: '05-build',
    async run(page) {
      await startScenario(page);
      await page.evaluate(() => {
        const s = window.__polderland.scene.getScene('GameScene');
        for (let i = 0; i < 400; i++) s.sim.update(0.1, 2);
        window.__stageClean(true);
        s.refreshAllTiles();
        s.startPlacement('pump');
        const sim = s.sim;
        outer: for (let x = 4; x < 12; x++) {
          for (let y = 4; y < 12; y++) {
            if (!sim.validate('pump', sim.tiles[x][y])) { s.hoverTile = sim.tiles[x][y]; break outer; }
          }
        }
      });
      await cleanHud(page);
      await freeze(page);
      await page.waitForTimeout(900);
    },
  },
];

/**
 * Clear the two transient pieces of HUD that do not belong in a store shot:
 * the tutorial panel, which covers the map and dates the picture to minute
 * one, and whatever message happens to be left on the status line, which the
 * staged moment has usually outrun.
 */
async function cleanHud(page, { repair = true } = {}) {
  await page.evaluate((repairHouses) => {
    window.__stageClean(repairHouses);
    if (repairHouses) window.__polderland.scene.getScene('GameScene').refreshAllTiles();
    const hud = window.__polderland.scene.getScene('HudScene');
    hud.tutorialStep = 99;
    hud.updateTutorial(true);
    hud.flashMessage('', 'info');
  }, repair);
}

/**
 * Page-side helper for the staging code, installed once the game is up.
 *
 * It has to run in the same page.evaluate as the staging itself. Staging runs
 * the simulation directly, so what happened is queued for the scene to announce
 * on its next frame; a clean-up in a later evaluate loses that race, and a
 * "HOUSE LOST" toast and a floating label are drawn in between.
 */
async function installHelpers(page) {
  await page.evaluate(() => {
    window.__stageClean = (repairHouses) => {
      const game = window.__polderland.scene.getScene('GameScene');
      game.sim.events.length = 0;
      if (repairHouses) {
        // A house the staging happened to lose is put back, so the hero shots
        // do not open on a ruin. The flood shot keeps its ruins: that is what
        // it is for.
        for (const t of game.sim.buildings) {
          if (t.building && t.building.lost) Object.assign(t.building, { lost: false, damage: 0, flooded: false });
        }
        game.sim.stats.housesLost = 0;
      }
    };
  });
}

/** The boot scene generates every sprite, which takes as long as it takes. */
async function waitForMenu(page) {
  await page.waitForFunction(() => {
    const g = window.__polderland;
    const menu = g && g.scene.getScene('MenuScene');
    return !!(menu && menu.levelRows && menu.levelRows.length);
  }, null, { timeout: 60000 });
  await page.waitForTimeout(600);
}

async function startScenario(page) {
  // Game coordinates to page pixels through the canvas's own box. The canvas
  // does not always start at the page's corner (the safe-area insets move it)
  // and its backing size is not the page's, so scaling by zoom alone aims
  // at the wrong place on a phone.
  const rows = await page.evaluate(() => {
    const g = window.__polderland;
    const box = g.canvas.getBoundingClientRect();
    const kx = box.width / g.scale.width;
    const ky = box.height / g.scale.height;
    return g.scene.getScene('MenuScene').levelRows.map((r) => {
      const b = r.button.getBounds();
      return { x: box.left + (b.x + b.width / 2) * kx, y: box.top + (b.y + b.height / 2) * ky };
    });
  });
  await page.mouse.click(rows[0].x, rows[0].y);
  // The fade-out, the scene start and the first terrain render all have to
  // land before anything may touch the simulation.
  await page.waitForFunction(() => {
    const s = window.__polderland.scene.getScene('GameScene');
    return !!(s && s.sim && s.scene.isActive());
  }, null, { timeout: 60000 });
  await page.waitForTimeout(1200);
}

/**
 * Freeze the world for the shot. The game's own pause puts a menu on screen,
 * so this stops the scene's update loop instead and leaves the HUD drawing
 * the state the shot just staged.
 */
async function freeze(page) {
  await page.evaluate(() => window.__polderland.scene.pause('GameScene'));
}

const exe = chromePath();
const browser = await chromium.launch(exe ? { executablePath: exe } : {});
let failed = false;

for (const lang of LANGS) {
  for (const device of DEVICES.filter((d) => d.dir.includes(DEVICE))) {
    const dir = `${OUT}/${lang}/${device.dir}`;
    await mkdir(dir, { recursive: true });
    for (const shot of SHOTS.filter((x) => x.name.includes(ONLY))) {
      const ctx = await browser.newContext({
        viewport: { width: device.width, height: device.height },
        deviceScaleFactor: device.scale,
        ...(device.touch ? { isMobile: true, hasTouch: true } : {}),
      });
      const page = await ctx.newPage();
      const errors = [];
      page.on('pageerror', (e) => errors.push(String(e)));
      await page.addInitScript((l) => {
        window.localStorage.setItem('polderland.v2', JSON.stringify({
          settings: { musicVolume: 0, sfxVolume: 0, lang: l },
        }));
      }, lang);
      await page.goto(URL, { waitUntil: 'load' });
      await waitForMenu(page);
      await installHelpers(page);
      try {
        await shot.run(page);
      } catch (e) {
        const active = await page.evaluate(
          () => window.__polderland.scene.getScenes(true).map((x) => x.scene.key),
        ).catch(() => []);
        console.error(`${lang}/${device.dir}/${shot.name}: ${e.message.split('\n')[0]}`);
        console.error(`  active scenes: ${active.join(', ') || 'none'}; page errors: ${errors.join(' | ') || 'none'}`);
        await ctx.close();
        failed = true;
        continue;
      }
      await page.screenshot({ path: `${dir}/${shot.name}.png` });
      if (errors.length) {
        failed = true;
        console.error(`${lang}/${device.dir}/${shot.name}: ${errors[0]}`);
      }
      await ctx.close();
    }
    console.log(`${lang}/${device.dir}: done`);
  }
}

await browser.close();
if (failed) process.exit(1);
