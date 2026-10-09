/**
 * A tiny pixel-pushing canvas used to author every sprite in the game at
 * boot time. Everything is drawn on an integer grid at 1:1 scale and then
 * displayed with nearest-neighbour filtering, which is what gives the game
 * its hand-placed-pixel look instead of the soft vector look of shape
 * primitives.
 */

import { css, mix, rgb, toHex } from '../palette.js';

/** Isometric tile footprint. A 2:1 diamond, the pixel-art standard. */
export const TILE_W = 64;
export const TILE_H = 32;
/**
 * Depth of the earth block drawn under each tile: enough to cover the small
 * elevation steps inside the polder and to give the island a rim where it
 * meets the sea.
 */
export const TILE_WALL = 16;
/** All terrain textures share this canvas size and anchor. */
export const TERRAIN_TEX_H = TILE_H + TILE_WALL;
/** Anchor point inside a terrain texture: the centre of the diamond top. */
export const TERRAIN_ANCHOR_X = TILE_W / 2;
export const TERRAIN_ANCHOR_Y = TILE_H / 2;

/** 4x4 Bayer matrix, normalised to 0..1. Used for all gradient dithering. */
const BAYER4 = [
  [0, 8, 2, 10],
  [12, 4, 14, 6],
  [3, 11, 1, 9],
  [15, 7, 13, 5],
].map((row) => row.map((v) => v / 16));

/** Deterministic value noise so every regenerated texture is identical. */
export function hash2(x, y, seed = 0) {
  let h = x * 374761393 + y * 668265263 + seed * 2147483647;
  h = (h ^ (h >> 13)) * 1274126177;
  h = h ^ (h >> 16);
  return ((h >>> 0) % 100000) / 100000;
}

/**
 * Horizontal span of the tile diamond at a given row.
 * Row 0 is the topmost point; the widest rows are 15 and 16.
 */
export function diamondSpan(y) {
  const half = y < TILE_H / 2 ? (y + 1) * 2 : (TILE_H - y) * 2;
  return { x0: TILE_W / 2 - half, x1: TILE_W / 2 + half - 1 };
}

export class Px {
  constructor(w, h) {
    this.w = w;
    this.h = h;
    this.canvas = typeof document !== 'undefined'
      ? document.createElement('canvas')
      : null;
    this.canvas.width = w;
    this.canvas.height = h;
    this.ctx = this.canvas.getContext('2d', { willReadFrequently: true });
    this.ctx.imageSmoothingEnabled = false;
  }

  clear() {
    this.ctx.clearRect(0, 0, this.w, this.h);
    return this;
  }

  /** Set a single pixel. Out-of-bounds writes are dropped silently. */
  set(x, y, color, alpha = 1) {
    x |= 0;
    y |= 0;
    if (x < 0 || y < 0 || x >= this.w || y >= this.h) return this;
    this.ctx.fillStyle = css(color, alpha);
    this.ctx.fillRect(x, y, 1, 1);
    return this;
  }

  rect(x, y, w, h, color, alpha = 1) {
    this.ctx.fillStyle = css(color, alpha);
    this.ctx.fillRect(x | 0, y | 0, w | 0, h | 0);
    return this;
  }

  /** Unfilled rectangle, one pixel thick. */
  frame(x, y, w, h, color, alpha = 1) {
    this.rect(x, y, w, 1, color, alpha);
    this.rect(x, y + h - 1, w, 1, color, alpha);
    this.rect(x, y, 1, h, color, alpha);
    this.rect(x + w - 1, y, 1, h, color, alpha);
    return this;
  }

  hline(x0, x1, y, color, alpha = 1) {
    const a = Math.min(x0, x1);
    const b = Math.max(x0, x1);
    return this.rect(a, y, b - a + 1, 1, color, alpha);
  }

  vline(x, y0, y1, color, alpha = 1) {
    const a = Math.min(y0, y1);
    const b = Math.max(y0, y1);
    return this.rect(x, a, 1, b - a + 1, color, alpha);
  }

