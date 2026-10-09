/**
 * Every sprite in Polderland is generated here at boot: terrain, water,
 * buildings, structures, props, particles and UI chrome. Nothing is loaded
 * from disk, so the whole game ships as a single JS bundle with no asset
 * pipeline, yet still reads as hand-placed pixel art.
 *
 * Conventions
 *  - Terrain textures are 64x44 with the diamond top occupying rows 0..31.
 *  - Object textures are anchored bottom-centre and sit on the tile centre.
 *  - Light comes from the upper-left; every ramp is indexed accordingly.
 */

import { P, mix, shade } from '../palette.js';
import { HOUSE_VARIANTS } from '../constants.js';
import {
  Px, TILE_W, TILE_H, TILE_WALL, TERRAIN_TEX_H, diamondSpan, hash2, rampAt,
  ditherRamp, IsoBuf, ISO_HU, stampMap,
} from './px.js';
import { PixBuf, bayerAt, readPixels } from './px.js';

const TAU = Math.PI * 2;

/* ================================================================
   TERRAIN
================================================================ */

/**
 * A flat diamond of one colour. Terrain tops used to be filled with per-pixel
 * noise across three ramp steps, which read as sand-paper at every zoom and
 * drew the tile grid wherever two noisy tiles met. A flat fill with a few
 * deliberate marks on it is how hand-drawn pixel terrain is actually made.
 */
function flatTop(px, color) {
  for (let y = 0; y < TILE_H; y++) {
    const { x0, x1 } = diamondSpan(y);
    px.hline(x0, x1, y, color);
  }
}

/**
 * Soft clusters of a second colour: flattened iso blobs with ragged edges,
 * kept clear of the rim so they never trace the tile outline.
 */
function mottle(px, color, seed, count, { rMin = 3, rMax = 6, inset = 6 } = {}) {
  for (let i = 0; i < count; i++) {
    const cy = 6 + Math.floor(hash2(i, seed, 101) * (TILE_H - 12));
    const { x0, x1 } = diamondSpan(cy);
    if (x1 - x0 < inset * 2 + 4) continue;
    const cx = x0 + inset + Math.floor(hash2(i, seed, 103) * (x1 - x0 - inset * 2));
    const rx = rMin + Math.floor(hash2(i, seed, 107) * (rMax - rMin + 1));
    const ry = Math.max(1, rx / 2);
    for (let y = Math.floor(cy - ry); y <= Math.ceil(cy + ry); y++) {
      if (y < 1 || y >= TILE_H - 1) continue;
      const span = diamondSpan(y);
      for (let x = cx - rx; x <= cx + rx; x++) {
        if (x <= span.x0 + 1 || x >= span.x1 - 1) continue;
        const dx = (x - cx) / rx;
        const dy = (y - cy) / ry;
        const r = dx * dx + dy * dy;
        // Solid core, broken rim: the rim is what makes it a clump of grass
        // rather than a stamped ellipse.
        if (r > 1 || (r > 0.55 && hash2(x, y, seed + i) < 0.5)) continue;
        px.set(x, y, color);
      }
    }
  }
}

/** Pick a point inside the diamond, clear of the rim by `inset`. */
function innerPoint(seed, i, salt, inset = 7) {
  const y = inset - 2 + Math.floor(hash2(i, seed, salt) * (TILE_H - inset * 2 + 2));
  const { x0, x1 } = diamondSpan(y);
  if (x1 - x0 < inset * 2 + 2) return null;
  return { x: x0 + inset + Math.floor(hash2(i, seed, salt + 1) * (x1 - x0 - inset * 2)), y };
}

/**
 * Tufts, flowers and pebbles on a grass diamond. A tuft is the classic
 * pixel-art "v": two lit blade tips over a darker root.
 */
function scatterGrassDetail(px, seed, {
  flowers = 0, tufts = 7, dry = false, base = null,
} = {}) {
  const ramp = dry ? P.grassDry : P.grass;
  const b = base ?? ramp[3];
  const tip = mix(b, ramp[ramp.length - 1], 0.55);
  const root = mix(b, ramp[1], 0.55);
  for (let i = 0; i < tufts; i++) {
    const p = innerPoint(seed, i, 11);
    if (!p) continue;
    px.set(p.x - 1, p.y - 1, tip);
    px.set(p.x + 1, p.y - 1, tip);
    px.set(p.x, p.y, root);
  }
  for (let i = 0; i < flowers; i++) {
    const p = innerPoint(seed, i, 47, 9);
    if (!p) continue;
    const petal = hash2(i, seed, 53) > 0.5 ? P.tulipYellow[2] : P.ui.white;
    px.set(p.x, p.y - 1, petal);
    px.set(p.x, p.y, root);
  }
}

function makeGrassTile(scene, key, seed, opts = {}) {
  const px = new Px(TILE_W, TERRAIN_TEX_H);
  const ramp = opts.dry ? P.grassDry : P.grass;
  const base = opts.base ?? ramp[3];
  flatTop(px, base);
  // Darker clumps first, then a few sunlit ones over them: two tones either
  // side of the base, never the whole ramp.
  mottle(px, mix(base, ramp[2], 0.42), seed, opts.dark ?? 4);
  mottle(px, mix(base, ramp[4], 0.34), seed + 7, opts.light ?? 3, { rMin: 2, rMax: 4 });
  px.isoWalls(P.wood, { seed, lip: mix(base, ramp[1], 0.2) });
  scatterGrassDetail(px, seed, { ...opts, base });
  px.toTexture(scene, key);
}

/**
 * Unreclaimed polder floor: a wild meadow of rushes nobody has broken yet.
 *
 * It was drawn olive-brown at first, which set it apart from pasture but
 * turned the opening screen — three quarters of the map starts like this —
 * into a sheet of mud. It stays green now and reads as different by texture
 * instead: a shade darker and cooler than the grazed fields, and standing
 * thick with clumps of rush whose pale seed heads catch the light.
 */
function makeRoughTile(scene, key, seed) {
  const px = new Px(TILE_W, TERRAIN_TEX_H);
  const base = mix(P.grass[3], P.grass[2], 0.45);
  flatTop(px, base);
  mottle(px, mix(base, P.grass[1], 0.4), seed, 5);
  mottle(px, mix(base, P.grassDry[3], 0.3), seed + 5, 3, { rMin: 2, rMax: 4 });
  px.isoWalls(P.wood, { seed, lip: mix(base, P.grass[1], 0.2) });
  for (let i = 0; i < 9; i++) {
    const p = innerPoint(seed, i, 71, 8);
    if (!p) continue;
    // A clump: three blades of uneven height, darker at the root.
    for (const [dx, h] of [[-1, 2], [0, 4], [1, 3]]) {
      for (let k = 0; k < h; k++) {
        px.set(p.x + dx, p.y - k, k === 0 ? P.grass[1] : k === h - 1 ? P.grass[4] : P.grass[2]);
      }
    }
    if (hash2(i, seed, 79) > 0.45) px.set(p.x, p.y - 4, P.grassDry[4]);
  }
  px.toTexture(scene, key);
}

/** A ploughed field: parallel furrows running along the iso grid. */
function makeFieldTile(scene, key, seed, crop) {
  const px = new Px(TILE_W, TERRAIN_TEX_H);
  px.isoTop(P.grassDry, { seed, lit: 0.66, grain: 0.03 });
  px.isoWalls(P.wood, { seed, lip: mix(P.grassDry[3], P.grassDry[1], 0.25) });

  // Furrows follow the +x tile direction (down-right on screen).
  for (let f = -8; f < 9; f++) {
    const startX = 32 + f * 6;
    for (let k = 0; k < 20; k++) {
      const x = startX - k * 2;
      const y = k;
      if (y >= TILE_H) break;
      const { x0, x1 } = diamondSpan(y);
      if (x < x0 || x > x1) continue;
      const soil = crop ? P.grassDry[1] : P.wood[2];
      px.set(x, y, soil);
      px.set(x + 1, y, soil);
      if (crop) {
        const c = crop === 'red' ? P.tulipRed : P.tulipYellow;
        const n = hash2(x, y, seed);
        if (n > 0.35) {
          px.set(x, y - 1, c[2]);
          px.set(x + 1, y - 1, c[1]);
        }
      }
    }
  }
  px.toTexture(scene, key);
}

function makeSandTile(scene, key, seed) {
  const px = new Px(TILE_W, TERRAIN_TEX_H);
  flatTop(px, mix(P.sand[3], P.sand[2], 0.25));
  mottle(px, mix(P.sand[3], P.sand[2], 0.7), seed, 4);
  px.isoWalls(P.sand, { seed, lip: mix(P.sand[3], P.sand[1], 0.25) });
  // Wind ripples.
  for (let i = 0; i < 6; i++) {
    const y = 5 + Math.floor(hash2(i, seed, 3) * (TILE_H - 10));
    const { x0, x1 } = diamondSpan(y);
    const len = 6 + Math.floor(hash2(i, seed, 9) * 10);
    const x = x0 + 3 + Math.floor(hash2(i, seed, 5) * Math.max(1, x1 - x0 - len - 6));
    px.hline(x, Math.min(x + len, x1 - 2), y, P.sand[1], 0.55);
  }
  // Marram grass clumps, the plant that actually holds a Dutch dune together.
  for (let i = 0; i < 7; i++) {
    const y = 5 + Math.floor(hash2(i, seed, 23) * (TILE_H - 10));
    const { x0, x1 } = diamondSpan(y);
    if (x1 - x0 < 12) continue;
    const x = x0 + 5 + Math.floor(hash2(i, seed, 29) * (x1 - x0 - 10));
    px.set(x, y, P.grass[2]);
    px.set(x, y - 1, P.grass[3]);
    px.set(x + 1, y - 1, P.grass[1]);
  }

  // Pebbles.
  for (let i = 0; i < 3; i++) {
    const y = 6 + Math.floor(hash2(i, seed, 17) * (TILE_H - 12));
    const { x0, x1 } = diamondSpan(y);
    const x = x0 + 5 + Math.floor(hash2(i, seed, 19) * Math.max(1, x1 - x0 - 10));
    px.set(x, y, P.stone[2]);
    px.set(x + 1, y, P.stone[1]);
  }
  px.toTexture(scene, key);
}

/**
 * Animated water tile. `ramp` chooses open sea versus inland canal/flood
 * water; `frame` shifts the wave phase so four textures loop seamlessly.
 */
/** Tiles three across share one long swell, so there are three variants. */
export const SEA_VARIANTS = 3;
const SWELL_W = TILE_W * SEA_VARIANTS;
/** Where on the swell the wind ripple shows, and where it breaks into foam. */
const SEA_RIPPLE = 0.46;
const SEA_CREST = 1.18;

/**
 * Which swell variant a map tile takes. Derived from where the tile's centre
 * falls in the long wave: stepping +1 in tx moves (32, 16) in world pixels and
 * +1 in ty moves (-32, 16), which work out to two thirds and one third of the
 * swell's period.
 */
export function seaVariant(tx, ty) {
  return ((2 * tx + ty) % SEA_VARIANTS + SEA_VARIANTS) % SEA_VARIANTS;
}

/**
 * The sea surface, as one function of world position and time.
 *
 * Every term's wave numbers are chosen so the phase advances by a whole
 * number over a tile step — the neighbour sits at (32, 16) — which is what
 * lets the pattern continue unbroken from tile to tile and into the off-map
 * plane. `wx`, `wy` are world pixels, so a tile passes its own offset in and
 * the plane passes its texture coordinates, and the two are the same sea.
 *
 * Two swells and nothing else: one a tile across, one three tiles across and
 * running the other way. Both are kept quiet — the shading only has to move by
 * a fraction of a ramp step — because the detail on this surface is not meant
 * to come from the wave at all. It comes from the ripple dashes in
 * `seaDetail`, which ride the swell's upslope.
 *
 * Two earlier attempts are worth not repeating. Crossing two ripples of the
 * same short wavelength lays a perfectly regular diamond lattice over the
 * whole sea, which reads as chain mail. Running a single wave at full
 * amplitude through a rounded ramp lookup turns it into big almond lobes with
 * hard edges, which reads as scales. Low amplitude plus dithering is what
 * makes it read as water.
 */
function seaWave(wx, wy, phase) {
  return Math.sin(TAU * (wx / TILE_W + wy / TILE_H) + phase)
    + Math.sin(TAU * (wx / SWELL_W - wy / TILE_H) + phase * 0.62) * 0.55;
}

function makeWaterTile(scene, key, ramp, frame, {
  crest = true, alpha = 1, still = false, variant = 0, shoal = 0,
} = {}) {
  const px = new Px(TILE_W, TERRAIN_TEX_H);
  const phase = (frame / 4) * Math.PI * 2;
  // The tile's own offset into the long swell, in world pixels.
  const ox = variant * TILE_W - TILE_W / 2;
  const oy = -TILE_H / 2;

  for (let y = 0; y < TILE_H; y++) {
    const { x0, x1 } = diamondSpan(y);
    for (let x = x0; x <= x1; x++) {
      if (still) {
        // Flat water with a slow, pale band drifting across it: a canal is
        // the calmest surface on the map and any dither on it read as mesh.
        const w = Math.sin(TAU * (x / TILE_W + y / TILE_H) + phase)
          + Math.sin(TAU * (2 * x / TILE_W) + phase * 1.6) * 0.5;
        const c = w > 1.05 ? mix(ramp[2], ramp[3], 0.55) : w < -1.1 ? mix(ramp[2], ramp[1], 0.35) : ramp[2];
        px.set(x, y, c, alpha);
        continue;
      }
      // Dithered rather than rounded: the swell only has to move the value by
      // a fraction of a ramp step for the surface to read, and rounding that
      // turns it into flat lobes with hard edges.
      px.set(x, y, seaShade(ramp, x + ox, y + oy, phase, frame, 0), alpha);
    }
  }

  if (still) {
    // Glitter on flat water: short highlights on the crest of each ripple.
    for (let y = 2; y < TILE_H - 2; y++) {
      const { x0, x1 } = diamondSpan(y);
      for (let x = x0 + 2; x < x1 - 2; x++) {
        const w = Math.sin(TAU * (x / TILE_W + y / TILE_H) + phase);
        // Sparse, and placed by hash rather than on a stride: a highlight
        // every third pixel laid a regular lattice over the water.
        if (w > 0.7 && hash2(x >> 1, y, frame + 5) > 0.93) {
          px.hline(x, x + 1, y, P.foam[1], 0.45);
          x += 3;
        }
      }
    }
  }

  if (crest) {
    for (let y = 1; y < TILE_H - 1; y++) {
      const { x0, x1 } = diamondSpan(y);
      for (let x = x0 + 1; x < x1 - 2; x++) {
        seaDetail(px, x, y, x + ox, y + oy, phase, alpha);
      }
    }
  }

  px.toTexture(scene, key);
}

/**
 * Smoothed value noise that wraps exactly over a `w` x `h` canvas: sample an
 * `n` x `n` lattice of hashes, take the lattice modulo n so the right edge
 * meets the left, and smoothstep between them so the blobs have no creases.
 */
function wrapNoise(x, y, w, h, n, seed) {
  const at = (gx, gy) => hash2(((gx % n) + n) % n, ((gy % n) + n) % n, seed);
  const fx = (x / w) * n;
  const fy = (y / h) * n;
  const x0 = Math.floor(fx);
  const y0 = Math.floor(fy);
  const tx = fx - x0;
  const ty = fy - y0;
  const sx = tx * tx * (3 - 2 * tx);
  const sy = ty * ty * (3 - 2 * ty);
  const a = at(x0, y0) + (at(x0 + 1, y0) - at(x0, y0)) * sx;
  const b = at(x0, y0 + 1) + (at(x0 + 1, y0 + 1) - at(x0, y0 + 1)) * sx;
  return a + (b - a) * sy;
}

/**
 * The colour of one pixel of sea. The Bayer matrix alone lays a visible
 * diagonal weave over a field this uniform, so the value is jittered by a
 * pixel hash first, which scatters the dither without touching its average.
 */
function seaShade(ramp, wx, wy, phase, frame, deep) {
  const w = seaWave(wx, wy, phase);
  // Centred between the two closest steps of the ramp and kept to a small
  // swing, so the dither is a soft sheen rather than a dark-and-light weave
  // over every pixel of the ocean.
  const jitter = (hash2(wx, wy, frame * 31 + 3) - 0.5) * 0.03;
  return ditherRamp(ramp, 0.54 + w * 0.065 + deep + jitter, wx, wy);
}

/**
 * What makes the surface read as water: short pale dashes lying along the
 * swell's upslope, and rarer white ones where it runs highest.
 *
 * They are placed by a hash of world position, which never moves, and gated
 * on the wave, which does — so the ripple sweeps across the sea as the swell
 * travels without any of it being animated directly. Tracing the crest
 * contour instead drew long smooth arcs that read as strokes drawn on top of
 * the water rather than as the water itself.
 */
function seaDetail(px, x, y, wx, wy, phase, alpha = 1) {
  const w = seaWave(wx, wy, phase);
  if (w < SEA_RIPPLE) return;
  if (w > SEA_CREST && hash2(wx >> 1, wy, 31) > 0.87) {
    px.set(x, y, P.foam[0], alpha * 0.4);
    px.set(x + 1, y, P.foam[0], alpha * 0.24);
    return;
  }
  if (hash2(wx >> 1, wy, 19) > 0.9) {
    px.set(x, y, P.sea[5], alpha * 0.3);
    px.set(x + 1, y, P.sea[5], alpha * 0.3);
    px.set(x + 2, y, P.sea[4], alpha * 0.2);
  }
}

/** How much paler each ring of mapped sea is than the open water beyond. */
export const SHOAL = [0.05, 0.13];

/** How big a patch of open sea is drawn before the plane repeats it. */
const OPEN_W = 384;
const OPEN_H = 192;

/**
 * The open sea beyond the map, as one rectangular patch the scene repeats
 * under everything else. It is the same `seaWave` the map's own water is cut
 * from — every term's period divides this canvas — so there is no seam where
 * the tiled diamonds stop and the plane begins: the ocean simply carries on
 * to the edge of the screen, instead of the flat background colour the camera
 * used to show there.
 *
 * The waves alone would still repeat every 192 x 32, which at 3x zoom is
 * several copies per screen and reads as wallpaper. A slow noise field over
 * the top varies the depth across the whole patch, so what repeats is 384 x
 * 192 — about one patch per screen — and repeats without an obvious motif.
 */
function makeOpenSeaTile(scene, key, frame) {
  const px = new Px(OPEN_W, OPEN_H);
  const phase = (frame / 4) * Math.PI * 2;
  // Precomputed per pixel: the noise is the expensive part and the foam pass
  // below needs the same values.
  const deep = new Float32Array(OPEN_W * OPEN_H);
  for (let y = 0; y < OPEN_H; y++) {
    for (let x = 0; x < OPEN_W; x++) {
      deep[y * OPEN_W + x] = (wrapNoise(x, y, OPEN_W, OPEN_H, 3, 61) - 0.5) * 0.2
        + (wrapNoise(x, y, OPEN_W, OPEN_H, 7, 29) - 0.5) * 0.08;
    }
  }

  for (let y = 0; y < OPEN_H; y++) {
    for (let x = 0; x < OPEN_W; x++) {
      px.set(x, y, seaShade(P.sea, x, y, phase, frame, deep[y * OPEN_W + x]));
    }
  }
  for (let y = 1; y < OPEN_H; y++) {
    // The deep patches are calmer, so they carry less ripple.
    for (let x = 0; x < OPEN_W - 2; x++) {
      if (deep[y * OPEN_W + x] < -0.02) continue;
      seaDetail(px, x, y, x, y, phase);
    }
  }
  px.toTexture(scene, key);
}

/**
 * Cloud shadows: a seamless field of soft dark blobs the scene drifts across
 * the whole view under a multiply blend. Two octaves of smoothed value noise,
 * thresholded so most of the texture is clear and the shadows arrive as
 * separate clouds rather than an even haze.
 */
function makeCloudShadow(scene, key) {
  const W = 256;
  const H = 128;
  const px = new PixBuf(W, H);

  // Three octaves on a lattice that is itself 2:1, so the clouds lie flat on
  // the isometric ground rather than standing up as round blots. Thresholded
  // into two flat levels — a dense core and a lighter fringe — which is how a
  // pixel artist would paint a passing shadow: shapes, not noise. White, so
  // the scene can tint it cool and multiply it over the land.
  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      const n = wrapNoise(x, y, W, H, 4, 17) * 0.6
        + wrapNoise(x, y, W, H, 8, 91) * 0.28
        + wrapNoise(x, y, W, H, 16, 7) * 0.12;
      const k = n - 0.5;
      if (k > 0.06) px.set(x, y, 0xffffff, 1);
      else if (k > 0.03) px.set(x, y, 0xffffff, 0.5);
    }
  }
  px.toTexture(scene, key);
}

/**
 * A plain contact ellipse, kept for anything that has no sprite to derive a
 * shadow from. Everything standing on the map uses `castShadowKey` instead.
 */
function makeShadow(scene, key) {
  const W = 32;
  const H = 16;
  const px = new PixBuf(W, H);
  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      const dx = (x + 0.5 - W / 2) / (W / 2);
      const dy = (y + 0.5 - H / 2) / (H / 2);
      // Hard-edged, no penumbra: a blurred shadow under crisp pixel art
      // reads as a smudge from a different game.
      if (dx * dx + dy * dy < 1) px.set(x, y, 0xffffff, 1);
    }
  }
  px.toTexture(scene, key);
}

/**
 * A screen-space vignette. Very low contrast — its whole job is to stop the
 * open sea reading as an evenly lit sheet out to the corners of the display.
 * Filtered smoothly: it is light, not a sprite.
 */
function makeVignette(scene, key) {
  const N = 128;
  const px = new PixBuf(N, N);
  for (let y = 0; y < N; y++) {
    for (let x = 0; x < N; x++) {
      const dx = (x + 0.5) / N * 2 - 1;
      const dy = (y + 0.5) / N * 2 - 1;
      const r = Math.min(1, Math.sqrt(dx * dx + dy * dy) / Math.SQRT2);
      // Measured: at 0.42 this cost eight points of mean luminance across the
      // playfield and bought less than one point of contrast back. It is here
      // to stop the corners glowing, not to set a mood.
      const a = Math.pow(r, 2.4) * 0.2;
      px.set(x, y, 0x10162c, a);
    }
  }
  px.toTexture(scene, key, { linear: true });
}

/**
 * Flood overlay drawn on top of a land tile. Kept deliberately greener and
 * more transparent than the open sea so the player can read depth through it.
 */
function makeFloodTile(scene, key, frame) {
  const px = new Px(TILE_W, TERRAIN_TEX_H);
  const phase = (frame / 4) * Math.PI * 2;
  for (let y = 0; y < TILE_H; y++) {
    const { x0, x1 } = diamondSpan(y);
    for (let x = x0; x <= x1; x++) {
      const w = Math.sin(TAU * (x / TILE_W + y / TILE_H) + phase)
        + Math.sin(TAU * (2 * x / TILE_W - 2 * y / TILE_H) + phase * 1.3) * 0.45;
      px.set(x, y, rampAt(P.flood, 0.52 + w * 0.16));
    }
  }
  // A bright waterline around the tile: the edge of the flood has to be
  // legible from across the map, not inferred from a change of green.
  for (let y = 0; y < TILE_H; y++) {
    const { x0, x1 } = diamondSpan(y);
    const c = y < TILE_H / 2 ? P.foam[0] : rampAt(P.flood, 0.85);
    px.set(x0, y, c, 0.8);
    px.set(x1, y, c, 0.8);
  }

  // Surface glints so shallow flooding still reads as moving water.
  for (let i = 0; i < 10; i++) {
    const y = 3 + Math.floor(hash2(i, frame, 71) * (TILE_H - 6));
    const { x0, x1 } = diamondSpan(y);
    const x = x0 + 2 + Math.floor(hash2(i, frame, 83) * Math.max(1, x1 - x0 - 4));
    if (Math.sin(TAU * (x / TILE_W + y / TILE_H) + phase) > 0.5) {
      px.hline(x, x + 1, y, P.foam[2], 0.5);
    }
  }
  px.toTexture(scene, key);
}

