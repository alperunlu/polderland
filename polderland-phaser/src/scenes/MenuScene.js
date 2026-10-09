import Phaser from 'phaser';
import { P } from '../palette.js';
import { TILE_W, TILE_H } from '../art/px.js';
import {
  ANCHORS, seaVariant, castShadowKey, shadowReach, makeCloudSprites, makeTitleSky, makeSeaHaze,
  makeFarCoast, dikeCornerKey,
} from '../art/textures.js';
import {
  panel, label, button, iconButton, slider, tooltipLayer, attachTip, textWidth, capY,
  PANEL_SHADOW, CAP_H,
} from '../ui/widgets.js';
import { metricsFor } from '../systems/viewport.js';
import { LEVELS, levelSubtitle } from '../systems/levels.js';
import {
  getProgress, isUnlocked, loadGame, clearSave, loadSettings, saveSettings,
} from '../systems/SaveGame.js';
import { Audio } from '../systems/Audio.js';
import { formatMoney } from '../helpers.js';
import {
  t as tr, getLang, setLang, LANGS, LANG_NAMES,
} from '../systems/i18n.js';
import { transition } from '../systems/nav.js';
import { Haptics, setHapticsEnabled, hapticsEnabled } from '../systems/Haptics.js';

/** How far below the land the sea surface is drawn in the diorama. */
const SEA_DROP = 7;
/** A village of different fronts rather than one house repeated. */
const HOUSE_PICK = [0, 3, 5, 1, 6, 2, 7, 4];

/**
 * The diorama's islands, largest first; the first that fits the rect the
 * layout gives it is used. `lx` x `ly` tiles including the dike ring; the
 * canal runs along row `canal` and out through a sluice in the right-hand
 * bank. Tiles not listed are pasture.
 */
const ISLANDS = [
  {
    lx: 10, ly: 6, canal: 3,
    tiles: [
      ['red', 1, 1], ['tree', 2, 1, 1], ['church', 3, 1], ['house', 4, 1], ['house', 5, 1],
      ['yellow', 6, 1], ['yellow', 7, 1], ['mill', 8, 1],
      ['mill', 1, 2], ['house', 3, 2], ['red', 4, 2], ['house', 5, 2], ['house', 6, 2],
      ['tree', 7, 2], ['plain', 8, 2],
      ['cow', 1, 4], ['red', 2, 4], ['red', 3, 4], ['yellow', 4, 4], ['yellow', 5, 4],
      ['plain', 6, 4], ['tree', 7, 4], ['cow', 8, 4, 1],
    ],
  },
  {
    lx: 8, ly: 5, canal: 2,
    tiles: [
      ['tree', 1, 1, 1], ['church', 2, 1], ['house', 3, 1], ['house', 4, 1], ['yellow', 5, 1],
      ['mill', 6, 1],
      ['cow', 1, 3], ['red', 2, 3], ['red', 3, 3], ['yellow', 4, 3], ['plain', 5, 3], ['tree', 6, 3],
    ],
  },
  {
    lx: 6, ly: 5, canal: 2,
    tiles: [
      ['church', 1, 1], ['house', 2, 1], ['yellow', 3, 1], ['mill', 4, 1],
      ['red', 1, 3], ['yellow', 2, 3], ['cow', 3, 3], ['tree', 4, 3],
    ],
  },
  {
    lx: 6, ly: 4, canal: 2,
    tiles: [['church', 1, 1], ['house', 2, 1], ['yellow', 3, 1], ['mill', 4, 1]],
  },
  {
    lx: 5, ly: 4, canal: 2,
    tiles: [['church', 1, 1], ['yellow', 2, 1], ['mill', 3, 1]],
  },
];

/**
 * The title screen. The diorama behind the menu is built from the same
 * sprites the game uses, sized to whatever viewport it lands in, and the
 * scenario list is a vertical stack so it works from a phone up.
 */
export class MenuScene extends Phaser.Scene {
  constructor() {
    super({ key: 'MenuScene' });
  }

  create() {
    this.tips = tooltipLayer(this, 900);
    this.layout();
    this.cameras.main.fadeIn(350, 13, 18, 36);
    Audio.setMood('calm');
    this.input.once('pointerdown', () => Audio.startMusic());

    this.scale.on('resize', this.onResize, this);
    this.events.once('shutdown', () => this.scale.off('resize', this.onResize, this));
  }

  onResize() {
    // Rebuilding is cheaper and safer than repositioning every element.
    this.scene.restart();
  }

  layout() {
    const W = this.scale.width;
    const H = this.scale.height;
    this.m = metricsFor(W, H, this.scale.zoom);

    this.L = this.menuLayout(W, H);
    const L = this.L;
    this.drawSky(W, H);
    this.buildDiorama(W, H, L.islandTop, L.islandBottom, L.islandCx, L.islandW);
    this.drawTitle(W, H);
    this.buildLevelList(W, H);
    this.buildFooter(W, H);
  }