  /** Bresenham line — keeps diagonals on the pixel grid. */
  line(x0, y0, x1, y1, color, alpha = 1) {
    x0 |= 0; y0 |= 0; x1 |= 0; y1 |= 0;
    const dx = Math.abs(x1 - x0);
    const dy = -Math.abs(y1 - y0);
    const sx = x0 < x1 ? 1 : -1;
    const sy = y0 < y1 ? 1 : -1;
    let err = dx + dy;
    for (;;) {
      this.set(x0, y0, color, alpha);
      if (x0 === x1 && y0 === y1) break;
      const e2 = 2 * err;
      if (e2 >= dy) { err += dy; x0 += sx; }
      if (e2 <= dx) { err += dx; y0 += sy; }
    }
    return this;
  }

  /** Filled circle using the midpoint test, kept crisp for small radii. */
  disc(cx, cy, r, color, alpha = 1) {
    for (let y = -r; y <= r; y++) {
      for (let x = -r; x <= r; x++) {
        if (x * x + y * y <= r * r + r * 0.25) this.set(cx + x, cy + y, color, alpha);
      }
    }
    return this;
  }

  /** Filled convex polygon via scanline, integer coordinates only. */
  poly(points, color, alpha = 1) {
    let minY = Infinity;
    let maxY = -Infinity;
    for (const p of points) {
      if (p[1] < minY) minY = p[1];
      if (p[1] > maxY) maxY = p[1];
    }
    for (let y = Math.floor(minY); y <= Math.ceil(maxY); y++) {
      const xs = [];
      for (let i = 0; i < points.length; i++) {
        const [ax, ay] = points[i];
        const [bx, by] = points[(i + 1) % points.length];
        if ((ay <= y && by > y) || (by <= y && ay > y)) {
          xs.push(ax + ((y - ay) / (by - ay)) * (bx - ax));
        }
      }
      if (xs.length < 2) continue;
      xs.sort((a, b) => a - b);
      for (let i = 0; i + 1 < xs.length; i += 2) {
        this.hline(Math.round(xs[i]), Math.round(xs[i + 1]), y, color, alpha);
      }
    }
    return this;
  }

  /**
   * Fill a rectangle with a dithered blend of two colours.
   * `t` 0 = all c1, 1 = all c2. The Bayer threshold keeps the transition
   * looking like deliberate pixel texture rather than noise.
   */
  ditherRect(x, y, w, h, c1, c2, t) {
    for (let j = 0; j < h; j++) {
      for (let i = 0; i < w; i++) {
        const th = BAYER4[(y + j) & 3][(x + i) & 3];
        this.set(x + i, y + j, t > th ? c2 : c1);
      }
    }
    return this;
  }

  /** True when the pixel has any opacity. */
  opaqueAt(data, x, y) {
    if (x < 0 || y < 0 || x >= this.w || y >= this.h) return false;
    return data[(y * this.w + x) * 4 + 3] > 8;
  }

  /**
   * Trace a one-pixel outline around every opaque cluster. Selective
   * outlining (skipping the top edge) reads as a light source from above.
   */
  outline(color, { skipTop = false, alpha = 1 } = {}) {
    const img = this.ctx.getImageData(0, 0, this.w, this.h);
    const d = img.data;
    const targets = [];
    for (let y = 0; y < this.h; y++) {
      for (let x = 0; x < this.w; x++) {
        if (this.opaqueAt(d, x, y)) continue;
        const near = this.opaqueAt(d, x - 1, y) || this.opaqueAt(d, x + 1, y)
          || this.opaqueAt(d, x, y + 1) || (!skipTop && this.opaqueAt(d, x, y - 1));
        if (near) targets.push([x, y]);
      }
    }
    for (const [x, y] of targets) this.set(x, y, color, alpha);
    return this;
  }