/** Rubble left behind when a building is lost to the water. */
function makeRubbleTile(scene, key) {
  const px = new Px(TILE_W, TERRAIN_TEX_H);
  flatTop(px, P.grassDry[2]);
  mottle(px, P.grassDry[1], 99, 4);
  px.isoWalls(P.wood, { seed: 99 });
  for (let i = 0; i < 26; i++) {
    const y = 6 + Math.floor(hash2(i, 5, 31) * (TILE_H - 12));
    const { x0, x1 } = diamondSpan(y);
    const x = x0 + 4 + Math.floor(hash2(i, 7, 37) * Math.max(1, x1 - x0 - 8));
    const c = rampAt(P.brick, hash2(i, 11, 41));
    px.rect(x, y, 2, 1, c);
    px.set(x, y - 1, shade(c, 20));
  }
  px.toTexture(scene, key);
}

export function buildTerrainTextures(scene) {
  // Three bands of pasture, a shade apart, keyed to how low the ground lies:
  // the lowest a little cooler and damper, the highest a little sunnier.
  const BANDS = [
    ['hi', mix(P.grass[3], P.grass[4], 0.16)],
    ['mid', P.grass[3]],
    ['lo', mix(P.grass[3], P.grass[2], 0.3)],
  ];
  for (const [name, base] of BANDS) {
    for (let i = 0; i < 4; i++) {
      makeGrassTile(scene, `t_grass_${name}_${i}`, (name.charCodeAt(0) * 7) + i * 17 + 3, {
        base, flowers: i === 1 ? 3 : 0, tufts: 4 + i,
      });
    }
  }
  // Ground that has been under water keeps a sour, dark look once drained.
  makeGrassTile(scene, 't_grass_wet', 71, {
    base: mix(P.grass[2], P.flood[1], 0.3), tufts: 3, light: 1,
  });
  makeGrassTile(scene, 't_grass_dry', 83, { dry: true, tufts: 5 });
  // Unreclaimed polder floor: rough, rushy ground nobody has broken yet. It
  // has to read as clearly poorer than pasture at a glance, because the whole
  // point of draining is watching this turn into the fields next to it.
  for (let i = 0; i < 4; i++) makeRoughTile(scene, `t_rough_${i}`, 137 + i * 19);
  for (let i = 0; i < 3; i++) {
    makeFieldTile(scene, `t_field_plain_${i}`, 5 + i * 13, null);
    makeFieldTile(scene, `t_field_red_${i}`, 29 + i * 13, 'red');
    makeFieldTile(scene, `t_field_yellow_${i}`, 41 + i * 13, 'yellow');
  }
  for (let stage = 0; stage < 3; stage++) {
    for (let i = 0; i < 2; i++) makeMudTile(scene, `t_mud${stage}_${i}`, 211 + stage * 31 + i * 7, stage);
  }
  makeFence(scene, 's_fence');
  makeSandTile(scene, 't_sand_0', 13);
  makeSandTile(scene, 't_sand_1', 27);
  makeRubbleTile(scene, 't_rubble');

  for (let f = 0; f < 4; f++) {
    for (let v = 0; v < SEA_VARIANTS; v++) {
      // The two rings of sea inside the map are the shelf the polder sits
      // behind: paler the closer they come to the shore. It is what the
      // coast of a reclaimed polder actually looks like, and it frames the
      // island against an ocean that now fills the rest of the screen.
      SHOAL.forEach((shoal, ring) => {
        makeWaterTile(scene, `t_sea${ring}_${f}_${v}`, P.sea, f, {
          crest: true, variant: v, shoal,
        });
      });
    }
    makeOpenSeaTile(scene, `fx_opensea_${f}`, f);
    makeWaterTile(scene, `t_canal_${f}`, P.canal, f, { crest: false, still: true });
    makeFloodTile(scene, `t_flood_${f}`, f);
  }
}

/* ================================================================
   TIDAL FLAT (the Dollard)
================================================================ */

/**
 * The flat in front of the sea dike, in the three states silt takes it
 * through: bare wad under a skin of water at low tide, higher slik where the
 * first glasswort takes hold, and kwelder, salt marsh grey-green with sea
 * lavender, high enough to dike in. The stage is what the player watches to
 * know when the land is ready, so the three must read apart at a glance.
 */
function makeMudTile(scene, key, seed, stage) {
  const px = new Px(TILE_W, TERRAIN_TEX_H);
  const wet = mix(P.sand[1], P.sea[2], 0.35);
  // Wet wad is the colour of the sand under a film of sea; slik is drier and
  // paler; marsh has turned green. Kept light: dark mud read as deep water.
  // Marsh stays close to the slik it grew from: a strong green read as a
  // card of lawn laid on the mud, not as the flat turning to marsh.
  const slik = mix(P.sand[3], P.sand[2], 0.35);
  const base = [mix(P.sand[2], P.flood[2], 0.28), slik, mix(slik, P.grass[2], 0.5)][stage];
  flatTop(px, base);
  if (stage < 2) {
    // Standing water in the hollows, catching the sky.
    mottle(px, mix(base, P.flood[3], stage === 0 ? 0.5 : 0.3), seed, stage === 0 ? 5 : 3, { rMin: 2, rMax: 5 });
    // A tidal creek winding across: the gully the ebb drains down.
    let x = 16 + Math.floor(hash2(1, seed, 3) * 32);
    for (let y = 3; y < TILE_H - 3; y++) {
      const { x0, x1 } = diamondSpan(y);
      x += Math.round((hash2(y, seed, 7) - 0.5) * 2.4);
      if (x <= x0 + 1 || x >= x1 - 2) continue;
      px.set(x, y, mix(wet, P.flood[2], 0.4));
      px.set(x + 1, y, mix(wet, P.flood[4], 0.3), 0.7);
    }
    // Ripple marks the tide leaves in the mud.
    for (let i = 0; i < 5; i++) {
      const y = 5 + Math.floor(hash2(i, seed, 13) * (TILE_H - 10));
      const { x0, x1 } = diamondSpan(y);
      const len = 5 + Math.floor(hash2(i, seed, 17) * 8);
      const xs = x0 + 3 + Math.floor(hash2(i, seed, 19) * Math.max(1, x1 - x0 - len - 6));
      px.hline(xs, Math.min(xs + len, x1 - 2), y, mix(base, P.sand[3], 0.35), 0.6);
    }
  } else {
    // Patches of denser growth and bare slik between them.
    mottle(px, mix(base, P.grass[2], 0.4), seed, 5);
    mottle(px, mix(base, slik, 0.6), seed + 3, 3, { rMin: 2, rMax: 4 });
    // The rim frays into slik, so neighbouring tiles run into each other
    // instead of meeting at a hard diamond edge.
    for (let y = 0; y < TILE_H; y++) {
      const { x0, x1 } = diamondSpan(y);
      for (let x = x0; x <= x1; x++) {
        const d = Math.min(x - x0, x1 - x, y, TILE_H - 1 - y);
        if (d < 3 && (x + y) % 2 === 0 && hash2(x, y, seed) < 0.75 - d * 0.2) px.set(x, y, slik, 0.7);
      }
    }
    // Small creeks still cut the marsh.
    for (let y = 8; y < 20; y++) {
      const x = 26 + Math.round(Math.sin(y * 0.7 + seed) * 3);
      px.set(x, y, mix(wet, P.flood[3], 0.4));
    }
  }
  // Vegetation: glasswort on the slik, sea lavender and grass on the marsh.
  const plants = [0, 5, 12][stage];
  for (let i = 0; i < plants; i++) {
    const pt = innerPoint(seed, i, 61, 7);
    if (!pt) continue;
    if (stage === 1) {
      px.set(pt.x, pt.y, P.tulipRed[0]);
      px.set(pt.x, pt.y - 1, mix(P.grass[2], P.tulipRed[1], 0.4));
    } else {
      px.set(pt.x - 1, pt.y - 1, P.grass[4]);
      px.set(pt.x + 1, pt.y - 1, P.grass[4]);
      px.set(pt.x, pt.y, P.grass[1]);
      if (hash2(i, seed, 67) > 0.55) px.set(pt.x, pt.y - 2, 0x9a7bc4);
    }
  }
  px.isoWalls(P.sand, { seed, lip: mix(base, P.sand[1], 0.3) });
  px.toTexture(scene, key);
}

/**
 * A kwelderwerk: brushwood dams staked out round a square of flat, the field
 * the tide is slowed in so its silt can settle. Stakes along the four edges,
 * bound brushwood between them.
 */
function makeFence(scene, key) {
  anchor(key, TILE_W / 2, TILE_H / 2);
  const px = new Px(TILE_W, TERRAIN_TEX_H);
  const inset = 5;
  const corners = [[32, inset / 2], [TILE_W - inset, 16], [32, TILE_H - inset / 2], [inset, 16]];
  for (let e = 0; e < 4; e++) {
    const [ax, ay] = corners[e];
    const [bx, by] = corners[(e + 1) % 4];
    const n = 11;
    for (let i = 0; i <= n; i++) {
      const x = Math.round(ax + ((bx - ax) * i) / n);
      const y = Math.round(ay + ((by - ay) * i) / n);
      // Brushwood bundle along the line, then a stake standing out of it.
      px.set(x, y, P.wood[1]);
      px.set(x + 1, y, P.wood[2]);
      if (i % 2 === 0) {
        px.vline(x, y - 3, y - 1, P.wood[3]);
        px.set(x, y - 3, P.wood[4]);
      }
    }
  }
  px.toTexture(scene, key);
}

/* ================================================================
   ANCHORS

   Every world sprite declares where its tile-centre sits inside its own
   texture, so the scene can place all of them with one rule.
================================================================ */

export const ANCHORS = {};

function anchor(key, x, y) {
  ANCHORS[key] = { x, y };
}

/** Terrain textures all share the same anchor. */
function registerTerrainAnchors(scene) {
  for (const key of scene.textures.getTextureKeys()) {
    if (key.startsWith('t_')) anchor(key, TILE_W / 2, TILE_H / 2);
  }
}

/**
 * An isometric cuboid: a diamond top face and the two side faces below it,
 * each a fixed step apart on the ramp so the volume reads without any
 * per-pixel lighting.
 *
 * Most of the buildings here are drawn as flat elevations with a roof stuck
 * on, which works for a house because the gable is doing the work. It does
 * not work for masonry — a sluice drawn that way is three rectangles, which
 * is exactly what the old one was.
 *
 * `cx, cy` is the centre of the top face, `hw`/`hh` its half extents, `h` how
 * far the box drops below it.
 */
function isoBox(px, cx, cy, hw, hh, h, ramp, {
  top = 0.86, left = 0.52, right = 0.3, courses = 0, seed = 1,
} = {}) {
  for (let x = Math.round(cx - hw); x <= Math.round(cx + hw); x++) {
    const u = Math.abs(x - cx) / hw;
    const spread = hh * (1 - u);
    const yTop = Math.round(cy - spread);
    const yBot = Math.round(cy + spread);
    for (let y = yTop; y <= yBot; y++) {
      px.set(x, y, rampAt(ramp, top + (hash2(x, y, seed) - 0.5) * 0.12));
    }
    const face = x < cx ? left : right;
    for (let d = 1; d <= h; d++) {
      // Courses of masonry: a darker line every few rows, staggered so the
      // blocks do not line up into columns.
      const y = yBot + d;
      const joint = courses > 0
        && ((d % courses === 0) || ((x + Math.floor(d / courses) * 3) % 7 === 0));
      px.set(x, y, rampAt(ramp, face + (hash2(x, d, seed + 5) - 0.5) * 0.14 - (joint ? 0.16 : 0)));
    }
  }
}

/**
 * A leat: the open watercourse that carries the boezem from the canal
 * network out to the sluice in the ring.
 *
 * An outlet may be built up to three tiles from the nearest canal, and until
 * now nothing was drawn between them — a gate in the dike and, somewhere off
 * to one side, water it had no visible connection to. These are half
 * segments, running from the tile centre out to one edge, so any path the
 * scene finds composes from them: a straight run draws two opposite halves, a
 * corner draws two adjacent ones.
 */
function makeLeat(scene, key, dirKey) {
  const px = new Px(TILE_W, TERRAIN_TEX_H);
  // Direction from the tile centre to the middle of that edge, in the iso
  // projection: +x goes down-right, +y down-left.
  const DIRS = {
    xp: [16, 8], xm: [-16, -8], yp: [-16, 8], ym: [16, -8],
  };
  const [ex, ey] = DIRS[dirKey];
  const cx = TILE_W / 2;
  const cy = TILE_H / 2;
  const HALF = 3;            // half-width of the cut, across the run

  // The across-run offset is the run direction turned a quarter turn in the
  // same projection, which for a 2:1 grid is (-ey * 2, ex / 2) normalised.
  const len = Math.hypot(ex, ey);
  const nx = (-ey / len) * 2;
  const ny = (ex / len) * 0.5;
  const N = 40;
  for (let i = 0; i <= N; i++) {
    const u = i / N;
    const bx = cx + ex * u;
    const by = cy + ey * u;
    for (let k = -HALF; k <= HALF; k += 0.5) {
      const x = Math.round(bx + nx * k);
      const y = Math.round(by + ny * k);
      const edge = Math.abs(k) > HALF - 1.2;
      if (edge) {
        // Banks: the spoil thrown up either side when it was dug.
        px.set(x, y, rampAt(P.sand, 0.4 + hash2(i, Math.round(k * 2), 5) * 0.3));
      } else {
        const d = 1 - Math.abs(k) / HALF;
        px.set(x, y, rampAt(P.canal, 0.3 + d * 0.3 + hash2(i >> 1, Math.round(k * 2), 9) * 0.14));
      }
    }
  }
  px.toTexture(scene, key);
  anchor(key, TILE_W / 2, TILE_H / 2);
}

/* ================================================================
   DIKES
================================================================ */

/**
 * Geometry of the four tile edges in texture space. Each edge is walked with
 * a 2:1 step so banks land exactly on the isometric grid; `inward` points at
 * the tile centre.
 */
const EDGES = {
  xm: { start: [30, 0], step: [-2, 1], inward: [2, 1] },
  ym: { start: [33, 0], step: [2, 1], inward: [-2, 1] },
  xp: { start: [63, 16], step: [-2, 1], inward: [-2, -1] },
  yp: { start: [0, 16], step: [2, 1], inward: [2, -1] },
  // Chamfers: a bank straight across the tile from its left vertex to its
  // right, facing the sea above it (cn) or below it (cs). One unit inward is
  // a sixteenth of a tile across the diagonal, 1.41 pixels on screen.
  cn: { start: [0, 16], step: [4, 0], inward: [0, 1.41] },
  cs: { start: [0, 16], step: [4, 0], inward: [0, -1.41] },
};

/**
 * Pixels a sea-dike tile is drawn above plain ground (GameScene.renderElev
 * lifts the coast by 0.9 m at PX_PER_M 6). A chamfered tile is drawn at
 * ground level, so its bank is that much taller to meet its neighbours' crest.
 */
export const DIKE_LIFT_PX = 5;

const DIKE_YOFF = 38;
const DIKE_TEX_H = TERRAIN_TEX_H + DIKE_YOFF;

/**
 * Draw an earth embankment along one tile edge.
 *
 * A Dutch dike is a broad grassed bank with a stone revetment on the sea
 * side and a maintenance track along the crest, so that is exactly what gets
 * drawn: crest track, grass shoulders, and a basalt-block face below.
 */
function drawDikeBank(px, edgeKey, { height, width = 4, damaged = false, geometry = null }) {
  const e = geometry || EDGES[edgeKey];
  const steps = 15;
  const [sx, sy] = e.start;
  const [dx, dy] = e.step;
  const [ix, iy] = e.inward;

  // The two ends of the outer edge, and of the inner edge one band in.
  // Run a little past both ends: neighbouring tiles then overlap and the
  // ring reads as one continuous bank instead of a row of segments.
  const A = [sx - dx, sy - dy + DIKE_YOFF];
  const B = [sx + dx * (steps + 1), sy + dy * (steps + 1) + DIKE_YOFF];
  const A2 = [A[0] + ix * width, A[1] + iy * width];
  const B2 = [B[0] + ix * width, B[1] + iy * width];
  const up = (pt, h) => [pt[0], pt[1] - h];

  // Banks on the far edges show the face that looks back over the polder;
  // banks on the near edges show the seaward face. Either way it is the
  // lower of the two long edges on screen.
  const innerIsLower = edgeKey === 'xm' || edgeKey === 'ym' || edgeKey === 'cn';
  const footA = innerIsLower ? A2 : A;
  const footB = innerIsLower ? B2 : B;

  const H = height;
  const crestGrass = damaged ? P.grassDry : P.grass;

  // 1. The visible face of the bank, from crest down to ground.
  px.poly([up(footA, H), up(footB, H), footB, footA], P.stone[1]);

  // Basalt revetment: courses running parallel to the crest, with the
  // blocks staggered and the foot of the slope in shadow.
  for (let d = 0; d < H; d++) {
    const y0 = footA[1] - H + d;
    const y1 = footB[1] - H + d;
    const shade = 0.56 - Math.min(0.3, d * 0.035);
    for (let t = 0; t <= steps * 2; t++) {
      const u = t / (steps * 2);
      const x = Math.round(footA[0] + (footB[0] - footA[0]) * u);
      const y = Math.round(y0 + (y1 - y0) * u);
      const course = Math.floor(d / 4);
      const block = Math.floor((t + course * 3) / 7);
      const mortar = d % 4 === 0 || (t + course * 3) % 7 === 0;
      const n = (hash2(block, course, 19) - 0.5) * 0.16;
      px.set(x, y, rampAt(P.stone, mortar ? shade - 0.2 + n : shade + n));
    }
  }

  // 2. Turf rolling over the lip, two pixels of grass above the stone.
  px.poly([up(footA, H), up(footB, H), up(footB, H - 3), up(footA, H - 3)], crestGrass[1]);

  // 3. The crest itself: a broad grassed top with a track along it.
  px.poly([up(A, H), up(B, H), up(B2, H), up(A2, H)], crestGrass[3]);

  for (let k = 0; k <= width; k += 0.5) {
    const p0 = [A[0] + ix * k, A[1] + iy * k - H];
    const p1 = [B[0] + ix * k, B[1] + iy * k - H];
    const t = k / width;
    // Lighter toward the seaward rim where the light catches it.
    const c = rampAt(crestGrass, 0.82 - t * 0.3);
    px.line(Math.round(p0[0]), Math.round(p0[1]), Math.round(p1[0]), Math.round(p1[1]), c);
  }

  // Maintenance track.
  const tk = width * 0.55;
  const t0 = [Math.round(A[0] + ix * tk), Math.round(A[1] + iy * tk - H)];
  const t1 = [Math.round(B[0] + ix * tk), Math.round(B[1] + iy * tk - H)];
  px.line(t0[0], t0[1], t1[0], t1[1], P.sand[3]);
  px.line(t0[0], t0[1] + 1, t1[0], t1[1] + 1, P.sand[2]);

  // Seaward rim highlight, the line that gives the bank its edge.
  px.line(Math.round(A[0]), Math.round(A[1] - H), Math.round(B[0]), Math.round(B[1] - H),
    rampAt(crestGrass, 0.95));

  if (damaged) {
    // A breach: the crest is gone and water is pouring through the gap.
    const g0 = 6;
    const g1 = 10;
    for (let t = g0; t <= g1; t++) {
      const u = t / steps;
      const cx = Math.round(A[0] + (B[0] - A[0]) * u);
      const cy = Math.round(A[1] + (B[1] - A[1]) * u);
      const sag = Math.round(Math.sin(((t - g0) / (g1 - g0)) * Math.PI) * H);
      for (let k = -1; k <= width + 1; k += 0.5) {
        const x = Math.round(cx + ix * k);
        const yTop = Math.round(cy + iy * k) - H;
        px.ctx.clearRect(x, yTop, 2, sag + 1);
        for (let d = 0; d < 3; d++) {
          px.set(x, yTop + sag - d, rampAt(P.flood, 0.5 + d * 0.12));
          px.set(x + 1, yTop + sag - d, rampAt(P.flood, 0.45 + d * 0.12));
        }
      }
    }
  }
}

/**
 * A field ditch: the shallow drain that separates one parcel from the next.
 * Drawn along a single tile edge so it runs unbroken across the map and
 * breaks up the diamond grid the eye would otherwise latch onto.
 */
function makeDitch(scene, key, edgeKey) {
  const px = new Px(TILE_W, TERRAIN_TEX_H);
  const e = EDGES[edgeKey];
  const steps = 16;

  // One pixel of water with a damp line beside it, and nothing darker. The
  // first version was five pixels across with a dark rim, which drew every
  // parcel boundary as a hard line and put the tile grid back on the map.
  const water = mix(P.grass[2], P.canal[3], 0.55);
  const damp = mix(P.grass[3], P.grass[2], 0.5);
  for (let i = -1; i <= steps; i++) {
    const bx = e.start[0] + e.step[0] * i;
    const by = e.start[1] + e.step[1] * i;
    for (let w = 0; w < 2; w++) {
      px.set(bx + w, by, water);
      px.set(bx + w + e.inward[0] * 0.5, by + e.inward[1] * 0.5, damp);
    }
    // A glint now and then so the ditch reads as water, not a seam.
    if (i % 5 === 2) px.set(bx, by, P.foam[0], 0.7);
  }

  px.toTexture(scene, key);
  anchor(key, TILE_W / 2, TILE_H / 2);
}

export const WAVE_FRAMES = 8;

/**
 * The sea working on one edge of the ring, during a storm.
 *
 * Drawn on the same canvas and anchor as the dike of that edge, so it lines up
 * with the bank exactly; the scene then slides it up the face to show how far
 * the water is reaching. The swell travels along the edge rather than pulsing
 * in place — a wave that only goes up and down reads as a bar chart, and one
 * that moves reads as the sea.
 */
/**
 * Water churned white by a storm is not the same colour as the sea it came
 * from. An earlier version shaded the wave's body from the `P.sea` ramp, so
 * the body was invisible against the open water behind it and all that read
 * was the white crest — a dotted squiggle running along the dike. This ramp
 * runs from the dark trough at the foot up through flood green to foam, which
 * is what makes it a wall of water rather than a drawn line.
 */
const WAVE_BODY = [P.sea[1], P.sea[2], P.sea[4], P.flood[2], P.flood[4]];