  /**
   * The sky itself is laid under the island once the island has been
   * placed, since the horizon is set by where the island sits; here only the
   * cloud sprites are made, once.
   */
  drawSky() {
    makeCloudSprites(this);
  }

  /**
   * Where the three blocks of the title screen go: the wordmark across the
   * top, then the island and the scenario list. Upright, they stack. On a
   * landscape screen there is not the height to stack them — the island
   * would sit behind the list — so the list moves to a column on the right
   * and the island takes the space to its left.
   */
  menuLayout(W, H) {
    const m = this.m;
    const t = m.text;
    // Title.
    const logo = this.textures.get('ui_logo').getSourceImage();
    const logoScale = Phaser.Math.Clamp(
      Math.min(Math.floor((W * 0.6) / logo.width), Math.floor((H * 0.2) / logo.height)), 2, 5,
    );
    const logoY = Math.max(6, Math.round(H * 0.03));
    const ribbonY = logoY + logo.height * logoScale + 2;
    const ribbonH = CAP_H * t + 8 + PANEL_SHADOW;
    const titleBottom = ribbonY + ribbonH;
    // List.
    const hasSave = !!loadGame();
    let rowH = t > 1 ? 62 : 46;
    let continueH = hasSave ? (t > 1 ? 50 : 32) + 4 : 0;
    let listH = LEVELS.length * rowH + (LEVELS.length - 1) * 4 + continueH;
    const footerTop = H - this.footerH() - 4;
    const side = W >= H * 1.3;
    if (side) {
      // The column sits in the room between the wordmark and the footer, and
      // on a short landscape screen four scenarios plus a Continue button at
      // the usual card height ran past the bottom edge: the last card, and
      // its Play button, were cut off. Squeeze the cards before they spill.
      const room = footerTop - (titleBottom + 6);
      if (listH > room) {
        if (hasSave) continueH = 36;
        const gaps = (LEVELS.length - 1) * 4;
        rowH = Math.max(40, Math.min(rowH, Math.floor((room - continueH - gaps) / LEVELS.length)));
        listH = LEVELS.length * rowH + gaps + continueH;
      }
    }
    let listW;
    let listX;
    let listTop;
    let islandCx;
    let islandW;
    let islandBottom;
    if (side) {
      listW = Math.min(t > 1 ? 440 : 320, Math.round(W * 0.5));
      listX = W - m.pad - listW;
      // Centred in the room under the title, and never higher than it.
      listTop = Math.max(titleBottom + 6, Math.round((titleBottom + footerTop - listH) / 2));
      islandW = listX - m.pad * 2;
      islandCx = Math.round(m.pad + islandW / 2);
      islandBottom = footerTop - 2;
    } else {
      listW = Math.min(460 + (t - 1) * 140, W - m.pad * 2);
      listX = Math.round((W - listW) / 2);
      listTop = Math.round(footerTop - 2 - listH);
      islandW = W;
      islandCx = Math.round(W / 2);
      islandBottom = listTop - 4;
    }
    return {
      side, logoScale, logoY, ribbonY, ribbonH, titleBottom, rowH, continueH,
      listW, listX, listTop, islandTop: titleBottom + 2, islandBottom, islandCx, islandW,
    };
  }

  /**
   * The title screen's hero shot: a whole polder, sized to the rect
   * menuLayout gives it, on an open sea under a morning sky.
   *
   * The island is a real one in miniature — a sand ring with its dike on
   * every outward edge, a sluice where the canal runs out through it, the
   * village and its church along the back, a mill as the focal point, tulip
   * fields and grazing in front — composed by hand at a few sizes, largest
   * that fits first. Every object is placed on an interior tile of the
   * island it belongs to, so nothing can end up out on the water at any
   * screen size, and objects are spaced by footprint rather than by today's
   * pixel sizes.
   */
  buildDiorama(W, H, top, bottom, cx = W / 2, regionW = W) {
    const band = bottom - top;
    // The wordmark's own rect: tall sprites may rise beside it, never into it.
    const L = this.L || {};
    let title = null;
    if (L.titleBottom && this.textures.exists('ui_logo')) {
      const lw = this.textures.get('ui_logo').getSourceImage().width * (L.logoScale || 1);
      title = new Phaser.Geom.Rectangle(W / 2 - lw / 2 - 6, 0, lw + 12, L.titleBottom + 2);
    }
    const shift = (d, dx, dy) => {
      for (const s of d.items) { s.x += dx; s.y += dy; }
      d.ox = (d.ox || 0) + dx;
      d.oy = (d.oy || 0) + dy;
      d.bounds.x += dx;
      d.bounds.y += dy;
      d.land.x += dx;
      d.land.y += dy;
    };
    const clearOfTitle = (d) => !title || d.items.every((s) => s.depth < 0
      || s.blendMode === Phaser.BlendModes.MULTIPLY
      || !Phaser.Geom.Intersects.RectangleToRectangle(s.getBounds(), title));

    this.dio = null;
    for (const spec of ISLANDS) {
      const last = spec === ISLANDS[ISLANDS.length - 1];
      if (!last && (spec.lx + spec.ly) * (TILE_W / 2) + 12 > regionW) continue;
      const d = this.buildIsland(spec);
      shift(d, Math.round(cx - (d.land.x + d.land.width / 2)), 0);
      if (d.bounds.height <= band) {
        // Everything fits: centre it in the rect.
        shift(d, 0, Math.round(top + (band - d.bounds.height) / 2 - d.bounds.y));
        this.dio = d;
        break;
      }
      // Otherwise sit the land on the bottom of the rect and let the mill
      // and the spire rise above its top, so long as they stay on screen
      // and clear of the wordmark.
      shift(d, 0, Math.round(bottom - 2 - (d.land.y + d.land.height)));
      const ok = d.bounds.y >= 2 && d.land.y >= top - 4 && clearOfTitle(d);      if (ok || last) {
        if (!ok && d.land.y < top) shift(d, 0, Math.round(top - d.land.y));
        this.dio = d;
        break;
      }
      for (const s of d.items) s.destroy();
    }
    this.drawBackdrop(W, H, this.dio.land.y);
  }