  /**
   * Selective outline ("selout"): each outline pixel takes the colour of the
   * sprite pixel it borders, pushed most of the way to `ink`. A red brick
   * house gets a deep red edge and a green one a deep green edge, which
   * separates overlapping objects as well as a black line does without
   * drawing a cartoon border round everything.
   */
  selout(ink, { skipTop = false, depth = 0.7, alpha = 1 } = {}) {
    const img = this.ctx.getImageData(0, 0, this.w, this.h);
    const d = img.data;
    const inkC = { r: (ink >> 16) & 255, g: (ink >> 8) & 255, b: ink & 255 };
    const targets = [];
    for (let y = 0; y < this.h; y++) {
      for (let x = 0; x < this.w; x++) {
        if (this.opaqueAt(d, x, y)) continue;
        const from = [[x, y + 1], [x - 1, y], [x + 1, y]];
        if (!skipTop) from.push([x, y - 1]);
        const src = from.find(([sx, sy]) => this.opaqueAt(d, sx, sy));
        if (!src) continue;
        const i = (src[1] * this.w + src[0]) * 4;
        const r = d[i] + (inkC.r - d[i]) * depth;
        const g = d[i + 1] + (inkC.g - d[i + 1]) * depth;
        const b = d[i + 2] + (inkC.b - d[i + 2]) * depth;
        targets.push([x, y, (Math.round(r) << 16) | (Math.round(g) << 8) | Math.round(b)]);
      }
    }
    for (const [x, y, c] of targets) this.set(x, y, c, alpha);
    return this;
  }

  /** Darken every opaque pixel below a diagonal, for quick ambient occlusion. */
  shadeBelow(yStart, amount) {
    const img = this.ctx.getImageData(0, 0, this.w, this.h);
    const d = img.data;
    for (let y = yStart; y < this.h; y++) {
      for (let x = 0; x < this.w; x++) {
        const i = (y * this.w + x) * 4;
        if (d[i + 3] < 8) continue;
        d[i] *= amount;
        d[i + 1] *= amount;
        d[i + 2] *= amount;
      }
    }
    this.ctx.putImageData(img, 0, 0);
    return this;
  }

  /** Composite another Px at an offset. */
  blit(other, dx, dy) {
    this.ctx.drawImage(other.canvas, dx | 0, dy | 0);
    return this;
  }

  /** Tint every opaque pixel toward a colour — used for night lighting. */
  tint(color, strength) {
    const img = this.ctx.getImageData(0, 0, this.w, this.h);
    const d = img.data;
    const c = rgb(color);
    for (let i = 0; i < d.length; i += 4) {
      if (d[i + 3] < 8) continue;
      d[i] += (c.r - d[i]) * strength;
      d[i + 1] += (c.g - d[i + 1]) * strength;
      d[i + 2] += (c.b - d[i + 2]) * strength;
    }
    this.ctx.putImageData(img, 0, 0);
    return this;
  }

  /**
   * Fill the diamond top face of a tile.
   * `ramp` is a dark->light colour ramp; noise dithers between its middle
   * entries so large fields of grass never look flat.
   */
  isoTop(ramp, { seed = 0, lit = 0.55, grain = 0.14, yOff = 0 } = {}) {
    // A tile top is a flat plane, so it gets a flat colour. Only a whisper of
    // noise and a slight lift toward the light-facing (upper-left) corner —
    // a strong vertical gradient here is what makes iso tiles read as two
    // triangles instead of one surface.
    for (let y = 0; y < TILE_H; y++) {
      const { x0, x1 } = diamondSpan(y);
      for (let x = x0; x <= x1; x++) {
        // Work in tile space rather than pixel space: a and b run -1..1 along
        // the two isometric axes. Shading by pixel position instead is what
        // makes a diamond read as two triangles.
        const a = (x - TILE_W / 2) / (TILE_W / 2);
        const b = (y - TILE_H / 2) / (TILE_H / 2);
        const towardLight = -(a + b) * 0.5;
        const n = hash2(x >> 1, y >> 1, seed);
        const t = lit + towardLight * 0.045 + (n - 0.5) * grain;
        const idx = Math.max(0, Math.min(ramp.length - 1, Math.round(t * (ramp.length - 1))));
        this.set(x, y + yOff, ramp[idx]);
      }
    }
    return this;
  }