function makeStormWave(scene, edgeKey, frame) {
  const px = new Px(TILE_W, DIKE_TEX_H);
  const e = EDGES[edgeKey];
  const steps = 15;
  const [sx, sy] = e.start;
  const [dx, dy] = e.step;
  const [ix, iy] = e.inward;
  // Seaward is away from the polder.
  const ox = -ix;
  const oy = -iy;

  const A = [sx - dx, sy - dy + DIKE_YOFF];
  const B = [sx + dx * (steps + 1), sy + dy * (steps + 1) + DIKE_YOFF];
  const phase = (frame / WAVE_FRAMES) * Math.PI * 2;
  // Four samples per step rather than two: at two, rounding left gaps between
  // the columns and the wave came out as a comb.
  const N = steps * 4;

  for (let t = 0; t <= N; t++) {
    const u = t / N;
    const bx = A[0] + (B[0] - A[0]) * u;
    const by = A[1] + (B[1] - A[1]) * u;
    // Whole numbers of periods per tile, so the crest line continues into the
    // neighbouring tile's wave instead of restarting: at 2.2 periods each tile
    // carried its own independent wave and the coast came out as a row of
    // shark's teeth. Surf does run in regular trains, so the repeat is fine;
    // the discontinuity was not.
    const swell = Math.sin(u * TAU - phase) * 2.6
      + Math.sin(u * TAU * 3 - phase * 1.7) * 1.1;
    const crest = Math.round(7 + swell);

    // The body of the wave, leaning seaward as it rises. Each run is laid
    // down two pixels wide along the edge so the columns close up into a
    // wall of water rather than a comb.
    for (let h = 0; h < crest; h++) {
      const lean = h * 0.25;
      const k = h / Math.max(1, crest);
      const c = ditherRamp(
        WAVE_BODY, 0.1 + k * 0.62 + (hash2(t, h, 23) - 0.5) * 0.12, t, h,
      );
      for (let w = 0; w < 2; w++) {
        const x = Math.round(bx + dx * w * 0.5 + ox * (0.5 + lean * 0.5));
        const y = Math.round(by + dy * w * 0.5 + oy * (0.5 + lean * 0.5) - h);
        px.set(x, y, c);
      }
    }

    // The crest itself: an unbroken lip of foam two pixels deep, thickening
    // where the swell runs highest.
    const lean = crest * 0.25;
    const fx = Math.round(bx + ox * (0.5 + lean * 0.5));
    const fy = Math.round(by + oy * (0.5 + lean * 0.5) - crest);
    const half = Math.round(dx * 0.5);
    for (const [px2, c] of [[0, P.foam[2]], [half, P.foam[2]]]) {
      px.set(fx + px2, fy, c);
      px.set(fx + px2, fy + 1, P.foam[1]);
    }
    if (swell > 1.8) {
      px.set(fx, fy - 1, P.foam[1]);
      px.set(fx + half, fy - 1, P.foam[1]);
    }
    // Spray thrown off the highest crests.
    if (swell > 3.0 && (t + frame) % 7 === 0) {
      px.set(fx + ox, fy - 3, P.foam[0]);
      px.set(fx + ox * 2, fy - 4 - ((t + frame) % 2), P.foam[1]);
      px.set(fx + ox * 2 + 1, fy - 6, P.foam[0]);
    }
  }

  const key = `s_wave_${edgeKey}_${frame}`;
  px.toTexture(scene, key);
  anchor(key, TILE_W / 2, TILE_H / 2 + DIKE_YOFF);
}

function makeDike(scene, key, edgeKey, level, damaged) {
  const px = new Px(TILE_W, DIKE_TEX_H);
  drawDikeBank(px, edgeKey, { height: 14 + level * 7, width: 4 + level, damaged });
  px.outline(P.ink[0], { skipTop: true, alpha: 0.55 });
  px.toTexture(scene, key);
  anchor(key, TILE_W / 2, TILE_H / 2 + DIKE_YOFF);
}

/**
 * A dike laid diagonally across the grid comes out as a staircase: each
 * step is a corner tile standing out into the water. Drawn as two banks
 * meeting at the corner, every step read as a block on its own. The tile
 * gets one straight bank across its middle instead, vertex to vertex, which
 * meets the next step's at the shared vertex: one straight dike on screen.
 */
function makeDikeChamfer(scene, key, dir, level, damaged) {
  const px = new Px(TILE_W, DIKE_TEX_H);
  // A north-facing bank stands on the tile's middle line with its foot, not
  // its seaward rim: the field in front of it is drawn over the foot, and a
  // foot below the line showed through as a row of teeth.
  // The rim is raised by as much and the bank made that much lower, so the
  // crest stays where the neighbouring banks' crests meet it.
  const width = 4 + level;
  const e = EDGES[dir];
  const k = dir === 'cn' ? Math.round(e.inward[1] * width) : 0;
  const geometry = { ...e, start: [e.start[0], e.start[1] - k] };
  drawDikeBank(px, dir, { height: 14 + level * 7 + DIKE_LIFT_PX - k, width, damaged, geometry });
  px.outline(P.ink[0], { skipTop: true, alpha: 0.55 });
  px.toTexture(scene, key);
  anchor(key, TILE_W / 2, TILE_H / 2 + DIKE_YOFF);
}

/**
 * The corners of the ring, where two banks meet on one tile.
 *
 * Drawn as two separate sprites, each bank ran a step past the corner so the
 * straight runs would join up, and at the corner that meant each crossed the
 * other: crest stripes cut through one another and one bank's stone face
 * stood over the other's crest in a stepped notch. A corner is one sprite
 * instead, each bank owning its side of the mitre — the line from the outer
 * corner along the bisector, as a joiner would cut it.
 *
 * `first` owns the pixels above (or left of) the mitre, `second` the rest;
 * where the owner has nothing, the other bank shows, so a face that hangs
 * below the line on the far side still reads.
 */
const DIKE_CORNERS = {
  // pair: [first, second, mitre] — mitre is 'h' (horizontal) or 'v' (vertical)
  xmym: ['xm', 'ym', 'v'], // top: vertical line through the top vertex
  xpyp: ['yp', 'xp', 'v'], // bottom
  xmyp: ['xm', 'yp', 'h'], // left: horizontal line through the left vertex
  xpym: ['ym', 'xp', 'h'], // right
};

/** The texture pair key for a corner tile's two edges, or null. */
export function dikeCornerKey(edges) {
  if (!edges || edges.length !== 2) return null;
  const k = [...edges].sort().join('');
  return DIKE_CORNERS[k] ? k : null;
}

function makeDikeCorner(scene, key, pair, level, damaged) {
  const [first, second, mitre] = DIKE_CORNERS[pair];
  const opts = { height: 14 + level * 7, width: 4 + level, damaged };
  const a = new Px(TILE_W, DIKE_TEX_H);
  const b = new Px(TILE_W, DIKE_TEX_H);
  drawDikeBank(a, first, opts);
  drawDikeBank(b, second, opts);
  const da = a.ctx.getImageData(0, 0, TILE_W, DIKE_TEX_H);
  const db = b.ctx.getImageData(0, 0, TILE_W, DIKE_TEX_H);
  // The mitre on the crest: through the vertex both edges share.
  const lineY = TILE_H / 2 + DIKE_YOFF - opts.height;
  const lineX = TILE_W / 2;
  const out = a.ctx.createImageData(TILE_W, DIKE_TEX_H);
  for (let y = 0; y < DIKE_TEX_H; y++) {
    for (let x = 0; x < TILE_W; x++) {
      const i = (y * TILE_W + x) * 4;
      const firstSide = mitre === 'h' ? y < lineY : x < lineX;
      const [own, other] = firstSide ? [da.data, db.data] : [db.data, da.data];
      const src = own[i + 3] > 0 ? own : other;
      out.data[i] = src[i];
      out.data[i + 1] = src[i + 1];
      out.data[i + 2] = src[i + 2];
      out.data[i + 3] = src[i + 3];
    }
  }
  a.ctx.putImageData(out, 0, 0);
  a.outline(P.ink[0], { skipTop: true, alpha: 0.55 });
  a.toTexture(scene, key);
  anchor(key, TILE_W / 2, TILE_H / 2 + DIKE_YOFF);
}

/* ================================================================
   BUILDING PARTS

   Buildings, machines and props are modelled as small isometric solids and
   rasterised by `IsoBuf` (px.js): walls are painted as flat elevations in
   their own pixel grid and mapped onto the projection, roofs are shaded per
   course, and a depth buffer settles what covers what. Every colour still
   comes from a named ramp, chosen per pixel by hand-written rules.

   World units: a tile is 16 x 16 along a (down-right) and b (down-left);
   heights are screen pixels. Sun from the upper left: walls facing +b are
   lit, walls facing +a are in shade.
================================================================ */

const INK = P.bOutline[1];
/** Bit 24 on a shader colour marks the pixel as emissive (a lit window). */
const GLOW = 0x1000000;

/** Ramp entry by index, clamped to the ramp. */
function R(ramp, i) {
  return ramp[Math.max(0, Math.min(ramp.length - 1, Math.round(i)))];
}

/** A wall elevation: a grid of colours, row 0 at the foot of the wall. */
class Elev {
  constructor(w, h) {
    this.w = w;
    this.h = h;
    this.c = new Int32Array(w * h).fill(-1);
  }

  inside(u, v) { return u >= 0 && v >= 0 && u < this.w && v < this.h; }

  get(u, v) { return this.inside(u, v) ? this.c[v * this.w + u] : -1; }

  set(u, v, c) { if (this.inside(u, v)) this.c[v * this.w + u] = c; }

  /** Only where something is painted already (keeps cut-outs cut). */
  over(u, v, c) { if (this.get(u, v) >= 0) this.set(u, v, c); }

  /** Fill a rectangle whose bottom-left cell is (u, v). */
  rect(u, v, w, h, c) {
    for (let j = 0; j < h; j++) for (let i = 0; i < w; i++) this.set(u + i, v + j, c);
  }

  hline(u0, u1, v, c) { for (let u = u0; u <= u1; u++) this.set(u, v, c); }

  vline(u, v0, v1, c) { for (let v = v0; v <= v1; v++) this.set(u, v, c); }
}

/**
 * Map an elevation onto the vertical wall from ground point `p` (its left
 * end on screen) to `q`. Columns are screen columns, rows are pixels above
 * `h0`, so anything painted into the elevation lands on the projection's
 * own 2:1 staircase.
 */
function wallFace(buf, p, q, h0, el, tag = 1) {
  const xl = Math.round(buf.proj(p[0], p[1], 0)[0]);
  const h1 = h0 + el.h;
  buf.face(
    [[p[0], p[1], h0], [q[0], q[1], h0], [q[0], q[1], h1], [p[0], p[1], h1]],
    (a, b, h, x) => el.get(x - xl, Math.floor(h - h0 + 1e-6)),
    { tag },
  );
}

const asShader = (s) => (typeof s === 'function' ? s : () => s);

/** An axis-aligned box: its two visible walls (+b left, +a right) and top. */
function isoCuboid(buf, a0, a1, b0, b1, h0, h1, { left, right, top }, tag = 1) {
  if (left != null) buf.face([[a0, b1, h0], [a1, b1, h0], [a1, b1, h1], [a0, b1, h1]], asShader(left), { tag });
  if (right != null) buf.face([[a1, b1, h0], [a1, b0, h0], [a1, b0, h1], [a1, b1, h1]], asShader(right), { tag });
  if (top != null) buf.face([[a0, b0, h1], [a1, b0, h1], [a1, b1, h1], [a0, b1, h1]], asShader(top), { tag });
}

/**
 * Brickwork: courses three pixels tall (two of brick, one of mortar) in
 * stretcher bond, bricks four columns long. Colour varies by whole bricks,
 * never by single pixels, and the mortar line is broken, so the wall reads
 * as brick rather than as ruled paper.
 */
function fillBrick(el, ramp, base, seed, v0 = 0, v1 = el.h - 1) {
  for (let v = v0; v <= v1; v++) {
    const course = Math.floor(v / 3);
    const off = (course & 1) * 2;
    for (let u = 0; u < el.w; u++) {
      const brick = Math.floor((u + off) / 4);
      const n = hash2(brick, course, seed);
      let i = base + (n > 0.86 ? 1 : n < 0.1 ? -1 : 0);
      if (v % 3 === 2 && hash2(brick, course, seed + 7) < 0.6) i = base - 1;
      el.set(u, v, R(ramp, i));
    }
  }
}

/** Lime-washed plaster: flat, with a few broad weathering patches. */
function fillPlaster(el, ramp, base, seed, v0 = 0, v1 = el.h - 1) {
  for (let v = v0; v <= v1; v++) {
    for (let u = 0; u < el.w; u++) {
      const n = hash2(u >> 2, Math.floor(v / 3), seed);
      el.set(u, v, R(ramp, base - (n > 0.88 ? 1 : 0)));
    }
  }
}

/**
 * A Dutch sash window: white frame and glazing bar, glass that catches the
 * sky (or glows at night), a pale stone sill and a lintel. `sh` pushes every
 * colour toward the shade end for a wall that faces away from the sun.
 */
function paintWindow(el, u, v, w, h, sh, lit, {
  shutter = null, lintel = P.bSandstone, arch = false, bars = true,
} = {}) {
  const F = R(P.bWhitePaint, 3 - sh);
  const Fd = R(P.bWhitePaint, 2 - sh);
  if (lintel) el.hline(u - 1, u + w, v + h, R(lintel, 3 - sh));
  el.hline(u - 1, u + w, v - 1, R(P.bSandstone, 3 - sh));
  const mid = v + Math.floor(h / 2);
  for (let j = 0; j < h; j++) {
    for (let i = 0; i < w; i++) {
      const y = v + j;
      const edge = i === 0 || i === w - 1 || j === 0 || j === h - 1;
      if (arch && j === h - 1 && (i === 0 || i === w - 1)) continue;
      let c;
      if (edge || (bars && y === mid)) {
        c = i === w - 1 || j === 0 ? Fd : F;
      } else if (lit) {
        const top = j >= h - 2;
        c = (top ? R(P.bGlow, 4) : y > mid ? R(P.bGlow, 3) : R(P.bGlow, 2)) | GLOW;
      } else {
        // Sky in the upper pane, the dark room behind the lower one.
        const hi = i === 1 && j === h - 2;
        c = hi ? R(P.bGlass, 5 - sh) : y > mid ? R(P.bGlass, 3 - sh) : R(P.bGlass, 1 - sh);
      }
      el.set(u + i, y, c);
    }
  }
  if (shutter) {
    for (const [su, side] of [[u - 2, 0], [u + w, 1]]) {
      for (let j = 0; j < h; j++) {
        const edgeRow = j === 0 || j === h - 1;
        el.set(su, v + j, R(shutter, (side ? 2 : 4) - sh - (edgeRow ? 1 : 0)));
        el.set(su + 1, v + j, R(shutter, (side ? 1 : 3) - sh - (edgeRow ? 1 : 0)));
      }
    }
  }
  if (lit) {
    // Light falls on the sill.
    el.hline(u, u + w - 1, v - 1, R(P.bGlow, 3) | GLOW);
  }
}

/** A panelled front door with its fanlight, frame and stone step. */
function paintDoor(el, u, v, w, h, sh, lit, paint) {
  const F = R(P.bWhitePaint, 4 - sh);
  el.rect(u - 1, v, w + 2, h + 1, F);
  el.vline(u + w, v, v + h, R(P.bWhitePaint, 3 - sh));
  // Fanlight.
  el.rect(u, v + h - 3, w, 2, lit ? (R(P.bGlow, 4) | GLOW) : R(P.bGlass, 3 - sh));
  el.set(u, v + h - 2, lit ? (R(P.bGlow, 5) | GLOW) : R(P.bGlass, 5 - sh));
  // Leaf.
  const leafH = h - 4;
  el.rect(u, v, w, leafH, R(paint, 3 - sh));
  el.vline(u, v, v + leafH - 1, R(paint, 4 - sh));
  el.vline(u + w - 1, v, v + leafH - 1, R(paint, 2 - sh));
  el.hline(u, u + w - 1, v + leafH - 1, R(paint, 2 - sh));
  el.hline(u + 1, u + w - 2, v + Math.floor(leafH / 2), R(paint, 2 - sh));
  el.set(u + w - 2, v + Math.floor(leafH / 2) - 1, R(P.bGlow, 3));
  // Step.
  el.hline(u - 1, u + w, v - 1, R(P.bSandstone, 4 - sh));
}

/**
 * The shape of a gable above the eaves, as a mask over the gable wall:
 * 1 = brick of the wall carried up, 2 = stone ornament (coping, claw
 * pieces, cornice). `r` is rows above the eaves, `d` the distance of the
 * column centre from the middle of the wall. Every type is at least as tall
 * as the roof behind it everywhere, so the roof's end is always covered.
 */
function gableShape(type, W, roofH) {
  const half = W / 2;
  const roofHW = (r) => half * (1 - r / roofH);
  let height;
  let mask;
  if (type === 'step') {
    // Trapgevel: three steps a side climbing to a crown.
    const crown = 2;
    const n = 3;
    const sw = (half - crown) / n;
    const stepTop = (d) => {
      if (d <= crown) return roofH + 4;
      const k = Math.min(n - 1, Math.floor((half - d) / sw));
      return Math.round(roofH * (1 - (half - (k + 1) * sw) / half)) + 2;
    };
    height = roofH + 7;
    mask = (d, r) => {
      if (d < 1 && r >= roofH + 4 && r < roofH + 6) return 2; // finial
      const t = stepTop(d);
      if (r >= t) return 0;
      return r === t - 1 ? 2 : 1;
    };
  } else if (type === 'bell') {
    // Klokgevel: an S-curved bell with a cornice and scrolled shoulders.
    const G = roofH + 5;
    const body = (r) => {
      if (r >= G + 2) return -1;
      if (r >= G) return 1;
      if (r >= G - 2) return 3.5;
      const t = r / G;
      return Math.max(2.5, half * (1 - t ** 1.45) - 1.6 * Math.sin(Math.PI * t));
    };
    height = G + 2;
    mask = (d, r) => {
      if (d <= body(r)) return r >= G - 2 ? 2 : 1;
      if (r < roofH && d <= roofHW(r) + 0.6) return 2;
      return 0;
    };
  } else if (type === 'spout') {
    // Tuitgevel: boarded shoulders along the roof, then a plain neck.
    const neck = 2.5;
    const G = roofH + 3;
    height = G + 3;
    mask = (d, r) => {
      if (r >= G) {
        if (r === G && d <= neck + 1) return 2;
        if (r === G + 1 && d <= neck - 0.5) return 2;
        if (r === G + 2 && d <= 1) return 2;
        return 0;
      }
      if (d <= neck) return 1;
      const edge = roofHW(r) + 0.6;
      if (d <= edge) return d > edge - 1.2 ? 2 : 1;
      return 0;
    };
  } else {
    // Halsgevel: a tall neck between claw pieces, under a pediment.
    const neck = 3.5;
    const G = roofH + 4;
    const shoulder = Math.round(roofH * 0.3);
    height = G + 4;
    mask = (d, r) => {
      if (r >= G) {
        const k = r - G;
        if (k === 0) return d <= neck + 1 ? 2 : 0;
        return d <= neck + 0.5 - k * 1.6 ? 2 : 0;
      }
      if (r < shoulder) return d <= roofHW(r) + 0.6 ? (r === shoulder - 1 && d > neck ? 2 : 1) : 0;
      if (d <= neck) return 1;
      return d <= roofHW(r) + 0.6 ? 2 : 0;
    };
  }
  return { height, mask: (u, r) => mask(Math.abs(u + 0.5 - half), r) };
}

/**
 * Roof covering for one plane. `u` counts pixel columns along the eave, `r`
 * pixels of height above the eave line, `rt` pixels down from the ridge;
 * `lit` is the plane's base ramp index (higher on the sun side).
 */
function roofColor(kind, u, r, rt, lit, seed) {
  if (kind === 'thatch') {
    const ramp = P.bThatch;
    if (rt < 2) return R(ramp, lit - 1 + (u % 3 === 0 ? 1 : 0));
    if (r < 1) return R(ramp, lit - 2);
    if (r < 2.5) return R(ramp, lit - 1 - ((u & 1) ? 1 : 0));
    const strand = hash2(u, Math.floor((r + hash2(u, 1, seed) * 5) / 5), seed);
    return R(ramp, lit + (strand > 0.78 ? 1 : strand < 0.2 ? -1 : 0));
  }
  if (kind === 'slate') {
    const ramp = P.bSlate;
    if (r < 1) return R(ramp, lit - 2);
    if (rt < 1.2) return R(ramp, lit + 1);
    const c = Math.floor((r - 1) / 3);
    const q = r - 1 - c * 3;
    if (q < 1) return R(ramp, lit - 1);
    const off = (c & 1) * 2;
    if ((u + off) % 5 === 0) return R(ramp, lit - 1);
    const n = hash2(Math.floor((u + off) / 5), c, seed);
    return R(ramp, lit + (n > 0.82 ? 1 : 0) + (q >= 2 ? 0 : 0));
  }
  // Pantiles, plain or glazed: S-shaped tiles laid in columns down the
  // slope, so the wave runs across the eave and the lips run along it.
  const glazed = kind === 'glazed';
  const ramp = glazed ? P.bGlazed : P.bPantile;
  if (r < 1) return R(ramp, lit - 2);
  if (rt < 1.5) return R(ramp, lit + ((u >> 1) & 1));
  if (rt < 2.5) return R(ramp, lit - 1);
  const c = Math.floor((r - 1) / 3);
  const q = r - 1 - c * 3;
  const wave = [-1, 0, 1, 0][u & 3];
  let i = lit + wave;
  if (q < 1 && wave >= 0) i += 1;
  if (glazed && wave === 1 && q >= 1) i += 1;
  // A few tiles weathered a step darker, a whole tile at a time.
  if (hash2(u >> 2, c, seed) > 0.9) i -= 1;
  return R(ramp, i);
}

/** Close a sprite: creases, sel-out outline and a contact shadow. */
function finishSprite(buf, contact, { night = false, crease = true } = {}) {
  if (night) buf.night(P.skyNight[1], 0.5);
  if (crease) buf.creases(INK, 0.32, 2.5);
  buf.selOut(INK, { dark: night ? 0.55 : 0.68, lit: night ? 0.4 : 0.45 });
  if (contact) buf.shadowPoly(contact, P.bOutline[0], 0.34);
}

/** Footprint grown by `g` units toward the viewer, at ground level. */
function contactOf(a0, a1, b0, b1, g = 1.25) {
  return [[a0 - 0.5, b1 + g, 0], [a1 + g, b1 + g, 0], [a1 + g, b0 - 0.5, 0], [a1, b0 - 0.5, 0], [a0 - 0.5, b1, 0]];
}

/** A brick chimney stack with a stone cap. */
function chimney(buf, ca, cb, h0, h1, brick, tag = 3) {
  const s = 0.75;
  const bricky = (base) => (a, b, h, x) => {
    const v = Math.floor(h);
    return R(brick, base - ((v % 3 === 0 && (x & 1)) ? 1 : 0));
  };
  isoCuboid(buf, ca - s, ca + s, cb - s, cb + s, h0, h1, {
    left: bricky(3), right: bricky(2), top: R(P.bOutline, 0),
  }, tag);
  isoCuboid(buf, ca - s - 0.25, ca + s + 0.25, cb - s - 0.25, cb + s + 0.25, h1, h1 + 1.5, {
    left: R(brick, 4), right: R(brick, 2), top: R(brick, 3),
  }, tag);
  // The flue.
  isoCuboid(buf, ca - 0.35, ca + 0.35, cb - 0.35, cb + 0.35, h1 + 1.5, h1 + 2.01, {
    top: R(P.bOutline, 0),
  }, tag);
}

/* ================================================================
   HOUSES

   Eight Dutch houses that belong to one village: the same bond, trim and
   window, but a different gable, material and roof each — stepped gable in
   red brick under pantiles, bell gable in dark klinker under black glazed
   tiles, spout gable in yellow brick, neck gable in lime-washed plaster
   under slate. Two face their gable to the lit side and two to the shaded
   side, so a street of them reads as a street and not a stamp.
================================================================ */

const HOUSE_W = 64;
const HOUSE_H = 74;
const HOUSE_OX = 32;
const HOUSE_OY = 56;

/**
 * `ea`/`eb`: half extents of the footprint along a and b (units).
 * `ridge`: the axis the ridge runs along; the gable closes its + end.
 */