  /**
   * One island from a spec, built around a local origin at the centre of tile
   * (0, 0). Returns its display objects and bounds (land, and land plus
   * everything standing on it).
   */
  buildIsland(spec) {
    const { lx, ly, canal } = spec;
    const items = [];
    const mills = [];
    const shadows = [];
    const water = [];
    const HW = TILE_W / 2;
    const HH = TILE_H / 2;
    const ROW = 16;
    const layer = { ground: 0, ditch: 2, dike: 4, object: 6 };

    const place = (key, gx, gy, lift, depthLayer, depthAdd = 0) => {
      const s = this.add.image(
        Math.round((gx - gy) * HW),
        Math.round((gx + gy) * HH + lift),
        key,
      );
      const a = ANCHORS[key] || { x: HW, y: HH };
      s.setOrigin(a.x / s.width, a.y / s.height);
      s.setDepth((gx + gy) * ROW + depthLayer + depthAdd);
      items.push(s);
      return s;
    };
    const castShadow = (s, gx, gy) => {
      const key = castShadowKey(this, s.texture.key, 1);
      if (!key) return;
      const sh = this.add.image(s.x, s.y, key).setBlendMode(Phaser.BlendModes.MULTIPLY)
        .setTint(P.shadowTint).setAlpha(0.5);
      const a = ANCHORS[key];
      sh.setOrigin(a.x / sh.width, a.y / sh.height);
      sh.setDepth((gx + gy + shadowReach(key)) * ROW + layer.ditch + 1);
      items.push(sh);
      shadows.push({ sh, src: s });
    };

    // Ground heights, as the game draws them: the ring stands proud, the
    // polder floor sits a little low, and the sea lower still.
    const RING = -3;
    const FLOOR = 2;
    const SEA = SEA_DROP;

    // Sea: two paler shelf rings round the island, like the map's own.
    for (let gy = -2; gy < ly + 2; gy++) {
      for (let gx = -2; gx < lx + 2; gx++) {
        if (gx >= 0 && gy >= 0 && gx < lx && gy < ly) continue;
        const ring = Math.max(gx < 0 ? -gx : gx - lx + 1, gy < 0 ? -gy : gy - ly + 1) === 1 ? 1 : 0;
        const s = place(`t_sea${ring}_0_${seaVariant(gx, gy)}`, gx, gy, SEA, 0);
        s.setDepth(-160);
        water.push({ s, kind: 'sea', ring, v: seaVariant(gx, gy) });
      }
    }

    const cell = {};
    for (const [kind, gx, gy, arg] of spec.tiles) cell[`${gx},${gy}`] = [kind, arg];
    let houseN = 0;
    for (let gy = 0; gy < ly; gy++) {
      for (let gx = 0; gx < lx; gx++) {
        const edges = [];
        if (gx === 0) edges.push('xm');
        if (gy === 0) edges.push('ym');
        if (gx === lx - 1) edges.push('xp');
        if (gy === ly - 1) edges.push('yp');
        if (edges.length) {
          place(`t_sand_${(gx + gy) % 2}`, gx, gy, RING, layer.ground);
          const corner = dikeCornerKey(edges);
          for (const e of corner ? [corner] : edges) {
            const sluice = e === 'xp' && gy === canal;
            // The low crest: at the title's scale the raised ring read as a
            // stone wall round a pool rather than a grass bank round a polder.
            place(sluice ? 's_sluice_xp_0' : `s_dike_${e}_0`, gx, gy, RING, layer.dike);
          }
          continue;
        }
        if (gy === canal) {
          const s = place('t_canal_0', gx, gy, FLOOR + 1, layer.ground);
          water.push({ s, kind: 'canal' });
          continue;
        }
        const [kind, arg] = cell[`${gx},${gy}`] || ['grass'];
        const v = (gx * 3 + gy * 5) % 3;
        const ground = kind === 'red' ? `t_field_red_${v}`
          : kind === 'yellow' ? `t_field_yellow_${v}`
            : kind === 'plain' ? `t_field_plain_${v}`
              : `t_grass_${(gx + gy) % 2 ? 'hi' : 'mid'}_${(gx * 7 + gy * 3) % 4}`;
        place(ground, gx, gy, FLOOR, layer.ground);
        // Ditches where one parcel meets another, on the two near edges.
        for (const [edge, nx, ny] of [['xp', gx + 1, gy], ['yp', gx, gy + 1]]) {
          if (nx >= lx - 1 || ny >= ly - 1 || ny === canal) continue;
          const [nk] = cell[`${nx},${ny}`] || ['grass'];
          const field = (k) => (k === 'red' || k === 'yellow' || k === 'plain' ? k : 'grass');
          if (field(nk) !== field(kind)) place(`t_ditch_${edge}`, gx, gy, FLOOR, layer.ditch);
        }

        let key = null;
        if (kind === 'mill') key = 'b_windmill_0';
        else if (kind === 'church') key = 'b_church';
        else if (kind === 'house') key = `b_house_${arg ?? (HOUSE_PICK[houseN++ % HOUSE_PICK.length])}`;
        else if (kind === 'tree') key = `p_tree_${arg || 0}`;
        else if (kind === 'cow') key = 'p_cow';
        if (!key || !this.textures.exists(key)) continue;
        const s = place(key, gx, gy, FLOOR, layer.object);
        if (kind === 'cow' && arg) s.setFlipX(true);
        if (kind === 'mill') mills.push(s);
        castShadow(s, gx, gy);
      }
    }

    // Bounds of the land alone, and of the land and all standing on it.
    let land = null;
    let all = null;
    const grow = (r, s) => {
      const bx = s.getBounds();
      if (!r) return new Phaser.Geom.Rectangle(bx.x, bx.y, bx.width, bx.height);
      Phaser.Geom.Rectangle.Union(r, bx, r);
      return r;
    };
    for (const s of items) {
      if (s.depth < 0 || s.blendMode === Phaser.BlendModes.MULTIPLY) continue;
      all = grow(all, s);
      if (s.texture.key.startsWith('t_')) land = grow(land, s);
    }

    // A boat working along the front of the island, just off the shelf.
    const boat = this.add.image(0, 0, 'p_boat');
    const ba = ANCHORS.p_boat;
    boat.setOrigin(ba.x / boat.width, ba.y / boat.height).setDepth(400);
    const wake = this.add.image(0, 0, 'fx_wake_0').setDepth(399).setAlpha(0.85);
    items.push(boat, wake);

    return {
      spec, items, mills, shadows, water, boat, wake, bounds: all, land,
      boatGy: ly + 0.9, boatGx: lx * 0.3, boatSpan: [-3, lx + 2],
    };
  }