  /** Draw the two visible side walls of a tile block. */
  isoWalls(ramp, { wall = TILE_WALL, yOff = 0, seed = 0, lip = null } = {}) {
    // The earth block under the tile, drawn as a true vertical extrusion of
    // the diamond's lower silhouette.
    //
    // Drawing it as horizontal bars instead spills earth outside the diamond
    // at the lower rows, and that spill is exactly what showed through as
    // brown triangles between neighbouring tiles: the tile in front can only
    // cover what lies inside its own diamond.
    for (let x = 0; x < TILE_W; x++) {
      // Lowest row of the diamond that contains this column.
      let bottom = -1;
      for (let y = TILE_H - 1; y >= 0; y--) {
        const { x0, x1 } = diamondSpan(y);
        if (x >= x0 && x <= x1) { bottom = y; break; }
      }
      if (bottom < 0) continue;

      // The left face turns away from the light, the right face toward it.
      const lit = x < TILE_W / 2 ? 0.22 : 0.42;
      for (let k = 0; k < wall; k++) {
        // A turf lip over the earth: where a neighbour sits a pixel or two
        // lower, this is all of the wall that shows, and in bare earth it
        // drew a dotted brown line round every tile on the map.
        if (lip !== null && k < 3) {
          this.set(x, bottom + 1 + k + yOff, x < TILE_W / 2 ? lip : mix(lip, 0xffffff, 0.06));
          continue;
        }
        const fade = Math.min(0.9, k / 14);
        const grain = (hash2(x, k, seed) - 0.5) * 0.10;
        const t = Math.max(0, lit - fade * 0.16 + grain);
        this.set(x, bottom + 1 + k + yOff, rampAt(ramp, t));
      }
    }
    return this;
  }

  /** Rim the top face of the diamond with a lighter edge highlight. */
  isoRim(color, alpha = 1, yOff = 0) {
    for (let y = 0; y < TILE_H / 2; y++) {
      const { x0, x1 } = diamondSpan(y);
      this.set(x0, y + yOff, color, alpha);
      this.set(x0 + 1, y + yOff, color, alpha);
      this.set(x1, y + yOff, color, alpha);
      this.set(x1 - 1, y + yOff, color, alpha);
    }
    return this;
  }

  /** Register this canvas with Phaser under `key`. */
  toTexture(scene, key) {
    if (scene.textures.exists(key)) scene.textures.remove(key);
    scene.textures.addCanvas(key, this.canvas);
    return key;
  }
}

/**
 * Pick a ramp entry by a 0..1 position, dithering between the two entries it
 * falls between with the same 4x4 Bayer matrix the gradients use.
 *
 * `rampAt` rounds, which turns a smooth field into flat regions with hard
 * borders — fine for a gradient down a wall, wrong for water, where it made
 * the sea read as a lattice of soft blobs rather than a surface.
 */
export function ditherRamp(ramp, t, x, y) {
  const f = Math.max(0, Math.min(1, t)) * (ramp.length - 1);
  const i = Math.floor(f);
  if (i >= ramp.length - 1) return ramp[ramp.length - 1];
  return ramp[f - i > BAYER4[y & 3][x & 3] ? i + 1 : i];
}

/** Pick a ramp entry by a 0..1 position. */
export function rampAt(ramp, t) {
  const i = Math.round(t * (ramp.length - 1));
  return ramp[Math.max(0, Math.min(ramp.length - 1, i))];
}

/** Blend toward a colour without leaving the palette's feel. */
export function tinted(hex, target, t) {
  return mix(hex, target, t);
}

export { toHex };

// --- buildings & props helpers ---

/**
 * Pixels of screen height per world unit of real height. A world unit along
 * either ground axis projects to (2, 1) px, so a tile is 16 x 16 units, and
 * 16 units of height ("one tile tall") is ~39 px in true 2:1 dimetric.
 */
export const ISO_HU = 2.44;