const HOUSE_SPECS = [
  {
    ea: 5, eb: 6.5, wallH: 21, roofH: 15, ridge: 'b', gable: 'step', roof: 'pantile',
    wall: P.bBrick, trim: P.bSandstone, paint: P.bGreenPaint, bands: true, chimneyAt: -0.5,
  },
  {
    ea: 6.5, eb: 5, wallH: 20, roofH: 16, ridge: 'a', gable: 'bell', roof: 'glazed',
    wall: P.bKlinker, trim: P.bWhitePaint, paint: P.bRedPaint, chimneyAt: -0.45,
  },
  {
    ea: 5.5, eb: 6, wallH: 19, roofH: 17, ridge: 'b', gable: 'spout', roof: 'pantile',
    wall: P.bYellowBrick, trim: P.bWhitePaint, paint: P.bGreenPaint, loft: true, chimneyAt: -0.6,
  },
  {
    ea: 6, eb: 5, wallH: 22, roofH: 14, ridge: 'a', gable: 'neck', roof: 'slate',
    wall: P.bPlaster, plaster: true, trim: P.bSandstone, paint: P.bGreenPaint, chimneyAt: -0.5,
  },
  {
    // Zaan style: painted green boarding, white trim.
    ea: 5.5, eb: 6, wallH: 20, roofH: 16, ridge: 'b', gable: 'bell', roof: 'pantile',
    wall: P.bGreenPaint, plaster: true, trim: P.bWhitePaint, paint: P.bWhitePaint, chimneyAt: -0.55,
  },
  {
    ea: 6, eb: 5.5, wallH: 21, roofH: 15, ridge: 'a', gable: 'step', roof: 'slate',
    wall: P.bRose, plaster: true, trim: P.bWhitePaint, paint: P.bGreenPaint, chimneyAt: -0.5,
  },
  {
    ea: 5, eb: 6.5, wallH: 20, roofH: 16, ridge: 'b', gable: 'neck', roof: 'pantile',
    wall: P.bOchre, plaster: true, trim: P.bWhitePaint, paint: P.bRedPaint, chimneyAt: -0.5,
  },
  {
    ea: 6.5, eb: 5, wallH: 19, roofH: 17, ridge: 'a', gable: 'spout', roof: 'glazed',
    wall: P.bBluePaint, plaster: true, trim: P.bWhitePaint, paint: P.bWhitePaint, loft: true, chimneyAt: -0.6,
  },
];

/** Which windows burn at night, per house, so the village is not uniform. */
const HOUSE_LIGHTS = [0b1011011, 0b0110110, 0b1101101, 0b1011110, 0b0111011, 0b1101110, 0b1010111, 0b0111101];

function paintWallBase(el, S, sh, seed, v1) {
  const base = sh ? 2 : 3;
  if (S.plaster) fillPlaster(el, S.wall, base + 1, seed, 0, v1);
  else fillBrick(el, S.wall, base, seed, 0, v1);
  // A tarred plinth, the way every Dutch wall meets the ground.
  el.rect(0, 0, el.w, 2, R(P.bKlinker, 1 - sh));
  el.hline(0, el.w - 1, 2, R(P.bKlinker, 2 - sh));
  if (S.bands) {
    // Speklagen: bands of pale stone through the brick.
    for (const v of [11, S.wallH - 1]) el.hline(0, el.w - 1, v, R(S.trim, 4 - sh));
  }
}

function paintGableWall(el, S, shape, sh, night, lights) {
  const { wallH } = S;
  const W = el.w;
  paintWallBase(el, S, sh, 11, wallH - 1);
  // Carry the wall up into the gable and trim its outline in stone.
  const trimLit = R(S.trim, 5 - sh);
  const trimMid = R(S.trim, 4 - sh);
  const trimDark = R(S.trim, 2 - sh);
  for (let r = 0; r < shape.height; r++) {
    for (let u = 0; u < W; u++) {
      const m = shape.mask(u, r);
      const v = wallH + r;
      if (!m) continue;
      if (m === 2) {
        const below = shape.mask(u, r - 1);
        el.set(u, v, below === 1 || r === 0 ? trimMid : trimLit);
        continue;
      }
      const course = Math.floor(v / 3);
      const n = hash2(Math.floor((u + (course & 1) * 2) / 4), course, 11);
      const base = S.plaster ? 4 - sh : 3 - sh;
      el.set(u, v, R(S.wall, base + (n > 0.86 ? 1 : 0) - (!S.plaster && v % 3 === 2 && n < 0.6 ? 1 : 0)));
    }
  }
  // Stone edge along the whole outline: lit on the left, shaded on the right.
  for (let r = 0; r < shape.height; r++) {
    for (let u = 0; u < W; u++) {
      if (shape.mask(u, r) !== 1) continue;
      const v = wallH + r;
      const up = shape.mask(u, r + 1);
      const lft = u === 0 ? 0 : shape.mask(u - 1, r);
      const rgt = u === W - 1 ? 0 : shape.mask(u + 1, r);
      if (!up) el.set(u, v, trimLit);
      else if (!lft) el.set(u, v, trimMid);
      else if (!rgt) el.set(u, v, trimDark);
    }
  }

  const lit = (i) => night && ((lights >> i) & 1);
  const g = S.gable;
  const cu = W / 2;
  if (g === 'spout') {
    // A warehouse front: loft doors stacked up the middle, windows either side.
    const doorU = cu - 2;
    paintDoor(el, doorU, 3, 4, 9, sh, lit(0), S.paint);
    for (const v of [wallH - 7, wallH + 3]) {
      el.rect(doorU - 1, v - 1, 6, 8, R(S.trim, 4 - sh));
      el.rect(doorU, v, 4, 6, R(S.paint, 3 - sh));
      el.vline(doorU + 2, v, v + 5, R(S.paint, 1 - sh));
      el.vline(doorU, v, v + 5, R(S.paint, 4 - sh));
    }
    paintWindow(el, 2, 5, 4, 7, sh, lit(1), { shutter: S.paint });
    paintWindow(el, W - 6, 5, 4, 7, sh, lit(2), { shutter: S.paint });
    paintWindow(el, 2, wallH - 7, 4, 6, sh, lit(3));
    paintWindow(el, W - 6, wallH - 7, 4, 6, sh, lit(4));
  } else {
    // Door to one side, a shuttered window beside it, two windows above.
    const doorU = W - 7;
    paintDoor(el, doorU, 3, 4, 10, sh, lit(0), S.paint);
    paintWindow(el, 3, 5, 5, 7, sh, lit(1), { shutter: S.paint });
    paintWindow(el, 3, wallH - 8, 5, 7, sh, lit(2));
    paintWindow(el, W - 8, wallH - 8, 5, 7, sh, lit(3));
    // The loft window in the gable, and a small one above it.
    paintWindow(el, cu - 2, wallH + 2, 4, 6, sh, lit(4), { lintel: S.trim });
    if (g === 'step' || g === 'neck') paintWindow(el, cu - 1, wallH + 10, 2, 3, sh, lit(5), { lintel: null, bars: false });
  }
  // Iron wall anchors: the little crosses that tie the gable to the beams.
  if (!S.plaster) {
    for (const au of [2, W - 3]) {
      const v = wallH + 1;
      el.vline(au, v, v + 2, R(P.bIron, 1));
      el.set(au, v + 1, R(P.bIron, 2));
    }
  }
}

function paintSideWall(el, S, sh, night, lights) {
  const { wallH } = S;
  const W = el.w;
  paintWallBase(el, S, sh, 23, wallH - 1);
  const lit = (i) => night && ((lights >> (i + 2)) & 1);
  const n = W >= 26 ? 3 : 2;
  const step = n === 3 ? 8 : 11;
  const u0 = n === 3 ? 3 : 4;
  for (let i = 0; i < n; i++) {
    const u = u0 + i * step;
    paintWindow(el, u, 5, 4, 7, sh, lit(i), { shutter: sh ? null : S.paint });
    paintWindow(el, u, wallH - 8, 4, 6, sh, lit(i + 1));
  }
  // The eaves throw a band of shadow down the top of the wall.
  for (let v = wallH - 4; v < wallH; v++) {
    for (let u = 0; u < W; u++) {
      const c = el.get(u, v);
      if (c >= 0 && c < GLOW) el.set(u, v, mix(c, INK, v >= wallH - 2 ? 0.34 : 0.18));
    }
  }
}

/**
 * Draw one house into `buf`, centred on the tile at world (0, 0).
 */
function drawHouse(buf, S, variant, night) {
  const { ea, eb, wallH, roofH } = S;
  const alongB = S.ridge === 'b';
  const e = alongB ? ea : eb;
  const k = roofH / e;
  const hr = wallH + roofH;
  const ov = 0.75;
  const he = wallH - k * ov;
  const ovr = 0.5;
  const seed = variant * 13 + 3;
  const lights = HOUSE_LIGHTS[variant];

  const gw = 4 * (alongB ? ea : eb);
  const sw = 4 * (alongB ? eb : ea);
  const shape = gableShape(S.gable, gw, roofH);
  const gEl = new Elev(gw, wallH + shape.height);
  const sEl = new Elev(sw, wallH);
  paintGableWall(gEl, S, shape, alongB ? 0 : 1, night, lights);
  paintSideWall(sEl, S, alongB ? 1 : 0, night, lights);

  const leftP = [-ea, eb];
  const leftQ = [ea, eb];
  const rightP = [ea, eb];
  const rightQ = [ea, -eb];
  wallFace(buf, leftP, leftQ, 0, alongB ? gEl : sEl, 1);
  wallFace(buf, rightP, rightQ, 0, alongB ? sEl : gEl, 1);

  // Roof: the visible plane, and the back one for the silhouette.
  const kind = S.roof;
  if (alongB) {
    const lit = 3;
    buf.face([[0, eb, hr], [0, -eb - ovr, hr], [ea + ov, -eb - ovr, he], [ea + ov, eb, he]],
      (a, b, h) => roofColor(kind, Math.floor((eb - b) * 2), h - he, hr - h, lit, seed), { tag: 2 });
    buf.face([[0, eb, hr], [0, -eb - ovr, hr], [-ea - ov, -eb - ovr, he], [-ea - ov, eb, he]],
      (a, b, h) => roofColor(kind, Math.floor((eb - b) * 2), h - he, hr - h, lit + 1, seed), { tag: 2 });
  } else {
    const lit = 4;
    buf.face([[ea, 0, hr], [-ea - ovr, 0, hr], [-ea - ovr, eb + ov, he], [ea, eb + ov, he]],
      (a, b, h) => roofColor(kind, Math.floor((a + ea + ovr) * 2), h - he, hr - h, lit, seed), { tag: 2 });
    buf.face([[ea, 0, hr], [-ea - ovr, 0, hr], [-ea - ovr, -eb - ov, he], [ea, -eb - ov, he]],
      (a, b, h) => roofColor(kind, Math.floor((a + ea + ovr) * 2), h - he, hr - h, lit - 1, seed), { tag: 2 });
  }

  // Chimney on the ridge toward the back, and on the bigger houses a second
  // one at the gable end.
  const cAt = S.chimneyAt * (alongB ? eb : ea);
  if (alongB) chimney(buf, 0, cAt, wallH, hr + 4, S.plaster ? P.bBrick : S.wall);
  else chimney(buf, cAt, 0, wallH, hr + 4, S.plaster ? P.bBrick : S.wall);

  // Hoisting beam out of the top of the gable.
  if (S.gable === 'spout' || S.gable === 'neck') {
    const hb = hr + (S.gable === 'spout' ? 1 : 2);
    const beam = { left: R(P.bWood, 3), right: R(P.bWood, 2), top: R(P.bWood, 4) };
    if (alongB) isoCuboid(buf, -0.3, 0.3, eb, eb + 1.5, hb, hb + 1.5, beam, 4);
    else isoCuboid(buf, ea, ea + 1.5, -0.3, 0.3, hb, hb + 1.5, beam, 4);
  }

  // Stone stoop and a bench of pavement along the front.
  const stoop = { left: R(P.bGreyStone, 4), right: R(P.bGreyStone, 3), top: R(P.bGreyStone, 5) };
  const doorU = S.gable === 'spout' ? gw / 2 : gw - 5;
  if (alongB) {
    const ac = -ea + doorU / 2;
    isoCuboid(buf, ac - 1.5, ac + 1.5, eb, eb + 1, 0, 1, stoop, 5);
  } else {
    const bc = eb - doorU / 2;
    isoCuboid(buf, ea, ea + 1, bc - 1.5, bc + 1.5, 0, 1, stoop, 5);
  }

  finishSprite(buf, contactOf(-ea, ea, -eb, eb), { night });
}

/**
 * Where each design's chimney pot sits relative to the house's anchor, so the
 * scene's smoke comes out of the pot and not out of the roof.
 */
export const HOUSE_CHIMNEY = HOUSE_SPECS.map((S) => {
  const alongB = S.ridge === 'b';
  const hr = S.wallH + S.roofH;
  const cAt = S.chimneyAt * (alongB ? S.eb : S.ea);
  const buf = new IsoBuf(HOUSE_W, HOUSE_H, HOUSE_OX, HOUSE_OY);
  const [x, y] = alongB ? buf.proj(0, cAt, hr + 6) : buf.proj(cAt, 0, hr + 6);
  return { x: Math.round(x) - HOUSE_OX, y: Math.round(y) - HOUSE_OY };
});

function makeHouse(scene, key, variant, night) {
  const buf = new IsoBuf(HOUSE_W, HOUSE_H, HOUSE_OX, HOUSE_OY);
  drawHouse(buf, HOUSE_SPECS[variant], variant, night);
  buf.toPx().toTexture(scene, key);
  anchor(key, HOUSE_OX, HOUSE_OY);
}

/* ================================================================
   CHURCH

   The village landmark: a sandstone nave under a steep slate roof, with a
   west tower of three stages — door, clock, belfry — and an octagonal
   slate spire carrying a gilded weathercock. Pale stone against dark slate
   is the strongest value contrast in the village, which is what makes it
   the thing the eye finds first.
================================================================ */

/** The sun, in world axes with height in units (a, b, up). */
const SUN = (() => {
  const v = [-0.55, 0.45, 0.72];
  const l = Math.hypot(...v);
  return v.map((c) => c / l);
})();

/**
 * Ramp index for a face with outward normal `n` (world axes, height in
 * units): `base` at right angles to the sun, `span` steps across the range.
 */
function litIndex(n, base, span) {
  const l = Math.hypot(n[0], n[1], n[2]) || 1;
  const d = (n[0] * SUN[0] + n[1] * SUN[1] + n[2] * SUN[2]) / l;
  return base + d * span;
}

/** Outward normal of a planar polygon given in (a, b, h px). */
function polyNormal(pts) {
  let nx = 0; let ny = 0; let nz = 0;
  for (let i = 0; i < pts.length; i++) {
    const p = pts[i];
    const q = pts[(i + 1) % pts.length];
    const pz = p[2] / ISO_HU;
    const qz = q[2] / ISO_HU;
    nx += (p[1] - q[1]) * (pz + qz);
    ny += (pz - qz) * (p[0] + q[0]);
    nz += (p[0] - q[0]) * (p[1] + q[1]);
  }
  return [nx, ny, nz];
}

/** Dressed stone: courses three rows tall, blocks six columns long. */
function fillAshlar(el, ramp, base, seed, v0 = 0, v1 = el.h - 1) {
  for (let v = v0; v <= v1; v++) {
    const course = Math.floor(v / 3);
    const off = (course & 1) * 3;
    for (let u = 0; u < el.w; u++) {
      const block = Math.floor((u + off) / 6);
      const n = hash2(block, course, seed);
      let i = base + (n > 0.8 ? 1 : n < 0.12 ? -1 : 0);
      if (v % 3 === 2) i = base - 1;
      else if ((u + off) % 6 === 5 && n < 0.7) i = base - 1;
      el.set(u, v, R(ramp, i));
    }
  }
}

/** A pointed lancet with a stone surround and leaded glass. */
function paintLancet(el, u, v, w, h, sh, lit, stone) {
  const half = (w - 1) / 2;
  for (let j = -1; j <= h; j++) {
    for (let i = -1; i <= w; i++) {
      // Pointed head: the top rows narrow toward the middle.
      const fromTop = h - 1 - j;
      const reach = fromTop < 0 ? -1 : fromTop < 2 ? half - (2 - fromTop) * 1.1 + 0.6 : half + 0.6;
      const d = Math.abs(i - half);
      const inGlass = j >= 0 && j < h && i >= 0 && i < w && d <= reach - 0.6;
      const inFrame = d <= reach + 0.6 && j >= -1 && j <= h;
      if (inGlass) {
        const bar = (i === Math.round(half) && j < h - 2) || (j % 3 === 0 && j > 0);
        let c;
        if (lit) c = (bar ? R(P.bGlow, 1) : R(P.bGlow, j > h - 4 ? 4 : 3)) | GLOW;
        else c = bar ? R(P.bIron, 2 - sh) : R(P.bGlass, (i < half ? 3 : 2) - sh + (j > h - 4 ? 1 : 0));
        el.set(u + i, v + j, c);
      } else if (inFrame && el.get(u + i, v + j) >= 0) {
        el.set(u + i, v + j, R(stone, (i < half ? 5 : 4) - sh));
      }
    }
  }
}

/** A clock dial on a tower face, round in the world, sheared on screen. */
function paintClock(el, cu, cv, sh, lit, hourAngle = -0.9, minuteAngle = 0.2) {
  const rx = 3.4;
  const ry = rx * ISO_HU / 2;
  for (let j = -Math.ceil(ry) - 1; j <= Math.ceil(ry) + 1; j++) {
    for (let i = -Math.ceil(rx) - 1; i <= Math.ceil(rx) + 1; i++) {
      const q = Math.hypot(i / (rx + 0.6), j / (ry + 0.6));
      if (q > 1) continue;
      const ring = q > 0.72;
      const c = ring ? R(P.bGlow, i < 0 ? 4 : 3) : (lit ? (R(P.bGlow, 5) | GLOW) : R(P.bGlazed, 3 - sh));
      el.set(cu + i, cv + j, c);
    }
  }
  // Gilded hands.
  const hand = (ang, len) => {
    for (let t = 0; t <= len; t += 0.5) {
      el.set(cu + Math.round(Math.sin(ang) * t), cv + Math.round(Math.cos(ang) * t * (ry / rx)), lit ? R(P.bIron, 0) : R(P.bGlow, 4));
    }
  };
  hand(hourAngle, 1.6);
  hand(minuteAngle, 2.6);
}

const CHURCH_W = 64;
const CHURCH_H = 112;
const CHURCH_OX = 32;
const CHURCH_OY = 96;

function drawChurch(buf, night) {
  const stone = P.bSandstone;
  // Nave.
  const na0 = -8;
  const na1 = 3;
  const nb = 4;
  const wallH = 16;
  const roofH = 17;
  const hr = wallH + roofH;

  const navL = new Elev((na1 - na0) * 2, wallH);
  fillAshlar(navL, stone, 3, 5);
  navL.rect(0, 0, navL.w, 2, R(P.bGreyStone, 2));
  for (const u of [3, 13]) paintLancet(navL, u, 4, 5, 10, 0, night, stone);
  // Eaves shadow.
  for (let v = wallH - 3; v < wallH; v++) {
    for (let u = 0; u < navL.w; u++) {
      const c = navL.get(u, v);
      if (c >= 0 && c < GLOW) navL.set(u, v, mix(c, INK, v >= wallH - 2 ? 0.34 : 0.18));
    }
  }
  wallFace(buf, [na0, nb], [na1, nb], 0, navL, 1);

  // The nave's east gable, mostly behind the tower.
  const navR = new Elev(nb * 4, wallH + roofH + 1);
  fillAshlar(navR, stone, 2, 9);
  for (let v = wallH; v < navR.h; v++) {
    for (let u = 0; u < navR.w; u++) {
      const d = Math.abs(u + 0.5 - nb * 2);
      const top = roofH * (1 - d / (nb * 2)) + 1;
      if (v - wallH >= top) navR.set(u, v, -1);
      else if (v - wallH >= top - 1) navR.set(u, v, R(stone, 4));
    }
  }
  wallFace(buf, [na1, nb], [na1, -nb], 0, navR, 1);

  // Slate roof, ridge along a.
  const ov = 0.75;
  const k = roofH / nb;
  const he = wallH - k * ov;
  buf.face([[na1 + 0.25, 0, hr], [na0 - 0.5, 0, hr], [na0 - 0.5, nb + ov, he], [na1 + 0.25, nb + ov, he]],
    (a, b, h) => roofColor('slate', Math.floor((a - na0 + 0.5) * 2), h - he, hr - h, 4, 17), { tag: 2 });
  buf.face([[na1 + 0.25, 0, hr], [na0 - 0.5, 0, hr], [na0 - 0.5, -nb - ov, he], [na1 + 0.25, -nb - ov, he]],
    (a, b, h) => roofColor('slate', Math.floor((a - na0 + 0.5) * 2), h - he, hr - h, 3, 17), { tag: 2 });

  // Buttresses between the windows, with weathered sloping tops.
  for (const ba of [na0 + 0.25, -3.25]) {
    const bA0 = ba - 0.5;
    const bA1 = ba + 0.5;
    isoCuboid(buf, bA0, bA1, nb, nb + 1.25, 0, 9, {
      left: (a, b, h) => R(stone, Math.floor(h) % 3 === 2 ? 3 : 4),
      right: (a, b, h) => R(stone, Math.floor(h) % 3 === 2 ? 1 : 2),
    }, 1);
    buf.face([[bA0, nb + 1.25, 9], [bA1, nb + 1.25, 9], [bA1, nb, 13], [bA0, nb, 13]], () => R(stone, 5), { tag: 1 });
    buf.face([[bA1, nb + 1.25, 9], [bA1, nb, 13], [bA1, nb, 9]], () => R(stone, 2), { tag: 1 });
  }

  // Tower.
  const ta0 = 3;
  const ta1 = 8;
  const tb = 2.5;
  const TH = 52;
  const towerEl = (sh, front) => {
    const el = new Elev(10, TH + 4);
    fillAshlar(el, stone, 3 - sh, front ? 21 : 27, 0, TH - 1);
    el.rect(0, 0, 10, 3, R(P.bGreyStone, 3 - sh));
    el.hline(0, 9, 3, R(stone, 4 - sh));
    // String courses: a pale band with a shadow under it.
    for (const v of [15, 31, 45]) {
      el.hline(0, 9, v, R(stone, 5 - sh));
      el.hline(0, 9, v - 1, R(stone, 1 - sh));
    }
    if (front) {
      // West door: a pointed arch of dark oak with iron straps.
      paintLancet(el, 2, 3, 6, 9, sh, false, stone);
      for (let v = 3; v < 11; v++) {
        for (let u = 3; u <= 6; u++) {
          if (el.get(u, v) >= 0 && el.get(u, v) !== R(stone, 4 - sh) && el.get(u, v) !== R(stone, 5 - sh)) {
            el.set(u, v, R(P.bWood, (u === 3 ? 3 : 2) - sh + (v % 3 === 0 ? -1 : 0)));
          }
        }
      }
      if (night) el.set(8, 11, R(P.bGlow, 5) | GLOW);
    } else {
      paintLancet(el, 3, 5, 4, 7, sh, night, stone);
    }
    paintClock(el, 5, 23, sh, night);
    // Belfry: two louvred openings.
    for (const u of [2, 6]) {
      for (let v = 33; v <= 42; v++) {
        for (let i = 0; i < 2; i++) {
          const head = v === 42 && i === (u === 2 ? 0 : 1);
          if (head) continue;
          el.set(u + i, v, v % 2 ? R(P.bOutline, 1) : R(P.bWood, 3 - sh - i));
        }
      }
      el.hline(u - 1, u + 2, 32, R(stone, 5 - sh));
    }
    // Cornice and a crenellated parapet.
    el.hline(0, 9, TH - 1, R(stone, 5 - sh));
    el.hline(0, 9, TH - 2, R(stone, 1 - sh));
    for (let v = TH; v < TH + 4; v++) {
      for (let u = 0; u < 10; u++) {
        const merlon = v < TH + 2 || (u % 4 < 2);
        el.set(u, v, merlon ? R(stone, (v === TH + 3 || (v === TH + 1 && u % 4 >= 2) ? 5 : 3) - sh) : -1);
      }
    }
    return el;
  };
  wallFace(buf, [ta0, tb], [ta1, tb], 0, towerEl(0, false), 1);
  wallFace(buf, [ta1, tb], [ta1, -tb], 0, towerEl(1, true), 1);
  // Lead flat inside the parapet (only seen through the crenels).
  isoCuboid(buf, ta0, ta1, -tb, tb, TH - 1, TH, { top: R(P.bIron, 2) }, 1);

  // Octagonal spire, each face lit by its own angle to the sun.
  const cx = (ta0 + ta1) / 2;
  const sr = 2.35;
  const apex = [cx, 0, 90];
  const base = [];
  for (let i = 0; i < 8; i++) {
    const ang = (i / 8) * TAU + TAU / 16;
    base.push([cx + Math.cos(ang) * sr, Math.sin(ang) * sr, TH + 1]);
  }
  for (let i = 0; i < 8; i++) {
    const tri = [base[i], base[(i + 1) % 8], apex];
    const n = polyNormal(tri);
    const idx = litIndex(n, 2.4, 2.4);
    buf.face(tri, (a, b, h) => {
      const course = Math.floor(h - TH) % 4;
      return R(P.bSlate, idx + (course === 0 ? -1 : 0));
    }, { tag: 2 });
  }
  // Broaches: little slate pyramids on the corners of the tower top.
  for (const [pa, pb] of [[ta0 + 0.6, tb - 0.6], [ta1 - 0.6, tb - 0.6], [ta1 - 0.6, -tb + 0.6]]) {
    const r = 0.6;
    const pts = [[pa - r, pb - r], [pa + r, pb - r], [pa + r, pb + r], [pa - r, pb + r]].map((p) => [p[0], p[1], TH + 1]);
    const top = [pa, pb, TH + 9];
    for (let i = 0; i < 4; i++) {
      const tri = [pts[i], pts[(i + 1) % 4], top];
      buf.face(tri, () => R(P.bSlate, litIndex(polyNormal(tri), 2.6, 2.2)), { tag: 2 });
    }
  }
  // Gilded ball, cross-arm and weathercock.
  const gold = (t) => R(P.bGlow, t);
  buf.line3([cx, 0, 90], [cx, 0, 99], gold(3), { tag: 3 });
  buf.line3([cx - 0.5, 0.5, 95], [cx + 0.5, -0.5, 95], gold(4), { tag: 3 });
  const [gx, gy] = buf.proj(cx, 0, 91);
  buf.put(Math.floor(gx) - 1, Math.floor(gy), gold(4), 1e7, 3);
  buf.put(Math.floor(gx), Math.floor(gy), gold(3), 1e7, 3);
  const [kx, ky] = buf.proj(cx, 0, 100);
  // The cockerel: head left, tail up right.
  for (const [dx, dy, t] of [[-1, 0, 5], [0, 0, 4], [1, 0, 3], [1, -1, 4], [2, -1, 3], [-1, 1, 3]]) {
    buf.put(Math.floor(kx) + dx, Math.floor(ky) + dy, gold(t), 1e7, 3);
  }

  finishSprite(buf, contactOf(na0, ta1, -nb, nb), { night });
}

