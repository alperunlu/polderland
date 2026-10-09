import Phaser from 'phaser';
import { P, css, mix } from '../palette.js';
import { TILE_W, TILE_H } from '../art/px.js';
import {
  ANCHORS, WAVE_FRAMES, seaVariant, SHOAL, HOUSE_CHIMNEY, dikeCornerKey,
  castShadowKey, shadowReach, lampOverlayKey,
} from '../art/textures.js';
import {
  PX_PER_M, ZOOM_LEVELS, DEFAULT_ZOOM_INDEX, CAM_KEY_SPEED, SPEEDS,
  PUMP_RADIUS, PUMP_CANAL_RANGE, LIGHT_CYCLE_DAYS, FLOOD_RECEDE,
} from '../constants.js';
import { isoX, isoY, screenToTile, clamp } from '../helpers.js';
import { Simulation } from '../systems/Simulation.js';
import { Audio } from '../systems/Audio.js';
import { loadSettings, saveGame, clearSave, recordResult } from '../systems/SaveGame.js';
import { levelById } from '../systems/levels.js';
import { metricsFor } from '../systems/viewport.js';
import { t as tr, keysOf, formatNumber } from '../systems/i18n.js';
import { MARSH_AT, ripe, flatsDrowned, marshPatch } from '../systems/wadden.js';
import { submitScore } from '../systems/GameCenter.js';
import { Haptics } from '../systems/Haptics.js';

/** Depth bands within one isometric row, so sprites stack in the right order. */
const D_TERRAIN = 0;
const D_FLOOD = 1;
const D_OVERLAY = 2;
const D_STRUCTURE = 4;
const D_OBJECT = 6;
const ROW_DEPTH = 16;
/**
 * Above every tile row of any map: overlays (highlight, weather, lights) sit
 * here. Fixed rather than derived from the map size, so a map that grows does
 * not end up drawing its new rows over them.
 */
const TOP_DEPTH = 1000 * ROW_DEPTH;
/** Neighbour offset -> the edge of the tile it lies across. */
const DIR_KEY = { '1,0': 'xp', '-1,0': 'xm', '0,1': 'yp', '0,-1': 'ym' };
/** Where in the light cycle day 0 falls: mid-morning. */
const TOD_START = 0.33;

export class GameScene extends Phaser.Scene {
  constructor() {
    super({ key: 'GameScene' });
  }

  init(data) {
    this.level = data.level || levelById(data.levelId);
    this.restoreData = data.save || null;
    this.isPaused = false;
    this.speedIndex = 0;
    this.placement = null;
    this.selected = null;
    this.hoverTile = null;
    this.aimTile = null;
    this.settings = loadSettings();
  }

  /* ================================================================
     SETUP
  ================================================================ */

  create() {
    // With a finger there is no hover, so placement becomes aim-then-confirm:
    // one tap puts the marker down, a second tap (or the BUILD button) commits
    // it. A fat finger should never cost 980 guilders.
    //
    // Which mode applies is decided by how the player actually just touched
    // the screen, not by sniffing the device: laptops have touchscreens and
    // tablets have trackpads.
    const device = this.sys.game.device;
    this.touchMode = device.input.touch && !device.os.desktop;

    this.sim = this.restoreData
      ? Simulation.restore(this.level, this.restoreData)
      : new Simulation(this.level);

    this.cameras.main.setBackgroundColor(css(P.sea[0]));
    this.setupBackdrop();
    this.buildWorld();
    this.setupCamera();
    this.setupInput();
    this.setupWeather();
    this.setupStormWaves();

    this.scene.launch('HudScene', { game: this });
    this.hud = this.scene.get('HudScene');

    // A scenario that holds its first storm back says so, and says where the
    // weather comes from: the grace period is for raising the right bank,
    // and a player who does not know which bank that is has no decision to
    // make, only a guess.
    if (!this.restoreData && this.level.firstStormDay && keysOf('en').includes(`level.${this.level.id}.brief`)) {
      this.time.delayedCall(1400, () => this.hud?.alert(tr('level.brief.title'),
        tr(`level.${this.level.id}.brief`, { days: Math.round(this.level.firstStormDay) }), 'warn'));
    }

    Audio.startMusic();
    this.autosaveTimer = 0;
    this.shakeUntil = 0;

    this.scale.on('resize', this.onResize, this);
    this.events.on('shutdown', () => this.teardown());
  }

  onResize(gameSize) {
    const w = gameSize.width;
    const h = gameSize.height;
    this.applyCameraViewport();
    const band = this.cameras.main.height;
    if (this.lightOverlay) this.lightOverlay.setSize(w, band);
    if (this.flash) this.flash.setSize(w, band);
    // Only the spawn line changes with the screen; setConfig would reset the
    // emitters' speeds and textures to defaults.
    if (this.rainEmitter) this.rainEmitter.updateConfig({ x: { min: -80, max: w + 80 } });
    if (this.rainFar) this.rainFar.updateConfig({ x: { min: -60, max: w + 60 } });
    // Turning the phone changes which part of the world is on screen, and the
    // camera would otherwise keep a scroll position chosen for the old shape —
    // often leaving the polder off the edge. Re-frame it instead.
    const portrait = h > w;
    if (this.wasPortrait !== undefined && this.wasPortrait !== portrait) {
      this.centreOnMap();
    }
    this.wasPortrait = portrait;
  }

  teardown() {
    this.scale.off('resize', this.onResize, this);
    this.scene.stop('HudScene');
    if (this.rainEmitter) this.rainEmitter.destroy();
    // The camera and its effects are already gone by the time 'shutdown'
    // reaches this listener (the camera manager's own listener runs first),
    // so there is nothing to remove, only a stale reference to drop. Reaching
    // for cameras.main here threw, which aborted the scene stop and with it
    // the Retry / Next / Menu buttons whenever a storm grade was active.
    this.stormFx = null;
  }

  /**
   * What lies beyond the island.
   *
   * The map is a finite diamond of tiles, so everything outside it used to be
   * the camera's flat background colour — a dead navy field filling half the
   * screen in portrait. These three layers replace it:
   *
   *  - an open-sea plane, cut from the same wave function as the map's own
   *    water, tiled across whatever the camera can see. It carries the tide
   *    with it, so the whole ocean rises and falls as one surface and there
   *    is no seam where the map's tiles end.
   *  - drifting cloud shadows over everything, moving with the wind.
   *  - a faint vignette, so the sea does not read as an evenly lit sheet.
   *
   * The first two are tile sprites re-fitted to the camera's world view each
   * frame rather than stretched to the map, which keeps them the same cost at
   * any zoom and lets the texture scroll in world pixels.
   */
  setupBackdrop() {
    this.openSea = this.add.tileSprite(0, 0, 16, 16, 'fx_opensea_0')
      .setOrigin(0, 0).setDepth(-1000);

    // Cloud shadows are white shapes multiplied through a cool tint: a
    // passing cloud should take the land toward blue, not toward grey.
    this.cloudShadows = this.add.tileSprite(0, 0, 16, 16, 'fx_clouds')
      .setOrigin(0, 0)
      .setDepth(TOP_DEPTH + 50)
      .setBlendMode(Phaser.BlendModes.MULTIPLY)
      .setTint(P.shadowTint)
      .setAlpha(0.3);
    this.cloudDrift = { x: 0, y: 0 };

    // World-space, like the two planes above, rather than pinned to the
    // screen: a scroll-factor-zero sprite is still scaled by the camera's
    // zoom, which would push the dark corners off the display at 2x and 3x.
    this.vignette = this.add.image(0, 0, 'fx_vignette')
      .setOrigin(0, 0)
      .setDepth(TOP_DEPTH + 65);

    // The sun's side of the screen, warmed; moonlight at night. Above the
    // time-of-day grade so the grade does not swallow it.
    this.sunGlow = this.add.image(0, 0, 'fx_sunglow')
      .setOrigin(0, 0)
      .setDepth(TOP_DEPTH + 72)
      .setBlendMode(Phaser.BlendModes.ADD)
      .setAlpha(0);

    this.setupShipping();
    this.setupAmbientLife();
  }

  /**
   * The small things that make a village look lived in: smoke from the
   * chimneys, birds going over, cows that do not stand like statues. None of
   * it touches the simulation. Pixel art earns most of its charm from motion
   * like this, and a board where only the water and the sails move reads as
   * a diagram of a village rather than a village.
   */
  setupAmbientLife() {
    const top = TOP_DEPTH;
    this.smoke = this.add.particles(0, 0, 'fx_smoke', {
      emitting: false,
      lifespan: { min: 1900, max: 2900 },
      speedY: { min: -10, max: -6 },
      // Read per puff, so a gale tears the smoke sideways instead of letting
      // it rise. (Assigning a new range to a live emitter only sets its
      // current value, which is not the same thing.)
      speedX: { onEmit: () => 1 + this.smokeWind * 14 + Math.random() * (4 + this.smokeWind * 8) },
      scale: { start: 0.6, end: 1.5 },
      alpha: { start: 0.9, end: 0 },
    }).setDepth(top + 30);
    this.smokeClock = 0;
    this.smokeWind = 0;
    this.birdClock = 6 + Math.random() * 8;
    this.cowClock = 0;
    this.birds = [];
  }

  updateAmbientLife(dt) {
    if (!this.smoke) return;
    const severity = this.sim.weatherSeverity();
    this.smokeWind = severity;

    // Smoke: a puff every so often from a random house that still has a dry
    // hearth. In a gale it tears away sideways instead of rising.
    this.smokeClock -= dt;
    if (this.smokeClock <= 0) {
      this.smokeClock = 0.16 + Math.random() * 0.2;
      const homes = this.sim.buildings.filter((t) => t.building.type === 'house'
        && !t.building.lost && !t.building.flooded && this.objectSprites[t.x][t.y]);
      if (homes.length) {
        const t = homes[Math.floor(Math.random() * homes.length)];
        const ob = this.objectSprites[t.x][t.y];
        const pot = HOUSE_CHIMNEY[t.building.variant] || HOUSE_CHIMNEY[0];
        this.smoke.emitParticleAt(ob.x + pot.x, ob.y + pot.y);
      }
    }

    // Birds: a small flock now and then, by day and in fair weather.
    this.birdClock -= dt;
    if (this.birdClock <= 0) {
      this.birdClock = 14 + Math.random() * 18;
      if (!this.isNight && severity < 0.5) this.launchFlock();
    }
    for (let i = this.birds.length - 1; i >= 0; i--) {
      const b = this.birds[i];
      b.t += dt;
      b.sprite.x += b.vx * dt;
      b.sprite.y = b.y0 + Math.sin(b.t * 2.2 + b.phase) * 2;
      b.sprite.setTexture(Math.floor(b.t * 6 + b.phase) % 2 ? 'fx_bird_1' : 'fx_bird_0');
      if (b.t > b.life) { b.sprite.destroy(); this.birds.splice(i, 1); }
    }

    // Cows: every little while one of them takes a step or turns round,
    // never wandering more than a few pixels from its own tile.
    this.cowClock -= dt;
    if (this.cowClock <= 0) {
      this.cowClock = 0.6 + Math.random() * 1.2;
      const cows = [];
      for (let x = 0; x < this.sim.cols; x++) {
        for (let y = 0; y < this.sim.rows; y++) {
          const ob = this.objectSprites[x][y];
          if (ob && ob.texture.key === 'p_cow') cows.push([ob, this.sim.tiles[x][y]]);
        }
      }
      if (cows.length) {
        const [ob, t] = cows[Math.floor(Math.random() * cows.length)];
        const home = Math.round(isoX(t.x, t.y));
        const target = home + Math.round((Math.random() * 2 - 1) * 4);
        if (target !== Math.round(ob.x)) {
          // The cow is drawn facing left.
          ob.setFlipX(target > ob.x);
          this.tweens.add({ targets: ob, x: target, duration: 700 + Math.abs(target - ob.x) * 160 });
        } else {
          ob.setFlipX(!ob.flipX);
        }
      }
    }
  }

