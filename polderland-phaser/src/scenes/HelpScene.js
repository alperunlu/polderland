import Phaser from 'phaser';
import { P } from '../palette.js';
import {
  panel, label, button, headerBand, capY, PANEL_SHADOW, CAP_H,
} from '../ui/widgets.js';
import { metricsFor } from '../systems/viewport.js';
import { TILE_W, TILE_H } from '../art/px.js';
import { ANCHORS } from '../art/textures.js';
import { t as tr } from '../systems/i18n.js';

/**
 * A short illustrated guide, reachable from the title screen.
 *
 * The pictures are not diagrams drawn for the occasion: each page composes a
 * small isometric vignette out of the very sprites the game draws the board
 * with, the same way the menu builds its diorama. A player who has read the
 * guide is then looking for things they have already seen, rather than for
 * the real version of an illustration.
 *
 * One page at a time rather than a scrolling wall, because a page sized to
 * hold one idea fits a phone in portrait as readily as a desktop, and the
 * guide is six ideas long.
 *
 * `art` places sprites on a notional tile grid: [texture key, gx, gy, depth
 * bias]. The bias only orders sprites sharing a tile — a dike bank over the
 * sand it stands on, a mill over its field.
 *
 * Tall things go on (1,0) and (0,1), the left and right corners of the
 * diamond, which are 64px apart across the screen and level with each other.
 * (0,0) and (1,1) are the back and front corners: they share a screen column
 * only 32px apart, so a house on one and a church on the other overlap into
 * an unreadable heap. Those two carry the ground cover and the small props.
 */
const PAGES = [
  {
    key: 'polder',
    art: [
      ['t_grass_mid_0', 0, 0], ['t_grass_hi_1', 1, 0],
      ['t_grass_lo_2', 0, 1], ['t_grass_mid_3', 1, 1],
      ['b_church', 0, 1, 6], ['b_house_0', 1, 0, 6], ['p_cow', 1, 1, 6],
    ],
  },
  {
    key: 'dike',
    art: [
      ['t_sand_0', 0, 0], ['t_sand_1', 1, 0],
      ['t_grass_mid_1', 0, 1], ['t_grass_hi_2', 1, 1],
      ['s_dike_ym_1', 0, 0, 6], ['s_dike_ym_1', 1, 0, 6],
      ['p_cow', 0, 1, 6],
    ],
  },
  {
    key: 'canal',
    art: [
      ['t_grass_mid_2', 0, 0], ['t_grass_hi_0', 1, 0],
      ['t_canal_0', 0, 1, 1], ['t_canal_0', 1, 1, 1],
      ['p_reeds', 0, 0, 6], ['p_boat', 1, 1, 8],
    ],
  },
  {
    key: 'mill',
    art: [
      ['t_grass_mid_1', 0, 0], ['t_grass_lo_3', 1, 0],
      ['t_canal_0', 0, 1, 1], ['t_canal_0', 1, 1, 1],
      // The windmill, not the pump house: level one is 1612, and what the
      // player actually places there is a poldermolen. Showing the steam-era
      // engine house taught them to look for a building that scenario does
      // not contain.
      ['b_windmill_0', 1, 0, 6], ['p_reeds', 0, 1, 6],
    ],
  },
  {
    key: 'outlet',
    art: [
      ['t_sand_0', 0, 0], ['t_sand_1', 1, 0],
      ['t_canal_0', 0, 1, 1], ['t_canal_0', 1, 1, 1],
      ['s_sluice_ym_1', 0, 0, 6], ['s_dike_ym_1', 1, 0, 6],
    ],
  },
  {
    key: 'money',
    art: [
      ['t_field_yellow_0', 0, 0], ['t_field_red_1', 1, 0],
      ['t_grass_hi_3', 0, 1], ['t_field_plain_2', 1, 1],
      ['b_house_1', 1, 0, 6], ['p_tree_0', 0, 1, 6], ['p_cow', 1, 1, 6],
    ],
  },
];

export class HelpScene extends Phaser.Scene {
  constructor() {
    super({ key: 'HelpScene' });
  }

  init(data) {
    this.page = data?.page ?? 0;
  }

  create() {
    this.layout();
    this.input.keyboard.on('keydown-ESC', () => this.close());
    this.input.keyboard.on('keydown-LEFT', () => this.go(-1));
    this.input.keyboard.on('keydown-RIGHT', () => this.go(1));
    this.scale.on('resize', this.onResize, this);
    this.events.once('shutdown', () => this.scale.off('resize', this.onResize, this));
  }

  onResize() {
    this.scene.restart({ page: this.page });
  }

  go(d) {
    const next = this.page + d;
    if (next < 0 || next >= PAGES.length) return;
    this.scene.restart({ page: next });
  }

  close() {
    this.scene.stop();
  }