function makeChurch(scene, key, night) {
  const buf = new IsoBuf(CHURCH_W, CHURCH_H, CHURCH_OX, CHURCH_OY);
  drawChurch(buf, night);
  buf.toPx().toTexture(scene, key);
  anchor(key, CHURCH_OX, CHURCH_OY);
}

/* ================================================================
   RUIN

   A house the sea took: the same footprint and bond as the village, burnt
   and drowned — jagged wall stumps with the windows gaping through to the
   inside, the roof timbers fallen in, rubble spilling out and a tide mark.
================================================================ */

function makeRuin(scene, key) {
  const buf = new IsoBuf(HOUSE_W, HOUSE_H, HOUSE_OX, HOUSE_OY);
  const ea = 5;
  const eb = 6;
  const brick = P.bBrick;

  /** A broken wall: brick up to a jagged top, soot above, silt below. */
  const broken = (w, h, sh, seed, heights, holes) => {
    const el = new Elev(w, h);
    fillBrick(el, brick, 2 - sh, seed);
    for (let u = 0; u < w; u++) {
      const top = heights(u);
      for (let v = 0; v < h; v++) {
        if (v >= top) { el.set(u, v, -1); continue; }
        const c = el.get(u, v);
        if (v < 5) el.set(u, v, mix(c, P.flood[1], v < 3 ? 0.5 : 0.3));
        else if (v > top - 4 && hash2(u >> 1, v >> 1, seed) > 0.3) el.set(u, v, mix(c, P.bOutline[0], 0.5));
        if (v === top - 1) el.set(u, v, R(brick, 3 - sh));
      }
    }
    for (const [hu, hv, hw, hh] of holes) {
      for (let j = 0; j < hh; j++) for (let i = 0; i < hw; i++) {
        if (el.get(hu + i, hv + j) >= 0) el.set(hu + i, hv + j, -1);
      }
      el.hline(hu - 1, hu + hw, hv - 1, R(P.bSandstone, 3 - sh));
    }
    return el;
  };
  const jag = (seed, base, amp, len) => (u) => {
    const t = u / len;
    return Math.round(base(t) + (hash2(u >> 1, 0, seed) - 0.5) * amp);
  };

  // Back walls first; their inner faces are what shows through the gaps.
  const backB = broken(4 * ea, 26, 1, 41, jag(3, (t) => 20 - t * 8, 5, 4 * ea), [[3, 6, 4, 6]]);
  wallFace(buf, [-ea, -eb], [ea, -eb], 0, backB, 1);
  const backA = broken(4 * eb, 26, 0, 43, jag(5, (t) => 12 + t * 10, 5, 4 * eb), [[14, 6, 4, 6]]);
  wallFace(buf, [-ea, eb], [-ea, -eb], 0, backA, 1);

  // Rubble floor inside.
  buf.face([[-ea, -eb, 1], [ea, -eb, 1], [ea, eb, 1], [-ea, eb, 1]], (a, b) => {
    const n = hash2(Math.floor(a * 1.5), Math.floor(b * 1.5), 7);
    return n > 0.7 ? R(brick, 2) : n > 0.45 ? R(P.bPantile, 2) : R(P.bOutline, 2);
  }, { tag: 1 });

  // Fallen roof timbers, charred.
  const beam = (p, q) => {
    buf.line3(p, q, R(P.bWood, 1), { tag: 3 });
    buf.line3([p[0], p[1], p[2] + 1], [q[0], q[1], q[2] + 1], R(P.bWood, 3), { tag: 3 });
  };
  beam([-ea + 0.5, -eb + 1, 19], [2, 2, 1]);
  beam([-1, -eb + 0.5, 16], [ea - 1, 1, 1]);
  beam([-ea + 1, 1, 12], [3, -3, 1]);

  // Front walls, lower and more broken: the gable end keeps one tall pier.
  const frontB = broken(4 * ea, 32, 0, 47, jag(7, (t) => (t < 0.3 ? 26 - t * 20 : t < 0.7 ? 7 : 12 - (t - 0.7) * 16), 4, 4 * ea), [[3, 9, 4, 7]]);
  wallFace(buf, [-ea, eb], [ea, eb], 0, frontB, 1);
  const frontA = broken(4 * eb, 22, 1, 53, jag(9, (t) => (t < 0.4 ? 9 - t * 8 : 6 + Math.sin(t * 7) * 3), 4, 4 * eb), [[17, 5, 3, 5]]);
  wallFace(buf, [ea, eb], [ea, -eb], 0, frontA, 1);

  // Rubble spilling out of the gaps.
  const pile = (a, b, s, h, seed) => {
    isoCuboid(buf, a - s, a + s, b - s, b + s, 0, h, {
      left: (pa, pb, ph, x, y) => (hash2(x >> 1, y, seed) > 0.5 ? R(brick, 3) : R(brick, 2)),
      right: (pa, pb, ph, x, y) => (hash2(x >> 1, y, seed) > 0.5 ? R(brick, 2) : R(brick, 1)),
      top: (pa, pb, ph, x, y) => (hash2(x >> 1, y, seed) > 0.6 ? R(P.bPantile, 4) : R(brick, 4)),
    }, 4);
  };
  pile(1.5, eb + 1.2, 0.9, 2, 1);
  pile(3, eb + 1.6, 0.6, 1, 2);
  pile(ea + 1.3, -1, 0.8, 2, 3);
  pile(ea + 1.1, 2.5, 0.5, 1, 4);

  finishSprite(buf, contactOf(-ea, ea, -eb, eb, 1.75));
  // Standing water left around the foot of it.
  buf.shadowPoly([[-ea - 1, eb + 2.5, 0], [ea + 2.5, eb + 2.5, 0], [ea + 2.5, -eb - 0.5, 0], [ea + 1.5, -eb - 0.5, 0], [ea + 1.5, eb + 1.5, 0], [-ea - 1, eb + 1.5, 0]],
    P.flood[2], (x, y) => ((x + y) % 5 === 0 ? 0.55 : 0.35));
  buf.toPx().toTexture(scene, key);
  anchor(key, HOUSE_OX, HOUSE_OY);
}

/* ================================================================
   WINDMILL

   An eight-sided stage mill (achtkante stellingmolen), the poldermolen of
   the Beemster: a brick base, a timber stage on struts, a thatched body
   tapering to a thatched cap, and a tail pole down to the stage for turning
   the cap into the wind.

   The sails turn in a real plane in front of the cap, square to a shaft
   that points off toward the lit side and tilts up a few degrees the way
   real windshafts do — so the sail disc is seen at an angle, as a sheared
   ellipse, not face-on. The plane sits far enough in front of the body, and
   the tips clear the stage railing by several pixels, so no frame can put a
   sail through the tower; the depth buffer draws the rest.

   Sixteen frames cover a quarter turn: four identical sails make a quarter
   turn a seamless loop. They turn anticlockwise seen from the front, as
   Dutch mills do, with the lattice on the trailing side of each stock.
================================================================ */

const MILL_W = 96;
const MILL_H = 118;
const MILL_OX = 52;
const MILL_OY = 104;
const MILL_FRAMES = 16;

const MILL = {
  baseR0: 7, baseR1: 6.5,
  deckR: 10, deckH: 18,
  bodyR0: 6, bodyR1: 3.6, bodyH: 60,
  psi: 1.27, tilt: 0.14, hubOff: 6.8, hubH: 67,
  sail: 15.5, sailW: 3.4, sailStart: 3.2,
};

/** Octagon vertices at radius r, height h, flats square to the axes. */
function octagon(r, h, ca = 0, cb = 0) {
  const pts = [];
  for (let i = 0; i < 8; i++) {
    const ang = (i + 0.5) * (TAU / 8);
    pts.push([ca + Math.cos(ang) * r, cb + Math.sin(ang) * r, h]);
  }
  return pts;
}

/** The static part of the mill: base, stage, body, cap and tail. */
function drawMillBody(buf) {
  const M = MILL;
  const D = [Math.cos(M.psi), Math.sin(M.psi)];
  const E = [-D[1], D[0]];

  // --- Brick base.
  const b0 = octagon(M.baseR0, 0);
  const b1 = octagon(M.baseR1, M.deckH + 1);
  for (let i = 0; i < 8; i++) {
    const j = (i + 1) % 8;
    const quad = [b0[i], b0[j], b1[j], b1[i]];
    const idx = litIndex(polyNormal(quad), 2.6, 1.8);
    const [xc] = buf.proj((b0[i][0] + b0[j][0]) / 2, (b0[i][1] + b0[j][1]) / 2, 0);
    const front = i === 0;
    const side = i === 1;
    buf.face(quad, (a, b, h, x) => {
      const v = Math.floor(h);
      const du = x + 0.5 - xc;
      // Door to the mill floor on the face toward the viewer.
      if (front && Math.abs(du) <= 3 && v < 11) {
        if (Math.abs(du) > 2 || v === 10) return R(P.bWhitePaint, 4);
        return R(P.bGreenPaint, (du < 0 ? 4 : 3) - (v === 5 ? 1 : 0));
      }
      if (side && Math.abs(du) <= 2 && v >= 11 && v < 16) {
        if (Math.abs(du) > 1 || v === 11 || v === 15) return R(P.bWhitePaint, 4);
        return R(P.bGlass, v > 13 ? 4 : 2);
      }
      if (v < 2) return R(P.bKlinker, 1);
      const course = Math.floor(v / 3);
      const off = (course & 1) * 2;
      const n = hash2(Math.floor((x + off) / 4), course, 5);
      return R(P.bBrick, idx + (n > 0.85 ? 1 : n < 0.1 ? -1 : 0) - (v % 3 === 2 && n < 0.6 ? 1 : 0));
    }, { tag: 1 });
  }

  // --- Stage: deck, its edge, struts and railing.
  const deck = octagon(M.deckR, M.deckH);
  const deckLow = octagon(M.deckR, M.deckH - 2);
  buf.face(deck, (a, b) => {
    const plank = Math.floor((a - b) * 1.2);
    return R(P.bWood, 5 - (plank % 3 === 0 ? 1 : 0));
  }, { tag: 4 });
  for (let i = 0; i < 8; i++) {
    const j = (i + 1) % 8;
    const quad = [deckLow[i], deckLow[j], deck[j], deck[i]];
    const idx = litIndex(polyNormal(quad), 2.2, 1.4);
    buf.face(quad, (a, b, h) => R(P.bWood, idx - (h < M.deckH - 1 ? 1 : 0)), { tag: 4 });
  }
  for (let i = 0; i < 8; i++) {
    const v = deck[i];
    const inner = octagon(M.baseR0 - 0.3, 8)[i];
    const edge = [v[0] * 0.95, v[1] * 0.95, M.deckH - 2];
    buf.line3(edge, inner, R(P.bWood, 2), { tag: 4 });
  }
  const rail = octagon(M.deckR - 0.3, M.deckH + 5);
  const railMid = octagon(M.deckR - 0.3, M.deckH + 2.5);
  for (let i = 0; i < 8; i++) {
    const j = (i + 1) % 8;
    buf.line3([rail[i][0], rail[i][1], M.deckH], rail[i], R(P.bWood, 2), { tag: 4 });
    buf.line3(rail[i], rail[j], R(P.bWood, 4), { tag: 4 });
    buf.line3(railMid[i], railMid[j], R(P.bWood, 2), { tag: 4 });
  }

  // --- Thatched body.
  const t0 = octagon(M.bodyR0, M.deckH);
  const t1 = octagon(M.bodyR1, M.bodyH);
  for (let i = 0; i < 8; i++) {
    const j = (i + 1) % 8;
    const quad = [t0[i], t0[j], t1[j], t1[i]];
    const idx = litIndex(polyNormal(quad), 2.7, 2.1);
    const [xc] = buf.proj((t0[i][0] + t0[j][0]) / 2, (t0[i][1] + t0[j][1]) / 2, 0);
    const front = i === 0;
    const side = i === 1;
    buf.face(quad, (a, b, h, x) => {
      const v = Math.floor(h);
      const du = x + 0.5 - xc;
      // Stage door, and small windows up the body with their thatch hoods.
      if (front && Math.abs(du) <= 2.5 && v >= M.deckH && v < M.deckH + 10) {
        if (Math.abs(du) > 1.5 || v === M.deckH + 9) return R(P.bWhitePaint, 4);
        return R(P.bGreenPaint, du < 0 ? 4 : 3);
      }
      if ((front && v >= 36 && v < 41 && Math.abs(du) <= 2) || (side && v >= 46 && v < 50 && Math.abs(du) <= 1.5)) {
        const top = front ? 40 : 49;
        const bot = front ? 36 : 46;
        if (Math.abs(du) > (front ? 1 : 0.5) || v === top || v === bot) return R(P.bWhitePaint, 4);
        return R(P.bGlass, v === top - 1 ? 4 : 2);
      }
      if ((front && v === 41 && Math.abs(du) <= 3) || (side && v === 50 && Math.abs(du) <= 2.5)) return R(P.bThatch, idx - 2);
      // Reed strands running down the body, a whole strand at a time.
      const n = hash2(x, Math.floor((h + hash2(x, 3, 9) * 7) / 7), 9);
      let k = idx + (n > 0.74 ? 1 : n < 0.2 ? -1 : 0);
      if (v < M.deckH + 2) k -= 1;
      return R(P.bThatch, k);
    }, { tag: 1 });
  }
  // Corner ridges: the eight posts under the thatch catch a line of light.
  for (let i = 0; i < 8; i++) {
    const lit = i >= 1 && i <= 3;
    buf.line3(t0[i], t1[i], R(P.bThatch, lit ? 4 : 1), { tag: 1, bias: 0.3 });
  }

  // --- Cap: a thatched hood elongated along the windshaft.
  const prof = [[-4.4, 0], [-4.3, 3], [-3.8, 5.5], [-2.9, 7.6], [-1.6, 9.1], [0, 9.8],
    [1.6, 9.1], [2.9, 7.6], [3.8, 5.5], [4.3, 3], [4.4, 0]];
  const T0 = -5.4;
  const T1 = 5;
  const at = (t, e, z) => [D[0] * t + E[0] * e, D[1] * t + E[1] * e, M.bodyH + z];
  for (let j = 0; j + 1 < prof.length; j++) {
    const [e0, z0] = prof[j];
    const [e1, z1] = prof[j + 1];
    const quad = [at(T0, e0, z0), at(T1, e0, z0), at(T1, e1, z1), at(T0, e1, z1)];
    const idx = litIndex(polyNormal(quad), 2.8, 2.2);
    buf.face(quad, (a, b, h) => {
      const t = a * D[0] + b * D[1];
      const col = Math.floor(t * 2);
      const n = hash2(col, Math.floor((h - M.bodyH) / 3), 21);
      return R(P.bThatch, idx + (n > 0.78 ? 1 : n < 0.2 ? -1 : 0) - (h < M.bodyH + 1.5 ? 1 : 0));
    }, { tag: 2 });
  }
  // Front board (the keuvel) and back of the hood.
  const front = prof.map(([e, z]) => at(T1, e, z));
  buf.face(front, (a, b, h) => {
    const z = h - M.bodyH;
    const e = (a * E[0] + b * E[1]);
    const rim = z > 8.4 - Math.abs(e) * 0.9 || Math.abs(e) > 3.9;
    return rim ? R(P.bGreenPaint, 3) : R(P.bWhitePaint, z < 1 ? 3 : 4);
  }, { tag: 2 });
  buf.face(prof.map(([e, z]) => at(T0, e, z)), () => R(P.bThatch, 1), { tag: 2 });

  // --- Tail pole and its braces, down to the winch on the stage.
  const tailTop = at(T0 + 0.3, 0, 0.5);
  const tailFoot = [D[0] * -(M.deckR + 0.6), D[1] * -(M.deckR + 0.6), M.deckH + 4];
  for (const off of [-0.25, 0.25]) {
    buf.line3([tailTop[0] + E[0] * off, tailTop[1] + E[1] * off, tailTop[2]],
      [tailFoot[0] + E[0] * off, tailFoot[1] + E[1] * off, tailFoot[2]], R(P.bWood, off < 0 ? 3 : 1), { tag: 4 });
  }
  const braceAt = (k) => [tailTop[0] + (tailFoot[0] - tailTop[0]) * k, tailTop[1] + (tailFoot[1] - tailTop[1]) * k,
    tailTop[2] + (tailFoot[2] - tailTop[2]) * k];
  for (const e of [-3.6, 3.6]) buf.line3(at(-3.4, e, 0.5), braceAt(0.45), R(P.bWood, 2), { tag: 4 });
  // The winch wheel, standing in the plane of the tail.
  const wc = braceAt(0.93);
  let prev = null;
  for (let s = 0; s <= 16; s++) {
    const ang = (s / 16) * TAU;
    const p = [wc[0] + E[0] * Math.cos(ang) * 1.8, wc[1] + E[1] * Math.cos(ang) * 1.8, wc[2] + Math.sin(ang) * 1.8 * ISO_HU];
    if (prev) buf.line3(prev, p, R(P.bWood, 3), { tag: 4 });
    prev = p;
  }

  // --- The windshaft running out through the front board to the hub.
  const hub = [D[0] * M.hubOff, D[1] * M.hubOff, M.hubH];
  const shaftIn = at(T1 - 0.5, 0, M.hubH - M.bodyH - 0.6);
  for (const dz of [0, 1]) {
    buf.line3([shaftIn[0], shaftIn[1], shaftIn[2] + dz], [hub[0], hub[1], hub[2] + dz], R(P.bIron, dz ? 4 : 2), { tag: 5 });
  }
  return hub;
}

/**
 * The four sails at angle `theta`, in the plane square to the tilted shaft.
 */
function drawMillSails(buf, hub, theta) {
  const M = MILL;
  const D = [Math.cos(M.psi), Math.sin(M.psi)];
  const E1 = [-D[1], D[0]];
  const ct = Math.cos(M.tilt);
  const st = Math.sin(M.tilt);
  // A point of the sail plane from its own coordinates (x across, y up).
  const P3 = (x, y) => [
    hub[0] + E1[0] * x - D[0] * st * y,
    hub[1] + E1[1] * x - D[1] * st * y,
    hub[2] + ct * y * ISO_HU,
  ];
  const plane = (a, b, h) => {
    const y = (h - hub[2]) / (ct * ISO_HU);
    const x = (a - hub[0] + D[0] * st * y) * E1[0] + (b - hub[1] + D[1] * st * y) * E1[1];
    return [x, y];
  };
  const L = M.sail;
  const W = M.sailW;
  const u0 = M.sailStart;
  for (let k = 0; k < 4; k++) {
    const phi = theta + k * (TAU / 4);
    const c = Math.cos(phi);
    const s = Math.sin(phi);
    const at = (u, v) => P3(u * c - v * s, u * s + v * c);
    const local = (a, b, h) => {
      const [x, y] = plane(a, b, h);
      return [x * c + y * s, -x * s + y * c];
    };
    // Canvas on the trailing side (+v), laced to the lattice.
    buf.face([at(u0, 0.4), at(L, 0.4), at(L, W + 0.4), at(u0, W + 0.4)], (a, b, h) => {
      const [u, v] = local(a, b, h);
      const edge = v > W - 0.3;
      const root = u < u0 + 1.2;
      return R(P.bCanvas, 4 - (edge ? 1 : 0) - (root ? 1 : 0) + (v < 1.4 && u > u0 + 3 ? 1 : 0));
    }, { tag: 6, bias: 0.4 });
    // Leading-edge board.
    buf.face([at(u0 + 1, -0.35), at(L, -0.35), at(L, -0.95), at(u0 + 1, -0.95)],
      () => R(P.bWood, 3), { tag: 6, bias: 0.4 });
    // Lattice: sail bars across, the outer lath along.
    for (let u = u0; u <= L + 0.01; u += 1.35) {
      buf.line3(at(u, 0.3), at(u, W + 0.45), R(P.bWood, 2), { tag: 6, bias: 0.8 });
    }
    buf.line3(at(u0, W + 0.45), at(L, W + 0.45), R(P.bWood, 1), { tag: 6, bias: 0.8 });
    // The stock: a light edge and a dark one, two pixels thick.
    buf.line3(at(0, -0.3), at(L + 0.4, -0.3), R(P.bWood, 4), { tag: 6, bias: 1.1 });
    buf.line3(at(0, 0.3), at(L + 0.4, 0.3), R(P.bWood, 1), { tag: 6, bias: 1.1 });
  }
  // The iron head of the shaft over the crossing.
  const head = [];
  for (let i = 0; i < 8; i++) {
    const ang = (i / 8) * TAU;
    head.push(P3(Math.cos(ang) * 1.1, Math.sin(ang) * 1.1));
  }
  buf.face(head, (a, b, h) => {
    const [x, y] = plane(a, b, h);
    return R(P.bIron, x > 0.2 || y > 0.3 ? 4 : 2);
  }, { tag: 5, bias: 2 });
}

function makeWindmill(scene) {
  const base = new IsoBuf(MILL_W, MILL_H, MILL_OX, MILL_OY);
  const hub = drawMillBody(base);
  for (let f = 0; f < MILL_FRAMES; f++) {
    const buf = base.clone();
    // Anticlockwise as seen from the front, which in the sail plane's own
    // axes (x toward screen-left) is a falling angle.
    drawMillSails(buf, hub, 0.18 - (f / MILL_FRAMES) * (TAU / 4));
    finishSprite(buf, contactOf(-MILL.baseR0, MILL.baseR0, -MILL.baseR0, MILL.baseR0, 1));
    const key = `b_windmill_${f}`;
    buf.toPx().toTexture(scene, key);
    anchor(key, MILL_OX, MILL_OY);
  }
}

/* ================================================================
   PUMPING STATION & SLUICE
================================================================ */