  /** A loose V of three to five birds crossing the part of the world in view. */
  launchFlock() {
    const view = this.cameras.main.worldView;
    const dir = Math.random() < 0.5 ? 1 : -1;
    const n = 3 + Math.floor(Math.random() * 3);
    const y = view.y + view.height * (0.12 + Math.random() * 0.3);
    const speed = 16 + Math.random() * 8;
    const x0 = dir > 0 ? view.x - 20 : view.right + 20;
    const life = (view.width + 60) / speed;
    for (let i = 0; i < n; i++) {
      const rank = Math.ceil(i / 2) * (i % 2 ? 1 : -1);
      const sprite = this.add.image(x0 - dir * Math.abs(rank) * 7, y + rank * 4, 'fx_bird_0')
        .setDepth(TOP_DEPTH + 55);
      this.birds.push({
        sprite, vx: dir * speed, y0: sprite.y, t: 0, life, phase: Math.random() * 6,
      });
    }
  }

  /**
   * Coasters working the open sea, off the polder's shoulders. They are the
   * one thing on screen that has nothing to do with the simulation: the point
   * is that the world does not stop at the map, and that a polder in 1612 was
   * a place traders sailed past.
   *
   * Depth is taken from the boat's own screen row, so a boat passing in front
   * of the island is drawn over it and one behind is drawn under it, exactly
   * as the tiles sort among themselves.
   */
  setupShipping() {
    // Tracks run parallel to the four coasts, a couple of tiles off the ring,
    // in tile coordinates: one axis is held and the other is sailed along.
    this.boats = [
      { hold: 'ty', at: -2.6, along: 1.6, speed: 0.30 },
      { hold: 'tx', at: -2.4, along: 12.0, speed: -0.24 },
      { hold: 'tx', at: this.sim.cols + 1.6, along: 4.0, speed: 0.35 },
    // No coaster sails a track that is mostly over the old land.
    ].filter((b) => this.sim.level.landLine === undefined || this.sim.level.landLine - b.at > 12)
      .map((b, i) => ({
      ...b,
      phase: i * 2.1,
      wake: this.add.image(0, 0, 'fx_wake_0').setAlpha(0.85),
      sprite: this.boatSprite(),
    }));
    for (const b of this.boats) this.placeBoat(b);
  }

  /** Where a boat is on the map, in tile coordinates. */
  boatTile(b) {
    return b.hold === 'ty' ? { x: b.along, y: b.at } : { x: b.at, y: b.along };
  }

  /** A boat sprite hung on the waterline its texture declared. */
  boatSprite() {
    const img = this.add.image(0, 0, 'p_boat');
    const a = ANCHORS.p_boat;
    img.setOrigin(a.x / img.width, a.y / img.height);
    return img;
  }

  placeBoat(b, lift = 0) {
    const { x, y } = this.boatTile(b);
    // Mirror the hull on the return leg so the sail is always on the same
    // side of the mast relative to travel.
    b.sprite.setFlipX(b.speed < 0);
    const px = Math.round(isoX(x, y));
    const py = Math.round(isoY(x, y, 0) - lift);
    // Riding the swell: a pixel up and down, never a fraction of one.
    const bob = Math.round(Math.sin(this.time.now / 1000 * 1.6 + b.phase) * 0.9);
    b.sprite.setPosition(px, py + bob);
    // Sorted by screen row exactly as the tiles are, so a boat crossing
    // behind the island is drawn behind it.
    const depth = (x + y) * ROW_DEPTH + D_OBJECT;
    b.sprite.setDepth(depth);

    // The wake is drawn for a boat running down-right along the grid's x
    // axis and mirrored for the other three headings, pinned by its stern.
    if (b.wake) {
      const alongX = b.hold === 'ty';
      const fwd = b.speed > 0;
      const flipX = alongX ? !fwd : fwd;
      const flipY = !fwd;
      const key = `fx_wake_${Math.floor(this.time.now / 260) % 2}`;
      if (b.wake.texture.key !== key) b.wake.setTexture(key);
      const a = ANCHORS[key];
      const w = b.wake.width;
      const h = b.wake.height;
      b.wake.setFlip(flipX, flipY);
      b.wake.setOrigin(
        flipX ? 1 - (a.x + 0.5) / w : (a.x + 0.5) / w,
        flipY ? 1 - (a.y + 0.5) / h : (a.y + 0.5) / h,
      );
      // Screen direction of travel, on the 2:1 line.
      const dx = (alongX ? 1 : -1) * (fwd ? 1 : -1);
      const dy = fwd ? 0.5 : -0.5;
      b.wake.setPosition(Math.round(px - dx * 9), Math.round(py - dy * 9));
      b.wake.setDepth(depth - 0.5);
    }
  }

  updateShipping(dt) {
    if (!this.boats) return;
    // Boats ride the same tide as the water they are on.
    const lift = this.seaVisualElev() * PX_PER_M;
    for (const b of this.boats) {
      b.along += b.speed * dt;
      // Where old land runs across the south, boats turn about at its shore
      // (a harbour, in effect) instead of sailing on over the fields.
      const line = this.sim.level.landLine;
      let span = (b.hold === 'tx' ? this.sim.rows : this.sim.cols) + 4;
      if (line !== undefined) span = Math.min(span, line - b.at - 1.5);
      if (b.along > span) b.along = -4;
      else if (b.along < -4) b.along = span;
      this.placeBoat(b, lift);
    }
  }

  /**
   * Re-fit the two world-space backdrop planes onto whatever the camera can
   * currently see, and scroll their textures so they stay pinned to the world
   * rather than sliding with the view.
   */
  updateBackdrop(dt) {
    const cam = this.cameras.main;
    const view = cam.worldView;
    // A pixel of margin each way: worldView is fractional, the sprites are not.
    const x = Math.floor(view.x) - 1;
    const y = Math.floor(view.y) - 1;
    const w = Math.ceil(view.width) + 2;
    const h = Math.ceil(view.height) + 2;

    // The map's sea tiles are drawn at the tide's height, so the plane has to
    // move with them or a step appears at the edge of the map.
    const lift = this.seaVisualElev() * PX_PER_M;
    this.openSea.setPosition(x, y).setSize(w, h);
    this.openSea.tilePositionX = x;
    this.openSea.tilePositionY = y + lift;

    // Clouds run before the wind, and faster than it, the way they do over
    // flat country: quicker and heavier as the weather turns. Driven by the
    // real frame time rather than the simulation's, so the sky keeps moving
    // while the game is paused.
    const severity = this.sim.weatherSeverity();
    // Each axis wraps on its own texture size: wrapping both on one period
    // made the shadows jump sideways every time the drift rolled over.
    const speed = 7 + severity * 40;
    this.cloudDrift.x = (this.cloudDrift.x + dt * speed) % 256;
    this.cloudDrift.y = (this.cloudDrift.y + dt * speed * 0.35) % 128;
    this.cloudShadows.setPosition(x, y).setSize(w, h);
    this.cloudShadows.tilePositionX = Math.round(x + this.cloudDrift.x);
    this.cloudShadows.tilePositionY = Math.round(y + this.cloudDrift.y);
    // No sun, no cloud shadows: they fade with the daylight, and thicken as
    // the weather closes in.
    const g = this.grade || { daylight: 1 };
    this.cloudShadows.setAlpha((0.26 + severity * 0.3) * (0.15 + 0.85 * g.daylight));

    this.vignette.setPosition(x, y).setDisplaySize(w, h);
    this.sunGlow.setPosition(x, y).setDisplaySize(w, h);
    if (g.glowColor !== undefined) {
      this.sunGlow.setTint(g.glowColor).setAlpha(g.glowAlpha);
    }
  }

  /**
   * One sprite per tile per layer, created once and then only re-pointed at
   * different textures. Rebuilding sprites every frame is what made the old
   * renderer expensive.
   */
  buildWorld() {
    this.terrainSprites = [];
    this.floodSprites = [];
    this.objectSprites = [];
    this.structureSprites = [];
    this.shadowSprites = [];
    this.leatSprites = [];
    this.dikeSprites = [];
    this.ditchSprites = [];

    for (let x = 0; x < this.sim.cols; x++) this.createColumn(x);
    this.setupHinterland();

    this.highlight = this.add.graphics().setDepth(TOP_DEPTH + 40);
    this.ghost = null;

    this.refreshAllTiles();
  }

  /**
   * On a coast with old land along one edge (the Dollard), that land goes
   * on past the edge of the map: grass and trees drawn beyond it, so the
   * mainland reads as a mainland and not as a strip with the sea behind it.
   * Scenery only; the simulation never sees these tiles.
   */
  setupHinterland() {
    const { landLine } = this.sim.level;
    if (landLine === undefined) return;
    const C = this.sim.cols;
    const R = this.sim.rows;
    // Every tile whose sprite could show inside the camera's bounds (see
    // setCameraBounds), with a margin, so no corner of the view is left sea.
    const left = -(R - 1) * (TILE_W / 2) - TILE_W * 3;
    const right = (C - 1) * (TILE_W / 2) + TILE_W * 3;
    const bottom = (C + R - 2) * (TILE_H / 2) + 160 + TILE_H * 3;
    const N = C + R;
    for (let x = -N; x < C + N; x++) {
      for (let y = -N; y < R + N; y++) {
        if (x >= 0 && x < C && y >= 0 && y < R) continue;
        if (x + y < landLine) continue;
        const sx = isoX(x, y);
        const sy = isoY(x, y, 0);
        if (sx < left || sx > right || sy > bottom) continue;
        const h = ((x * 73856093) ^ (y * 19349663)) >>> 0;
        const t = { x, y, base: 'old', elev: 1, tex: h % 4, prop: null };
        const row = (x + y) * ROW_DEPTH;
        const img = this.add.image(0, 0, this.terrainTextureFor(t)).setDepth(row + D_TERRAIN);
        this.placeSprite(img, t);
        const r = (h >>> 8) % 100;
        if (r < 22) {
          const tree = this.add.image(0, 0, h % 2 ? 'p_tree_0' : 'p_tree_1').setDepth(row + D_OBJECT);
          this.placeSprite(tree, t);
        }
      }
    }
  }

  /** The sprites for one column of tiles, x fixed, every y. */
  createColumn(x) {
    this.terrainSprites[x] = [];
    this.floodSprites[x] = [];
    this.objectSprites[x] = [];
    this.structureSprites[x] = [];
    this.shadowSprites[x] = [];
    this.dikeSprites[x] = [];
    this.ditchSprites[x] = [];
    for (let y = 0; y < this.sim.rows; y++) {
      const t = this.sim.tiles[x][y];
      const row = (x + y) * ROW_DEPTH;

      const terrain = this.add.image(0, 0, this.terrainTextureFor(t))
        .setDepth(row + D_TERRAIN);
      this.placeSprite(terrain, t, 0);
      this.terrainSprites[x][y] = terrain;

      // Every tile gets a flood sprite: on a map that grows, ground that is
      // sea today is land tomorrow.
      const flood = this.add.image(0, 0, 't_flood_0')
        .setDepth(row + D_FLOOD).setVisible(false);
      this.placeSprite(flood, t, 0);
      this.floodSprites[x][y] = flood;

      this.dikeSprites[x][y] = [];
      this.ditchSprites[x][y] = [];
      this.objectSprites[x][y] = null;
      this.structureSprites[x][y] = null;
      this.shadowSprites[x][y] = null;
    }
  }

  /**
   * Skip drawing the columns of tiles the camera cannot see. Phaser draws
   * every display object every frame, visible on screen or not, and on a
   * coast that has grown to a hundred-odd columns that is thousands of
   * sprites off-screen. Uses the camera filter rather than `visible`, which
   * the water and weather code already use to mean something.
   */
  cullColumns() {
    const cam = this.cameras.main;
    const v = cam.worldView;
    const key = `${Math.round(v.x / 16)},${Math.round(v.y / 16)},${cam.zoom},${this.sim.cols}`;
    if (key === this.cullKey) return;
    this.cullKey = key;
    const R = this.sim.rows;
    const HW = TILE_W / 2;
    const HH = TILE_H / 2;
    const margin = 160;
    for (let x = 0; x < this.sim.cols; x++) {
      if (!this.terrainSprites[x]) continue;
      // The column's screen box: x from (x - R + 1) to x half-tiles, y from x to x + R.
      const left = (x - R + 1) * HW - TILE_W;
      const right = x * HW + TILE_W;
      const top = x * HH - 200;
      const bottom = (x + R) * HH + 120;
      const off = right < v.x - margin || left > v.right + margin
        || bottom < v.y - margin || top > v.bottom + margin;
      if (this.culled?.[x] === off) continue;
      (this.culled ||= [])[x] = off;
      for (let y = 0; y < R; y++) this.cullTile(x, y, off);
    }
  }