/**
 * A tiny isometric solid rasteriser for the buildings, machines and props.
 *
 * World space is (a, b, h): `a` runs down-right on screen (+x tiles), `b`
 * down-left (+y tiles), both in units where a tile is 16 x 16, and `h` is
 * height in screen pixels. Faces are planar polygons; each covered pixel is
 * mapped back onto its plane and handed to a shader with its world position,
 * and a depth buffer sorts them. The result is exact 2:1 edges, walls whose
 * brick courses and windows follow the projection, and roofs, chimneys and
 * sails that occlude each other correctly — while every colour still comes
 * from a named ramp chosen by the shader, so it stays pixel art rather than a
 * render.
 */
export class IsoBuf {
  constructor(w, h, ox, oy) {
    this.w = w;
    this.h = h;
    this.ox = ox;
    this.oy = oy;
    this.col = new Int32Array(w * h).fill(-1);
    this.alpha = new Float32Array(w * h);
    this.depth = new Float32Array(w * h).fill(-1e9);
    /** Object tag per pixel: 0 empty; used by outline and night passes. */
    this.tag = new Uint8Array(w * h);
    /** 1 where the pixel emits light (lit windows), so night tint skips it. */
    this.glow = new Uint8Array(w * h);
  }

  clone() {
    const c = new IsoBuf(this.w, this.h, this.ox, this.oy);
    c.col.set(this.col);
    c.alpha.set(this.alpha);
    c.depth.set(this.depth);
    c.tag.set(this.tag);
    c.glow.set(this.glow);
    return c;
  }

  proj(a, b, h) {
    return [this.ox + 2 * (a - b), this.oy + a + b - h];
  }

  /** Write one pixel, depth-tested. */
  put(x, y, color, depth = 1e8, tag = 1, glow = 0, alpha = 1) {
    x |= 0; y |= 0;
    if (x < 0 || y < 0 || x >= this.w || y >= this.h || color < 0) return false;
    const i = y * this.w + x;
    if (depth < this.depth[i]) return false;
    this.depth[i] = depth;
    this.col[i] = color;
    this.alpha[i] = alpha;
    this.tag[i] = tag;
    this.glow[i] = glow;
    return true;
  }

  get(x, y) {
    if (x < 0 || y < 0 || x >= this.w || y >= this.h) return -1;
    const i = y * this.w + x;
    return this.alpha[i] > 0 ? this.col[i] : -1;
  }

  tagAt(x, y) {
    if (x < 0 || y < 0 || x >= this.w || y >= this.h) return 0;
    return this.tag[y * this.w + x];
  }

  /** Overwrite a pixel that is already drawn, keeping its depth. */
  recolor(x, y, color, glow = null) {
    if (x < 0 || y < 0 || x >= this.w || y >= this.h) return;
    const i = y * this.w + x;
    if (this.alpha[i] <= 0) return;
    this.col[i] = color;
    if (glow !== null) this.glow[i] = glow;
  }