/**
 * The pumping station (gemaal) of the 2100 scenario: an electric station of
 * the kind the Netherlands has run since the last steam engines went, not a
 * coal-fired engine hall. A low brick hall on a concrete plinth, a band of
 * windows under a concrete coping, solar panels on the flat roof, three
 * discharge culverts in the end wall facing the canal, and a switchgear
 * cabinet beside it. No stack and no smoke: in 2100 the station runs on the
 * grid. The four frames carry the outfall churning out of the culverts and
 * the cabinet's status light.
 */
const PUMP_W = 72;
const PUMP_H = 70;
const PUMP_OX = 38;
const PUMP_OY = 50;

function drawPumpHall(buf) {
  const a0 = -6;
  const a1 = 5;
  const b0 = -5;
  const b1 = 5;
  const P0 = 3; // plinth
  const H = 16; // eaves

  // Concrete plinth, a little wider than the hall.
  isoCuboid(buf, a0 - 0.5, a1 + 0.5, b0 - 0.5, b1 + 0.5, 0, P0, {
    left: R(P.bGreyStone, 4), right: R(P.bGreyStone, 3), top: R(P.bGreyStone, 5),
  }, 1);

  // Walls: dark klinker brick, a ribbon of windows high up, a concrete coping.
  const wall = (base) => (a, b, h, x) => {
    const v = Math.floor(h);
    if (v >= H - 1) return R(P.bGreyStone, base + 2);
    if (v >= 10 && v <= 12) {
      if (x % 7 === 0) return R(P.bIron, base);
      return R(P.bGlass, v === 12 ? base + 1 : base);
    }
    if (v === 9 || v === 13) return R(P.bGreyStone, base + 1);
    const course = Math.floor(v / 3);
    if (v % 3 === 2 && (x + course * 2) % 4 === 0) return R(P.bKlinker, base - 1);
    return R(P.bKlinker, base + 1);
  };
  isoCuboid(buf, a0, a1, b0, b1, P0, H, { left: wall(3), right: wall(2) }, 1);

  // Flat roof with a parapet.
  isoCuboid(buf, a0, a1, b0, b1, H, H + 1, {
    left: R(P.bGreyStone, 4), right: R(P.bGreyStone, 3), top: R(P.bGreyStone, 2),
  }, 2);

  // Solar panels in three rows, cells picked out in a lighter blue.
  for (let r = 0; r < 3; r++) {
    const pb = b0 + 1 + r * 3;
    isoCuboid(buf, a0 + 1, a1 - 1, pb, pb + 2, H + 1, H + 2.4, {
      left: R(P.bIron, 1),
      right: R(P.bIron, 2),
      top: (a, b, h, x) => (x % 4 === 0 || (Math.floor(a * 2) % 3 === 0) ? R(P.bGlass, 3) : R(P.bGlass, 1)),
    }, 2);
  }

  // Three discharge culverts in the end wall that faces the canal.
  for (const bc of [-3, 0, 3]) {
    buf.face([[a1 + 0.05, bc + 1.1, P0], [a1 + 0.05, bc - 1.1, P0],
      [a1 + 0.05, bc - 1.1, 8], [a1 + 0.05, bc + 1.1, 8]],
    (a, b, h) => (h > 7 ? R(P.bGreyStone, 4) : R(P.bOutline, 1)), { tag: 3 });
  }

  // Switchgear cabinet beside the hall, with a yellow hazard band.
  isoCuboid(buf, a0 + 1, a0 + 4, b1 + 0.8, b1 + 2.6, 0, 7, {
    left: (a, b, h) => (Math.floor(h) === 5 ? P.tulipYellow[2] : R(P.bIron, 3)),
    right: (a, b, h) => (Math.floor(h) === 5 ? P.tulipYellow[1] : R(P.bIron, 2)),
    top: R(P.bIron, 4),
  }, 3);

  return { outfall: [a1, 0, P0], a1, b0, b1, a0, light: [a0 + 3.4, b1 + 2.6, 6] };
}

function makePump(scene, hall, frame) {
  const buf = hall.clone();
  // Outfall water churning out of the culverts.
  for (const bc of [-3, 0, 3]) {
    const [ox, oy] = buf.proj(hall.info.a1 + 0.2, bc, hall.info.outfall[2]);
    for (let i = 0; i < 6; i++) {
      for (let j = 0; j < 2; j++) {
        const x = Math.round(ox - 2 + i);
        const y = Math.round(oy + j + i * 0.5);
        const foam = ((i + frame * 2 + j + bc) % 4) === 0;
        buf.put(x, y, foam ? P.foam[1] : R(P.canal, 3 - j), 1e5, 8);
      }
    }
  }
  // The cabinet's status light, on for two frames in four.
  const [lx, ly] = buf.proj(...hall.info.light);
  buf.put(Math.round(lx), Math.round(ly), frame < 2 ? 0x7cff8a : R(P.bIron, 2), 1e6, 8);
  finishSprite(buf, contactOf(hall.info.a0, hall.info.a1, hall.info.b0, hall.info.b1 + 2.6));
  const key = `s_pump_${frame}`;
  buf.toPx().toTexture(scene, key);
  anchor(key, PUMP_OX, PUMP_OY);
}

function makePumps(scene) {
  const hall = new IsoBuf(PUMP_W, PUMP_H, PUMP_OX, PUMP_OY);
  hall.info = drawPumpHall(hall);
  for (let f = 0; f < 4; f++) makePump(scene, hall, f);
}

/**
 * The steam pumping station (stoomgemaal) of the 1850s scenario, the kind that drained the Haarlemmermeer: a brick engine
 * hall under slate with round-arched windows and a roof ventilator, its
 * boiler stack standing behind, and the discharge arch in the gable end.
 * The four frames carry the animation: smoke rolling off the stack, a
 * wisp of steam from the roof, and the outfall churning.
 */
const STEAM_W = 72;
const STEAM_H = 118;
const STEAM_OX = 38;
const STEAM_OY = 98;

function drawSteamHall(buf) {
  const a0 = -6;
  const a1 = 5;
  const eb = 4.5;
  const wallH = 18;
  const roofH = 10;
  const hr = wallH + roofH;
  const brick = P.bBrick;

  // Boiler stack behind the hall: square, tapering, banded.
  const sa = -3.2;
  const sb = -6.4;
  const SH = 60;
  const sq = (r, h) => [[sa - r, sb - r, h], [sa + r, sb - r, h], [sa + r, sb + r, h], [sa - r, sb + r, h]];
  const s0 = sq(1.6, 0);
  const s1 = sq(1.05, SH);
  const stackShade = (base) => (a, b, h, x) => {
    const v = Math.floor(h);
    if (v >= SH - 4) return R(P.bKlinker, base + (v === SH - 4 ? 1 : 0));
    if (v % 16 === 8 || v % 16 === 9) return R(P.bSandstone, base + 1);
    const course = Math.floor(v / 3);
    return R(brick, base - (v % 3 === 2 && (x + course) % 3 === 0 ? 1 : 0));
  };
  buf.face([s0[3], s0[2], s1[2], s1[3]], stackShade(3), { tag: 3 });
  buf.face([s0[2], s0[1], s1[1], s1[2]], stackShade(2), { tag: 3 });
  // Corbelled crown and the flue.
  isoCuboid(buf, sa - 1.3, sa + 1.3, sb - 1.3, sb + 1.3, SH, SH + 2, {
    left: R(P.bKlinker, 3), right: R(P.bKlinker, 2), top: R(P.bKlinker, 4),
  }, 3);
  isoCuboid(buf, sa - 0.8, sa + 0.8, sb - 0.8, sb + 0.8, SH + 2, SH + 2.02, { top: R(P.bOutline, 0) }, 3);

  // Long wall, lit: three round-arched windows between pilasters.
  const left = new Elev((a1 - a0) * 2, wallH);
  fillBrick(left, brick, 3, 71);
  left.rect(0, 0, left.w, 2, R(P.bKlinker, 1));
  left.hline(0, left.w - 1, 2, R(P.bSandstone, 4));
  for (const u of [3, 9, 15]) {
    for (let j = 0; j < 11; j++) {
      for (let i = 0; i < 4; i++) {
        const head = j >= 9 && (i === 0 || i === 3);
        if (head) continue;
        const frame = i === 0 || i === 3 || j === 0 || j === 10 || (j >= 9 && (i === 1 || i === 2) && j === 10);
        const bar = (j === 4 || j === 8) || i === 2;
        left.set(u + i, 5 + j, frame ? R(P.bWhitePaint, 4) : bar ? R(P.bWhitePaint, 3) : R(P.bGlass, j > 6 ? 4 : 2));
      }
    }
    // Brick arch over each window.
    left.hline(u, u + 3, 16, R(P.bSandstone, 4));
    left.hline(u - 1, u + 4, 4, R(P.bSandstone, 4));
  }
  for (const u of [0, 7, 13, 21]) left.vline(u, 3, wallH - 1, R(brick, 4));
  for (let u = 0; u < left.w; u++) {
    left.set(u, wallH - 1, R(P.bSandstone, 4));
    left.set(u, wallH - 2, R(brick, 1));
  }
  wallFace(buf, [a0, eb], [a1, eb], 0, left, 1);

  // Gable end, shaded: oculus, the outfall arch and a date stone.
  const g = new Elev(eb * 4, wallH + roofH + 2);
  fillBrick(g, brick, 2, 73);
  g.rect(0, 0, g.w, 2, R(P.bKlinker, 0));
  const cu = eb * 2;
  for (let v = wallH; v < g.h; v++) {
    for (let u = 0; u < g.w; u++) {
      const d = Math.abs(u + 0.5 - cu);
      const top = roofH * (1 - d / cu) + 1.5;
      if (v - wallH >= top) g.set(u, v, -1);
      else if (v - wallH >= top - 1.2) g.set(u, v, R(P.bSandstone, 3));
    }
  }
  for (let j = -4; j <= 4; j++) {
    for (let i = -4; i <= 4; i++) {
      const q = Math.hypot(i / 3.6, j / 4.4);
      if (q > 1) continue;
      const c = q > 0.7 ? R(P.bSandstone, 3) : (i === 0 || j === 0) ? R(P.bWhitePaint, 3) : R(P.bGlass, j > 0 ? 3 : 1);
      g.set(cu - 1 + i, 20 + j, c);
    }
  }
  // Outfall arch.
  for (let j = 0; j < 8; j++) {
    for (let i = -4; i <= 3; i++) {
      const d = Math.abs(i + 0.5);
      const inArch = j < 5 || d < 4 - (j - 4) * 1.1;
      if (!inArch) continue;
      const ring = !(j < 6 && d < 3) && !(j >= 5 && d < 3 - (j - 5) * 1.2);
      g.set(cu + i, j, ring ? R(P.bSandstone, 3) : R(P.bOutline, 1));
    }
  }
  wallFace(buf, [a1, eb], [a1, -eb], 0, g, 1);

  // Slate roof.
  const ov = 0.6;
  const k = roofH / eb;
  const he = wallH - k * ov;
  buf.face([[a1 + 0.3, 0, hr], [a0 - 0.4, 0, hr], [a0 - 0.4, eb + ov, he], [a1 + 0.3, eb + ov, he]],
    (a, b, h) => roofColor('slate', Math.floor((a - a0) * 2), h - he, hr - h, 4, 31), { tag: 2 });
  buf.face([[a1 + 0.3, 0, hr], [a0 - 0.4, 0, hr], [a0 - 0.4, -eb - ov, he], [a1 + 0.3, -eb - ov, he]],
    (a, b, h) => roofColor('slate', Math.floor((a - a0) * 2), h - he, hr - h, 3, 31), { tag: 2 });
  // Roof ventilator along the ridge: louvred sides under a little roof.
  isoCuboid(buf, -3, 1.5, -1, 1, hr - 2, hr + 4, {
    left: (a, b, h) => (Math.floor(h) % 2 ? R(P.bWood, 2) : R(P.bWhitePaint, 3)),
    right: (a, b, h) => (Math.floor(h) % 2 ? R(P.bWood, 1) : R(P.bWhitePaint, 2)),
  }, 2);
  buf.face([[1.8, 0, hr + 7], [-3.3, 0, hr + 7], [-3.3, 1.6, hr + 3.6], [1.8, 1.6, hr + 3.6]], () => R(P.bSlate, 4), { tag: 2 });
  buf.face([[1.8, 0, hr + 7], [-3.3, 0, hr + 7], [-3.3, -1.6, hr + 3.6], [1.8, -1.6, hr + 3.6]], () => R(P.bSlate, 3), { tag: 2 });
  buf.face([[1.8, 1.6, hr + 3.6], [1.8, -1.6, hr + 3.6], [1.8, 0, hr + 7]], () => R(P.bSlate, 2), { tag: 2 });
  return { stackTop: [sa, sb, SH + 2], outfall: [a1, 0, 0], a1, eb };
}

/** A puff of smoke: a lit disc of cloud, eroded as it thins out. */
function smokePuff(buf, x, y, r, age, seed, ramp = P.bSmoke) {
  for (let j = -r; j <= r; j++) {
    for (let i = -r; i <= r; i++) {
      const d = Math.hypot(i, j * 1.15);
      if (d > r + 0.3) continue;
      // Thin out from the rim inward as the puff ages.
      if (age > 0.45 && hash2((x + i) >> 1, (y + j) >> 1, seed) < (age - 0.45) * 1.6 * (d / (r + 0.5) + 0.35)) continue;
      const lit = -(i + j) / (r + 0.01);
      const idx = 3.4 + lit * 1.2 - age * 1.2 - (d > r - 0.8 ? 0.5 : 0);
      buf.put(Math.round(x + i), Math.round(y + j), R(ramp, idx), 1e6 + j, 7);
    }
  }
}

function makeSteamPump(scene, hall, frame) {
  const buf = hall.clone();
  // Outfall water churning out of the arch.
  const [ox, oy] = buf.proj(hall.info.a1 + 0.2, 0.2, 0);
  for (let i = 0; i < 9; i++) {
    for (let j = 0; j < 3; j++) {
      const x = Math.round(ox + i);
      const y = Math.round(oy - 2 + j + i * 0.5);
      const foam = ((i + frame * 2 + j) % 4) === 0;
      buf.put(x, y, foam ? P.foam[1] : R(P.canal, 3 - j), 1e5, 8);
    }
  }
  // Smoke off the stack, drifting downwind to the right.
  const [sx, sy] = buf.proj(...hall.info.stackTop);
  for (let i = 0; i < 4; i++) {
    const s = (i + frame / 4) / 4;
    const x = sx + s * 16 + Math.sin(s * 5) * 2;
    const y = sy - 2 - s * 22;
    smokePuff(buf, x, y, Math.round(2 + s * 4), s, i * 7 + 1);
  }
  // A wisp of steam from the ventilator.
  const [vx, vy] = buf.proj(-0.7, 0, 38);
  for (let i = 0; i < 2; i++) {
    const s = (i + frame / 4) / 2;
    smokePuff(buf, vx + s * 8, vy - 2 - s * 9, Math.round(1 + s * 2), s * 0.9, i + 31, P.bHide);
  }
  finishSprite(buf, contactOf(-6, 5, -4.5, 4.5));
  const key = `s_steam_${frame}`;
  buf.toPx().toTexture(scene, key);
  anchor(key, STEAM_OX, STEAM_OY);
}

function makeSteamPumps(scene) {
  const hall = new IsoBuf(STEAM_W, STEAM_H, STEAM_OX, STEAM_OY);
  hall.info = drawSteamHall(hall);
  for (let f = 0; f < 4; f++) makeSteamPump(scene, hall, f);
}

/**
 * The outlet: an uitwateringssluis, cut through the ring dike.
 *
 * Drawn per edge, from the same `EDGES` geometry and the same `drawDikeBank`
 * the ring itself is made of, so the masonry head sits in the bank along its
 * real axis and the crest track runs onto the deck. A sluice is a hole in a
 * dike; it has to be built out of the dike.
 */
function makeSluice(scene, edgeKey, level) {
  const px = new Px(TILE_W, DIKE_TEX_H);
  // The stretch it replaces is an ordinary bank of the same level, so it
  // meets its neighbours at exactly their height and width. Raising the ring
  // raises the sluice with it.
  const H = 14 + level * 7;
  const WIDTH = 4 + level;
  drawDikeBank(px, edgeKey, { height: H, width: WIDTH });

  const e = EDGES[edgeKey];
  const steps = 15;
  const [sx, sy] = e.start;
  const [dx, dy] = e.step;
  const [ix, iy] = e.inward;
  const A = [sx - dx, sy - dy + DIKE_YOFF];
  const B = [sx + dx * (steps + 1), sy + dy * (steps + 1) + DIKE_YOFF];
  const A2 = [A[0] + ix * WIDTH, A[1] + iy * WIDTH];
  const B2 = [B[0] + ix * WIDTH, B[1] + iy * WIDTH];
  // Whichever of the two long edges is lower on screen is the face we see.
  const innerIsLower = edgeKey === 'xm' || edgeKey === 'ym';
  const fA = innerIsLower ? A2 : A;
  const fB = innerIsLower ? B2 : B;
  // The face we see is lit when it looks down-left (+b), shaded otherwise.
  const faceLit = edgeKey === 'xm' || edgeKey === 'yp';
  const sh = faceLit ? 0 : 1;

  /** A point on the visible face: `u` along the edge, `h` above its foot. */
  const face = (u, h) => [
    Math.round(fA[0] + (fB[0] - fA[0]) * u),
    Math.round(fA[1] + (fB[1] - fA[1]) * u - h),
  ];
  /** A point on the crest: `u` along the edge, `k` in from the seaward rim. */
  const crest = (u, k) => [
    Math.round(A[0] + (B[0] - A[0]) * u + ix * k),
    Math.round(A[1] + (B[1] - A[1]) * u + iy * k - H),
  ];

  const U0 = 0.30;
  const U1 = 0.70;
  const UM = (U0 + U1) / 2;
  const N = 48;
  const stone = P.bSandstone;

  // 1. Dressed ashlar head, with wing walls stepping down either side.
  for (let t = -6; t <= N + 6; t++) {
    const wing = t < 0 || t > N;
    const u = U0 + (U1 - U0) * (t / N);
    const top = wing ? H - 3 - Math.abs(t < 0 ? t : t - N) : H + 2;
    for (let h = 0; h <= top; h++) {
      const [x, y] = face(u, h);
      const course = Math.floor(h / 3);
      const joint = h % 3 === 0 || (t + course * 7 + 60) % 12 === 0;
      const n = hash2((t + 60) >> 2, course, 7);
      let i = 3 - sh + (n > 0.8 ? 1 : 0);
      if (joint) i -= 1;
      if (h === top) i = 5 - sh;
      if (h < 3) i -= 1;
      px.set(x, y, R(stone, i));
      px.set(x + 1, y, R(stone, i));
    }
  }

  // 2. The arch, and the dark culvert behind it with water in the bottom.
  const AW = 0.15;
  const ARCH = 9;
  for (let t = -24; t <= 24; t++) {
    const r = t / 24;
    const u = UM + r * AW;
    const top = Math.round(ARCH * Math.sqrt(Math.max(0, 1 - r * r)));
    for (let h = 0; h <= top; h++) {
      const [x, y] = face(u, h);
      let c;
      if (h <= 2) c = R(P.canal, 1 + h + ((t + h * 3) % 7 === 0 ? 1 : 0));
      else c = R(P.bOutline, h > top - 2 ? 2 : h > 5 ? 1 : 0);
      px.set(x, y, c);
      px.set(x + 1, y, c);
    }
    if (top > 0) {
      // Voussoirs: a ring of paler cut stone round the opening.
      const [vx, vy] = face(u, top + 1);
      const key = Math.abs(t) < 3;
      px.set(vx, vy, R(stone, (key ? 5 : Math.abs(t) % 6 < 3 ? 5 : 4) - sh));
      px.set(vx + 1, vy, R(stone, 4 - sh));
    }
  }
  // Weed on the wet stone at the waterline.
  for (let t = -20; t <= 20; t += 3) {
    if (hash2(t, 3, 19) < 0.45) continue;
    const [x, y] = face(UM + (t / 24) * AW, 3);
    px.set(x, y, R(P.bVerdigris, 2));
    px.set(x + 1, y, R(P.bVerdigris, 3));
  }

  // 3. The gate in its grooves above the arch, planked with iron straps.
  for (let t = -18; t <= 18; t++) {
    const u = UM + (t / 24) * AW;
    for (let h = ARCH + 3; h <= ARCH + 9; h++) {
      const [x, y] = face(u, h);
      const plank = Math.floor((t + 18) / 5);
      let c = R(P.bWood, 3 - sh + (plank % 2 ? 0 : -1));
      if (h === ARCH + 9) c = R(P.bWood, 4 - sh);
      if (h === ARCH + 4 || h === ARCH + 8) c = R(P.bIron, 2 - sh);
      px.set(x, y, c);
      px.set(x + 1, y, c);
    }
  }
  for (const s of [-1, 1]) {
    for (let h = ARCH + 2; h <= ARCH + 10; h++) {
      const [x, y] = face(UM + s * AW * 0.82, h);
      px.set(x, y, R(stone, 2 - sh));
    }
  }

  // 4. The deck carrying the crest track over the cut.
  for (let t = 0; t <= 36; t++) {
    const u = U0 + (U1 - U0) * (t / 36);
    for (let k = -1; k <= WIDTH + 1; k += 0.5) {
      const [x, y] = crest(u, k);
      const plank = Math.floor(t / 3) % 2;
      px.set(x, y, R(P.bWood, 3 + plank));
    }
  }

  // 5. White railings down both sides of the deck.
  for (const k of [-0.5, WIDTH + 0.5]) {
    const [x0, y0] = crest(U0, k);
    const [x1, y1] = crest(U1, k);
    px.line(x0, y0 - 6, x1, y1 - 6, R(P.bWhitePaint, 5));
    px.line(x0, y0 - 3, x1, y1 - 3, R(P.bWhitePaint, 3));
    for (const u of [U0, UM, U1]) {
      const [x, y] = crest(u, k);
      px.vline(x, y - 7, y, R(P.bWhitePaint, 4));
    }
  }

  // 6. The winch that lifts the gate: a drum between two posts.
  const p0 = crest(UM - 0.05, WIDTH * 0.25);
  const p1 = crest(UM + 0.05, WIDTH * 0.25);
  px.vline(p0[0], p0[1] - 5, p0[1], R(P.bWood, 2));
  px.vline(p1[0], p1[1] - 5, p1[1], R(P.bWood, 2));
  px.line(p0[0], p0[1] - 5, p1[0], p1[1] - 5, R(P.bIron, 4));
  px.line(p0[0], p0[1] - 4, p1[0], p1[1] - 4, R(P.bIron, 2));
  const [gx, gy] = face(UM, ARCH + 10);
  px.vline(gx, gy - 2, gy, R(P.bIron, 3));

  px.outline(P.bOutline[1], { skipTop: true, alpha: 0.55 });
  const key = `s_sluice_${edgeKey}_${level}`;
  px.toTexture(scene, key);
  anchor(key, TILE_W / 2, TILE_H / 2 + DIKE_YOFF);
}

/* ================================================================
   PROPS & PARTICLES
================================================================ */

/**
 * A tree canopy from overlapping leaf masses. Each mass is shaded as a ball
 * lit from the upper left, but the ramp is chosen per 2 x 2 leaf cluster
 * rather than per pixel, so it breaks up into foliage instead of a pillow,
 * and a crease runs where a nearer mass overlaps one behind it.
 */