  /** Draw or skip every sprite of one tile. */
  cullTile(x, y, off) {
    const id = off ? this.cameras.main.id : 0;
    const set = (o) => { if (o) o.cameraFilter = id; };
    set(this.terrainSprites[x][y]);
    set(this.floodSprites[x][y]);
    set(this.objectSprites[x][y]);
    set(this.structureSprites[x][y]);
    set(this.shadowSprites[x][y]);
    for (const d of this.dikeSprites[x][y]) set(d);
    for (const d of this.ditchSprites[x][y]) set(d);
  }

  /**
   * The coast has moved on the Dollard: new dike and new polder. Redraw what
   * changed (around `tile`, or everything), and let the storm waves break on
   * the new coast.
   */
  onCoastChanged(tile = null) {
    if (tile) {
      const R = 5;
      for (let x = tile.x - R; x <= tile.x + R; x++) {
        for (let y = tile.y - R; y <= tile.y + R; y++) {
          const t = this.sim.tile(x, y);
          if (t) this.refreshTile(t);
        }
      }
    } else {
      this.refreshAllTiles();
      this.refreshLeats();
    }
    for (const w of this.waveSprites || []) w.sprite.destroy();
    this.setupStormWaves();
  }

  /** Position a sprite using the anchor its texture declared at generation. */
  placeSprite(sprite, tile, elevOverride = null) {
    const a = ANCHORS[sprite.texture.key] || { x: TILE_W / 2, y: TILE_H / 2 };
    sprite.setOrigin(a.x / sprite.width, a.y / sprite.height);
    const elev = elevOverride === null ? this.renderElev(tile) : elevOverride;
    sprite.setPosition(
      Math.round(isoX(tile.x, tile.y)),
      Math.round(isoY(tile.x, tile.y, elev)),
    );
  }

  /**
   * A real polder is flat to within decimetres, so drawing its elevation at
   * full scale terraces the whole map into brown steps. The ground is drawn
   * almost flat and its depth is carried by colour instead; only the coastal
   * ring is given a real lift, because that ridge is the point.
   */
  renderElev(t) {
    if (t.base === 'sea') return this.seaVisualElev();
    // The flat lies level; how far it has silted up shows in its colour.
    // Drawn at its true height, every tile of marsh stood proud of the flat
    // around it like a card laid on the table.
    if (t.base === 'mud') return 0.15 + t.elev * 0.05;
    // A chamfered step of dike stands on the ground; its bank carries the
    // height (see makeDikeChamfer).
    if (t.coastal && this.chamferFor(t)) return 0;
    if (t.coastal) return 0.9;
    return t.elev * 0.3;
  }

  /**
   * A step of a dike laid diagonally across the grid: a corner standing out
   * to sea with the next step of dike on the diagonal beside it. Drawn as
   * one straight bank across the tile ('cn' facing the sea above, 'cs'
   * below) rather than as a corner, so the steps join into one line.
   */
  chamferFor(t) {
    if (!t.dike || !t.edges || t.edges.length !== 2) return null;
    const pair = [...t.edges].sort().join('');
    if (pair !== 'xmym' && pair !== 'xpyp') return null;
    const dikeAt = (x, y) => { const n = this.sim.tile(x, y); return !!(n && n.dike); };
    if (!dikeAt(t.x - 1, t.y + 1) && !dikeAt(t.x + 1, t.y - 1)) return null;
    return pair === 'xmym' ? 'cn' : 'cs';
  }

  /** Which shelf band a mapped sea tile is in; the outermost ring is 0. */
  shoalRing(t) {
    return Math.min(SHOAL.length - 1, t.ring);
  }

  terrainTextureFor(t) {
    if (t.base === 'mud') {
      const stage = t.elev >= MARSH_AT ? 2 : t.elev > -0.3 ? 1 : 0;
      return `t_mud${stage}_${(t.x + t.y) % 2}`;
    }
    if (t.base === 'sea') {
      return `t_sea${this.shoalRing(t)}_${this.waterFrame || 0}_${seaVariant(t.x, t.y)}`;
    }
    if (t.canal) return `t_canal_${this.waterFrame || 0}`;
    if (t.building && t.building.lost) return 't_rubble';
    // Only the landward half of a chamfered step shows below its bank.
    // Dressed as the field behind it, so the two run on without a seam.
    if (t.coastal && this.chamferFor(t)) {
      const dir = this.chamferFor(t) === 'cn' ? 1 : -1;
      for (const [dx, dy] of [[dir, 0], [0, dir]]) {
        const n = this.sim.tile(t.x + dx, t.y + dy);
        if (n && n.base === 'land' && !n.coastal && !n.canal && !n.building) return this.terrainTextureFor(n);
      }
      return `t_grass_hi_${t.tex % 4}`;
    }
    if (t.coastal) return `t_sand_${t.tex % 2}`;

    // Land use is a property of the whole parcel, so a field is one colour
    // from edge to edge and the map reads as farmland rather than a grid.
    const v = t.tex % 4;
    // Ground nobody has broken yet: rough, or sour and dark where the sea
    // has been over it. Bringing a parcel into production is something the
    // player watches happen on the map rather than a number in the treasury,
    // and this test sits ahead of the field textures so that ground drowned
    // out of production stops looking like a field the same moment it stops
    // paying like one — and looks like one again once it has been won back.
    if (t.plan && !t.use) return t.everFlooded ? 't_grass_wet' : `t_rough_${v}`;
    if (t.use === 'plough') return `t_field_plain_${v % 3}`;
    if (t.use === 'tulipRed') return `t_field_red_${v % 3}`;
    if (t.use === 'tulipYellow') return `t_field_yellow_${v % 3}`;

    // Within pasture, the lowest ground reads a shade darker and damper.
    const band = t.elev <= -3 ? 'lo' : t.elev >= -1 ? 'hi' : 'mid';
    return `t_grass_${band}_${v}`;
  }

  /** Rebuild the sprites for one tile after its contents changed. */
  refreshTile(t) {
    const row = (t.x + t.y) * ROW_DEPTH;

    const terrain = this.terrainSprites[t.x][t.y];
    const wanted = this.terrainTextureFor(t);
    if (terrain.texture.key !== wanted) terrain.setTexture(wanted);
    this.placeSprite(terrain, t);

    // Field ditches, drawn on the two near edges only so each boundary is
    // drawn once and the lines run unbroken across the polder.
    for (const d of this.ditchSprites[t.x][t.y]) d.destroy();
    this.ditchSprites[t.x][t.y] = [];
    if (t.base === 'land' && !t.canal && !t.coastal) {
      for (const [edge, dx, dy] of [['xp', 1, 0], ['yp', 0, 1]]) {
        if (!this.sim.parcelEdge(t, dx, dy)) continue;
        const d = this.add.image(0, 0, `t_ditch_${edge}`).setDepth(row + D_OVERLAY);
        this.placeSprite(d, t);
        this.ditchSprites[t.x][t.y].push(d);
      }
    }

    // Dike banks, one sprite per outward-facing edge — or one mitred sprite
    // for a corner, where two separate banks would cross each other.
    for (const s of this.dikeSprites[t.x][t.y]) s.destroy();
    this.dikeSprites[t.x][t.y] = [];
    if (t.dike && t.edges) {
      const corner = this.chamferFor(t) || dikeCornerKey(t.edges);
      for (const edge of corner ? [corner] : t.edges) {
        const key = t.dike.broken
          ? `s_dike_${edge}_broken`
          : `s_dike_${edge}_${clamp(t.dike.level, 0, 2)}`;
        const s = this.add.image(0, 0, key).setDepth(row + D_STRUCTURE);
        this.placeSprite(s, t);
        this.dikeSprites[t.x][t.y].push(s);
      }
    }

    // Machinery.
    const wantStructure = t.pump ? this.pumpTexture(t)
      : t.outlet ? this.outletTexture(t)
        : t.fence ? 's_fence'
          : null;
    let st = this.structureSprites[t.x][t.y];
    if (!wantStructure) {
      if (st) { st.destroy(); this.structureSprites[t.x][t.y] = null; }
    } else {
      if (!st) {
        st = this.add.image(0, 0, wantStructure).setDepth(row + D_STRUCTURE + 1);
        this.structureSprites[t.x][t.y] = st;
      }
      if (st.texture.key !== wantStructure) st.setTexture(wantStructure);
      st.setTint(this.machineTint(t.pump || t.outlet || {}));
      this.placeSprite(st, t);
    }

    // Buildings and scenery.
    const wantObject = this.objectTextureFor(t);
    let ob = this.objectSprites[t.x][t.y];
    if (!wantObject) {
      if (ob) { ob.destroy(); this.objectSprites[t.x][t.y] = null; }
    } else {
      if (!ob) {
        ob = this.add.image(0, 0, wantObject).setDepth(row + D_OBJECT);
        this.objectSprites[t.x][t.y] = ob;
      }
      if (ob.texture.key !== wantObject) ob.setTexture(wantObject);
      this.placeSprite(ob, t);
    }

    this.refreshShadow(t, row);
    // Sprites made just now start drawn; keep a culled column culled.
    if (this.culled?.[t.x]) this.cullTile(t.x, t.y, true);
  }

  /**
   * How wide a contact shadow each kind of thing casts, in pixels, or 0 for
   * things that cast none. A dike is part of the ground and already shaded;
   * water and empty fields have nothing standing on them.
   */
  /**
   * The sprite on a tile that throws a shadow, or null. Its shadow is derived
   * from the sprite itself (see `castShadowKey`), so whatever size a building
   * is drawn at, the shadow fits it. Dikes and sluices are part of the ground
   * and already shaded; reeds are too low to matter.
   */
  shadowCasterFor(t) {
    const st = this.structureSprites[t.x][t.y];
    if (st && t.pump) return st;
    const ob = this.objectSprites[t.x][t.y];
    if (ob && ob.texture.key !== 'p_reeds') return ob;
    return null;
  }

  /**
   * Keep one shadow per occupied tile: a contact patch under the footprint
   * and the cast shadow running down-right from it. Without them every
   * building reads as a sticker laid on the tile rather than a thing standing
   * on it.
   */
  refreshShadow(t, row) {
    const caster = this.shadowCasterFor(t);
    let sh = this.shadowSprites[t.x][t.y];
    if (!caster) {
      if (sh) { sh.destroy(); this.shadowSprites[t.x][t.y] = null; }
      return;
    }
    if (!sh) {
      sh = this.add.image(0, 0, 'fx_shadow').setBlendMode(Phaser.BlendModes.MULTIPLY);
      this.shadowSprites[t.x][t.y] = sh;
    }
    sh.caster = caster;
    sh.row = row;
    sh.srcKey = null;
    this.applySunTo(sh);
  }

  /**
   * The sun as the shadows see it. It always stands upper-left — every
   * sprite is painted lit from there, and a shadow swinging round to the
   * other side would contradict the paint — so what the day changes is how
   * long the shadows are (three baked lengths), how dense, and how blue.
   */
  sunState() {
    const tod = this.timeOfDay();
    const day = clamp((tod - 0.22) / 0.62, 0, 1);
    // 0 at sunrise and sunset, 1 at noon.
    const height = Math.sin(Math.PI * day);
    const lit = tod > 0.21 && tod < 0.85;
    const severity = this.sim.weatherSeverity();
    // Overcast flattens the light: under a storm, shadows all but go.
    const weather = 1 - severity * 0.75;
    return {
      len: !lit ? 0 : height > 0.72 ? 0 : height > 0.38 ? 1 : 2,
      alpha: (lit ? 0.5 + (1 - height) * 0.1 : 0.2) * weather,
      tint: lit ? P.shadowTint : P.grade.night,
    };
  }