  /**
   * Everything behind the island: sky with sun and halo, clouds in two
   * layers, a far coast on the horizon, and the open sea — the game's own
   * sea surface, aligned to the island's shelf tiles so there is no seam,
   * fading into haze toward the horizon. Plus cloud shadows drifting over
   * the island and water.
   */
  drawBackdrop(W, H, landTop) {
    const d = this.dio;
    const horizon = Phaser.Math.Clamp(Math.round(landTop - 12), 24, H - 40);
    // Shelf tiles behind the island would stand up above the horizon.
    for (const w of d.water) {
      if (w.kind === 'sea' && w.s.getBounds().y < horizon + 2) w.s.setVisible(false);
    }
    this.horizon = horizon;
    const sunX = Math.round(Math.max(26, W * 0.13));
    const sunY = Math.round(Phaser.Math.Clamp(horizon * 0.3, 18, 70));
    makeTitleSky(this, 'fx_menusky', W, horizon, sunX, sunY);
    this.add.image(0, 0, 'fx_menusky').setOrigin(0, 0).setDepth(-200);

    // The sea plane, from the horizon down. Its texture is the same wave as
    // the shelf tiles, offset so the pattern runs straight on under them.
    this.sea = this.add.tileSprite(0, horizon, W, H - horizon, 'fx_opensea_0')
      .setOrigin(0, 0).setDepth(-180);
    this.sea.tilePositionX = -d.ox;
    this.sea.tilePositionY = horizon - d.oy - SEA_DROP;
    const hazeH = Phaser.Math.Clamp(Math.round((landTop - horizon) + 28), 24, 90);
    makeSeaHaze(this, 'fx_menuhaze', hazeH);
    this.add.tileSprite(0, horizon, W, hazeH, 'fx_menuhaze').setOrigin(0, 0).setDepth(-150);

    if (!this.textures.exists('fx_farcoast')) makeFarCoast(this, 'fx_farcoast');
    for (const fx of [0.02, 0.7]) {
      this.add.image(Math.round(W * fx), horizon, 'fx_farcoast').setOrigin(0, 1).setDepth(-190);
    }

    // Clouds: far flat ones low over the horizon, near cumulus higher up.
    // Placed from a fixed pattern scaled to the screen, not at random, so the
    // title screen looks the same every time.
    this.clouds = [];
    const addCloud = (key, fx, y, speed, depth) => {
      const c = this.add.image(Math.round(W * fx), Math.round(y), key).setOrigin(0.5, 1).setDepth(depth);
      this.clouds.push({ c, x: c.x, speed });
    };
    addCloud('fx_cloud_5', 0.24, Math.max(24, horizon - 30), 1.2, -196);
    addCloud('fx_cloud_3', 0.6, Math.max(30, horizon - 44), 1.5, -196);
    addCloud('fx_cloud_4', 0.92, Math.max(20, horizon - 24), 1.0, -196);
    // Near cumulus in the open sky either side of the wordmark.
    const room = horizon - 8;
    if (room > 50) {
      addCloud('fx_cloud_0', 0.84, Math.max(44, room * 0.45), 3.0, -194);
      addCloud('fx_cloud_2', 0.1, Math.max(56, room * 0.62), 2.4, -194);
      const y1 = Math.round(room * 0.86);
      // Only where it clears the title ribbon.
      if (room > 110 && y1 - 32 > (this.L ? this.L.titleBottom : 0)) addCloud('fx_cloud_1', 0.62, y1, 2.7, -194);
    }

    // Cloud shadows over the sea and island, as in the game.
    this.cloudShade = this.add.tileSprite(0, horizon, W, H - horizon, 'fx_clouds')
      .setOrigin(0, 0).setDepth(450).setBlendMode(Phaser.BlendModes.MULTIPLY)
      .setTint(P.shadowTint).setAlpha(0.22);
    this.cloudDrift = 0;

    // A few gulls over the water.
    this.gulls = [];
    for (let i = 0; i < 3; i++) {
      const g = this.add.image(0, 0, 'fx_bird_0').setDepth(460);
      this.gulls.push({
        g, x: W * (0.15 + i * 0.3), y: horizon + 10 + i * 17, speed: 9 + i * 3, phase: i * 1.7,
      });
    }
  }