function canopy(buf, blobs, ramp, seed, { cluster = 2, span = 3.2, base = 3.1 } = {}) {
  for (const [cx, cy, r, bias = 0] of blobs) {
    for (let y = Math.floor(cy - r); y <= Math.ceil(cy + r); y++) {
      for (let x = Math.floor(cx - r); x <= Math.ceil(cx + r); x++) {
        const dx = (x + 0.5 - cx) / r;
        const dy = (y + 0.5 - cy) / r;
        const q = dx * dx + dy * dy;
        // A leafy rim: the edge is bitten by whole clusters.
        const bite = hash2(Math.floor(x / cluster), Math.floor(y / cluster), seed + 3);
        if (q > 1 || (q > 0.72 && bite < 0.35)) continue;
        const nz = Math.sqrt(Math.max(0, 1 - q));
        const lightDot = -dx * 0.55 - dy * 0.6 + nz * 0.55;
        const n = hash2(Math.floor((x + 1) / cluster), Math.floor(y / cluster), seed) - 0.5;
        const idx = base + lightDot * span + n * 1.6 + bias;
        buf.put(x, y, R(ramp, idx), cy + r * 0.6 + nz * r * 0.4, 2);
      }
    }
  }
}

function makeTree(scene, key, variant) {
  const W = 40;
  const H = 52;
  const ox = 20;
  const oy = 45;
  const buf = new IsoBuf(W, H, ox, oy);
  const bark = P.bBark;
  if (variant === 0) {
    // Linden: a straight trunk under a tall, rounded crown.
    for (let j = 0; j < 17; j++) {
      const y = oy - j;
      const w = j < 2 ? 2 : 1;
      for (let i = -w; i <= w + 1; i++) {
        const idx = i <= -1 ? 3 : i === 0 ? 4 : i === 1 ? 2 : 1;
        buf.put(ox + i, y, R(bark, idx - (j % 5 === 0 && i === 0 ? 1 : 0)), -100, 1);
      }
    }
    // A limb showing through the lower crown.
    buf.line3([0, 0, 14], [-2.5, 2.5, 22], R(bark, 2), { tag: 1, bias: -60 });
    canopy(buf, [
      [ox + 1, oy - 20, 9.5, -0.5], [ox - 6, oy - 23, 7], [ox + 7, oy - 22, 7, -0.3],
      [ox - 1, oy - 30, 8.5], [ox + 5, oy - 33, 6], [ox - 5, oy - 35, 5.5], [ox + 1, oy - 38, 5],
    ], P.bLeaf, 11);
  } else {
    // Pollard willow: a stout, knobbly trunk crowned by a spray of shoots.
    for (let j = 0; j < 13; j++) {
      const y = oy - j;
      const w = j < 2 ? 3 : j > 10 ? 3 : 2;
      for (let i = -w; i <= w; i++) {
        let idx = i < -1 ? 3 : i < 1 ? 4 : i < 2 ? 2 : 1;
        if ((i === 0 && j % 4 === 1) || (i === -1 && j % 5 === 3)) idx -= 2;
        buf.put(ox + i, y, R(bark, idx), -100, 1);
      }
    }
    // The pollard head: a knuckle of old cuts.
    for (const [dx, dy] of [[-3, -13], [-1, -14], [1, -14], [3, -13], [0, -15]]) {
      buf.put(ox + dx, oy + dy, R(bark, dx < 0 ? 4 : 2), -90, 1);
    }
    // Shoots fanning up out of the head.
    for (let s = 0; s < 11; s++) {
      const ang = -Math.PI / 2 + (s - 5) * 0.2 + (hash2(s, 1, 5) - 0.5) * 0.15;
      const len = 13 + hash2(s, 2, 5) * 7;
      const x0 = ox + (s - 5) * 0.5;
      const y0 = oy - 14;
      for (let t = 0; t < len; t++) {
        const bend = (t / len) ** 2 * (s - 5) * 0.5;
        buf.put(Math.round(x0 + Math.cos(ang) * t + bend), Math.round(y0 + Math.sin(ang) * t), R(bark, 3), -80, 1);
      }
    }
    canopy(buf, [
      [ox - 7, oy - 22, 5.5], [ox + 7, oy - 22, 5.5, -0.4], [ox - 3, oy - 28, 6.5],
      [ox + 4, oy - 29, 6], [ox, oy - 34, 5.5], [ox - 8, oy - 29, 4], [ox + 9, oy - 28, 4, -0.4],
    ], P.bWillow, 23, { cluster: 2, span: 3.4, base: 3.2 });
  }
  finishSprite(buf, null, { crease: true });
  buf.shadowPoly([[-2.5, 1.5, 0], [2.5, 1.5, 0], [2.5, -1, 0], [-2.5, -1, 0]], P.bOutline[0], 0.3);
  buf.toPx().toTexture(scene, key);
  anchor(key, ox, oy);
}

/**
 * A Frisian cow, drawn pixel by pixel: at this size every pixel is a
 * decision, and the black-and-white patches are what make it a cow.
 */
const COW_MAP = [
  '...o.o..............',
  '..oKoKo.............',
  '.oKKKKKoooooooooooo.',
  'oKKWKKwwwwwKKKKwwwwo',
  'oKWWKwwwwwKKKKKKwwso',
  'oKWWwwwwwwwKKKKwwssoK',
  'oppWowwwwwwwwwKwwsSoK',
  '.opo.oswwwwwwwwwssSo.',
  '..o..oSsssssssssSSo..',
  '.....oSo.oSooooSoSo..',
  '.....oko.oko..oko.o..',
  '.....ogo.ogo..ogoogo.',
];

function makeCow(scene, key) {
  const W = 24;
  const H = 16;
  const buf = new IsoBuf(W, H, 12, 13);
  const pink = mix(P.bHide[3], P.tulipRed[2], 0.45);
  const legend = {
    o: P.bHideDark[0], K: P.bHideDark[2], k: P.bHideDark[3], g: P.bHideDark[1],
    W: P.bHide[5], w: P.bHide[4], s: P.bHide[3], S: P.bHide[2],
    p: pink,
  };
  stampMap(buf, 2, 1, COW_MAP, legend);
  buf.shadowPoly([[-2.5, 2, 0], [2.5, 2, 0], [2.5, -2, 0], [-2.5, -2, 0]], P.bOutline[0], 0.32);
  buf.toPx().toTexture(scene, key);
  anchor(key, 12, 13);
}

/**
 * A small Dutch sailing barge: a tarred round-ended hull with a green top
 * strake, a leeboard, and a tanned gaff sail and jib. Built along the a
 * axis; the scene mirrors it for boats running along b.
 */
function makeBoat(scene, key) {
  const W = 44;
  const H = 46;
  const ox = 22;
  const oy = 36;
  const buf = new IsoBuf(W, H, ox, oy);
  const beam = (a, h) => {
    const t = Math.min(1, Math.abs(a) / 6.2);
    return (1.5 + h * 0.2) * Math.sqrt(Math.max(0.02, 1 - t ** 3));
  };
  const steps = 12;
  for (const side of [1, -1]) {
    for (let i = 0; i < steps; i++) {
      const a0 = -6 + (12 / steps) * i;
      const a1 = a0 + 12 / steps;
      const quad = [[a0, side * beam(a0, 0), 0], [a1, side * beam(a1, 0), 0], [a1, side * beam(a1, 4), 4], [a0, side * beam(a0, 4), 4]];
      const idx = litIndex(polyNormal(side > 0 ? quad : quad.slice().reverse()), 1.4, 1.4);
      buf.face(quad, (a, b, h) => {
        if (h > 3) return R(P.bGreenPaint, idx + 1.5);
        if (h > 2.4) return R(P.bWhitePaint, idx + 1.5);
        return R(P.bWood, idx - 0.5);
      }, { tag: 1 });
    }
  }
  // Deck.
  const deck = [];
  for (let i = 0; i <= steps; i++) { const a = -6 + i; deck.push([a, beam(a, 4), 4]); }
  for (let i = steps; i >= 0; i--) { const a = -6 + i; deck.push([a, -beam(a, 4), 4]); }
  buf.face(deck, (a) => R(P.bWood, Math.floor(a * 2) % 3 === 0 ? 3 : 4), { tag: 1 });
  // Leeboard, hung on the near side.
  buf.face([[0.4, beam(0.5, 4) + 0.2, 4.2], [1.8, beam(1.8, 4) + 0.2, 4.2], [3.2, beam(3, 4) + 0.6, 0.6], [-0.8, beam(-0.8, 4) + 0.6, 0.6]],
    () => R(P.bWood, 3), { tag: 3, bias: 0.5 });
  // Mast, boom and gaff.
  const mA = 2.4;
  buf.line3([mA, 0, 4], [mA, 0, 33], R(P.bWood, 2), { tag: 2 });
  buf.line3([mA + 0.5, -0.5, 4], [mA + 0.5, -0.5, 33], R(P.bWood, 4), { tag: 2 });
  // Gaff mainsail in the plane b = 0, tanned the old way.
  const sail = [[mA - 0.3, 0, 7], [mA - 0.3, 29], [-3.6, 0, 33], [-5.6, 0, 8]].map((p) => (p.length === 2 ? [p[0], 0, p[1]] : p));
  buf.face(sail, (a, b, h) => {
    const seam = Math.floor((a - (h - 7) * 0.06) * 1.6) % 3 === 0;
    const foot = h < 9;
    return R(P.bTanSail, 3 + (seam ? -1 : 0) - (foot ? 1 : 0) + (h > 26 && a > 0 ? 1 : 0));
  }, { tag: 2 });
  buf.line3([mA, 0, 7], [-5.8, 0, 7.5], R(P.bWood, 2), { tag: 2 });
  buf.line3([mA, 0, 29], [-3.8, 0, 33.5], R(P.bWood, 2), { tag: 2 });
  // Jib to the stemhead.
  buf.face([[mA + 0.3, 0.2, 30], [6.3, 0.2, 5], [mA + 0.6, 0.2, 7]], (a, b, h) => R(P.bTanSail, h > 18 ? 4 : 3), { tag: 2 });
  // The tricolour at the masthead.
  const [fx, fy] = buf.proj(mA, 0, 34);
  const flag = [P.tulipRed[2], P.bWhitePaint[5], P.sea[3]];
  for (let j = 0; j < 3; j++) for (let i = 1; i <= 4; i++) buf.put(Math.floor(fx) + i, Math.floor(fy) + j + (i > 2 ? 1 : 0), flag[j], 1e6, 2);
  finishSprite(buf, null);
  // Bow wave and wake on the water.
  for (const [a, b, al] of [[6.3, 0.8, 0.8], [6.8, 1.6, 0.6], [5.6, 2.2, 0.5], [-6.4, 0.6, 0.45], [-7.4, 1.2, 0.3], [-8.4, 0.4, 0.25]]) {
    const [x, y] = buf.proj(a, b, 0);
    for (let i = 0; i < 2; i++) {
      const X = Math.floor(x) + i;
      const Y = Math.floor(y);
      const idx = Y * W + X;
      if (X < 0 || Y < 0 || X >= W || Y >= H || buf.alpha[idx] > 0) continue;
      buf.col[idx] = P.foam[1];
      buf.alpha[idx] = al;
    }
  }
  buf.toPx().toTexture(scene, key);
  anchor(key, ox, oy);
}

/**
 * Reeds and bulrushes where the land meets a watercourse: clumps of blades
 * in three greens with a few dry ones, bending at the tip, and the brown
 * heads of the lisdodde standing out of them.
 */
function makeReeds(scene, key) {
  const W = 34;
  const H = 26;
  const ox = 17;
  const oy = 21;
  const buf = new IsoBuf(W, H, ox, oy);
  const clumps = [[-9, -1, 6, 11], [1, 2, 8, 14], [9, -2, 5, 10], [-2, -4, 4, 9]];
  clumps.sort((p, q) => p[1] - q[1]);
  clumps.forEach(([cx, cy, n, tall], ci) => {
    for (let s = 0; s < n; s++) {
      const x0 = ox + cx + Math.round((s - n / 2) * 1.1);
      const y0 = oy + cy + (s % 2);
      const hgt = Math.round(tall * (0.6 + hash2(s, ci, 3) * 0.45));
      const lean = (hash2(s, ci, 5) - 0.5) * 5;
      const dry = hash2(s, ci, 7) > 0.8;
      for (let t = 0; t < hgt; t++) {
        const k = t / hgt;
        const x = Math.round(x0 + lean * k * k);
        const idx = 1.5 + k * 3.6 + (s % 2 ? -0.6 : 0.4);
        buf.put(x, y0 - t, dry ? R(P.bReed, idx - 0.5) : R(P.bLeaf, idx), y0 + ci * 0.1, 1);
      }
      if (hash2(s, ci, 9) > 0.62) {
        // A bulrush head.
        const x = Math.round(x0 + lean);
        const y = y0 - hgt;
        buf.put(x, y - 1, R(P.bReed, 1), y0 + 1, 1);
        buf.put(x, y, R(P.bWood, 3), y0 + 1, 1);
        buf.put(x, y + 1, R(P.bWood, 2), y0 + 1, 1);
        buf.put(x, y - 2, R(P.bReed, 3), y0 + 1, 1);
      }
    }
  });
  buf.selOut(INK, { dark: 0.55, lit: 0.35 });
  buf.shadowPoly([[-5, 2.5, 0], [4, 2.5, 0], [4, -3, 0], [-5, -3, 0]], P.bOutline[0], 0.22);
  buf.toPx().toTexture(scene, key);
  anchor(key, ox, oy);
}

/* ================================================================
   --- atmosphere & fx ---

   Light, weather and the title sky. Everything here is either an effect
   texture (rain, ripples, splashes, sparks, wakes) or something derived at
   run time from the sprites other code draws (cast shadows, lit windows), so
   it follows those sprites whatever size or shape they are given.
================================================================ */

/**
 * Pick a band from a continuous position, with an ordered-dither step only in
 * the last `width` of each band. Flat bands with a short dithered seam is the
 * classic pixel-art gradient: clean where it can be, textured only where two
 * colours meet.
 */
function bandAt(f, x, y, width = 0.34) {
  const i = Math.floor(f);
  const fr = f - i;
  if (fr <= 1 - width) return i;
  return (fr - (1 - width)) / width > bayerAt(x, y) ? i + 1 : i;
}

/** An isometric (2:1) ellipse ring, one pixel wide. */
function isoRing(px, cx, cy, rx, color, alpha = 1, { front = false, gaps = 0 } = {}) {
  const steps = Math.max(12, Math.round(rx * 7));
  let last = '';
  for (let i = 0; i < steps; i++) {
    const a = (i / steps) * TAU;
    if (gaps && Math.floor((i / steps) * gaps * 2) % 2 === 1) continue;
    const x = Math.round(cx + Math.cos(a) * rx);
    const y = Math.round(cy + Math.sin(a) * rx * 0.5);
    const k = `${x},${y}`;
    if (k === last) continue;
    last = k;
    px.set(x, y, color, alpha);
    // The near half of a ring on water reads thicker: it faces the viewer.
    if (front && Math.sin(a) > 0.3) px.set(x, y + 1, color, alpha * 0.55);
  }
}

function makeSplash(scene, frame) {
  const W = 24;
  const H = 18;
  const px = new PixBuf(W, H);
  const cx = W / 2;
  const baseY = H - 4;
  const foam = P.foam;

  // 0: a crown thrown straight up; 1: it tops out and breaks; 2-3: it falls
  // back and the ring runs out across the surface, thinning as it goes.
  if (frame === 0) {
    for (let y = baseY - 7; y <= baseY; y++) {
      px.set(cx - 1, y, foam[1]);
      px.set(cx, y, foam[2]);
      if (y > baseY - 5) px.set(cx + 1, y, foam[0]);
    }
    px.set(cx - 3, baseY - 4, foam[2]);
    px.set(cx + 3, baseY - 5, foam[1]);
    isoRing(px, cx, baseY, 3, foam[2], 1, { front: true });
  } else if (frame === 1) {
    for (let y = baseY - 10; y <= baseY - 5; y += 2) px.set(cx, y, foam[2]);
    for (const [dx, dy] of [[-4, -8], [4, -9], [-6, -5], [6, -6], [-2, -11], [2, -12]]) {
      px.set(cx + dx, baseY + dy, dy < -9 ? foam[2] : foam[1]);
    }
    isoRing(px, cx, baseY, 5, foam[2], 1, { front: true });
    isoRing(px, cx, baseY, 2, foam[0], 0.8);
  } else if (frame === 2) {
    for (const [dx, dy] of [[-7, -4], [7, -5], [-9, -1], [9, -2], [-3, -6], [3, -7]]) {
      px.set(cx + dx, baseY + dy, foam[1], 0.85);
    }
    isoRing(px, cx, baseY, 8, foam[1], 0.9, { front: true });
    isoRing(px, cx, baseY, 4, foam[0], 0.55, { gaps: 3 });
  } else {
    isoRing(px, cx, baseY, 10, foam[0], 0.55, { gaps: 5 });
    isoRing(px, cx, baseY, 6, foam[0], 0.3, { gaps: 4 });
  }
  const key = `fx_splash_${frame}`;
  px.toTexture(scene, key);
  anchor(key, cx, baseY);
}

/** Small effect sprites. Called once at boot; all tiny. */
function makeParticles(scene) {
  // Coin for income popups.
  const coin = new Px(10, 10);
  coin.disc(5, 5, 4, P.ui.goldDark);
  coin.disc(5, 5, 3, P.ui.gold);
  coin.disc(4, 4, 1, mix(P.ui.gold, P.ui.white, 0.6));
  coin.vline(5, 3, 7, P.ui.goldDark);
  coin.hline(4, 6, 4, P.ui.goldDark);
  coin.toTexture(scene, 'fx_coin');

  // Rain, in two depths. Each streak is slanted to match the velocity the
  // emitter gives it (about one across for every five down), bright at the
  // leading end and fading up its tail, so it reads as motion rather than as
  // a dash. The far layer is shorter, thinner and dimmer.
  const rain = new PixBuf(3, 12);
  for (let i = 0; i < 12; i++) {
    const x = 2 - Math.floor(i / 5);
    rain.set(x, i, i > 8 ? P.foam[2] : P.foam[1], 0.25 + (i / 11) * 0.7);
  }
  rain.toTexture(scene, 'fx_rain');
  const rainFar = new PixBuf(2, 7);
  for (let i = 0; i < 7; i++) {
    rainFar.set(i < 4 ? 1 : 0, i, P.foam[0], 0.2 + (i / 6) * 0.45);
  }
  rainFar.toTexture(scene, 'fx_rain_far');

  // Four-point sparkle for build confirmations: hot centre, cool tips.
  const spark = new PixBuf(7, 7);
  for (let d = 1; d <= 3; d++) {
    const c = d === 1 ? P.lamp[3] : d === 2 ? P.ui.gold : P.lamp[1];
    const a = d === 3 ? 0.7 : 1;
    spark.set(3 - d, 3, c, a).set(3 + d, 3, c, a).set(3, 3 - d, c, a).set(3, 3 + d, c, a);
  }
  spark.set(3, 3, P.ui.white);
  spark.toTexture(scene, 'fx_spark');

  // A clod of dust kicked up by building work.
  const dust = new PixBuf(5, 4);
  dust.set(1, 0, P.sand[4]).set(2, 0, P.sand[4]).set(0, 1, P.sand[3]).set(1, 1, P.sand[4])
    .set(2, 1, P.sand[3]).set(3, 1, P.sand[3]).set(1, 2, P.sand[2]).set(2, 2, P.sand[2])
    .set(3, 2, P.sand[2]).set(4, 2, P.sand[1], 0.6).set(2, 3, P.sand[1], 0.6);
  dust.toTexture(scene, 'fx_dust');

  // White dot for the spray emitter, and a torn scrap of spume.
  const dot = new PixBuf(3, 3);
  dot.set(1, 0, P.foam[1]).set(0, 1, P.foam[1]).set(1, 1, P.foam[2]).set(2, 1, P.foam[1]).set(1, 2, P.foam[0]);
  dot.toTexture(scene, 'fx_dot');
  const spray = new PixBuf(4, 3);
  spray.set(1, 0, P.foam[2]).set(0, 1, P.foam[1]).set(1, 1, P.foam[2]).set(2, 1, P.foam[2])
    .set(3, 1, P.foam[0], 0.7).set(2, 2, P.foam[0], 0.7);
  spray.toTexture(scene, 'fx_spray');

  for (let f = 0; f < 4; f++) makeSplash(scene, f);
  // A puff of chimney smoke: a lumpy pale cluster, lighter on top.
  // A grey underside so it still reads against pale plaster and sky.
  const smoke = new Px(9, 8);
  smoke.disc(4, 4, 3, P.stone[3]);
  smoke.disc(4, 3, 3, P.stone[4]);
  smoke.disc(3, 3, 2, P.foam[1]);
  smoke.disc(5, 2, 1, P.foam[2]);
  smoke.toTexture(scene, 'fx_smoke');

  // A bird in two wing positions, drawn dark so it reads against sky and sea.
  const bird = (key, up) => {
    const b = new Px(7, 4);
    b.set(3, 2, P.ink[1]);
    if (up) {
      b.set(2, 1, P.ink[1]); b.set(1, 0, P.ink[1]);
      b.set(4, 1, P.ink[1]); b.set(5, 0, P.ink[1]);
    } else {
      b.set(2, 2, P.ink[1]); b.set(1, 3, P.ink[1]); b.set(0, 3, P.ink[2]);
      b.set(4, 2, P.ink[1]); b.set(5, 3, P.ink[1]); b.set(6, 3, P.ink[2]);
    }
    b.toTexture(scene, key);
  };
  bird('fx_bird_0', true);
  bird('fx_bird_1', false);

  makeRipples(scene);
  makeWakes(scene);
  makeSunGlow(scene, 'fx_sunglow');

  const glint = new PixBuf(5, 1);
  glint.set(0, 0, P.sea[5], 0.6).set(1, 0, P.foam[1]).set(2, 0, P.foam[2]).set(3, 0, P.foam[1])
    .set(4, 0, P.sea[5], 0.6);
  glint.toTexture(scene, 'fx_glint');
}

/**
 * Raindrop rings on water: one sheet of four frames, played as an animation
 * by the ripple emitter. A drop, a small ring, a wide ring, a broken ring.
 */
function makeRipples(scene) {
  const FW = 11;
  const FH = 6;
  const px = new PixBuf(FW * 4, FH);
  const cx = 5;
  const cy = 2;
  px.set(cx, cy, P.foam[2]).set(cx, cy - 1, P.foam[1], 0.7);
  isoRing({ set: (x, y, c, a) => px.set(x + FW, y, c, a) }, cx, cy, 2, P.foam[1], 0.9, { front: true });
  isoRing({ set: (x, y, c, a) => px.set(x + FW * 2, y, c, a) }, cx, cy, 4, P.foam[0], 0.7, { front: true });
  isoRing({ set: (x, y, c, a) => px.set(x + FW * 3, y, c, a) }, cx, cy, 5, P.foam[0], 0.35, { gaps: 3 });
  px.toTexture(scene, 'fx_ripple');
  const tex = scene.textures.get('fx_ripple');
  for (let i = 0; i < 4; i++) tex.add(i, 0, i * FW, 0, FW, FH);
}

/**
 * A boat's wake, drawn for a boat running down-right along the 2:1 line (the
 * +x grid axis); the scene mirrors it for the other three headings. Two arms
 * of broken foam open out behind the stern, which sits at the anchor. Two
 * frames, with the dashes shifted, so the wake crawls as the boat moves.
 */
function makeWakes(scene) {
  const W = 30;
  const H = 16;
  for (let f = 0; f < 2; f++) {
    const px = new PixBuf(W, H);
    const sx = W - 3;
    const sy = H - 3;
    // Churned water right under the stern.
    px.set(sx, sy, P.foam[2]).set(sx - 1, sy, P.foam[1]).set(sx - 2, sy - 1, P.foam[1]).set(sx - 1, sy + 1, P.foam[0], 0.7);
    const arm = (ex, ey) => {
      const n = Math.max(Math.abs(ex - sx), Math.abs(ey - sy));
      for (let i = 2; i <= n; i++) {
        if (((i + f * 2) >> 1) % 2 === 1) continue;
        const t = i / n;
        const x = Math.round(sx + (ex - sx) * t);
        const y = Math.round(sy + (ey - sy) * t);
        px.set(x, y, t < 0.4 ? P.foam[1] : P.foam[0], 0.85 - t * 0.7);
      }
    };
    arm(1, sy - 11); // along the course, the long arm
    arm(sx - 13, 0); // the steeper arm, opening away from it
    const key = `fx_wake_${f}`;
    px.toTexture(scene, key);
    anchor(key, sx, sy);
  }
}