  /** Lay one shadow out under the sun the map is currently lit by. */
  applySunTo(sh) {
    const sun = this.sun || (this.sun = this.sunState());
    const caster = sh.caster;
    if (!caster || !caster.active) { sh.setVisible(false); return; }
    // Night variants have the same outline as the day ones.
    const src = caster.texture.key.replace(/_night$/, '');
    sh.srcKey = caster.texture.key;
    const key = castShadowKey(this, src, sun.len);
    if (!key) { sh.setVisible(false); return; }
    if (sh.texture.key !== key) sh.setTexture(key);
    const a = ANCHORS[key];
    sh.setOrigin(a.x / sh.width, a.y / sh.height);
    sh.setPosition(caster.x, caster.y);
    // Above the ground of every row the shadow crosses, below the things
    // standing in the row it ends on. The caster's own outline is cut out of
    // the texture, so drawing over it is harmless.
    sh.setDepth(sh.row + shadowReach(key) * ROW_DEPTH + D_OVERLAY + 1);
    sh.setTint(sun.tint).setAlpha(sun.alpha).setVisible(caster.visible);
  }

  /**
   * The sun only has to be recomputed when it has actually moved. Quantising
   * the time of day keeps this to a handful of passes over the map per light
   * cycle instead of one every frame. Mill shadows are the exception: their
   * sails turn, so their shadows are re-pointed whenever the sprite is.
   */
  updateShadows() {
    const step = Math.floor(this.timeOfDay() * 240) * 16
      + Math.round(this.sim.weatherSeverity() * 12);
    if (step !== this.sunStep) {
      this.sunStep = step;
      this.sun = this.sunState();
      for (let x = 0; x < this.sim.cols; x++) {
        for (let y = 0; y < this.sim.rows; y++) {
          const sh = this.shadowSprites[x][y];
          if (sh) this.applySunTo(sh);
        }
      }
      return;
    }
    for (const t of this.sim.pumps) {
      const sh = this.shadowSprites[t.x][t.y];
      if (sh && sh.caster && sh.caster.texture.key !== sh.srcKey) this.applySunTo(sh);
    }
  }

  objectTextureFor(t) {
    const night = this.isNight;
    if (t.building) {
      const b = t.building;
      if (b.lost) return 'b_ruin';
      // Only reachable from a save made before mills became machines.
      if (b.type === 'windmill') return `b_windmill_${this.millFrame || 0}`;
      if (b.type === 'church') return night ? 'b_church_night' : 'b_church';
      return night ? `b_house_${b.variant}_night` : `b_house_${b.variant}`;
    }
    if (t.canal) return null;
    if (t.prop === 'tree') return t.tex % 2 === 0 ? 'p_tree_0' : 'p_tree_1';
    if (t.prop === 'cow') return 'p_cow';
    // Reed beds come up on their own wherever the polder meets standing
    // water, so the canals the player digs grow their own banks. Scattered by
    // tile position rather than by `tex`, which is shared across a whole
    // parcel and would put a hedge down one entire bank.
    if (t.base === 'land' && !t.coastal && !t.pump && !t.outlet
      && (t.x * 7 + t.y * 13) % 5 < 2 && this.besideCanal(t)) return 'p_reeds';
    return null;
  }