  /**
   * Rasterise a planar polygon. `shade(a, b, h, x, y)` returns a colour or -1
   * to leave the pixel alone (for cut-outs such as gable profiles).
   */
  face(pts, shade, { tag = 1, bias = 0, glow = 0 } = {}) {
    const n = pts.length;
    let nx = 0; let ny = 0; let nz = 0;
    for (let i = 0; i < n; i++) {
      const p = pts[i];
      const q = pts[(i + 1) % n];
      nx += (p[1] - q[1]) * (p[2] + q[2]);
      ny += (p[2] - q[2]) * (p[0] + q[0]);
      nz += (p[0] - q[0]) * (p[1] + q[1]);
    }
    const ndir = nx + ny + 2 * nz;
    if (Math.abs(ndir) < 1e-7) return this;
    const k = nx * pts[0][0] + ny * pts[0][1] + nz * pts[0][2];
    const P = pts.map((p) => this.proj(p[0], p[1], p[2]));
    let minX = Infinity; let maxX = -Infinity; let minY = Infinity; let maxY = -Infinity;
    for (const [x, y] of P) {
      if (x < minX) minX = x;
      if (x > maxX) maxX = x;
      if (y < minY) minY = y;
      if (y > maxY) maxY = y;
    }
    const x0 = Math.max(0, Math.floor(minX));
    const x1 = Math.min(this.w - 1, Math.ceil(maxX));
    const y0 = Math.max(0, Math.floor(minY));
    const y1 = Math.min(this.h - 1, Math.ceil(maxY));
    const EPS = 1e-4;
    for (let y = y0; y <= y1; y++) {
      const sy = y + 0.5;
      // Crossings of this scanline with the polygon's edges.
      const xs = [];
      for (let i = 0; i < n; i++) {
        const [ax, ay] = P[i];
        const [bx, by] = P[(i + 1) % n];
        if ((ay <= sy && by > sy) || (by <= sy && ay > sy)) {
          xs.push(ax + ((sy - ay) / (by - ay)) * (bx - ax));
        }
      }
      if (xs.length < 2) continue;
      xs.sort((p, q) => p - q);
      for (let s = 0; s + 1 < xs.length; s += 2) {
        const xa = Math.max(x0, Math.ceil(xs[s] - 0.5 - EPS));
        const xb = Math.min(x1, Math.ceil(xs[s + 1] - 0.5 - EPS) - 1);
        for (let x = xa; x <= xb; x++) {
          const X = x + 0.5 - this.ox;
          const Y = sy - this.oy;
          const a0 = (Y + X / 2) / 2;
          const b0 = (Y - X / 2) / 2;
          const t = (k - nx * a0 - ny * b0) / ndir;
          const a = a0 + t;
          const b = b0 + t;
          const h = 2 * t;
          const d = a + b + h + bias;
          const i = y * this.w + x;
          if (d < this.depth[i]) continue;
          const c = shade(a, b, h, x, y);
          if (c === undefined || c < 0) continue;
          this.depth[i] = d;
          // Bit 24 marks an emissive pixel (a lit window) per pixel.
          this.col[i] = c & 0xffffff;
          this.alpha[i] = 1;
          this.tag[i] = tag;
          this.glow[i] = c > 0xffffff ? 1 : glow;
        }
      }
    }
    return this;
  }

  /** A depth-tested one-pixel 3D line, for thin members: bars, rails, stocks. */
  line3(p, q, color, { tag = 1, bias = 0.6, glow = 0, skipEnds = false } = {}) {
    const [xa, ya] = this.proj(p[0], p[1], p[2]);
    const [xb, yb] = this.proj(q[0], q[1], q[2]);
    let x0 = Math.floor(xa); let y0 = Math.floor(ya);
    const x1 = Math.floor(xb); const y1 = Math.floor(yb);
    const da = p[0] + p[1] + p[2];
    const db = q[0] + q[1] + q[2];
    const dx = Math.abs(x1 - x0);
    const dy = -Math.abs(y1 - y0);
    const sx = x0 < x1 ? 1 : -1;
    const sy = y0 < y1 ? 1 : -1;
    const steps = Math.max(dx, -dy) || 1;
    let err = dx + dy;
    let k = 0;
    for (;;) {
      if (!skipEnds || (k > 0 && k < steps)) {
        const col = typeof color === 'function' ? color(k / steps) : color;
        this.put(x0, y0, col, da + (db - da) * (k / steps) + bias, tag, glow);
      }
      if (x0 === x1 && y0 === y1) break;
      const e2 = 2 * err;
      if (e2 >= dy) { err += dy; x0 += sx; }
      if (e2 <= dx) { err += dx; y0 += sy; }
      k++;
    }
    return this;
  }