/**
 * Sunlight falling on the land from the upper left: a broad warm wash that
 * is strongest in that corner and gone by the far one, added over the world.
 * Smoothly filtered, like the vignette, since it is light rather than paint.
 */
function makeSunGlow(scene, key) {
  const N = 128;
  const px = new PixBuf(N, N);
  for (let y = 0; y < N; y++) {
    for (let x = 0; x < N; x++) {
      const d = Math.sqrt((x / N) ** 2 + (y / N) ** 2) / 1.3;
      const a = Math.pow(Math.max(0, 1 - d), 2.2);
      px.set(x, y, 0xffffff, a);
    }
  }
  px.toTexture(scene, key, { linear: true });
}

/* ---- Shadows cast by sprites ---------------------------------------- */

/**
 * How far a shadow runs across the ground for each unit of height, at the
 * three sun heights the scenes use: 0 high noon, 1 afternoon, 2 golden hour.
 */
export const SHADOW_SLOPE = [0.36, 0.62, 1.0];
const shadowReachOf = {};

/**
 * The shadow a sprite throws, derived from the sprite itself.
 *
 * The sun is always upper-left, so every shadow falls down-right along the 2:1
 * grid line. Each column of the sprite is treated as standing on its own
 * lowest pixel — which for an isometric building is the foot of its walls, so
 * the right-hand wall throws its shadow off its own base line — and each
 * opaque pixel is projected down that line by its height above that foot.
 * Columns that hang in the air (a sail tip, an overhanging eave) hang from
 * the tile's centre line instead. The sprites bake their own contact shadow,
 * so none is added here; the sprite's whole footprint is cut out, since the
 * shadow is drawn above the ground of the tiles it falls across and must not
 * darken the thing casting it.
 *
 * Built on first use and cached, so boot pays nothing and whatever another
 * pass redraws a building as, its shadow follows. White, for multiply with a
 * cool tint: shadows lean blue.
 */
export function castShadowKey(scene, srcKey, len = 1) {
  const key = `fx_sh_${srcKey}_${len}`;
  if (shadowReachOf[key] !== undefined && scene.textures.exists(key)) return key;
  const a = ANCHORS[srcKey];
  const src = a && readPixels(scene, srcKey);
  if (!src) return null;
  const { w, h, data } = src;
  // Solid pixels cast; the sprite's own baked contact shadow (translucent)
  // neither casts nor is drawn over, so the two shadows meet without
  // doubling up into a dark smudge.
  const op = (x, y) => x >= 0 && y >= 0 && x < w && y < h && data[(y * w + x) * 4 + 3] > 160;
  const any = (x, y) => x >= 0 && y >= 0 && x < w && y < h && data[(y * w + x) * 4 + 3] > 8;
  const k = SHADOW_SLOPE[len] ?? SHADOW_SLOPE[1];
  const ax = Math.round(a.x);
  const ay = Math.round(a.y);

  const foot = new Int16Array(w);
  let top = h;
  for (let x = 0; x < w; x++) {
    let b = -1;
    for (let y = h - 1; y >= 0; y--) {
      if (op(x, y)) { b = y; break; }
    }
    for (let y = 0; y < h; y++) {
      if (op(x, y)) { top = Math.min(top, y); break; }
    }
    foot[x] = b >= ay - 14 ? b : ay;
  }
  const tall = Math.max(0, ay - top + 10);
  const padL = 6;
  const W2 = w + padL + Math.ceil(tall * k) + 6;
  const H2 = h + Math.ceil(tall * k * 0.5) + 8;
  const out = new PixBuf(W2, H2);

  let maxY = ay;
  const CAST = 1;
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      if (!op(x, y)) continue;
      const lift = Math.max(0, foot[x] - y);
      const sx = Math.round(x + lift * k) + padL;
      const sy = Math.round(foot[x] + lift * k * 0.5);
      out.set(sx, sy, 0xffffff, CAST);
      out.set(sx + 1, sy, 0xffffff, CAST);
      if (sy > maxY) maxY = sy;
    }
  }

  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      if (any(x, y)) out.set(x + padL, y, 0xffffff, 0);
    }
  }

  out.toTexture(scene, key);
  anchor(key, ax + padL, ay);
  // How many rows of tiles down the screen the shadow reaches, so the scene
  // can sort it above the ground it falls on.
  shadowReachOf[key] = Math.max(0, Math.min(3, Math.ceil((maxY - ay - 2) / (TILE_H / 2))));
  return key;
}

/** Rows of tiles a cast shadow reaches past its own; 0 if unknown. */
export function shadowReach(key) {
  return shadowReachOf[key] || 0;
}

/* ---- Lit windows ----------------------------------------------------- */

const lampMasks = {};

/**
 * Which pixels of a building are lamplight: wherever its night variant is
 * warm and bright and its day variant is not. Derived rather than declared, so
 * it follows whatever the buildings are redrawn as. Returned as a canvas the
 * size of the building plus a two-pixel spill margin: window pixels at full
 * strength and brightened toward the lamp colour, and a two-step glow thrown
 * on the surrounding wall.
 */
function lampMask(scene, dayKey, nightKey) {
  const id = `${dayKey}|${nightKey}`;
  if (lampMasks[id] !== undefined) return lampMasks[id];
  const day = readPixels(scene, dayKey);
  const night = readPixels(scene, nightKey);
  if (!day || !night || day.w !== night.w || day.h !== night.h) {
    lampMasks[id] = null;
    return null;
  }
  const { w, h } = night;
  const lit = new Uint8Array(w * h);
  let any = false;
  for (let i = 0; i < w * h; i++) {
    const n = i * 4;
    const r = night.data[n];
    const g = night.data[n + 1];
    const b = night.data[n + 2];
    if (night.data[n + 3] < 128) continue;
    const diff = Math.abs(r - day.data[n]) + Math.abs(g - day.data[n + 1]) + Math.abs(b - day.data[n + 2]);
    if (diff > 60 && r > 150 && r >= b + 30) { lit[i] = 1; any = true; }
  }
  if (!any) { lampMasks[id] = null; return null; }

  const PAD = 2;
  const out = new PixBuf(w + PAD * 2, h + PAD * 2);
  const solid = (x, y) => x >= 0 && y >= 0 && x < w && y < h && night.data[(y * w + x) * 4 + 3] > 128;
  for (let y = -PAD; y < h + PAD; y++) {
    for (let x = -PAD; x < w + PAD; x++) {
      if (x >= 0 && y >= 0 && x < w && y < h && lit[y * w + x]) {
        const n = (y * w + x) * 4;
        const c = (night.data[n] << 16) | (night.data[n + 1] << 8) | night.data[n + 2];
        out.set(x + PAD, y + PAD, mix(c, P.lamp[3], 0.25), 1);
        continue;
      }
      // Glow on the wall around a window: nearest lit pixel within two.
      if (!solid(x, y)) continue;
      let best = 9;
      for (let dy = -2; dy <= 2; dy++) {
        for (let dx = -2; dx <= 2; dx++) {
          const xx = x + dx;
          const yy = y + dy;
          if (xx < 0 || yy < 0 || xx >= w || yy >= h || !lit[yy * w + xx]) continue;
          best = Math.min(best, Math.abs(dx) + Math.abs(dy));
        }
      }
      if (best <= 1) out.set(x + PAD, y + PAD, P.lamp[1], 0.42);
      else if (best <= 3) out.set(x + PAD, y + PAD, P.lamp[0], 0.22);
    }
  }
  out.ctx.putImageData(out.img, 0, 0);
  lampMasks[id] = { canvas: out.canvas, pad: PAD };
  return lampMasks[id];
}

/**
 * A lit-window overlay for one building in one place, with anything that
 * stands in front of it cut away. `cutters` are the sprites drawn over the
 * building, as { key, x, y, flipX } with x, y the texture's top-left relative
 * to the building texture's top-left. Returns the new key, or null when the
 * building has no lamps.
 */
export function lampOverlayKey(scene, key, dayKey, nightKey, cutters = []) {
  const mask = lampMask(scene, dayKey, nightKey);
  if (!mask) return null;
  const canvas = document.createElement('canvas');
  canvas.width = mask.canvas.width;
  canvas.height = mask.canvas.height;
  const ctx = canvas.getContext('2d');
  ctx.imageSmoothingEnabled = false;
  ctx.drawImage(mask.canvas, 0, 0);
  ctx.globalCompositeOperation = 'destination-out';
  for (const c of cutters) {
    if (!scene.textures.exists(c.key)) continue;
    const img = scene.textures.get(c.key).getSourceImage();
    const x = Math.round(c.x) + mask.pad;
    const y = Math.round(c.y) + mask.pad;
    if (c.flipX) {
      ctx.save();
      ctx.scale(-1, 1);
      ctx.drawImage(img, -x - img.width, y);
      ctx.restore();
    } else {
      ctx.drawImage(img, x, y);
    }
  }
  if (scene.textures.exists(key)) scene.textures.remove(key);
  scene.textures.addCanvas(key, canvas);
  const a = ANCHORS[nightKey];
  anchor(key, a.x + mask.pad, a.y + mask.pad);
  return key;
}

/* ---- Title sky --------------------------------------------------------- */

/**
 * The title screen's sky as one texture: flat bands of the sky ramp stepping
 * down to the horizon, each seam dithered over a few rows, the bands getting
 * narrower toward the horizon where the colour turns fastest; and a sun in
 * the upper left inside two dithered halo rings.
 */
export function makeTitleSky(scene, key, W, H, sunX, sunY) {
  const px = new PixBuf(W, H);
  const ramp = P.skyTitle;
  const n = ramp.length - 1;
  const R = 7;
  for (let y = 0; y < H; y++) {
    const t = y / Math.max(1, H - 1);
    const f = Math.pow(t, 1.7) * n;
    for (let x = 0; x < W; x++) {
      let c = ramp[Math.min(n, bandAt(f, x, y, 0.3))];
      const d = Math.hypot(x - sunX, (y - sunY) * 1.05);
      if (d < R + 30) {
        if (d < R - 0.4) c = P.sun[0];
        else if (d < R + 0.6) c = P.sun[1];
        else {
          const g = Math.pow(1 - (d - R) / 30, 2.2) * 3;
          const lvl = Math.min(3, bandAt(g, x, y, 0.4));
          if (lvl > 0) c = mix(c, lvl >= 2 ? P.sun[1] : P.sun[2], [0, 0.16, 0.3, 0.5][lvl]);
        }
      }
      px.set(x, y, c);
    }
  }
  px.toTexture(scene, key);
}

/**
 * Distant water under haze, laid over the top of the sea plane: opaque flat
 * bands at the horizon, thinning by ordered dither into the patterned sea
 * below, with a few long horizontal glints. Tiles horizontally.
 */
export function makeSeaHaze(scene, key, H) {
  const W = 256;
  const px = new PixBuf(W, H);
  const ramp = P.seaHaze;
  for (let y = 0; y < H; y++) {
    const t = y / Math.max(1, H - 1);
    // Solid for the first stretch below the horizon, then thinning out by
    // ordered dither: distance first, then the patterned sea shows through.
    const cover = t < 0.35 ? 1 : 1 - (t - 0.35) / 0.65;
    const c = ramp[Math.min(ramp.length - 1, bandAt(t * (ramp.length - 1), 0, y, 0.5))];
    for (let x = 0; x < W; x++) {
      if (cover > bayerAt(x, y) * 0.96 + 0.02) px.set(x, y, c);
    }
  }
  // Glints lengthen toward the viewer, as they would on a real horizon.
  for (let i = 0; i < 12; i++) {
    const y = 2 + Math.floor(hash2(i, 3, 41) * H * 0.3);
    const len = 2 + Math.floor((y / H) * 10 * hash2(i, 5, 43));
    const x = Math.floor(hash2(i, 7, 47) * W);
    for (let j = 0; j < len; j++) px.set((x + j) % W, y, j === 0 || j === len - 1 ? ramp[0] : P.foam[1], 0.9);
  }
  px.toTexture(scene, key);
}

/**
 * The next polder along: a pale strip on the horizon with a dune line, a
 * spire, trees and a couple of mills, all in one haze colour. It is there to
 * say the world goes on.
 */
export function makeFarCoast(scene, key) {
  const W = 200;
  const H = 12;
  const px = new PixBuf(W, H);
  const base = H - 1;
  const body = P.farCoast[0];
  const lit = P.farCoast[1];
  for (let x = 0; x < W; x++) {
    const e = Math.min(x, W - 1 - x);
    const taper = Math.min(1, e / 24);
    const hgt = Math.round((1.4 + Math.sin(x / 11) * 0.8 + Math.sin(x / 4.3) * 0.4) * taper);
    for (let y = base - hgt; y <= base; y++) px.set(x, y, y === base - hgt ? lit : body);
  }
  const tree = (x) => { px.set(x, base - 3, body).set(x - 1, base - 2, body).set(x, base - 2, body).set(x + 1, base - 2, body); };
  const mill = (x) => {
    for (let y = base - 5; y <= base; y++) px.set(x, y, body);
    px.set(x - 1, base - 1, body).set(x + 1, base - 1, body);
    for (let i = 1; i <= 3; i++) {
      px.set(x - i, base - 5 - i, body).set(x + i, base - 5 + i, body);
      px.set(x + i, base - 5 - i, body).set(x - i, base - 5 + i, body);
    }
  };
  const spire = (x) => {
    for (let y = base - 9; y <= base; y++) px.set(x, y, body);
    px.set(x + 1, base - 5, body).set(x + 1, base - 4, body).set(x + 1, base - 3, body).set(x + 2, base - 3, body)
      .set(x + 2, base - 2, body).set(x + 3, base - 2, body);
  };
  for (const x of [34, 38, 97, 101, 104, 150, 153]) tree(x);
  mill(58);
  mill(128);
  spire(84);
  px.toTexture(scene, key);
}

/**
 * A pixel cumulus. A cluster of spheres — a flat-bottomed row of small ones,
 * a row of larger ones riding on it, and a tower or two off-centre toward
 * the sun — becomes one height field (the highest sphere surface over each
 * pixel). Lighting comes from that field's slope, lit from the upper left,
 * and darkens toward the flat base, so the shading runs continuously over
 * the whole cloud with a crease wherever one puff swells out of another:
 * the cauliflower. The result is quantised into the cloud ramp with a thin
 * dither at each seam, and the silhouette steps down a shade on its shaded
 * (lower and right) side.
 */
function makeCloud(scene, key, W, H, seed) {
  const px = new PixBuf(W, H);
  const baseY = H - 2;
  const S = [];
  const rnd = (i, k) => hash2(i, k, seed);
  const nBase = Math.max(4, Math.round(W / 8));
  for (let i = 0; i < nBase; i++) {
    const t = (i + 0.5) / nBase;
    const r = H * (0.22 + 0.12 * Math.sin(Math.PI * t) + rnd(i, 1) * 0.08);
    S.push({ cx: 3 + r * 0.7 + t * (W - 6 - r * 1.4), cy: baseY - r * 0.35, r });
  }
  const nTop = Math.max(3, Math.round(W / 13));
  for (let i = 0; i < nTop; i++) {
    const t = 0.18 + (i / Math.max(1, nTop - 1)) * 0.64;
    const r = H * (0.3 + 0.12 * Math.sin(Math.PI * t) + rnd(i, 2) * 0.07);
    S.push({ cx: t * W + (rnd(i, 3) - 0.5) * 6, cy: baseY - H * 0.36 - (rnd(i, 4) * H * 0.08), r });
  }
  const rt = H * 0.4;
  S.push({ cx: W * (0.34 + rnd(0, 5) * 0.12), cy: rt + 1, r: rt });

  const h = new Float32Array(W * H);
  for (let y = 0; y <= baseY; y++) {
    for (let x = 0; x < W; x++) {
      let best = 0;
      for (const { cx, cy, r } of S) {
        const d2 = (x + 0.5 - cx) ** 2 + (y + 0.5 - cy) ** 2;
        if (d2 < r * r) best = Math.max(best, Math.sqrt(r * r - d2) * 0.5 + 0.5);
      }
      h[y * W + x] = best;
    }
  }
  const at = (x, y) => (x < 0 || y < 0 || x >= W || y > baseY ? 0 : h[y * W + x]);
  const L = [-0.55, -0.68, 0.48];
  const ramp = P.cloud;
  const n = ramp.length - 1;
  for (let y = 0; y <= baseY; y++) {
    for (let x = 0; x < W; x++) {
      if (at(x, y) <= 0) continue;
      const gx = (at(x + 1, y) - at(x - 1, y)) / 2;
      const gy = (at(x, y + 1) - at(x, y - 1)) / 2;
      const len = Math.hypot(gx, gy, 1);
      const lambert = (-gx * L[0] - gy * L[1] + L[2]) / len;
      const under = Math.max(0, (y - (baseY - H * 0.34)) / (H * 0.34));
      const v = 0.42 + lambert * 0.62 - under * 0.62;
      let l = Math.max(0, Math.min(n, bandAt(v * n, x, y, 0.2)));
      if (at(x, y + 1) <= 0 || at(x + 1, y) <= 0) l = Math.max(0, l - 1);
      if (y === baseY) l = Math.min(l, 1);
      px.set(x, y, ramp[l]);
    }
  }
  px.toTexture(scene, key);
}

/**
 * A far stratus streak: a long thin wisp low over the horizon, lit along its
 * top edge, fading into the haze at both ends.
 */
function makeStratus(scene, key, W, H, seed) {
  const px = new PixBuf(W, H);
  const ramp = P.cloud.map((c) => mix(c, P.skyTitle[9], 0.15));
  for (let x = 0; x < W; x++) {
    const t = x / (W - 1);
    const lump = 0.6 + 0.4 * Math.sin(t * 9 + seed) * Math.sin(t * 3.1 + seed * 2);
    const th = Math.round((H - 1) * Math.pow(Math.sin(Math.PI * t), 0.7) * lump);
    if (th < 1) continue;
    for (let k = 0; k < th; k++) {
      const y = H - 1 - k;
      const c = k === th - 1 ? ramp[5] : k === 0 ? ramp[2] : ramp[4];
      const edge = Math.min(t, 1 - t) < 0.12;
      if (edge && bayerAt(x, y) > Math.min(t, 1 - t) / 0.12) continue;
      px.set(x, y, c);
    }
  }
  px.toTexture(scene, key);
}

/** The title screen's clouds: three near cumulus and three far stratus. */
export function makeCloudSprites(scene) {
  if (scene.textures.exists('fx_cloud_5')) return;
  makeCloud(scene, 'fx_cloud_0', 104, 40, 11);
  makeCloud(scene, 'fx_cloud_1', 78, 32, 23);
  makeCloud(scene, 'fx_cloud_2', 58, 25, 37);
  makeStratus(scene, 'fx_cloud_3', 90, 5, 41);
  makeStratus(scene, 'fx_cloud_4', 60, 4, 53);
  makeStratus(scene, 'fx_cloud_5', 130, 6, 67);
}

/* ================================================================
   UI CHROME
================================================================ */

// The chrome and the icons are drawn in chrome.js, which owns the interface's
// light, corners and outline rules. These two hooks keep the calls in
// buildAllTextures below unchanged; the colour arguments they pass are
// historical and ignored — each key has exactly one style, defined there.
import { makeUiPanel, makeUiIcons } from './chrome.js';

function makePanel(scene, key) {
  makeUiPanel(scene, key);
}

function makeIcons(scene) {
  makeUiIcons(scene);
}

/* ================================================================
   ENTRY POINT
================================================================ */

export function buildAllTextures(scene) {
  buildTerrainTextures(scene);
  registerTerrainAnchors(scene);

  for (const edge of ['xp', 'yp']) makeDitch(scene, `t_ditch_${edge}`, edge);
  for (const d of ['xm', 'ym', 'xp', 'yp']) makeLeat(scene, `t_leat_${d}`, d);

  for (const edge of ['xm', 'ym', 'xp', 'yp']) {
    for (let level = 0; level < 3; level++) {
      makeDike(scene, `s_dike_${edge}_${level}`, edge, level, false);
    }
    makeDike(scene, `s_dike_${edge}_broken`, edge, 0, true);
  }
  for (const pair of Object.keys(DIKE_CORNERS)) {
    for (let level = 0; level < 3; level++) {
      makeDikeCorner(scene, `s_dike_${pair}_${level}`, pair, level, false);
    }
    makeDikeCorner(scene, `s_dike_${pair}_broken`, pair, 0, true);
  }
  for (const dir of ['cn', 'cs']) {
    for (let level = 0; level < 3; level++) {
      makeDikeChamfer(scene, `s_dike_${dir}_${level}`, dir, level, false);
    }
    makeDikeChamfer(scene, `s_dike_${dir}_broken`, dir, 0, true);
  }

  // One design per variant the simulation can hand out.
  if (HOUSE_SPECS.length !== HOUSE_VARIANTS) throw new Error('HOUSE_SPECS and HOUSE_VARIANTS disagree');
  for (let v = 0; v < HOUSE_VARIANTS; v++) {
    makeHouse(scene, `b_house_${v}`, v, false);
    makeHouse(scene, `b_house_${v}_night`, v, true);
  }
  makeChurch(scene, 'b_church', false);
  makeChurch(scene, 'b_church_night', true);
  makeRuin(scene, 'b_ruin');
  makeWindmill(scene);

  makePumps(scene);
  makeSteamPumps(scene);
  for (const edgeKey of ['xm', 'ym', 'xp', 'yp']) {
    for (let f = 0; f < WAVE_FRAMES; f++) makeStormWave(scene, edgeKey, f);
  }
  for (const edge of ['xm', 'ym', 'xp', 'yp']) {
    for (let level = 0; level < 3; level++) makeSluice(scene, edge, level);
  }

  makeTree(scene, 'p_tree_0', 0);
  makeTree(scene, 'p_tree_1', 1);
  makeCow(scene, 'p_cow');
  makeBoat(scene, 'p_boat');
  makeReeds(scene, 'p_reeds');

  makeShadow(scene, 'fx_shadow');
  makeCloudShadow(scene, 'fx_clouds');
  makeVignette(scene, 'fx_vignette');

  makeParticles(scene);

  makePanel(scene, 'ui_panel', P.ui.panel, P.ui.edge, P.ui.edgeLight);
  makePanel(scene, 'ui_panel_dark', P.ui.panelDark, P.ui.edgeDark, P.ui.edge);
  makePanel(scene, 'ui_btn', P.ui.panelLit, P.ui.edge, P.ui.edgeLight);
  makePanel(scene, 'ui_btn_hi', mix(P.ui.panelLit, P.ui.edgeLight, 0.25), P.ui.edgeLight, P.ui.gold);
  makePanel(scene, 'ui_btn_dn', P.ui.panelDark, P.ui.edgeDark, P.ui.edge);
  makePanel(scene, 'ui_btn_off', mix(P.ui.panel, P.ui.inkDark, 0.5), P.ui.edgeDark, P.ui.edgeDark);
  // A visibly filled variant for the one action on a screen the player is
  // actually meant to take next. Without it, "the sea wins" and "next
  // scenario" looked exactly as important as "menu" — three identical
  // buttons in a row, no steer.
  makePanel(scene, 'ui_btn_gold', mix(P.ui.panelLit, P.ui.gold, 0.4), P.ui.gold, mix(P.ui.gold, P.ui.white, 0.4));
  makePanel(scene, 'ui_btn_gold_hi', mix(P.ui.panelLit, P.ui.gold, 0.62), P.ui.gold, P.ui.white);
  makePanel(scene, 'ui_btn_gold_dn', mix(P.ui.panelDark, P.ui.gold, 0.3), P.ui.goldDark, P.ui.gold);

  makeIcons(scene);
}

export const PANEL_SLICE = 6;
export { TILE_W, TILE_H, TILE_WALL, TERRAIN_TEX_H };