  besideCanal(t) {
    for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
      const n = this.sim.tile(t.x + dx, t.y + dy);
      if (n && n.canal) return true;
    }
    return false;
  }

  refreshAllTiles() {
    for (let x = 0; x < this.sim.cols; x++) {
      for (let y = 0; y < this.sim.rows; y++) this.refreshTile(this.sim.tiles[x][y]);
    }
    this.refreshLeats();
  }

  /**
   * The watercourses that carry the boezem from the canal network out to each
   * sluice in the ring.
   *
   * An outlet is allowed three tiles from the nearest canal, and nothing used
   * to be drawn in between: a gate in the dike, and water somewhere off to one
   * side with no visible relationship to it. The leat is the relationship —
   * the shortest run of land between the two, dug.
   *
   * Rebuilt whole rather than patched, because digging one canal tile can
   * change which canal is nearest and therefore re-route every leat on the
   * map. There are at most a handful of outlets, so it is cheap.
   */
  refreshLeats() {
    for (const s of this.leatSprites) s.destroy();
    this.leatSprites = [];
    for (const t of this.sim.outlets) {
      const path = this.leatPath(t);
      if (!path) continue;
      for (let i = 0; i < path.length; i++) {
        const tile = path[i];
        if (tile.canal) break;
        const row = (tile.x + tile.y) * ROW_DEPTH;
        for (const n of [path[i - 1], path[i + 1]]) {
          if (!n) continue;
          const dir = DIR_KEY[`${n.x - tile.x},${n.y - tile.y}`];
          if (!dir) continue;
          const spr = this.add.image(0, 0, `t_leat_${dir}`).setDepth(row + D_OVERLAY);
          this.placeSprite(spr, tile);
          this.leatSprites.push(spr);
        }
      }
    }
  }

  /** Shortest run of land from an outlet to the nearest canal tile. */
  leatPath(from) {
    const seen = new Set([`${from.x},${from.y}`]);
    let edge = [[from]];
    for (let depth = 0; depth < 5; depth++) {
      const next = [];
      for (const path of edge) {
        const head = path[path.length - 1];
        for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
          const n = this.sim.tile(head.x + dx, head.y + dy);
          if (!n || n.base !== 'land') continue;
          const key = `${n.x},${n.y}`;
          if (seen.has(key)) continue;
          // The ring is the thing the leat runs out through, not along.
          if (n.coastal && !n.outlet) continue;
          const grown = path.concat(n);
          if (n.canal) return grown;
          seen.add(key);
          next.push(grown);
        }
      }
      if (!next.length) break;
      edge = next;
    }
    return null;
  }

  /* ================================================================
     CAMERA
  ================================================================ */

  setupCamera() {
    const cam = this.cameras.main;

    // World extents of the isometric map, plus room for building tops above
    // and the earth blocks below.
    this.setCameraBounds();

    this.zoomIndex = DEFAULT_ZOOM_INDEX;
    this.zoomTween = null;
    cam.setZoom(ZOOM_LEVELS[this.zoomIndex]);
    this.applyCameraViewport();

    // Start looking at the whole polder, centred on the map rather than on
    // the village, so the ring dike is visible from the first frame.
    this.centreOnMap();

    this.keys = this.input.keyboard.addKeys({
      up: Phaser.Input.Keyboard.KeyCodes.UP,
      down: Phaser.Input.Keyboard.KeyCodes.DOWN,
      left: Phaser.Input.Keyboard.KeyCodes.LEFT,
      right: Phaser.Input.Keyboard.KeyCodes.RIGHT,
      w: Phaser.Input.Keyboard.KeyCodes.W,
      a: Phaser.Input.Keyboard.KeyCodes.A,
      s: Phaser.Input.Keyboard.KeyCodes.S,
      d: Phaser.Input.Keyboard.KeyCodes.D,
    });
  }

  /**
   * Give the world camera only the band between the two HUD bars.
   *
   * The bars are opaque and the map used to be drawn under them, so the polder
   * sat hard against the top bar with dead space above the build bar — the map
   * was centred in the canvas rather than in the part of it you can see. With
   * the camera confined to the visible band, nothing is ever hidden behind a
   * bar and the framing centres on what the player is actually looking at.
   */
  applyCameraViewport() {
    const w = this.scale.width;
    const h = this.scale.height;
    const m = metricsFor(w, h, this.scale.zoom);
    const top = m.topBarTotalH + 2;
    const bottom = m.buildBarH + m.pad;
    const band = Math.max(120, h - top - bottom);
    this.cameras.main.setViewport(0, top, w, band);
  }

  /**
   * World extents of the isometric map, plus room for building tops above,
   * the earth blocks below and a margin of sea. Recomputed when the map grows.
   */
  setCameraBounds() {
    const C = this.sim.cols;
    const R = this.sim.rows;
    const left = -(R - 1) * (TILE_W / 2) - TILE_W;
    const right = (C - 1) * (TILE_W / 2) + TILE_W;
    const top = -120;
    const bottom = (C + R - 2) * (TILE_H / 2) + 160;
    this.cameras.main.setBounds(left, top, right - left, bottom - top);
  }

  /** Frame the entire island, or on a growing map its seaward front. */
  centreOnMap() {
    const fx = this.sim.focusX ?? (this.sim.cols - 1) / 2;
    const my = this.sim.focusY ?? (this.sim.rows - 1) / 2;
    this.cameras.main.centerOn(isoX(fx, my), isoY(fx, my, 0));
  }

  /**
   * Zoom, without the jolt.
   *
   * Pixel art wants a whole-number zoom: at 1.5x some pixels are two screen
   * pixels wide and their neighbours are one, and the whole map shimmers as
   * it scrolls. So the camera still *comes to rest* on a whole number — but
   * it travels there over a couple of frames instead of teleporting, and a
   * pinch drives it continuously while the fingers are down. Motion hides
   * the uneven pixels; a still frame would not.
   */
  setZoomTo(value, focus = null, { animate = true } = {}) {
    const cam = this.cameras.main;
    const lo = ZOOM_LEVELS[0];
    const hi = ZOOM_LEVELS[ZOOM_LEVELS.length - 1];
    const target = clamp(value, lo, hi);
    if (Math.abs(target - cam.zoom) < 0.001) return;

    // Whatever is under the fingers (or the cursor) should stay there.
    const screen = focus || { x: this.scale.width / 2, y: this.scale.height / 2 };
    const anchor = cam.getWorldPoint(screen.x, screen.y);

    const apply = (z) => {
      cam.setZoom(z);
      const after = cam.getWorldPoint(screen.x, screen.y);
      cam.scrollX += anchor.x - after.x;
      cam.scrollY += anchor.y - after.y;
    };

    if (this.zoomTween) { this.zoomTween.stop(); this.zoomTween = null; }
    if (!animate) { apply(target); this.syncZoomIndex(); return; }

    const from = { z: cam.zoom };
    this.zoomTween = this.tweens.add({
      targets: from,
      z: target,
      duration: 180,
      ease: 'Sine.easeOut',
      onUpdate: () => apply(from.z),
      onComplete: () => {
        this.zoomTween = null;
        // Land exactly on the value asked for, not on the tween's last step.
        apply(target);
        this.syncZoomIndex();
      },
    });
  }

  /** Keep the step index in step with wherever the camera actually is. */
  syncZoomIndex() {
    const z = this.cameras.main.zoom;
    let best = 0;
    for (let i = 1; i < ZOOM_LEVELS.length; i++) {
      if (Math.abs(ZOOM_LEVELS[i] - z) < Math.abs(ZOOM_LEVELS[best] - z)) best = i;
    }
    this.zoomIndex = best;
  }

  /** Snap to the nearest whole step, which is where pixel art looks right. */
  settleZoom(focus = null) {
    const z = this.cameras.main.zoom;
    let best = ZOOM_LEVELS[0];
    for (const level of ZOOM_LEVELS) {
      if (Math.abs(level - z) < Math.abs(best - z)) best = level;
    }
    this.setZoomTo(best, focus);
  }

  setZoomIndex(i, focus = null) {
    const next = clamp(i, 0, ZOOM_LEVELS.length - 1);
    if (next === this.zoomIndex && !this.zoomTween) return;
    this.zoomIndex = next;
    this.setZoomTo(ZOOM_LEVELS[next], focus);
  }

  /* ================================================================
     INPUT
  ================================================================ */

  setupInput() {
    const cam = this.cameras.main;
    let dragging = false;
    let dragMoved = 0;
    let dragOrigin = null;
    let camOrigin = null;
    let pinchStart = 0;
    let pinchZoom = 1;
    let pinched = false;

    this.input.on('pointerdown', (ptr) => {
      this.setTouchMode(ptr.wasTouch);
      if (ptr.rightButtonDown()) {
        if (this.placement) this.cancelPlacement();
        else this.select(null);
        return;
      }
      dragging = true;
      dragMoved = 0;
      dragOrigin = { x: ptr.x, y: ptr.y };
      camOrigin = { x: cam.scrollX, y: cam.scrollY };
    });

    this.input.on('pointermove', (ptr) => {
      // Two fingers down: pinch to zoom, and no dragging.
      const p1 = this.input.pointer1;
      const p2 = this.input.pointer2;
      if (p1.isDown && p2.isDown) {
        dragging = false;
        const dist = Phaser.Math.Distance.Between(p1.x, p1.y, p2.x, p2.y);
        if (pinchStart === 0) {
          pinchStart = dist;
          pinchZoom = cam.zoom;
        } else if (pinchStart > 8) {
          // Follow the fingers directly: the map scales with the gesture and
          // settles on a whole step when they lift.
          pinched = true;
          this.setZoomTo(pinchZoom * (dist / pinchStart), {
            x: (p1.x + p2.x) / 2, y: (p1.y + p2.y) / 2,
          }, { animate: false });
        }
        return;
      }
      if (pinchStart !== 0) {
        pinchStart = 0;
        if (pinched) { this.settleZoom(); pinched = false; }
      }

      if (dragging && ptr.isDown) {
        const dx = dragOrigin.x - ptr.x;
        const dy = dragOrigin.y - ptr.y;
        dragMoved = Math.max(dragMoved, Math.abs(dx) + Math.abs(dy));
        if (dragMoved > 24) this.hasPanned = true;
        cam.scrollX = camOrigin.x + dx / cam.zoom;
        cam.scrollY = camOrigin.y + dy / cam.zoom;
      }

      const tile = this.tileAtPointer(ptr);
      this.hoverTile = tile;
    });

    this.input.on('pointerup', (ptr) => {
      const wasDragging = dragging;
      dragging = false;
      if (pinchStart !== 0) {
        pinchStart = 0;
        if (pinched) { this.settleZoom(); pinched = false; }
        return;
      }
      if (ptr.rightButtonReleased()) return;
      // A drag is a camera move, not a click.
      if (!wasDragging || dragMoved > 6) return;

      const tile = this.tileAtPointer(ptr);
      if (!tile) return;
      if (!this.placement) { this.select(tile); return; }

      if (!this.touchMode) { this.tryBuild(tile); return; }
      // Touch: first tap aims, a tap on the same tile commits.
      if (this.aimTile && this.aimTile.x === tile.x && this.aimTile.y === tile.y) {
        this.confirmAim();
      } else {
        this.setAim(tile);
      }
    });

    this.input.on('wheel', (ptr, objs, dx, dy) => {
      this.setZoomIndex(this.zoomIndex + (dy > 0 ? -1 : 1), ptr);
    });

    const kb = this.input.keyboard;
    kb.on('keydown-HOME', () => this.centreOnMap());
    kb.on('keydown-ESC', () => {
      if (this.placement) this.cancelPlacement();
      else this.requestPause(!this.isPaused);
    });
    kb.on('keydown-SPACE', () => this.requestPause(!this.isPaused));
    kb.on('keydown-ONE', () => this.startPlacement('dike'));
    kb.on('keydown-TWO', () => this.startPlacement('canal'));
    kb.on('keydown-THREE', () => this.startPlacement('pump'));
    kb.on('keydown-FOUR', () => this.startPlacement('outlet'));
    kb.on('keydown-PLUS', () => this.cycleSpeed(1));
    kb.on('keydown-MINUS', () => this.cycleSpeed(-1));
    kb.on('keydown-TAB', (e) => { e.preventDefault(); this.cycleSpeed(1); });
    kb.on('keydown-M', () => this.hud?.toggleMute());
  }

  /** Switch between hover and aim-and-confirm placement. */
  setTouchMode(isTouch) {
    if (isTouch === this.touchMode) return;
    this.touchMode = isTouch;
    this.aimTile = null;
    // Touch puts a confirmation strip where the message line lives, so the
    // HUD has to be laid out again rather than just told. This happens once,
    // on the first touch of a session.
    this.hud?.buildLayout();
    this.hud?.onAimChanged(null);
    this.hud?.onPlacementChanged(this.placement);
  }

  tileAtPointer(ptr) {
    const world = this.cameras.main.getWorldPoint(ptr.x, ptr.y);
    // Ground is drawn nearly flat, so one unprojection is enough; the coastal
    // ring is lifted, so try that offset too and prefer a coastal hit.
    const lifted = screenToTile(world.x, world.y + 0.9 * PX_PER_M);
    if (this.sim.inBounds(lifted.x, lifted.y) && this.sim.tiles[lifted.x][lifted.y].coastal) {
      return this.sim.tiles[lifted.x][lifted.y];
    }
    const flat = screenToTile(world.x, world.y);
    return this.sim.inBounds(flat.x, flat.y) ? this.sim.tiles[flat.x][flat.y] : null;
  }

  /* ================================================================
     BUILDING
  ================================================================ */

  startPlacement(kind) {
    if (this.sim.outcome) return;
    if (this.placement === kind) { this.cancelPlacement(); return; }
    this.placement = kind;
    this.aimTile = null;
    this.hud?.onAimChanged(null);
    this.select(null);
    this.hud?.onPlacementChanged(kind);
    Audio.click();
  }

  setAim(tile) {
    this.aimTile = tile;
    this.hoverTile = tile;
    const reason = this.sim.validate(this.placement, tile);
    const cost = this.sim.costOf(this.placement, tile);
    this.hud?.onAimChanged(tile, reason, cost);
    if (reason) Audio.deny(); else Audio.hover();
  }

  confirmAim() {
    if (!this.placement || !this.aimTile) return;
    this.tryBuild(this.aimTile);
  }

  cancelPlacement() {
    this.placement = null;
    this.aimTile = null;
    if (this.ghost) { this.ghost.destroy(); this.ghost = null; }
    this.highlight.clear();
    this.hud?.onPlacementChanged(null);
    this.hud?.onAimChanged(null);
  }

  tryBuild(tile) {
    const kind = this.placement;
    const res = this.sim.build(kind, tile);
    if (!res.ok) {
      Audio.deny();
      Haptics.refused();
      this.hud?.flashMessage(res.reason, 'bad');
      return;
    }

    if (kind === 'canal') Audio.dig();
    else Audio.build();

    this.refreshTile(tile);
    // Neighbours may need redrawing too (canal banks, dike edges).
    for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
      const n = this.sim.tile(tile.x + dx, tile.y + dy);
      if (n) this.refreshTile(n);
    }
    this.refreshLeats();
    this.spawnSpark(tile);
    Haptics.build();
    this.hud?.flashMessage(
      tr('place.built', { what: this.labelFor(kind), cost: res.cost }), 'good',
    );

    // Building is a commitment, so keep the placement mode open for a run of
    // canal tiles but close it for the expensive one-offs.
    if (kind !== 'canal' && kind !== 'dike') {
      this.cancelPlacement();
    } else {
      this.aimTile = null;
      this.hud?.onAimChanged(null);
    }
    this.hud?.refreshCosts();
  }

  /**
   * The machine that lifts water off the land is a windmill in the seventeenth
   * century and an engine house in the twenty-second, which is not decoration:
   * steam drainage does not reach the Netherlands until 1787, and De Beemster
   * was drained by forty-three mills.
   */
  /**
   * How a machine reads at a glance. Laid up is not the same as stalled: one
   * is the treasury's fault and the other the canal's, and a player who
   * cannot tell them apart cannot fix either.
   */
  machineTint(st) {
    if (st.laidUp) return P.ui.textMute;
    if (st.starved) return P.ui.red;
    return 0xffffff;
  }

  /** 'mill' (1612, 1665), 'steam' (the 1850s) or 'engine' (2100, electric). */
  machineKind() {
    // What a pump built today would be. A long game moves on through eras.
    const kind = this.sim.machineAt().machine;
    return ['mill', 'steam', 'engine'].includes(kind) ? kind : 'mill';
  }

  /** Texture prefix of a powered machine's frames: steam hall or electric station. */
  pumpPrefix(kind = this.machineKind()) {
    return kind === 'steam' ? 's_steam' : 's_pump';
  }

  /** A pump keeps the machine it was built as, whatever the era is now. */
  pumpTexture(t) {
    const kind = t?.pump?.kind || this.machineKind();
    if (kind === 'mill') return `b_windmill_${this.millFrame || 0}`;
    return `${this.pumpPrefix(kind)}_${this.pumpFrame || 0}`;
  }

  /**
   * An outlet is drawn as the sluice it is, cut through the ring: for the
   * edge the ring runs along on this tile and at the height that stretch
   * stands at. A corner carries two banks; the sluice goes in the first.
   */
  outletTexture(t) {
    const edge = (t.edges && t.edges[0]) || 'ym';
    const level = clamp(t.dike ? t.dike.level : 1, 0, 2);
    return `s_sluice_${edge}_${level}`;
  }

  /** Take down the selected work, from the inspector's Demolish button. */
  demolishSelected() {
    const t = this.selected;
    if (!t) return;
    const res = this.sim.demolish(t);
    if (!res.ok) return;
    Audio.click?.();
    Haptics.build?.();
    this.refreshTile(t);
    for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
      const n = this.sim.tile(t.x + dx, t.y + dy);
      if (n) this.refreshTile(n);
    }
    if (res.kind === 'outlet' || res.kind === 'canal') this.refreshLeats();
    this.floatText(t, `+${res.refund}`, P.ui.gold);
    this.hud?.refreshCosts();
    this.select(t);
  }

  labelFor(kind, tile = null) {
    // On the tidal flat the dike tool stakes a fence or lays new dike on marsh.
    if (kind === 'dike' && tile && tile.base === 'mud' && this.sim.dikeOnMud) {
      const action = this.sim.dikeOnMud(tile);
      if (action === 'fence') return tr('build.fence');
      if (action === 'dike') return tr('build.enclose');
    }
    if (kind === 'pump') return tr(`build.${this.machineKind()}`);
    return tr(`build.${kind}`);
  }

  select(tile) {
    this.selected = tile;
    this.hud?.onSelectionChanged(tile);
  }

  cycleSpeed(dir) {
    if (this.isPaused && dir > 0) { this.requestPause(false); return; }
    this.speedIndex = clamp(this.speedIndex + dir, 0, SPEEDS.length - 1);
    this.hud?.refreshSpeed();
  }

  requestPause(on) {
    if (this.sim.outcome) return;
    this.isPaused = on;
    if (on) {
      this.scene.launch('PauseScene', { game: this });
      this.scene.bringToTop('PauseScene');
    } else {
      this.scene.stop('PauseScene');
    }
    this.hud?.refreshSpeed();
  }

  /* ================================================================
     WEATHER & LIGHT
  ================================================================ */

  /**
   * The sea working on the side the storm is coming from.
   *
   * One sprite per outward edge of every coastal tile the wind faces, slid up
   * the bank by how close the water is to the crest: a warning shows a swell
   * at the foot, a storm at its height shows it breaking level with the crest,
   * and an overtopping sea shows it above the crest with the spray going over.
   * On the far two edges the bank hides the water itself, so what you see is
   * the spray coming over the top, which is the right way round.
   */
  setupStormWaves() {
    this.waveSprites = [];
    for (const t of this.sim.coastalTiles()) {
      if (!t.edges) continue;
      for (const edge of t.edges) {
        const far = edge === 'xm' || edge === 'ym';
        const row = (t.x + t.y) * ROW_DEPTH;
        const sprite = this.add.image(0, 0, `s_wave_${edge}_0`)
          .setDepth(row + D_STRUCTURE + (far ? -1 : 1))
          .setVisible(false);
        this.placeSprite(sprite, t);
        this.waveSprites.push({ sprite, tile: t, edge, far, baseY: sprite.y });
      }
    }
  }

  updateStormWaves(time) {
    if (!this.waveSprites) return;
    const sim = this.sim;
    const active = sim.stormState !== 'calm';
    const frame = Math.floor(time / 110) % WAVE_FRAMES;
    // The breaking waves, for the spray to be thrown from.
    this.activeWaves = [];

    for (const w of this.waveSprites) {
      const facing = active && w.edge === sim.stormDir;
      if (!facing) {
        if (w.sprite.visible) w.sprite.setVisible(false);
        continue;
      }
      this.activeWaves.push(w);
      // How far up this tile's own defence the water is standing, 0 at the
      // foot and 1 at the crest. Exposure differs tile by tile, so the swell
      // is uneven along the ring exactly as the danger is.
      const sea = sim.seaAt(w.tile);
      const crest = sim.crestOf(w.tile);
      const foot = w.tile.elev - 0.6;
      const reach = clamp((sea - foot) / Math.max(0.4, crest - foot), 0, 1.25);

      w.sprite.setVisible(true);
      if (w.sprite.texture.key !== `s_wave_${w.edge}_${frame}`) {
        w.sprite.setTexture(`s_wave_${w.edge}_${frame}`);
      }
      // A warning is a swell at the foot; an overtopping sea climbs past it.
      const climb = (crest - foot) * PX_PER_M * reach;
      w.sprite.y = Math.round(w.baseY - climb);
      w.sprite.setAlpha(sim.stormState === 'warning' ? 0.55 : 0.95);
      // Over the crest, the water is coming in: let it wash the bank white.
      w.sprite.setTint(sea > crest ? P.foam[0] : 0xffffff);
    }
  }

  setupWeather() {
    const width = this.scale.width;
    // Rain and the light pass are drawn in camera space, so they cover the
    // band the world camera owns rather than the whole canvas.
    const height = this.cameras.main.height;
    const top = TOP_DEPTH;

    // Rain in two depths: a far sheet of short, dim, slower streaks and a
    // near one of long bright fast ones. The streak textures are slanted to
    // the same angle as these velocities.
    this.rainFar = this.add.particles(0, 0, 'fx_rain_far', {
      x: { min: -60, max: width + 60 },
      y: -10,
      lifespan: 1900,
      speedY: { min: 380, max: 460 },
      speedX: { min: -86, max: -70 },
      quantity: 2,
      frequency: 30,
      alpha: { min: 0.25, max: 0.5 },
    }).setScrollFactor(0).setDepth(top + 58);
    this.rainFar.stop();
    this.rainEmitter = this.add.particles(0, 0, 'fx_rain', {
      x: { min: -80, max: width + 80 },
      y: -20,
      lifespan: 1200,
      speedY: { min: 780, max: 900 },
      speedX: { min: -170, max: -145 },
      quantity: 1,
      frequency: 40,
      alpha: { min: 0.35, max: 0.8 },
    }).setScrollFactor(0).setDepth(top + 60);
    this.rainEmitter.stop();

    // Rings where the drops land on water, and spume blown off the breaking
    // waves. Both in world space, placed each frame by `updateWeatherFx`.
    if (!this.anims.exists('fx_ripple')) {
      this.anims.create({
        key: 'fx_ripple',
        frames: [0, 1, 2, 3].map((frame) => ({ key: 'fx_ripple', frame })),
        frameRate: 9,
      });
    }
    this.rippleEmitter = this.add.particles(0, 0, 'fx_ripple', {
      anim: 'fx_ripple',
      lifespan: 440,
      speed: 0,
      emitting: false,
    }).setDepth(top + 45);
    this.wind = { x: 0, y: 0 };
    this.sprayEmitter = this.add.particles(0, 0, 'fx_spray', {
      lifespan: { min: 500, max: 950 },
      speedX: { onEmit: () => this.wind.x * (40 + Math.random() * 70) },
      speedY: { onEmit: () => this.wind.y * (40 + Math.random() * 70) - 30 - Math.random() * 45 },
      gravityY: 110,
      alpha: { start: 0.95, end: 0 },
      emitting: false,
    }).setDepth(top + 46);
    this.rippleBudget = 0;
    this.sprayBudget = 0;

    // A single multiply pass over the world gives the day/night cycle.
    this.lightOverlay = this.add.rectangle(0, 0, width, height, 0xffffff)
      .setOrigin(0, 0).setScrollFactor(0)
      .setDepth(top + 70)
      .setBlendMode(Phaser.BlendModes.MULTIPLY)
      .setAlpha(0);

    // Lightning: an additive flash over the whole band, kept soft.
    this.flash = this.add.rectangle(0, 0, width, height, 0xcfdcff)
      .setOrigin(0, 0).setScrollFactor(0)
      .setDepth(top + 73)
      .setBlendMode(Phaser.BlendModes.ADD)
      .setAlpha(0);
    this.nextBolt = 0;
    this.boltAt = -1e9;

    // Lit windows, one overlay per building, drawn above the grade.
    this.lamps = new Map();
    this.lampSyncAt = -1e9;

    this.splashPool = [];
  }

  /** Where the open sea surface is drawn, in elevation units. */
  seaVisualElev() {
    // Exaggerated a little so the tide and a storm surge are visible as the
    // water climbing the dike, without ever swallowing the map.
    return clamp(this.sim.effectiveSea() * 0.85 - 1.0, -1.7, 1.5);
  }

  /**
   * 0 = midnight, 0.5 = midday. Deliberately decoupled from the simulation's
   * calendar: a game day passes in a couple of seconds, and a light cycle
   * that fast would strobe.
   */
  timeOfDay() {
    // A new polder opens on a clear morning rather than at midnight: the
    // first thing a player sees of a level should be the land in daylight.
    return (this.sim.elapsedDays / LIGHT_CYCLE_DAYS + TOD_START) % 1;
  }

  /**
   * The grade for the time of day: a multiply colour and strength over the
   * whole world, plus the additive light from the sun's corner. Keyframed
   * and eased between, so the day runs night -> dawn -> morning -> day ->
   * golden hour -> sunset -> blue hour -> night without a visible step.
   * Night stays light enough to play in: readability first, then mood.
   */
  gradeAt(tod) {
    const G = P.grade;
    const W = 0xffffff;
    const [warm, soft, pink, moon] = P.sunGlow;
    const K = [
      [0.00, G.night, 0.5, moon, 0.1, 0],
      [0.19, G.night, 0.5, moon, 0.1, 0],
      [0.24, G.dawn, 0.34, pink, 0.16, 0.4],
      [0.30, G.morning, 0.14, soft, 0.16, 1],
      [0.38, W, 0, soft, 0.1, 1],
      [0.64, W, 0, soft, 0.1, 1],
      [0.73, G.golden, 0.26, warm, 0.24, 1],
      [0.80, G.sunset, 0.34, pink, 0.2, 0.7],
      [0.85, G.blue, 0.44, moon, 0.06, 0.1],
      [0.90, G.night, 0.5, moon, 0.1, 0],
      [1.00, G.night, 0.5, moon, 0.1, 0],
    ];
    let i = 0;
    while (i < K.length - 2 && tod >= K[i + 1][0]) i++;
    const a = K[i];
    const b = K[i + 1];
    const raw = clamp((tod - a[0]) / Math.max(0.0001, b[0] - a[0]), 0, 1);
    const k = raw * raw * (3 - 2 * raw);
    return {
      tint: mix(a[1], b[1], k),
      strength: a[2] + (b[2] - a[2]) * k,
      glowColor: mix(a[3], b[3], k),
      glowAlpha: a[4] + (b[4] - a[4]) * k,
      daylight: a[5] + (b[5] - a[5]) * k,
    };
  }

  updateLighting() {
    const tod = this.timeOfDay();
    const g = this.gradeAt(tod);

    // Storms darken and cool the whole scene on top of the time of day, and
    // put the sun out.
    const severity = this.sim.weatherSeverity();
    if (severity > 0) {
      g.tint = mix(g.tint, P.grade.storm, Math.min(1, severity * 1.2));
      g.strength = clamp(Math.max(g.strength, severity * 0.3) + severity * 0.06, 0, 0.6);
      g.glowAlpha *= 1 - severity;
      g.daylight *= 1 - severity * 0.5;
    }
    this.grade = g;
    this.lightOverlay.setFillStyle(g.tint).setAlpha(g.strength);
    this.updateStormGrade(severity);

    const night = tod < 0.21 || tod > 0.84;
    if (night !== this.isNight) {
      this.isNight = night;
      // Swap every building to its lit or unlit variant.
      for (const t of this.sim.buildings) this.refreshTile(t);
    }

    // Lamps come on through the dusk and go off through the dawn, ahead of
    // and behind the texture swap, so windows light one step at a time
    // rather than all at once.
    const lamps = tod < 0.5
      ? clamp((0.25 - tod) / 0.06, 0, 1)
      : clamp((tod - 0.78) / 0.07, 0, 1);
    this.updateLamps(lamps * (1 - severity * 0.3));
  }

  /**
   * A storm takes the colour out of the world as well as the light. On
   * WebGL this is a real desaturation on the world camera, added only while
   * it is raining; the canvas renderer gets the darker grade alone.
   */
  updateStormGrade(severity) {
    const cam = this.cameras.main;
    if (!cam.postFX || this.sys.game.renderer.type !== Phaser.WEBGL) return;
    const want = severity > 0.06;
    if (want && !this.stormFx) {
      this.stormFx = cam.postFX.addColorMatrix();
      this.stormSat = -1;
    }
    if (!this.stormFx) return;
    if (!want) {
      cam.postFX.remove(this.stormFx);
      this.stormFx = null;
      return;
    }
    const sat = Math.round(severity * 20) / 20;
    if (sat !== this.stormSat) {
      this.stormSat = sat;
      this.stormFx.saturate(-0.32 * sat);
    }
  }

  /**
   * Lit windows. Each building's lamps are an overlay derived from the
   * difference between its day and night textures, placed above the grade so
   * they keep their full colour while the world around them darkens. That
   * would let a lamp shine through anything standing in front of it, so each
   * overlay has the sprites in front of it cut out of it. Rebuilt only when
   * what stands in front changes.
   */
  updateLamps(level) {
    if (level <= 0.01) {
      for (const l of this.lamps.values()) if (l.img.visible) l.img.setVisible(false);
      return;
    }
    const now = this.time.now;
    if (now - this.lampSyncAt > 1500) this.syncLamps();
    for (const l of this.lamps.values()) l.img.setVisible(true).setAlpha(level);
  }

  syncLamps() {
    this.lampSyncAt = this.time.now;
    const seen = new Set();
    for (const t of this.sim.buildings) {
      if (!t.building || t.building.lost) continue;
      const ob = this.objectSprites[t.x][t.y];
      if (!ob || !ob.active) continue;
      const base = ob.texture.key.replace(/_night$/, '');
      const nightKey = `${base}_night`;
      if (!this.textures.exists(nightKey)) continue;
      const id = `${t.x},${t.y}`;
      seen.add(id);

      const left = ob.x - ob.displayOriginX;
      const topY = ob.y - ob.displayOriginY;
      const right = left + ob.width;
      const bottom = topY + ob.height;
      const row = t.x + t.y;
      const cutters = [];
      for (let dx = -3; dx <= 3; dx++) {
        for (let dy = -3; dy <= 3; dy++) {
          const n = this.sim.tile(t.x + dx, t.y + dy);
          if (!n || n.x + n.y <= row) continue;
          const list = [this.structureSprites[n.x][n.y], this.objectSprites[n.x][n.y],
            ...this.dikeSprites[n.x][n.y]];
          for (const s of list) {
            if (!s || !s.visible) continue;
            const l = s.x - s.displayOriginX;
            const tp = s.y - s.displayOriginY;
            if (l >= right || l + s.width <= left || tp >= bottom || tp + s.height <= topY) continue;
            cutters.push({ key: s.texture.key, x: l - left, y: tp - topY, flipX: s.flipX });
          }
        }
      }
      // Animation frames do not count as a change: a mill turning in front
      // of a window should not rebuild the overlay every second.
      const sig = `${base}|${cutters.map((c) => `${c.key.replace(/_\d+$/, '')}@${c.x},${c.y}`).join(';')}|${ob.x},${ob.y}`;
      let l = this.lamps.get(id);
      if (l && l.sig === sig) continue;
      const key = lampOverlayKey(this, `fx_lamp_${t.x}_${t.y}`, base, nightKey, cutters);
      if (!key) {
        if (l) { l.img.destroy(); this.lamps.delete(id); }
        continue;
      }
      if (!l) {
        l = { img: this.add.image(0, 0, key).setDepth(TOP_DEPTH + 74) };
        this.lamps.set(id, l);
      }
      l.sig = sig;
      l.img.setTexture(key);
      const a = ANCHORS[key];
      l.img.setOrigin(a.x / l.img.width, a.y / l.img.height).setPosition(ob.x, ob.y);
    }
    for (const [id, l] of this.lamps) {
      if (!seen.has(id)) { l.img.destroy(); this.lamps.delete(id); }
    }
  }

  /** Whether a point in the world is open water, for rain rings. */
  isWaterAt(wx, wy) {
    const t = screenToTile(wx, wy);
    if (!this.sim.inBounds(t.x, t.y)) return true;
    const tile = this.sim.tiles[t.x][t.y];
    return tile.base === 'sea' || tile.canal || tile.depth > 0.1;
  }

  updateWeatherFx(dt = 0.016) {
    const severity = this.sim.weatherSeverity();
    const now = this.time.now;
    if (severity > 0.08) {
      if (!this.rainEmitter.emitting) { this.rainEmitter.start(); this.rainFar.start(); }
      this.rainEmitter.frequency = Math.max(5, 56 - severity * 50);
      this.rainFar.frequency = Math.max(6, 50 - severity * 44);
      this.rainEmitter.setParticleAlpha({ min: 0.35 + severity * 0.25, max: 0.6 + severity * 0.35 });

      // Rings on the water, spread over whatever the camera can see.
      const view = this.cameras.main.worldView;
      this.rippleBudget += dt * severity * (view.width * view.height) / 2600;
      let tries = 0;
      while (this.rippleBudget >= 1 && tries < 40) {
        tries++;
        const x = view.x + Math.random() * view.width;
        const y = view.y + Math.random() * view.height;
        if (!this.isWaterAt(x, y)) continue;
        this.rippleEmitter.emitParticleAt(Math.round(x), Math.round(y), 1);
        this.rippleBudget -= 1;
      }
      this.rippleBudget = Math.min(this.rippleBudget, 4);
    } else if (this.rainEmitter.emitting) {
      this.rainEmitter.stop();
      this.rainFar.stop();
    }

    // Spume off the breaking waves, blown inland by the storm's wind.
    const waves = this.activeWaves || [];
    if (waves.length) {
      const inland = {
        xm: [0.89, 0.45], xp: [-0.89, -0.45], ym: [-0.89, 0.45], yp: [0.89, -0.45],
      }[this.sim.stormDir] || [0, 0];
      this.wind.x = inland[0];
      this.wind.y = inland[1];
      const rate = this.sim.stormState === 'active' ? 0.9 + severity * 1.4 : 0.25;
      this.sprayBudget = Math.min(8, this.sprayBudget + dt * waves.length * rate);
      while (this.sprayBudget >= 1) {
        this.sprayBudget -= 1;
        const w = waves[Math.floor(Math.random() * waves.length)];
        this.sprayEmitter.emitParticleAt(
          Math.round(w.sprite.x + (Math.random() - 0.5) * 36),
          Math.round(w.sprite.y - 4 - Math.random() * 6), 1,
        );
      }
    }

    // Lightning, now and then, at the height of a storm: a bright stroke,
    // a gap, a weaker second stroke, and a fade. Soft enough not to strobe.
    if (this.sim.stormState === 'active' && severity > 0.45) {
      if (!this.nextBolt) this.nextBolt = now + 3000 + Math.random() * 6000;
      if (now > this.nextBolt) {
        this.boltAt = now;
        this.nextBolt = now + 7000 + Math.random() * 9000;
      }
    } else {
      this.nextBolt = 0;
    }
    const e = now - this.boltAt;
    const flash = e < 0 ? 0 : e < 60 ? 0.24 : e < 130 ? 0.03 : e < 190 ? 0.16 : e < 520 ? 0.16 * (1 - (e - 190) / 330) : 0;
    if (flash !== this.flash.alpha) this.flash.setAlpha(flash);

    Audio.setMood(this.sim.stormState === 'active' ? 'storm'
      : this.sim.stormState === 'warning' ? 'tense' : 'calm');
  }

  /* ================================================================
     EFFECTS
  ================================================================ */

  /**
   * Building work: a ring of dust kicked out across the ground along the 2:1
   * plane, and a few sparkles rising off it. Nothing is scaled — pixel
   * sprites only fade — so the effect stays on the pixel grid.
   */
  spawnSpark(tile) {
    const x = Math.round(isoX(tile.x, tile.y));
    const y = Math.round(isoY(tile.x, tile.y, this.renderElev(tile)));
    const depth = (tile.x + tile.y) * ROW_DEPTH + 20;
    const dust = this.add.particles(x, y + 4, 'fx_dust', {
      lifespan: { min: 380, max: 620 },
      // Twice as wide as it is deep: the burst lies on the ground plane.
      speedX: { min: -46, max: 46 },
      speedY: { min: -23, max: 23 },
      alpha: { start: 0.9, end: 0 },
      emitting: false,
    }).setDepth(depth);
    dust.explode(10);
    const sparks = this.add.particles(x, y - 6, 'fx_spark', {
      lifespan: { min: 380, max: 560 },
      speedX: { min: -24, max: 24 },
      speedY: { min: -70, max: -30 },
      gravityY: 60,
      alpha: { start: 1, end: 0 },
      emitting: false,
    }).setDepth(depth + 1);
    sparks.explode(5);
    this.time.delayedCall(700, () => { dust.destroy(); sparks.destroy(); });
  }

  /** Water breaking in: the splash sheet, and droplets flung off it. */
  spawnSplash(tile) {
    const x = Math.round(isoX(tile.x, tile.y));
    const y = Math.round(isoY(tile.x, tile.y, this.renderElev(tile)));
    const depth = (tile.x + tile.y) * ROW_DEPTH + D_OVERLAY;
    const s = this.add.image(x, y, 'fx_splash_0').setDepth(depth);
    const a = ANCHORS.fx_splash_0;
    s.setOrigin(a.x / s.width, a.y / s.height);
    let frame = 0;
    const timer = this.time.addEvent({
      delay: 110,
      repeat: 3,
      callback: () => {
        frame += 1;
        if (frame > 3) { s.destroy(); return; }
        s.setTexture(`fx_splash_${frame}`);
      },
    });
    const drops = this.add.particles(x, y - 6, 'fx_dot', {
      lifespan: { min: 420, max: 700 },
      speedX: { min: -50, max: 50 },
      speedY: { min: -110, max: -50 },
      gravityY: 260,
      alpha: { start: 1, end: 0.3 },
      emitting: false,
    }).setDepth(depth + ROW_DEPTH);
    drops.explode(9);
    this.time.delayedCall(760, () => { timer.remove(); s.destroy(); drops.destroy(); });
  }

  /**
   * A number that floats up from a tile — income, costs, damage. It pops up
   * a few pixels, holds, then drifts and fades, over a one-pixel ink drop
   * shadow so it reads over grass, water and roofs alike.
   */
  floatText(tile, text, color) {
    const x = Math.round(isoX(tile.x, tile.y));
    const y = Math.round(isoY(tile.x, tile.y, this.renderElev(tile))) - 20;
    const depth = TOP_DEPTH + 75;
    const shadow = this.add.bitmapText(x + 1, y + 1, 'pxfont', text, 10)
      .setOrigin(0.5).setTint(P.ink[0]).setAlpha(0.8).setDepth(depth);
    const t = this.add.bitmapText(x, y, 'pxfont', text, 10)
      .setOrigin(0.5).setTint(color).setDepth(depth + 0.1);
    const lift = { v: 0, a: 1 };
    const onUpdate = () => {
      const yy = Math.round(y - lift.v);
      t.setY(yy).setAlpha(lift.a);
      shadow.setY(yy + 1).setAlpha(lift.a * 0.8);
    };
    this.tweens.chain({
      targets: lift,
      tweens: [
        { v: 8, duration: 180, ease: 'Back.easeOut', onUpdate },
        {
          v: 30, a: 0, duration: 1000, ease: 'Sine.easeIn', delay: 250, onUpdate,
        },
      ],
      onComplete: () => { t.destroy(); shadow.destroy(); },
    });
  }

  handleEvents() {
    for (const e of this.sim.drainEvents()) {
      switch (e.type) {
        case 'breach':
          Audio.breach();
          Haptics.disaster();
          this.cameras.main.shake(600, 0.008);
          this.refreshTile(e.tile);
          this.spawnSplash(e.tile);
          this.hud?.alert(tr('breach.title'),
            tr('breach.body', { x: e.tile.x, y: e.tile.y }), 'bad');
          this.hud?.pingTile(e.tile);
          break;
        case 'dikeRepaired':
          this.refreshTile(e.tile);
          break;
        // The storm banner at the top already says all of this, and stays up
        // for as long as it matters; a toast on top of it only doubled it.
        case 'stormWarning':
          Audio.alarm();
          Haptics.warning();
          break;
        case 'stormStart':
          Audio.thunder();
          break;
        case 'laidUp':
          // Running out of money used to stop a mill in complete silence: no
          // message, no mark on the machine, and a polder quietly filling up
          // with no stated cause. It is the loudest thing the economy does.
          Audio.alarm();
          Haptics.warning();
          this.refreshTile(e.tile);
          this.hud?.alert(tr('broke.title'),
            tr(e.kind === 'outlet' ? 'broke.outlet' : 'broke.pump'), 'bad');
          this.hud?.pingTile(e.tile);
          this.floatText(e.tile, tr('broke.float'), P.ui.red);
          break;
        case 'reclaimed':
        case 'fieldLost':
          // Many parcels can turn over on the same day, so this stays silent
          // and does the one thing that matters: redraw the ground.
          this.refreshTile(e.tile);
          break;
        case 'canalFull':
          Audio.alarm();
          Haptics.warning();
          this.hud?.alert(tr('canalFull.title'), tr('canalFull.body'), 'warn');
          break;
        case 'backOn':
          Audio.build();
          this.refreshTile(e.tile);
          this.hud?.flashMessage(
            tr(e.left > 0 ? 'backOn.some' : 'backOn.all', { n: e.left }), 'good',
          );
          break;
        case 'stormEnd':
          this.hud?.flashMessage(tr('storm.over'), 'good');
          break;
        case 'buildingLost':
          Audio.splash();
          Haptics.disaster();
          this.refreshTile(e.tile);
          this.spawnSplash(e.tile);
          this.floatText(e.tile, tr('lost.float'), P.ui.red);
          this.hud?.alert(tr('lost.title'), tr('lost.body'), 'bad');
          break;
        case 'newDay':
          this.onNewDay();
          break;
        case 'enclosed':
          // A new polder: the dikes have cut a stretch of flat off the sea.
          this.onCoastChanged();
          this.ripeAnnounced = false;
          Audio.victory?.();
          Haptics.success?.();
          this.hud?.alert(tr('enclosed.title'),
            tr('enclosed.body', { ha: formatNumber(this.sim.score()) }), 'good');
          this.hud?.refreshCosts();
          submitScore(this.level, this.sim.score());
          break;
        case 'won':
        case 'lost':
          this.finish(e.type === 'won');
          break;
        default:
          break;
      }
    }
  }

  compass(dir) {
    return dir ? tr(`dir.${dir}`) : '';
  }

  onNewDay() {
    // A new era: from now on pumps are built as the next machine.
    const machine = this.machineKind();
    if (this.lastMachine && machine !== this.lastMachine) {
      this.hud?.alert(tr('era.title'), tr(`era.${machine}`), 'good');
      this.hud?.relabelBuildBar?.();
    }
    this.lastMachine = machine;
    // The tidal flat changes colour as it silts up; say so once when the
    // marsh by the dike first stands high enough to be diked, and again
    // after each new polder.
    if (this.sim.mudTiles) {
      // Young clay settles below the canal in a few years, and then it stops
      // draining itself. Said once, as the first of it comes near the canal,
      // so a player who has only ever built dikes has time to dig and pump.
      const canal = this.sim.canalSurface();
      if (!this.klinkAnnounced && this.sim.wonTiles?.some((t) => !t.coastal && t.elev < canal + 0.25)) {
        this.klinkAnnounced = true;
        this.hud?.alert(tr('klink.title'), tr('klink.body'), 'warn');
      }
      if (!this.ripeAnnounced && ripe(this.sim)) {
        this.ripeAnnounced = true;
        this.hud?.alert(tr('ripe.title'), tr('ripe.body'), 'good');
      }
      for (const t of this.sim.mudTiles) this.refreshTile(t);
    }
    // Rubble and drained ground change how tiles are drawn.
    this.dayTickCounter = (this.dayTickCounter || 0) + 1;
    if (this.dayTickCounter % 3 === 0) {
      for (let x = 0; x < this.sim.cols; x++) {
        for (let y = 0; y < this.sim.rows; y++) {
          const t = this.sim.tiles[x][y];
          if (t.base === 'land' && !t.canal && t.everFlooded) this.refreshTile(t);
        }
      }
    }
    this.hud?.refreshCosts();
  }

  finish(won) {
    Audio.stopMusic();
    if (won) { Audio.victory(); Haptics.success(); } else { Audio.defeat(); Haptics.disaster(); }
    clearSave();
    const result = {
      won,
      score: this.sim.score(),
      days: this.sim.stats.daysSurvived,
      level: this.level,
      stats: this.sim.stats,
      intact: this.sim.intactHouses(),
      total: this.sim.totalHouses(),
    };
    recordResult(this.level.id, result);
    // An endless coast's final tally goes to the leaderboard.
    if (this.level.endless) submitScore(this.level, result.score);
    this.time.delayedCall(900, () => {
      this.scene.launch('GameOverScene', result);
      this.scene.bringToTop('GameOverScene');
    });
  }

  /* ================================================================
     FRAME
  ================================================================ */

  update(time, delta) {
    const dt = Math.min(delta, 100) / 1000;

    if (!this.isPaused && !this.sim.outcome) {
      this.sim.update(dt, SPEEDS[this.speedIndex]);
      this.handleEvents();

      this.autosaveTimer += dt;
      if (this.autosaveTimer > 10) {
        this.autosaveTimer = 0;
        saveGame(this.sim.serialize());
      }
    }

    this.updateAnimationFrames(time);
    this.updateStormWaves(time);
    this.updateWaterVisuals();
    this.updateBackdrop(dt);
    this.updateShipping(dt);
    this.updateAmbientLife(dt);
    this.updateShadows();
    this.updateLighting();
    this.updateWeatherFx(dt);
    this.updateCameraKeys(dt);
    this.updatePlacementPreview();
    this.cullColumns();
  }

  updateAnimationFrames(time) {
    const water = Math.floor(time / 190) % 4;
    const mill = Math.floor(time / 65) % 16;
    const pump = Math.floor(time / 130) % 4;

    if (water !== this.waterFrame) {
      this.waterFrame = water;
      this.openSea.setTexture(`fx_opensea_${water}`);
      for (let x = 0; x < this.sim.cols; x++) {
        for (let y = 0; y < this.sim.rows; y++) {
          const t = this.sim.tiles[x][y];
          if (t.base === 'sea') {
            this.terrainSprites[x][y]
              .setTexture(`t_sea${this.shoalRing(t)}_${water}_${seaVariant(x, y)}`);
          }
          else if (t.canal) this.terrainSprites[x][y].setTexture(`t_canal_${water}`);
          const f = this.floodSprites[x][y];
          if (f && f.visible) f.setTexture(`t_flood_${water}`);
        }
      }
    }

    const kindOf = (t) => t.pump.kind || this.machineKind();
    if (mill !== this.millFrame) {
      this.millFrame = mill;
      for (const t of this.sim.pumps) {
        if (kindOf(t) !== 'mill') continue;
        const s = this.structureSprites[t.x][t.y];
        if (!s) continue;
        // A stalled mill stands still, sails furled on the first frame.
        s.setTexture(t.pump.running ? `b_windmill_${mill}` : 'b_windmill_0');
        s.setTint(this.machineTint(t.pump));
      }
    }

    if (pump !== this.pumpFrame) {
      this.pumpFrame = pump;
      for (const t of this.sim.pumps) {
        const kind = kindOf(t);
        if (kind === 'mill') continue;
        const s = this.structureSprites[t.x][t.y];
        if (!s) continue;
        // A stalled pump freezes on its first frame.
        s.setTexture(`${this.pumpPrefix(kind)}_${t.pump.running ? pump : 0}`);
        s.setTint(this.machineTint(t.pump));
      }
    }
  }

  /**
   * The depth to draw for a tile: the real depth when it is rising, and a
   * slower fall when it is dropping, so draining reads as a recession.
   */
  shownDepth(t, recede) {
    this.shown = this.shown || new WeakMap();
    const before = this.shown.get(t);
    const now = before === undefined ? t.depth : Math.max(t.depth, before - recede);
    this.shown.set(t, now);
    return now;
  }

  updateWaterVisuals() {
    const seaElev = this.seaVisualElev();
    const drowned = flatsDrowned(this.sim);
    const day = this.sim.elapsedDays;
    const recede = FLOOD_RECEDE * Math.max(0, day - (this.visualDay ?? day));
    this.visualDay = day;
    for (let x = 0; x < this.sim.cols; x++) {
      for (let y = 0; y < this.sim.rows; y++) {
        const t = this.sim.tiles[x][y];
        if (t.base === 'sea') {
          this.terrainSprites[x][y].y = Math.round(isoY(x, y, seaElev));
          continue;
        }
        const base = this.renderElev(t);
        const f = this.floodSprites[x][y];
        if (!f) continue;
        if (t.canal) { f.setVisible(false); continue; }
        if (t.base === 'mud') {
          // A storm tide stands over the flats: the mud goes under, and
          // only the fence stakes show above the water.
          if (!drowned) { if (f.visible) f.setVisible(false); continue; }
          if (!f.visible) { f.setVisible(true); f.setTexture(`t_flood_${this.waterFrame || 0}`); }
          f.setAlpha(0.9);
          f.y = Math.round(isoY(x, y, Math.max(base + 0.2, seaElev)));
          continue;
        }
        const shown = this.shownDepth(t, recede);
        if (shown <= 0.02) {
          if (f.visible) f.setVisible(false);
          continue;
        }
        if (!f.visible) { f.setVisible(true); f.setTexture(`t_flood_${this.waterFrame || 0}`); }
        // Shallow water is a sheen; deep water is opaque and sits higher.
        const deep = clamp(shown / 0.8, 0, 1);
        f.setAlpha(0.5 + deep * 0.45);
        f.y = Math.round(isoY(x, y, base + Math.min(shown, 1.2) * 0.5));
      }
    }
  }

  updateCameraKeys(dt) {
    const cam = this.cameras.main;
    const k = this.keys;
    let dx = 0;
    let dy = 0;
    if (k.left.isDown || k.a.isDown) dx -= 1;
    if (k.right.isDown || k.d.isDown) dx += 1;
    if (k.up.isDown || k.w.isDown) dy -= 1;
    if (k.down.isDown || k.s.isDown) dy += 1;
    if (dx || dy) {
      this.hasPanned = true;
      const speed = (CAM_KEY_SPEED / cam.zoom) * dt;
      cam.scrollX += dx * speed;
      cam.scrollY += dy * speed;
    }
  }

  /* ================================================================
     PLACEMENT PREVIEW
  ================================================================ */

  updatePlacementPreview() {
    const g = this.highlight;
    g.clear();
    if (!this.placement) {
      if (this.ghost) { this.ghost.destroy(); this.ghost = null; }
      if (this.selected) this.drawTileOutline(g, this.selected, P.ui.gold, 0.9);
      return;
    }

    const kind = this.placement;
    // Show every legal tile, so the rule is visible, not guessed at. The
    // wash alone used to be so faint (0.18) it all but disappeared into the
    // dithered ground textures; outlining every one of them fixed that but
    // then read as a sheet of graph paper laid over half the map, which is
    // its own kind of illegible. A stronger flat wash is the middle ground —
    // legible from across the island, quiet up close.
    for (let x = 0; x < this.sim.cols; x++) {
      for (let y = 0; y < this.sim.rows; y++) {
        const t = this.sim.tiles[x][y];
        if (this.sim.validate(kind, t)) continue;
        // On the flat nearly every tile takes a fence, and washing them all
        // turned the whole coast orange. Marsh ready for new dike stands out;
        // fence ground gets only a trace.
        if (kind === 'dike' && t.base === 'mud') {
          if (this.sim.dikeOnMud(t) === 'dike') this.fillTile(g, t, this.accentFor(kind), 0.4);
          else this.fillTile(g, t, P.ui.white, 0.06);
          continue;
        }
        this.fillTile(g, t, this.accentFor(kind), 0.3);
      }
    }

    const hover = this.touchMode ? this.aimTile : this.hoverTile;
    if (!hover) return;
    const reason = this.sim.validate(kind, hover);
    const affordable = this.sim.money >= this.sim.costOf(kind, hover);
    const ok = !reason && affordable;

    // Range rings make the adjacency rules concrete. Each one is drawn in
    // the same distance metric the rule it illustrates actually uses — the
    // canal-reach rings are diamonds (Manhattan distance, `hasCanalWithin`),
    // not circles, which is what a player was shown before this: a hover
    // could sit inside the drawn "reach" circle and still fail to validate,
    // because the real rule measured differently from the ring around it.
    if (kind === 'pump') {
      this.drawRange(g, hover, PUMP_RADIUS, P.ui.blue, 0.16, 'circle');
      this.drawRange(g, hover, PUMP_CANAL_RANGE, P.ui.green, 0.20, 'diamond');
    } else if (kind === 'outlet') {
      this.drawRange(g, hover, 3, P.ui.green, 0.18, 'diamond');
    }

    // On marsh the dike tool takes the whole stretch at once: show all of
    // it, the new dike darker than the polder it will hold.
    const patch = kind === 'dike' && hover.base === 'mud' ? marshPatch(this.sim, hover) : null;
    if (patch && typeof patch === 'object') {
      const walls = new Set(patch.walls);
      for (const t of patch.tiles) {
        this.fillTile(g, t, ok ? (walls.has(t) ? this.accentFor(kind) : P.ui.green) : P.ui.red, walls.has(t) ? 0.55 : 0.35);
      }
    }
    this.fillTile(g, hover, ok ? this.accentFor(kind) : P.ui.red, 0.5);
    this.drawTileOutline(g, hover, ok ? P.ui.white : P.ui.red, 1);

    this.hud?.setHoverInfo(hover, reason, this.sim.costOf(kind, hover));
  }

  accentFor(kind) {
    return {
      dike: P.ui.orange, canal: P.ui.blue, pump: P.ui.green,
      outlet: P.ui.gold, fence: P.ui.green,
    }[kind] || P.ui.white;
  }

  tileCorners(t) {
    const x = isoX(t.x, t.y);
    const y = isoY(t.x, t.y, this.renderElev(t));
    const hw = TILE_W / 2;
    const hh = TILE_H / 2;
    return [
      { x, y: y - hh }, { x: x + hw, y }, { x, y: y + hh }, { x: x - hw, y },
    ];
  }

  fillTile(g, t, color, alpha) {
    const c = this.tileCorners(t);
    g.fillStyle(color, alpha);
    g.beginPath();
    g.moveTo(c[0].x, c[0].y);
    for (let i = 1; i < c.length; i++) g.lineTo(c[i].x, c[i].y);
    g.closePath();
    g.fillPath();
  }

  drawTileOutline(g, t, color, alpha) {
    const c = this.tileCorners(t);
    g.lineStyle(1, color, alpha);
    g.beginPath();
    g.moveTo(c[0].x, c[0].y);
    for (let i = 1; i < c.length; i++) g.lineTo(c[i].x, c[i].y);
    g.closePath();
    g.strokePath();
  }

  /**
   * `shape` picks the distance metric so the ring drawn matches the rule it
   * illustrates: 'circle' for a Euclidean radius (how far a pump lifts
   * water), 'diamond' for Manhattan distance (how far a canal can reach).
   *
   * Only the boundary tiles — the ones with a neighbour outside the range —
   * get an outline. Stroking every tile inside the area as well drew a
   * lattice of diamonds across the whole thing, which reads as graph paper,
   * not as a ring; outlining just the edge is what actually draws a ring.
   */
  drawRange(g, centre, radius, color, alpha, shape = 'circle') {
    const included = (dx, dy) => (shape === 'diamond'
      ? Math.abs(dx) + Math.abs(dy) <= radius
      : dx * dx + dy * dy <= radius * radius);
    for (let dx = -radius; dx <= radius; dx++) {
      for (let dy = -radius; dy <= radius; dy++) {
        if (!included(dx, dy)) continue;
        const t = this.sim.tile(centre.x + dx, centre.y + dy);
        if (!t) continue;
        this.fillTile(g, t, color, alpha);
        const onEdge = [[1, 0], [-1, 0], [0, 1], [0, -1]]
          .some(([nx, ny]) => !included(dx + nx, dy + ny));
        if (onEdge) this.drawTileOutline(g, t, color, Math.min(1, alpha + 0.55));
      }
    }
  }
}