  update(time, delta) {
    const dt = Math.min(delta || 16, 100) / 1000;
    const d = this.dio;
    if (!d) return;
    const W = this.scale.width;

    const mill = Math.floor(time / 70) % 16;
    if (mill !== this.millFrame) {
      this.millFrame = mill;
      for (const s of d.mills) s.setTexture(`b_windmill_${mill}`);
      for (const { sh, src } of d.shadows) {
        if (!src.texture.key.startsWith('b_windmill_')) continue;
        const key = castShadowKey(this, src.texture.key, 1);
        if (key && sh.texture.key !== key) sh.setTexture(key);
      }
    }

    const water = Math.floor(time / 190) % 4;
    if (water !== this.waterFrame) {
      this.waterFrame = water;
      this.sea.setTexture(`fx_opensea_${water}`);
      for (const w of d.water) {
        w.s.setTexture(w.kind === 'canal' ? `t_canal_${water}` : `t_sea${w.ring}_${water}_${w.v}`);
      }
    }

    for (const c of this.clouds) {
      c.x += c.speed * dt;
      if (c.x - c.c.width / 2 > W) c.x = -c.c.width / 2;
      c.c.x = Math.round(c.x);
    }
    this.cloudDrift = (this.cloudDrift + dt * 6) % 256;
    this.cloudShade.tilePositionX = Math.round(this.cloudDrift);
    this.cloudShade.tilePositionY = Math.round(this.cloudDrift * 0.5) % 128;

    for (const g of this.gulls) {
      g.x += g.speed * dt;
      if (g.x > W + 10) g.x = -10;
      g.g.setPosition(Math.round(g.x), Math.round(g.y + Math.sin(time / 900 + g.phase) * 3));
      g.g.setTexture(Math.floor(time / 220 + g.phase) % 3 ? 'fx_bird_1' : 'fx_bird_0');
    }

    // The boat: along the front of the island and round again, riding a
    // pixel of swell, its wake pinned to its stern.
    const [a, b] = d.boatSpan;
    d.boatGx += dt * 0.22;
    if (d.boatGx > b) d.boatGx = a;
    const bx = Math.round((d.boatGx - d.boatGy) * (TILE_W / 2)) + d.ox;
    const by = Math.round((d.boatGx + d.boatGy) * (TILE_H / 2)) + d.oy + SEA_DROP;
    d.boat.setPosition(bx, by + Math.round(Math.sin(time / 600) * 0.9));
    const wk = `fx_wake_${Math.floor(time / 260) % 2}`;
    if (d.wake.texture.key !== wk) d.wake.setTexture(wk);
    const wa = ANCHORS[wk];
    d.wake.setOrigin((wa.x + 0.5) / d.wake.width, (wa.y + 0.5) / d.wake.height);
    d.wake.setPosition(bx - 9, by - 4);
  }