  /**
   * Selective outline: every empty pixel touching the silhouette takes a
   * dark, hue-tinted version of the colour it borders. Edges that face the
   * sun (the shape lies below or to the right of the empty pixel) get a
   * lighter line than the shaded ones.
   */
  selOut(ink, { dark = 0.66, lit = 0.42, skip = null } = {}) {
    const { w, h } = this;
    const out = [];
    for (let y = 0; y < h; y++) {
      for (let x = 0; x < w; x++) {
        const i = y * w + x;
        if (this.alpha[i] > 0) continue;
        let src = -1; let litSide = true; let best = 0;
        // Shade side first: the neighbour above or to the left owns the pixel.
        const cands = [[x, y - 1, false], [x - 1, y, false], [x + 1, y, true], [x, y + 1, true]];
        for (const [cx, cy, isLit] of cands) {
          if (cx < 0 || cy < 0 || cx >= w || cy >= h) continue;
          const j = cy * w + cx;
          if (this.alpha[j] < 1 || !this.tag[j]) continue;
          if (skip && skip(this.tag[j])) continue;
          const score = isLit ? 1 : 2;
          if (score > best) { best = score; src = this.col[j]; litSide = isLit; }
        }
        if (src >= 0) out.push([i, mix(src, ink, litSide ? lit : dark)]);
      }
    }
    for (const [i, c] of out) {
      this.col[i] = c;
      this.alpha[i] = 1;
      this.tag[i] = 255;
    }
    return this;
  }

  /**
   * Darken a pixel's colour one notch toward `ink` wherever it sits against
   * a surface further back — the crease that separates a chimney or gable
   * from the roof behind it without drawing an ink line.
   */
  creases(ink, amount = 0.3, minGap = 3, tags = null) {
    const { w, h } = this;
    const hits = new Set();
    const ok = (i) => this.alpha[i] > 0 && this.tag[i] !== 255 && (!tags || tags.has(this.tag[i]));
    for (let y = 0; y < h; y++) {
      for (let x = 0; x < w; x++) {
        const i = y * w + x;
        if (!ok(i)) continue;
        for (const j of [x + 1 < w ? i + 1 : -1, y + 1 < h ? i + w : -1]) {
          if (j < 0 || !ok(j)) continue;
          // The pixel further back is the one in the occluder's shadow.
          if (this.depth[j] - this.depth[i] > minGap) hits.add(i);
          else if (this.depth[i] - this.depth[j] > minGap) hits.add(j);
        }
      }
    }
    for (const j of hits) if (!this.glow[j]) this.col[j] = mix(this.col[j], ink, amount);
    return this;
  }

  /** Semi-transparent ground shadow, only where nothing else is drawn. */
  shadowPoly(pts, color, alpha) {
    const P = pts.map((p) => this.proj(p[0], p[1], p[2] || 0));
    let minY = Infinity; let maxY = -Infinity;
    for (const p of P) { minY = Math.min(minY, p[1]); maxY = Math.max(maxY, p[1]); }
    for (let y = Math.max(0, Math.floor(minY)); y <= Math.min(this.h - 1, Math.ceil(maxY)); y++) {
      const sy = y + 0.5;
      const xs = [];
      for (let i = 0; i < P.length; i++) {
        const [ax, ay] = P[i];
        const [bx, by] = P[(i + 1) % P.length];
        if ((ay <= sy && by > sy) || (by <= sy && ay > sy)) xs.push(ax + ((sy - ay) / (by - ay)) * (bx - ax));
      }
      xs.sort((p, q) => p - q);
      for (let s = 0; s + 1 < xs.length; s += 2) {
        for (let x = Math.max(0, Math.ceil(xs[s] - 0.5)); x <= Math.min(this.w - 1, Math.ceil(xs[s + 1] - 0.5) - 1); x++) {
          const i = y * this.w + x;
          if (this.alpha[i] > 0) continue;
          this.col[i] = color;
          this.alpha[i] = typeof alpha === 'function' ? alpha(x, y) : alpha;
          this.tag[i] = 0;
        }
      }
    }
    return this;
  }

  /** Pull every non-emissive pixel toward a night colour. */
  night(color, strength, keepGlow = true) {
    for (let i = 0; i < this.col.length; i++) {
      if (this.alpha[i] <= 0) continue;
      if (keepGlow && this.glow[i]) continue;
      this.col[i] = mix(this.col[i], color, strength);
    }
    return this;
  }