  /**
   * Build one page's vignette into a container, then scale it to the band it
   * has been given. Composing at natural tile size and scaling afterwards
   * keeps the art on whole pixels at 1x and lets the same page fill a large
   * screen without a second set of coordinates.
   */
  buildArt(spec, cx, cy, maxW, maxH) {
    const c = this.add.container(0, 0).setDepth(3);
    for (const [key, gx, gy, bias = 0] of spec) {
      if (!this.textures.exists(key)) continue;
      const s = this.add.image(
        Math.round((gx - gy) * (TILE_W / 2)),
        Math.round((gx + gy) * (TILE_H / 2)),
        key,
      );
      const a = ANCHORS[key] || { x: TILE_W / 2, y: TILE_H / 2 };
      s.setOrigin(a.x / s.width, a.y / s.height);
      s.setDepth((gx + gy) * 10 + bias);
      c.add(s);
    }
    const b = c.getBounds();
    if (b.width > 0 && b.height > 0) {
      // Whole-number scales only: this is pixel art, and 1.5x puts half of
      // every edge between two screen pixels.
      const fit = Math.min(maxW / b.width, maxH / b.height);
      const scale = Math.max(1, Math.floor(fit));
      c.setScale(scale);
      const nb = c.getBounds();
      c.setPosition(
        Math.round(c.x + (cx - (nb.x + nb.width / 2))),
        Math.round(c.y + (cy - (nb.y + nb.height / 2))),
      );
    }
    return c;
  }

  layout() {
    const W = this.scale.width;
    const H = this.scale.height;
    const m = metricsFor(W, H, this.scale.zoom);
    const t = m.text;
    const page = PAGES[this.page];

    this.add.rectangle(0, 0, W, H, P.ui.inkDark, 0.8).setOrigin(0, 0).setDepth(0);

    const w = Math.min(380 + (t - 1) * 120, W - m.pad * 2);
    const h = Math.min(310 + (t - 1) * 60, H - m.pad * 2);
    const x = Math.round((W - w) / 2);
    const y = Math.round((H - h) / 2);
    panel(this, x, y, w, h).setDepth(1);

    const head = headerBand(this, x, y, w, tr('help.title'), { size: 2, color: P.ui.gold });
    label(this, x + w - 12, capY(y + 2 + (head.bottom - y - 4) / 2, 1), `${this.page + 1}/${PAGES.length}`, {
      size: 1, origin: [1, 0], color: P.ui.textDim, bold: true,
    }).setDepth(3);

    // Buttons sit at the bottom; everything between the header and them is
    // the page, so the art band is whatever height is actually left over.
    const btnH = t > 1 ? 44 : 28;
    const by = y + h - PANEL_SHADOW - btnH - 10;

    const heading = label(this, W / 2, 0, tr(`help.${page.key}.title`), {
      size: t, origin: [0.5, 0], color: P.ui.edgeLight, bold: true,
    }).setDepth(2);
    const body = label(this, W / 2, 0, tr(`help.${page.key}.body`), {
      size: 1, origin: [0.5, 0], color: P.ui.text, align: 'center', maxWidth: w - 36,
    }).setDepth(2);

    // Text is laid out from the bottom up so the art gets the slack: the
    // Dutch of a given page is routinely a line longer than the English.
    const dotsY = by - 10;
    const bodyY = Math.round(dotsY - 10 - body.height);
    const headY = Math.round(bodyY - 5 - CAP_H * t - 2);
    heading.setY(headY);
    body.setY(bodyY);

    // The picture sits on a recessed stage, a window onto the polder.
    const artTop = head.bottom + 6;
    const artH = Math.max(32, headY - 8 - artTop);
    const stageW = w - 28;
    panel(this, x + 14, artTop, stageW, artH, 'ui_well').setDepth(2);
    this.buildArt(page.art, W / 2, artTop + artH / 2 + 2, stageW - 16, artH - 12);

    // Which page you are on, as dots rather than a second number.
    const dotGap = 8;
    const totalW = (PAGES.length - 1) * dotGap + 4 + 5;
    let dx = Math.round(W / 2 - totalW / 2);
    PAGES.forEach((p, i) => {
      const on = i === this.page;
      this.add.image(dx, dotsY, on ? 'ui_dot_on' : 'ui_dot').setOrigin(0, 0.5).setDepth(2);
      dx += dotGap + (on ? 4 : 0);
    });

    const gap = 6;
    const side = Math.floor((w - 28 - gap * 2) / 4);
    const mid = w - 28 - gap * 2 - side * 2;
    let bx = x + 14;
    const back = button(this, {
      x: bx, y: by, w: side, h: btnH, text: tr('help.back'), size: t,
      onClick: () => this.go(-1),
    }).setDepth(2);
    back.setEnabled(this.page > 0);
    bx += side + gap;

    // The last page's forward button closes the guide instead of dead-ending
    // on a disabled control.
    const last = this.page === PAGES.length - 1;
    button(this, {
      x: bx, y: by, w: mid, h: btnH, size: t, primary: true,
      text: tr(last ? 'help.start' : 'help.next'),
      onClick: () => (last ? this.close() : this.go(1)),
    }).setDepth(2);
    bx += mid + gap;

    button(this, {
      x: bx, y: by, w: side, h: btnH, text: tr('help.close'), size: t,
      onClick: () => this.close(),
    }).setDepth(2);
  }
}