  /**
   * The wordmark and its tagline ribbon, in the band menuLayout reserves for
   * them ([0, L.titleBottom]); the island is free below it.
   */
  drawTitle(W) {
    const m = this.m;
    const L = this.L;
    const logo = this.textures.get('ui_logo').getSourceImage();
    this.add.image(Math.round(W / 2 - (logo.width * L.logoScale) / 2), L.logoY, 'ui_logo')
      .setOrigin(0, 0).setScale(L.logoScale).setDepth(501);

    // Tagline on a navy ribbon with brass rules either side.
    const tag = tr('menu.tagline');
    const t = m.text;
    // Tracked out a pixel per letter: a quiet subtitle under a loud mark.
    const tw = textWidth(tag, t) + (tag.length - 1) * t;
    const rw = tw + 20 * t;
    const rh = L.ribbonH;
    const ry = L.ribbonY;
    const rx = Math.round((W - rw) / 2);
    panel(this, rx, ry, rw, rh, 'ui_panel_dark').setDepth(500);
    label(this, W / 2, capY(ry + (rh - PANEL_SHADOW) / 2, t), tag, {
      size: t, color: P.ui.edgeLight, origin: [0.5, 0],
    }).setLetterSpacing(1).setDepth(501);
    const g = this.add.graphics().setDepth(500);
    const ruleY = Math.round(ry + (rh - PANEL_SHADOW) / 2);
    const ruleW = Math.min(40 * t, rx - m.pad);
    if (ruleW > 8) {
      g.fillStyle(P.ui.inkDark, 0.6);
      g.fillRect(rx - 4 - ruleW, ruleY, ruleW, 2);
      g.fillRect(rx + rw + 4, ruleY, ruleW, 2);
      g.fillStyle(P.ui.edgeLight, 1);
      g.fillRect(rx - 4 - ruleW, ruleY - 1, ruleW, 1);
      g.fillRect(rx + rw + 4, ruleY - 1, ruleW, 1);
    }
  }