  /** Copy into a canvas-backed `Px`, ready for `toTexture`. */
  toPx() {
    const px = new Px(this.w, this.h);
    const img = px.ctx.createImageData(this.w, this.h);
    const d = img.data;
    for (let i = 0; i < this.col.length; i++) {
      const a = this.alpha[i];
      if (a <= 0 || this.col[i] < 0) continue;
      const c = this.col[i];
      d[i * 4] = (c >> 16) & 0xff;
      d[i * 4 + 1] = (c >> 8) & 0xff;
      d[i * 4 + 2] = c & 0xff;
      d[i * 4 + 3] = Math.round(Math.min(1, a) * 255);
    }
    px.ctx.putImageData(img, 0, 0);
    return px;
  }
}

/**
 * Stamp a hand-drawn pixel map. `rows` is an array of equal-length strings;
 * each character is looked up in `legend` (a colour, or absent / '.' for
 * transparent). Used for the small props, where every pixel is a decision.
 */
export function stampMap(buf, x0, y0, rows, legend, { depth = 1e8, tag = 1, flip = false } = {}) {
  for (let j = 0; j < rows.length; j++) {
    const row = rows[j];
    for (let i = 0; i < row.length; i++) {
      const ch = row[flip ? row.length - 1 - i : i];
      if (ch === '.' || ch === ' ') continue;
      const c = legend[ch];
      if (c === undefined) continue;
      buf.put(x0 + i, y0 + j, c, depth, tag);
    }
  }
}

// --- atmosphere helpers ---

/** Ordered-dither threshold (0..1) for a pixel, from the shared 4x4 Bayer matrix. */
export function bayerAt(x, y) {
  return BAYER4[y & 3][x & 3];
}

/**
 * A raw RGBA buffer for textures that touch every pixel (skies, haze, masks).
 * `Px.set` goes through a fillRect per pixel, which is fine for a sprite and
 * far too slow for a full-screen sky; this writes straight into ImageData and
 * uploads once.
 */
export class PixBuf {
  constructor(w, h) {
    this.w = w;
    this.h = h;
    this.canvas = document.createElement('canvas');
    this.canvas.width = w;
    this.canvas.height = h;
    this.ctx = this.canvas.getContext('2d', { willReadFrequently: true });
    this.ctx.imageSmoothingEnabled = false;
    this.img = this.ctx.createImageData(w, h);
    this.d = this.img.data;
  }

  set(x, y, color, alpha = 1) {
    if (x < 0 || y < 0 || x >= this.w || y >= this.h) return this;
    const i = (y * this.w + x) * 4;
    this.d[i] = (color >> 16) & 0xff;
    this.d[i + 1] = (color >> 8) & 0xff;
    this.d[i + 2] = color & 0xff;
    this.d[i + 3] = Math.round(Math.max(0, Math.min(1, alpha)) * 255);
    return this;
  }

  /** Alpha (0..255) at a pixel, 0 outside the buffer. */
  alphaAt(x, y) {
    if (x < 0 || y < 0 || x >= this.w || y >= this.h) return 0;
    return this.d[(y * this.w + x) * 4 + 3];
  }

  toTexture(scene, key, { linear = false } = {}) {
    this.ctx.putImageData(this.img, 0, 0);
    if (scene.textures.exists(key)) scene.textures.remove(key);
    const tex = scene.textures.addCanvas(key, this.canvas);
    // Only for light, never for sprites: a vignette or a glow is meant to be
    // a smooth gradient, and nearest filtering blows its few texels up into
    // visible blocks.
    if (linear && tex) tex.setFilter(1);
    return key;
  }
}

/** Pixels of an existing canvas-backed texture, or null. */
export function readPixels(scene, key) {
  if (!scene.textures.exists(key)) return null;
  const src = scene.textures.get(key).getSourceImage();
  if (!src || !src.getContext) return null;
  const w = src.width;
  const h = src.height;
  const data = src.getContext('2d', { willReadFrequently: true }).getImageData(0, 0, w, h).data;
  return { w, h, data, canvas: src };
}
