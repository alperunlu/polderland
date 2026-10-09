/**
 * App Store screenshots with a caption: each raw shot from screenshots.mjs set
 * in a rounded frame under a headline, on a sea-blue ground, at Apple's exact
 * pixel sizes.
 *
 *   node scripts/captions.mjs [dir] [lang ...]
 *
 * Reads  <dir>/<lang>/<device>/NN-name.png        (the raw shots)
 * Writes <dir>/<lang>/<device>-captioned/NN-name.png
 *
 * The raw shots are left alone, so this can be re-run whenever a caption is
 * reworded. The words live in CAPTIONS below, one pair per shot and language.
 * Playwright is not a dependency of this package, as with screenshots.mjs.
 */

import { mkdir, readFile } from 'node:fs/promises';
import { existsSync, readdirSync } from 'node:fs';
import { chromium } from 'playwright';

const DIR = process.argv[2] || 'store/screenshots';
const LANGS = process.argv.slice(3).length ? process.argv.slice(3) : ['en', 'nl'];

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
 * The two Apple sizes in use, and where the caption and the frame sit on each.
 * `top` is where the screenshot starts and `shotW` how wide it is drawn. The
 * whole shot is kept in view with a margin below it: letting it run off the
 * bottom edge, as store pages often do, cut the build buttons in half, and
 * the controls are part of what the shot is selling.
 */
const DEVICES = {
  'iphone-6.9': {
    w: 1320, h: 2868, pad: 120, head: 120, sub: 50, shotW: 1020, top: 580, radius: 96, gap: 22,
  },
  'ipad-13': {
    w: 2752, h: 2064, pad: 160, head: 150, sub: 64, shotW: 2080, top: 440, radius: 80, gap: 22,
  },
};

/** Headline and a line under it, per shot. Keep the claims true to the game. */
const CAPTIONS = {
  en: {
    '01-title': ['Keep the sea out', 'A strategy game about living below sea level'],
    '02-polder': ['Drain the polder', 'Mills, canals and outlets keep the land dry'],
    '03-storm': ['Read the storm', 'Raise the dike before the wind turns'],
    '04-flood': ["Don't let the sea in", 'One breach and the village goes under'],
    '05-build': ['Build with care', 'Every mill and ditch costs guilders'],
  },
  nl: {
    '01-title': ['Houd de zee buiten', 'Een strategiespel over leven onder zeeniveau'],
    '02-polder': ['Maal de polder droog', 'Molens en vaarten houden het land droog'],
    '03-storm': ['Lees de storm', 'Verhoog de dijk voordat de wind draait'],
    '04-flood': ['Laat de zee er niet in', 'Eén doorbraak en het dorp loopt onder'],
    '05-build': ['Bouw met beleid', 'Elke molen en vaart kost guldens'],
  },
};

const esc = (s) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;');

function html(d, head, sub, dataUri) {
  return `<!doctype html><html><head><meta charset="utf-8"><style>
    * { box-sizing: border-box; margin: 0; }
    html, body { width: ${d.w}px; height: ${d.h}px; overflow: hidden; }
    body {
      position: relative;
      background: linear-gradient(180deg, #3f93c8 0%, #2a76aa 34%, #1b4a80 66%, #0d1224 100%);
      font-family: "Avenir Next", "Helvetica Neue", Arial, "Liberation Sans", "DejaVu Sans", sans-serif;
      color: #fbf3df;
    }
    /* A low sun and a band of horizon light behind the words. */
    .glow {
      position: absolute; left: 50%; top: ${Math.round(d.top * 0.55)}px; width: ${d.w * 1.3}px; height: ${d.w * 1.3}px;
      transform: translate(-50%, -50%);
      background: radial-gradient(closest-side, rgba(255, 233, 170, .30), rgba(255, 233, 170, 0) 70%);
    }
    .text {
      position: absolute; left: ${d.pad}px; right: ${d.pad}px; top: 0; height: ${d.top - Math.round(d.pad * 0.25)}px;
      display: flex; flex-direction: column; justify-content: center; text-align: center;
    }
    h1 {
      font-size: ${d.head}px; line-height: 1.04; font-weight: 800; letter-spacing: -0.01em; text-wrap: balance;
      text-shadow: 0 6px 0 rgba(13, 18, 36, .35), 0 14px 40px rgba(13, 18, 36, .35);
    }
    p {
      margin-top: ${d.gap}px; font-size: ${d.sub}px; line-height: 1.22; font-weight: 500; text-wrap: balance;
      color: rgba(251, 243, 223, .86);
    }
    .shot {
      position: absolute; top: ${d.top}px; left: ${Math.round((d.w - d.shotW) / 2)}px; width: ${d.shotW}px;
      border-radius: ${d.radius}px; overflow: hidden;
      box-shadow: 0 0 0 10px rgba(13, 18, 36, .85), 0 0 0 14px rgba(255, 255, 255, .20),
                  0 50px 140px rgba(0, 0, 0, .55);
    }
    .shot img { display: block; width: 100%; height: auto; }
  </style></head><body>
    <div class="glow"></div>
    <div class="text"><h1>${esc(head)}</h1><p>${esc(sub)}</p></div>
    <div class="shot"><img src="${dataUri}"></div>
  </body></html>`;
}

const exe = chromePath();
const browser = await chromium.launch(exe ? { executablePath: exe } : {});
let made = 0;
let missing = 0;

for (const lang of LANGS) {
  for (const [device, d] of Object.entries(DEVICES)) {
    const out = `${DIR}/${lang}/${device}-captioned`;
    await mkdir(out, { recursive: true });
    for (const [name, [head, sub]] of Object.entries(CAPTIONS[lang])) {
      const src = `${DIR}/${lang}/${device}/${name}.png`;
      if (!existsSync(src)) { console.error(`missing ${src}`); missing += 1; continue; }
      const dataUri = `data:image/png;base64,${(await readFile(src)).toString('base64')}`;
      const page = await browser.newPage({ viewport: { width: d.w, height: d.h }, deviceScaleFactor: 1 });
      await page.setContent(html(d, head, sub, dataUri), { waitUntil: 'load' });
      await page.screenshot({ path: `${out}/${name}.png`, type: 'png' });
      await page.close();
      made += 1;
    }
    console.log(`${lang}/${device}-captioned: done`);
  }
}

await browser.close();
console.log(`${made} captioned shots`);
if (missing) process.exit(1);