  /** Scenarios as a vertical stack of cards: one per scenario, at any width. */
  buildLevelList(W, H) {
    const m = this.m;
    const t = m.text;
    const save = loadGame();
    const {
      rowH, listW, continueH, listX: x, listTop,
    } = this.L;
    let y = listTop;

    if (save) {
      const lv = LEVELS.find((l) => l.id === save.levelId);
      if (lv) {
        const text = tr('menu.continue', { name: lv.name });
        // The largest type that fits beside the icon: a long name such as
        // "Haarlemmermeer 1852" at the phone's usual size ran off the button.
        let size = t;
        while (size > 1) {
          const probe = label(this, 0, 0, text, { size, bold: true });
          const fits = probe.width <= listW - 64;
          probe.destroy();
          if (fits) break;
          size -= 1;
        }
        button(this, {
          x, y, w: listW, h: continueH - 4, size, primary: true, icon: 'ic_play', text,
          onClick: () => this.startLevel(lv, save),
        }).setDepth(700);
      }
      y += continueH;
    }

    this.levelRows = [];
    LEVELS.forEach((level, i) => {
      const unlocked = isUnlocked(LEVELS, i);
      const prog = getProgress(level.id);
      const c = this.add.container(x, y).setDepth(600);
      c.add(panel(this, 0, 0, listW, rowH, unlocked ? 'ui_panel' : 'ui_panel_dark'));
      const faceH = rowH - PANEL_SHADOW;

      // Number badge: brass for a scenario you can play, a padlock if not.
      const bs = faceH - 12;
      const badge = this.add.graphics();
      const bx = 6;
      const by = 6;
      badge.fillStyle(unlocked ? P.ui.brass[0] : P.ui.inkDark, 1);
      badge.fillRect(bx + 1, by, bs - 2, bs);
      badge.fillRect(bx, by + 1, bs, bs - 2);
      badge.fillStyle(unlocked ? P.ui.brass[3] : P.ui.panelDark, 1);
      badge.fillRect(bx + 1, by + 1, bs - 2, bs - 2);
      badge.fillStyle(unlocked ? P.ui.brass[5] : P.ui.panel, 1);
      badge.fillRect(bx + 1, by + 1, bs - 2, 1);
      badge.fillStyle(unlocked ? P.ui.brass[2] : P.ui.panelLo, 1);
      badge.fillRect(bx + 1, by + bs - 3, bs - 2, 2);
      c.add(badge);
      if (unlocked) {
        c.add(label(this, bx + bs / 2, capY(by + (bs - 2) / 2, 2), String(i + 1), {
          size: 2, bold: true, color: P.ui.brass[0], origin: [0.5, 0],
          shadowColor: P.ui.brass[5], shadowAlpha: 0.6,
        }));
      } else {
        c.add(this.add.image(bx + bs / 2, by + (bs - 2) / 2, 'ic_lock').setScale(t > 1 ? 2 : 1)
          .setAlpha(0.7));
      }

      const bw = Math.min(t > 1 ? 140 : 64, Math.round(listW * 0.3));
      const bh = faceH - 10;
      const tx = bx + bs + 6 + 2 * t;
      const textW = listW - tx - bw - 16;
      // Names at double size, unless a narrow card cannot hold every one of
      // them: the cards stay alike rather than each picking its own size.
      const nameSize = LEVELS.every((l) => textWidth(l.name, 2, true) <= textW) ? 2 : 1;
      c.add(label(this, tx, capY(faceH * 0.3 + 1, nameSize), level.name, {
        size: nameSize, bold: true, color: unlocked ? P.ui.text : P.ui.textMute,
      }));
      let sub = unlocked ? levelSubtitle(level)
        : tr('menu.lockedHint', { name: LEVELS[i - 1].name });
      let subColor = unlocked ? P.ui.textDim : P.ui.textMute;
      if (unlocked && prog.bestScore > 0) {
        sub = prog.completed
          ? tr('menu.completed', { score: formatMoney(prog.bestScore) })
          : tr('menu.best', { score: formatMoney(prog.bestScore), days: prog.bestDays });
        subColor = prog.completed ? P.ui.green : P.ui.edgeLight;
      }
      // Anything that will not fit on the line is cut rather than wrapped.
      while (sub.length > 4 && textWidth(sub, 1) > textW) sub = `${sub.slice(0, -2).trimEnd()}…`;
      c.add(label(this, tx, capY(faceH * 0.72, 1), sub, { size: 1, color: subColor }));

      const b = button(this, {
        x: listW - bw - 6, y: 5, w: bw, h: bh,
        text: tr(unlocked ? 'menu.play' : 'menu.locked'), size: t, primary: unlocked,
        onClick: () => this.startLevel(level),
      });
      b.setEnabled(unlocked);
      c.add(b);
      this.levelRows.push({ level, unlocked, button: b });
      y += rowH + 4;
    });
  }

  footerH() {
    return this.m.text > 1 ? 44 : 28;
  }

  buildFooter(W, H) {
    const m = this.m;
    const t = m.text;
    const fh = this.footerH() - 4;
    const fy = H - fh - 3;
    this.settingsBtn = iconButton(this, {
      x: W - fh - m.pad, y: fy, size: fh, icon: 'ic_gear', iconScale: t,
      hitPad: t > 1 ? 3 : 0,
      tooltip: tr('menu.settingsTip'),
      onClick: () => this.toggleSettings(),
    }).setDepth(700);
    attachTip(this.settingsBtn, this.tips);

    // A way in for someone who has never seen a polder. It sits next to the
    // settings gear rather than in the scenario list, where it would be
    // competing with the thing the player actually came here to press.
    // Width = pad + icon + gap + text + pad, the same sums button() uses.
    const gw = Math.round(textWidth(tr('menu.howTo'), t, true) + 16 * t
      + Math.max(6, 5 * t) * 2 + Math.max(4, 3 * t) + 2);
    this.howToBtn = button(this, {
      x: W - m.pad - fh - 6 - gw, y: fy, w: gw, h: fh, size: t, icon: 'ic_book', iconScale: t,
      text: tr('menu.howTo'),
      onClick: () => this.openGuide(),
    }).setDepth(700);

    // Control hints, when there is room left for them beside the guide.
    // One line or not at all: a hint wrapped into a corner is just clutter.
    const hintW = W - m.pad * 2 - fh - gw - 20;
    const hint = tr(t > 1 ? 'menu.hintTouch' : 'menu.hintKeys');
    if (textWidth(hint) <= hintW) {
      label(this, m.pad, capY(fy + (fh - 4) / 2, 1), hint, {
        size: 1, color: P.ui.textDim,
      }).setDepth(700);
    }
    label(this, W - m.pad, 4, 'v2.1', { size: 1, color: P.ui.textMute, origin: [1, 0] }).setDepth(700);

    this.buildSettingsPanel(W, H);
  }

  buildSettingsPanel(W, H) {
    const t = this.m.text;
    const w = Math.min(t > 1 ? 380 : 256, W - 24);
    const rowGap = t > 1 ? 44 : 26;
    const bh = t > 1 ? 40 : 22;
    const s = loadSettings();
    const hh = CAP_H * t + 12;
    const h = 2 + hh + 10 + (t > 1 ? 6 : 0) + rowGap * 2 + 12 + bh + 10 + bh + 6 + 14 + PANEL_SHADOW;
    const x = Math.round(W - w - this.m.pad);
    const y = Math.max(4, Math.round(H - h - this.footerH() - 4));
    // Both sliders start clear of the wider of the two labels, whatever the
    // language calls them.
    const labelW = Math.max(52,
      textWidth(tr('menu.music'), 1), textWidth(tr('menu.effects'), 1)) + 10;

    this.settingsPanel = this.add.container(x, y).setDepth(800).setVisible(false);
    this.settingsPanel.add(panel(this, 0, 0, w, h, 'ui_panel'));
    this.settingsPanel.add(this.add.rectangle(2, 2, w - 4, hh, P.ui.panelLo).setOrigin(0, 0));
    this.settingsPanel.add(label(this, 12, capY(2 + hh / 2, t), tr('menu.settings'), {
      size: t, bold: true, color: P.ui.edgeLight,
    }));

    let ry = 2 + hh + 10 + (t > 1 ? 6 : 0);
    const sliderRow = (name, value, onChange) => {
      this.settingsPanel.add(label(this, 12, capY(ry + 7, 1), name, { size: 1, color: P.ui.text }));
      this.settingsPanel.add(slider(this, {
        x: 12 + labelW, y: ry, w: w - labelW - 26, value, onChange,
      }));
      ry += rowGap;
    };
    sliderRow(tr('menu.music'), s.musicVolume, (v) => Audio.setMusicVolume(v));
    sliderRow(tr('menu.effects'), s.sfxVolume, (v) => { Audio.setSfxVolume(v); Audio.click(); });

    // Language. Each button says what it is in its own language, so it reads
    // to a player who cannot read the one currently selected.
    this.settingsPanel.add(label(this, 12, ry - 4, tr('menu.language'), {
      size: 1, color: P.ui.text,
    }));
    ry += 12;
    const current = getLang();
    const lw = Math.floor((w - 24 - (LANGS.length - 1) * 4) / LANGS.length);
    LANGS.forEach((code, i) => {
      const b = button(this, {
        x: 12 + i * (lw + 4), y: ry, w: lw, h: bh,
        text: LANG_NAMES[code], size: 1,
        accent: P.ui.gold,
        onClick: () => this.chooseLang(code),
      });
      b.setActive2(code === current);
      this.settingsPanel.add(b);
    });
    ry += bh + 10;

    // Vibration. Off is a real preference, not a fault, so it is a toggle
    // rather than something buried.
    this.settingsPanel.add(label(this, 12, capY(ry + (bh - 4) / 2, 1), tr('menu.haptics'), {
      size: 1, color: P.ui.text,
    }));
    const tw = t > 1 ? 80 : 56;
    const toggle = button(this, {
      x: w - tw - 12, y: ry, w: tw, h: bh,
      text: tr(hapticsEnabled() ? 'menu.on' : 'menu.off'), size: 1,
      accent: P.ui.green,
      onClick: () => {
        const on = !hapticsEnabled();
        setHapticsEnabled(on);
        saveSettings({ haptics: on });
        toggle.setText2(tr(on ? 'menu.on' : 'menu.off')).setActive2(on);
        if (on) Haptics.build();
      },
    });
    toggle.setActive2(hapticsEnabled());
    this.settingsPanel.add(toggle);
    ry += bh + 6;

    this.settingsPanel.add(label(this, 12, ry, tr('menu.saveNote'), {
      size: 1, color: P.ui.textMute, maxWidth: w - 24,
    }));
  }

  /**
   * Switching language rebuilds the menu rather than re-setting every label:
   * button widths, wrap points and the two-column readouts are all computed
   * from the text, so they have to be laid out again anyway.
   */
  chooseLang(code) {
    if (code === getLang()) {
      this.toggleSettings();
      return;
    }
    Audio.click();
    saveSettings({ lang: code });
    setLang(code);
    this.scene.restart();
  }

  toggleSettings() {
    this.settingsPanel.setVisible(!this.settingsPanel.visible);
  }

  /**
   * The guide runs over the top of the menu rather than replacing it: the
   * diorama stays behind it, and closing the guide leaves the player exactly
   * where they were instead of on a freshly rebuilt title screen.
   */
  openGuide() {
    this.settingsPanel.setVisible(false);
    this.tips.hide();
    this.scene.launch('HelpScene');
    this.scene.bringToTop('HelpScene');
  }

  startLevel(level, save = null) {
    Audio.stopMusic();
    if (!save) clearSave();
    this.cameras.main.fadeOut(260, 13, 18, 36);
    this.cameras.main.once('camerafadeoutcomplete', () => {
      transition(this, { stop: ['MenuScene'], start: 'GameScene', data: { level, save } });
    });
  }

}
