/**
 * UI chrome and icons, generated at boot.
 *
 * One light for the whole interface, the same as the world's: the sun is up
 * and to the left. So every panel and button carries a one-pixel highlight
 * along its top, a darker band along its bottom, rounded pixel corners and a
 * soft shadow falling down and right; every icon is shaded lit-side-up and
 * outlined selectively (a hue-tinted dark edge, lighter on the lit side),
 * never with a flat black line.
 *
 * Panels are nine-slices: SLICE px corners on a CHROME_S px square texture,
 * so all the detail (corners, lip, shadow) lives in the corners and edges
 * and stretches cleanly to any size.
 */

import { P, mix, rgb } from '../palette.js';
import { Px } from './px.js';
import { measureText, paintText, CELL_H } from './font.js';

const U = P.ui;
const B = U.brass;

export const CHROME_S = 24;
export const SLICE = 8;

/* ----------------------------------------------------------------
   Boxes
---------------------------------------------------------------- */

/**
 * Draw one rounded, lit box into `px` at (x0, y0), `w` x `h`.
 *
 * style: outline, face, hi (top light row), side (left column light),
 * shade (right column), lo (bottom band) and loRows (its height — the visible
 * thickness of a button), inset (rows of shadow along the top inside, for
 * pressed buttons and wells), rim (optional second inner ring colour).
 */
export function drawBox(px, x0, y0, w, h, s) {
  const inside = (x, y) => {
    if (x < 0 || y < 0 || x >= w || y >= h) return false;
    const cx = x < 2 ? x : x > w - 3 ? w - 1 - x : 2;
    const cy = y < 2 ? y : y > h - 3 ? h - 1 - y : 2;
    // Radius-2 corner: drop the two outermost pixels of each corner.
    return !(cx + cy < 2);
  };
  const edge = (x, y) => inside(x, y)
    && (!inside(x - 1, y) || !inside(x + 1, y) || !inside(x, y - 1) || !inside(x, y + 1));

  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      if (!inside(x, y)) continue;
      let c;
      if (edge(x, y)) c = s.outline;
      else {
        // Distance in from each side, measured inside the outline.
        const top = y - 1;
        const bottom = h - 2 - y;
        const left = x - 1;
        const right = w - 2 - x;
        c = s.face;
        if (s.rim !== undefined && (top === 0 || bottom === 0 || left === 0 || right === 0)) c = s.rim;
        else if (s.inset && top < s.inset) c = top === 0 ? s.insetDark ?? s.lo : s.lo;
        else if (bottom < (s.loRows || 0)) c = bottom === 0 && s.loEdge !== undefined ? s.loEdge : s.lo;
        else if (top === 0) c = s.hi;
        else if (left === 0 && s.side !== undefined) c = s.side;
        else if (right === 0 && s.shade !== undefined) c = s.shade;
      }
      px.set(x0 + x, y0 + y, c);
    }
  }
}

/** A soft drop shadow under a box, falling down and one pixel right. */
function dropShadow(px, x0, y0, w, h, rows) {
  for (let r = 0; r < rows; r++) {
    const a = r === 0 ? 0.42 : 0.2;
    px.hline(x0 + 2 + r, x0 + w - 1 - (r === 0 ? 0 : 1), y0 + h + r, U.shadow, a);
  }
  // The right-hand side catches a sliver too.
  px.vline(x0 + w, y0 + 3, y0 + h - 1, U.shadow, 0.3);
}

const STYLES = {
  // Cards, bars and dialogs.
  ui_panel: {
    outline: U.inkDark, face: U.panel, hi: U.panelHi, side: mix(U.panel, U.panelHi, 0.4),
    shade: mix(U.panel, U.panelLo, 0.5), lo: U.panelLo, loRows: 2, shadow: 2,
  },
  // Tooltips, toasts and floating readouts: a step darker, one lighter rim.
  ui_panel_dark: {
    outline: U.inkDark, face: U.panelDark, hi: mix(U.panelDark, U.panelHi, 0.7),
    side: mix(U.panelDark, U.panelHi, 0.3), lo: mix(U.panelDark, U.inkDark, 0.4), loRows: 1, shadow: 2,
  },
  // A recessed well: shadow inside along the top, light along the bottom.
  ui_well: {
    outline: mix(U.panelLo, U.inkDark, 0.6), face: U.panelDark, hi: U.panelDark,
    inset: 1, insetDark: mix(U.inkDark, U.panelDark, 0.35), lo: mix(U.panelDark, U.panelHi, 0.35),
    loRows: 1, shadow: 0,
  },
  // Raised buttons: a face with a lit top edge on a visible three-pixel base.
  ui_btn: {
    outline: U.inkDark, face: U.panelLit, hi: U.btnHi, side: mix(U.panelLit, U.btnHi, 0.35),
    lo: U.btnLo, loEdge: mix(U.btnLo, U.inkDark, 0.4), loRows: 3, shadow: 1,
  },
  ui_btn_hi: {
    outline: U.inkDark, face: U.btnHover, hi: mix(U.btnHi, U.white, 0.3),
    side: mix(U.btnHover, U.btnHi, 0.45), lo: U.btnLo, loEdge: mix(U.btnLo, U.inkDark, 0.4),
    loRows: 3, shadow: 1,
  },
  // Pressed: the face has sunk onto its base, shadow along its top edge.
  ui_btn_dn: {
    outline: U.inkDark, face: mix(U.panelLit, U.btnLo, 0.35), hi: U.btnLo,
    inset: 2, insetDark: mix(U.btnLo, U.inkDark, 0.5), lo: U.btnLo, loRows: 1, shadow: 0,
  },
  // Selected (the tool being placed, the speed that is running): brass ring.
  ui_btn_on: {
    outline: B[1], face: mix(U.btnHover, B[2], 0.18), hi: mix(B[4], U.white, 0.2), rim: B[3],
    lo: U.btnLo, loRows: 3, shadow: 1,
  },
  ui_btn_off: {
    outline: mix(U.inkDark, U.panelDark, 0.4), face: mix(U.panelDark, U.panel, 0.4),
    hi: mix(U.panelDark, U.panel, 0.9), lo: U.panelLo, loRows: 1, shadow: 0,
  },
  // The one action on a screen the player is meant to take next.
  ui_btn_gold: {
    outline: B[0], face: B[3], hi: B[5], side: B[4], shade: mix(B[3], B[2], 0.5),
    lo: B[1], loEdge: mix(B[1], B[0], 0.5), loRows: 3, shadow: 1,
  },
  ui_btn_gold_hi: {
    outline: B[0], face: B[4], hi: U.white, side: B[5], shade: B[3],
    lo: B[1], loEdge: mix(B[1], B[0], 0.5), loRows: 3, shadow: 1,
  },
  ui_btn_gold_dn: {
    outline: B[0], face: mix(B[3], B[2], 0.5), hi: B[2], inset: 2, insetDark: B[1],
    lo: B[1], loRows: 1, shadow: 0,
  },
};

/** Keys that press down: their drop shadow is the base they sink onto. */
function makeChrome(scene, key) {
  const s = STYLES[key];
  const S = CHROME_S;
  const px = new Px(S, S);
  const sh = s.shadow || 0;
  const h = S - sh;
  if (sh) dropShadow(px, 0, 0, S - 1, h, sh);
  drawBox(px, 0, 0, sh ? S - 1 : S, h, s);
  px.toTexture(scene, key);
}

/* ----------------------------------------------------------------
   Icons
---------------------------------------------------------------- */

export const ICON = 16;

/**
 * Selective outline: every empty pixel touching the sprite takes a dark,
 * hue-tinted version of the colour it touches — deeper on the shade side
 * (below and right), lighter on the lit side (above and left).
 */
function selOut(px, { lit = 0.5, dark = 0.78 } = {}) {
  const { w, h } = px;
  const img = px.ctx.getImageData(0, 0, w, h);
  const d = img.data;
  const at = (x, y) => (x < 0 || y < 0 || x >= w || y >= h ? -1 : (y * w + x) * 4);
  const solid = (x, y) => { const i = at(x, y); return i >= 0 && d[i + 3] > 128; };
  const col = (x, y) => { const i = at(x, y); return (d[i] << 16) | (d[i + 1] << 8) | d[i + 2]; };
  const out = [];
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      if (solid(x, y)) continue;
      // Shade side first: the sprite is above or to the left of this pixel.
      let src = null;
      let shadeSide = true;
      if (solid(x, y - 1)) src = [x, y - 1];
      else if (solid(x - 1, y)) src = [x - 1, y];
      else if (solid(x + 1, y)) { src = [x + 1, y]; shadeSide = false; } else if (solid(x, y + 1)) { src = [x, y + 1]; shadeSide = false; }
      if (!src) continue;
      const c = col(src[0], src[1]);
      out.push([x, y, mix(c, U.inkDark, shadeSide ? dark : lit)]);
    }
  }
  for (const [x, y, c] of out) px.set(x, y, c);
}

/** A disc shaded by the upper-left light, from a dark->light ramp. */
function ball(px, cx, cy, r, ramp, { rimDark = true } = {}) {
  for (let y = Math.floor(cy - r); y <= Math.ceil(cy + r); y++) {
    for (let x = Math.floor(cx - r); x <= Math.ceil(cx + r); x++) {
      const dx = x + 0.5 - cx;
      const dy = y + 0.5 - cy;
      const dist = Math.hypot(dx, dy);
      if (dist > r) continue;
      const l = -(dx + dy) / (r * 1.4142);
      let i = l > 0.35 ? ramp.length - 1 : l > -0.1 ? ramp.length - 2 : ramp.length - 3;
      if (rimDark && dist > r - 1.1 && l < 0.2) i = Math.max(0, ramp.length - 4);
      px.set(x, y, ramp[Math.max(0, i)]);
    }
  }
}

/** A glyph icon (transport controls and the like) in lit cream. */
function lightGlyph(px, draw) {
  draw(U.text);
  // A shade step along the lower edge of every stroke: the same light as
  // the chrome it sits on.
  const { w, h } = px;
  const img = px.ctx.getImageData(0, 0, w, h);
  const d = img.data;
  const lower = [];
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const i = (y * w + x) * 4;
      if (d[i + 3] < 128) continue;
      const below = y + 1 < h ? d[i + w * 4 + 3] : 0;
      if (below < 128) lower.push([x, y]);
    }
  }
  for (const [x, y] of lower) px.set(x, y, mix(U.text, U.textDim, 0.7));
}

function icon(scene, key, draw, { outline = true } = {}) {
  const px = new Px(ICON, ICON);
  draw(px);
  if (outline) selOut(px);
  px.toTexture(scene, key);
}

function makeIconSet(scene) {
  /* ---- Money ---- */
  icon(scene, 'ic_coin', (px) => {
    ball(px, 8, 8, 6.4, [B[1], B[2], B[3], B[4]]);
    // Raised inner ring: lit on its lower-right inside, shaded upper-left.
    for (let a = 0; a < 32; a++) {
      const t = (a / 32) * Math.PI * 2;
      const x = Math.round(7.5 + Math.cos(t) * 3.4);
      const y = Math.round(7.5 + Math.sin(t) * 3.4);
      const lit = Math.cos(t) + Math.sin(t) > 0;
      px.set(x, y, lit ? B[5] : B[2]);
    }
    px.set(5, 4, U.white);
    px.set(4, 5, B[5]);
    px.set(6, 4, B[5]);
  });

  /* ---- Gauges ---- */
  // Sea level: a red-and-white peilschaal standing in the water.
  icon(scene, 'ic_drop', (px) => {
    for (let y = 1; y <= 13; y++) {
      const band = Math.floor((y - 1) / 2) % 2 === 0;
      px.set(10, y, band ? U.white : U.red);
      px.set(11, y, band ? mix(U.white, U.textDim, 0.5) : mix(U.red, P.brick[1], 0.5));
    }
    px.rect(1, 9, 14, 6, P.sea[3]);
    px.rect(1, 12, 14, 3, P.sea[2]);
    // Wave crests along the surface.
    for (const x0 of [1, 6, 11]) {
      px.hline(x0, x0 + 2, 8, P.sea[4]);
      px.set(x0 + 1, 7, P.foam[2]);
      px.set(x0, 8, P.foam[1]);
    }
    px.hline(2, 13, 10, P.sea[4], 0.6);
  });

  // Workable land: a furrowed field with a new shoot.
  icon(scene, 'ic_land', (px) => {
    px.rect(1, 10, 14, 5, P.grass[3]);
    px.hline(1, 14, 10, P.grass[5]);
    px.hline(1, 14, 12, P.grass[2]);
    px.hline(1, 14, 14, P.grass[1]);
    px.hline(2, 13, 11, P.grass[4]);
    // Stem and two leaves, lit on the left.
    px.vline(8, 4, 10, P.grass[2]);
    px.vline(7, 5, 9, P.grass[4]);
    px.poly([[2, 5], [5, 3], [7, 5], [5, 7]], P.grass[4]);
    px.hline(3, 5, 4, P.grass[5]);
    px.poly([[9, 3], [12, 1], [14, 2], [11, 5]], P.grass[3]);
    px.hline(10, 12, 2, P.grass[4]);
  });

  // The flood mark, kept for anything still asking for it.
  icon(scene, 'ic_flood', (px) => {
    px.rect(1, 8, 14, 7, P.flood[3]);
    px.hline(1, 14, 8, P.foam[1]);
    px.hline(1, 14, 12, P.flood[2]);
    px.poly([[4, 7], [8, 2], [12, 7]], P.roofTile[3]);
    px.rect(5, 7, 6, 2, P.brick[3]);
  });

  // Canal: a channel between two grassy banks, in section.
  icon(scene, 'ic_canal', (px) => {
    // A straight polder canal between two grass banks, seen across: the far
    // bank lit, the near bank's lip throwing a shadow on the water.
    px.rect(1, 2, 14, 4, P.grass[4]);
    px.hline(1, 14, 2, P.grass[5]);
    px.hline(1, 14, 5, P.wood[3]);
    px.rect(1, 6, 14, 5, P.canal[3]);
    px.hline(1, 14, 6, P.canal[1]);
    px.hline(3, 6, 8, P.foam[1]);
    px.hline(9, 13, 9, P.canal[4]);
    px.set(10, 7, P.foam[2]);
    px.rect(1, 11, 14, 4, P.grass[3]);
    px.hline(1, 14, 11, P.grass[4]);
    px.hline(1, 14, 14, P.grass[2]);
    px.set(4, 12, P.grass[5]); px.set(11, 13, P.grass[5]);
  });

  icon(scene, 'ic_house', (px) => {
    // A stepped gable, the unmistakable Dutch house front.
    const steps = [[6, 9, 2], [5, 10, 4], [4, 11, 6]];
    for (const [a, b, y] of steps) px.rect(a, y, b - a + 1, 2, P.brick[3]);
    px.rect(3, 8, 10, 7, P.brick[3]);
    px.vline(3, 8, 14, P.brick[4]);
    px.vline(12, 8, 14, P.brick[2]);
    for (const [a, b, y] of steps) {
      px.hline(a, b, y, P.plaster[4]);
      px.set(b, y + 1, P.brick[2]);
      px.set(a, y + 1, P.brick[4]);
    }
    px.hline(3, 12, 8, P.plaster[3]);
    px.rect(7, 4, 2, 2, P.glass[1]);
    px.set(7, 4, P.glass[2]);
    // Windows with white frames, and a green door.
    for (const x of [4, 10]) {
      px.rect(x, 9, 2, 3, P.plaster[4]);
      px.set(x + 1, 10, P.glass[1]);
      px.set(x + 1, 11, P.glass[2]);
    }
    px.rect(7, 11, 2, 4, P.copper[1]);
    px.set(7, 11, P.copper[2]);
    px.hline(6, 9, 10, P.plaster[4]);
  });

  /* ---- Build tools ---- */
  icon(scene, 'ic_dike', (px) => {
    // A dike in section, and the whole game in one picture: the sea stands
    // high on the left, the bank holds it, and the polder lies lower than the
    // water on the right. The old drawing gave the sea two pixels at the foot
    // and read as a green mound.
    // The bank: grass crown and landward slope, basalt on the sea face.
    px.poly([[3, 14], [6, 4], [9, 4], [13, 14]], P.grass[3]);
    px.poly([[9, 4], [13, 14], [11, 14], [8, 5]], P.grass[2]);
    px.hline(6, 9, 3, P.sand[4]);
    px.hline(6, 9, 4, P.sand[3]);
    px.poly([[3, 14], [5, 7], [7, 7], [6, 14]], P.stone[3]);
    px.line(5, 7, 3, 13, P.stone[4]);
    px.hline(5, 6, 10, P.stone[2]);
    // The sea, up to more than half the bank's height, with a breaking crest.
    px.poly([[0, 7], [4, 7], [3, 14], [0, 14]], P.sea[3]);
    px.rect(0, 11, 3, 4, P.sea[2]);
    px.hline(0, 3, 7, P.foam[2]);
    px.set(1, 6, P.foam[1]);
    px.hline(0, 2, 9, P.sea[4]);
    // The polder: a field well below the waterline, with its ditch.
    px.rect(12, 12, 4, 3, P.grass[4]);
    px.hline(12, 15, 12, P.grass[5]);
    px.set(14, 13, P.canal[3]);
    px.set(14, 14, P.canal[2]);
  });

  icon(scene, 'ic_mill', (px) => {
    // Tapered thatched body on a brick base, cap, then the sails in front.
    px.poly([[5, 14], [6, 7], [10, 7], [11, 14]], P.grassDry[3]);
    px.poly([[8, 7], [10, 7], [11, 14], [8, 14]], P.grassDry[2]);
    px.vline(6, 9, 13, P.grassDry[4]);
    px.rect(4, 12, 8, 3, P.brick[3]);
    px.hline(4, 11, 12, P.brick[4]);
    px.vline(11, 12, 14, P.brick[2]);
    px.rect(7, 13, 2, 2, P.wood[1]);
    px.poly([[5, 7], [8, 4], [11, 7]], P.wood[2]);
    px.line(5, 7, 8, 4, P.wood[3]);
    // Sails: two crossed stocks, each with a strip of lattice canvas on its
    // trailing side, turning clockwise.
    const hx = 8; const hy = 6;
    for (const [dx, dy] of [[-1, -1], [1, -1], [-1, 1], [1, 1]]) {
      for (let k = 1; k <= 5; k++) {
        const x = hx + dx * k;
        const y = hy + dy * k;
        px.set(x - dy, y + dx, k % 2 ? P.sail[3] : P.sail[1]);
        px.set(x, y, P.wood[1]);
      }
    }
    px.set(hx, hy, P.metal[3]);
  });

  icon(scene, 'ic_pump', (px) => {
    // An electric gemaal: a low flat-roofed hall with solar panels on top,
    // a band of windows, and water pouring out of its culverts.
    px.rect(1, 3, 13, 2, P.glass[1]);
    for (const x of [2, 5, 8, 11]) px.rect(x, 3, 2, 1, P.glass[3]);
    px.hline(1, 13, 5, P.stone[4]);
    px.rect(1, 6, 13, 7, P.brick[1]);
    px.vline(1, 6, 12, P.brick[2]);
    px.rect(2, 7, 11, 2, P.glass[2]);
    px.hline(2, 12, 7, P.glass[3]);
    for (const x of [3, 7, 11]) px.rect(x - 1, 10, 2, 3, P.ink[1]);
    px.rect(0, 13, 16, 2, P.canal[3]);
    for (const x of [2, 6, 10]) px.set(x, 13, P.foam[1]);
  });

  icon(scene, 'ic_fence', (px) => {
    // A kwelderwerk: a square of brushwood dams staked out on the mud.
    px.rect(0, 11, 16, 5, P.sand[1]);
    px.hline(0, 15, 11, mix(P.sand[2], P.flood[3], 0.4));
    for (const x of [2, 6, 10, 14]) {
      px.vline(x, 5, 12, P.wood[3]);
      px.set(x, 5, P.wood[4]);
    }
    px.hline(1, 15, 9, P.wood[1]);
    px.hline(1, 15, 10, P.wood[2]);
    px.hline(1, 15, 7, P.wood[2]);
  });

  icon(scene, 'ic_steam', (px) => {
    // A steam gemaal: a brick engine hall and its tall chimney.
    px.rect(11, 1, 3, 12, P.brick[2]);
    px.vline(11, 1, 12, P.brick[3]);
    px.hline(10, 14, 1, P.stone[4]);
    px.poly([[1, 7], [6, 3], [11, 7]], P.roofSlate[2]);
    px.line(1, 7, 6, 3, P.roofSlate[3]);
    px.rect(1, 7, 11, 7, P.brick[3]);
    px.vline(1, 7, 13, P.brick[4]);
    px.hline(1, 11, 7, P.stone[3]);
    for (const x of [3, 7]) {
      px.rect(x, 9, 2, 3, P.glass[1]);
      px.set(x, 9, P.glass[3]);
    }
    px.rect(1, 14, 14, 1, P.canal[3]);
    px.hline(12, 14, 13, P.canal[4]);
  });

  icon(scene, 'ic_outfall', (px) => {
    px.rect(1, 6, 9, 8, P.brick[3]);
    px.vline(1, 6, 13, P.brick[4]);
    px.hline(1, 9, 5, P.roofSlate[3]);
    px.rect(10, 1, 3, 13, P.brick[2]);
    px.hline(9, 13, 1, P.stone[4]);
    px.rect(3, 8, 2, 4, P.glass[2]);
    px.rect(6, 8, 2, 4, P.glass[2]);
    px.rect(1, 14, 14, 1, P.canal[3]);
  });

  icon(scene, 'ic_sluice', (px) => {
    // A sluice: stone piers, a beam and winch, and a timber gate.
    px.rect(1, 4, 3, 11, P.stone[3]);
    px.vline(1, 4, 14, P.stone[4]);
    px.rect(12, 4, 3, 11, P.stone[2]);
    px.vline(14, 4, 14, P.stone[1]);
    px.rect(1, 3, 14, 2, P.wood[3]);
    px.hline(1, 14, 3, P.wood[4]);
    px.rect(4, 6, 8, 6, P.wood[2]);
    px.vline(4, 6, 11, P.wood[3]);
    px.vline(8, 6, 11, P.wood[1]);
    px.hline(4, 11, 8, P.metal[2]);
    px.rect(4, 12, 8, 3, P.canal[3]);
    px.hline(4, 11, 12, P.canal[4]);
    px.hline(5, 9, 13, P.foam[0], 0.7);
    ball(px, 8, 1.5, 1.6, [P.metal[1], P.metal[2], P.metal[3], P.metal[4]], { rimDark: false });
  });

  /* ---- Misc ---- */
  icon(scene, 'ic_warn', (px) => {
    px.poly([[8, 1], [15, 14], [1, 14]], U.orange);
    px.poly([[8, 1], [15, 14], [8, 14]], mix(U.orange, P.brick[2], 0.35));
    px.line(8, 1, 1, 14, B[5]);
    px.rect(7, 5, 2, 5, U.inkDark);
    px.rect(7, 11, 2, 2, U.inkDark);
  });

  icon(scene, 'ic_storm', (px) => {
    ball(px, 5, 6, 3.6, [P.stone[1], P.stone[2], P.stone[3], P.stone[4]], { rimDark: false });
    ball(px, 10, 5, 4.2, [P.stone[1], P.stone[2], P.stone[3], P.stone[4]], { rimDark: false });
    px.rect(2, 7, 12, 3, P.stone[2]);
    px.hline(2, 13, 9, P.stone[1]);
    px.poly([[8, 9], [11, 9], [9, 12], [11, 12], [6, 15], [7, 12], [6, 12]], U.gold);
  });

  icon(scene, 'ic_clock', (px) => {
    ball(px, 8, 8, 6.4, [P.plaster[1], P.plaster[2], P.plaster[3], P.plaster[4]]);
    px.vline(7, 4, 8, U.inkDark);
    px.hline(7, 10, 8, U.inkDark);
  });

  icon(scene, 'ic_lock', (px) => {
    for (let y = 2; y <= 7; y++) {
      px.set(4, y, P.metal[4]);
      px.set(11, y, P.metal[2]);
    }
    px.hline(5, 10, 1, P.metal[4]);
    px.set(5, 2, P.metal[3]); px.set(10, 2, P.metal[3]);
    px.rect(3, 7, 10, 8, B[3]);
    px.hline(3, 12, 7, B[5]);
    px.vline(3, 8, 14, B[4]);
    px.hline(3, 12, 14, B[2]);
    px.rect(7, 9, 2, 4, B[1]);
  });

  icon(scene, 'ic_star', (px) => {
    px.poly([[8, 1], [10, 6], [15, 6], [11, 9], [13, 14], [8, 11], [3, 14], [5, 9], [1, 6], [6, 6]], B[4]);
    px.poly([[8, 1], [10, 6], [15, 6], [11, 9], [13, 14], [8, 11]], B[3]);
    px.set(7, 5, B[5]); px.set(7, 6, B[5]); px.set(6, 7, B[5]);
  });

  icon(scene, 'ic_book', (px) => {
    px.rect(2, 3, 6, 10, P.plaster[4]);
    px.rect(8, 3, 6, 10, P.plaster[3]);
    px.vline(8, 3, 13, P.plaster[1]);
    for (const y of [5, 7, 9]) {
      px.hline(3, 6, y, P.plaster[2]);
      px.hline(9, 12, y, P.plaster[1]);
    }
    px.hline(2, 13, 13, P.wood[2]);
    px.hline(1, 14, 14, P.wood[1]);
  });

  /* ---- Transport and system glyphs ---- */
  icon(scene, 'ic_pause', (px) => lightGlyph(px, (c) => {
    px.rect(4, 3, 3, 10, c);
    px.rect(9, 3, 3, 10, c);
  }));

  icon(scene, 'ic_play', (px) => lightGlyph(px, (c) => {
    for (let y = 3; y <= 12; y++) {
      const k = Math.min(y - 3, 12 - y);
      px.hline(5, 5 + Math.round(k * 1.5), y, c);
    }
  }));

  icon(scene, 'ic_ff', (px) => lightGlyph(px, (c) => {
    for (let y = 4; y <= 11; y++) {
      const k = Math.min(y - 4, 11 - y);
      px.hline(2, 2 + Math.round(k * 1.3), y, c);
      px.hline(8, 8 + Math.round(k * 1.3), y, c);
    }
  }));

  icon(scene, 'ic_fit', (px) => lightGlyph(px, (c) => {
    for (const [ox, oy, sx, sy] of [[2, 2, 1, 1], [13, 2, -1, 1], [2, 13, 1, -1], [13, 13, -1, -1]]) {
      px.rect(Math.min(ox, ox + sx * 3), oy, 4, 1, c);
      px.rect(ox, Math.min(oy, oy + sy * 3), 1, 4, c);
    }
    // A tiny island tile in the middle: "the whole map".
    px.hline(7, 8, 6, P.grass[4]);
    px.hline(6, 9, 7, P.grass[4]);
    px.hline(6, 9, 8, P.grass[3]);
    px.hline(7, 8, 9, P.grass[2]);
  }));

  const speaker = (px, c) => {
    px.rect(2, 6, 3, 4, c);
    px.poly([[4, 6], [8, 2], [8, 13], [4, 9]], c);
  };
  icon(scene, 'ic_sound', (px) => {
    lightGlyph(px, (c) => speaker(px, c));
    px.vline(10, 6, 9, U.blue);
    px.set(11, 5, U.blue); px.set(11, 10, U.blue);
    px.vline(12, 5, 10, mix(U.blue, U.white, 0.3));
    px.set(13, 4, U.blue); px.set(13, 11, U.blue);
    px.vline(14, 5, 10, U.blue);
  });

  icon(scene, 'ic_mute', (px) => {
    lightGlyph(px, (c) => speaker(px, c));
    px.tint(U.textMute, 0.45);
    px.line(10, 5, 14, 10, U.red);
    px.line(14, 5, 10, 10, U.red);
    px.line(11, 5, 14, 9, U.red);
    px.line(13, 5, 10, 9, U.red);
  });

  icon(scene, 'ic_gear', (px) => {
    const ramp = [P.metal[1], P.metal[2], P.metal[3], P.metal[4]];
    for (let a = 0; a < 8; a++) {
      const t = (a / 8) * Math.PI * 2;
      const x = Math.round(7.5 + Math.cos(t) * 6);
      const y = Math.round(7.5 + Math.sin(t) * 6);
      const lit = Math.cos(t) + Math.sin(t) < 0;
      px.rect(x - 1, y - 1, 2, 2, lit ? ramp[3] : ramp[1]);
    }
    ball(px, 8, 8, 5.2, ramp);
    ball(px, 8, 8, 2.2, [U.panelDark, U.panelDark, U.panelLo, U.panelLo], { rimDark: false });
  });
}

/* ----------------------------------------------------------------
   Small fixed pieces
---------------------------------------------------------------- */

function makePieces(scene) {
  // Keycap, for the shortcut numbers shown in mouse mode.
  const key = new Px(11, 12);
  drawBox(key, 0, 0, 11, 12, {
    outline: U.inkDark, face: mix(U.panelDark, U.panelLo, 0.5), hi: U.panel,
    lo: mix(U.inkDark, U.panelDark, 0.5), loRows: 2,
  });
  key.toTexture(scene, 'ui_key');

  // Slider knob: a brass lozenge with a grip line.
  const knob = new Px(11, 15);
  knob.hline(3, 10, 14, U.shadow, 0.4);
  drawBox(knob, 0, 0, 10, 14, {
    outline: B[0], face: B[3], hi: B[5], side: B[4], shade: B[2], lo: B[1], loRows: 2,
  });
  knob.vline(4, 4, 8, B[2]);
  knob.vline(5, 4, 8, B[5]);
  knob.toTexture(scene, 'ui_knob');

  // Page dot and its current state.
  const dot = new Px(5, 5);
  dot.rect(1, 0, 3, 5, U.textMute); dot.rect(0, 1, 5, 3, U.textMute);
  dot.toTexture(scene, 'ui_dot');
  const dotOn = new Px(9, 5);
  dotOn.rect(1, 0, 7, 5, B[4]); dotOn.rect(0, 1, 9, 3, B[4]);
  dotOn.hline(1, 7, 0, B[5]); dotOn.hline(1, 7, 4, B[2]);
  dotOn.toTexture(scene, 'ui_dot_on');
}

/* ----------------------------------------------------------------
   Title logo
---------------------------------------------------------------- */

/**
 * The wordmark: the bold face with a brass face graded light to dark down
 * the letters, a white glint along their tops, a two-pixel extrusion in deep
 * sea blue under them (they stand like a dike above the water), a dark
 * tinted outline around the lot and a soft shadow under it. Drawn at one
 * pixel per font pixel and shown at a whole-number scale.
 */
export function makeLogo(scene, key, text) {
  const tw = measureText(text, true);
  const M = 2;
  const EX = 2;
  const w = tw + M * 2;
  const h = CELL_H + EX + M * 2 + 1;
  // Paint the letters into a mask.
  const mask = new Px(w, h);
  mask.ctx.fillStyle = '#ffffff';
  paintText(mask.ctx, text, M, M - 1, { bold: true });
  const md = mask.ctx.getImageData(0, 0, w, h).data;
  const ink = (x, y) => x >= 0 && y >= 0 && x < w && y < h && md[(y * w + x) * 4 + 3] > 128;
  const body = (x, y) => ink(x, y) || ink(x, y - 1) || ink(x, y - 2);

  const px = new Px(w, h);
  // Three clean bands down the letters, lightest on top: no per-stroke
  // glints, which at this size only read as stripes.
  const ramp = [B[5], B[5], B[5], B[4], B[4], B[4], B[3], B[3]];
  const sea = [P.sea[2], P.sea[0]];
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      if (ink(x, y)) {
        const row = Math.max(0, Math.min(7, y - M));
        px.set(x, y, row === 0 && ink(x - 1, y) && ink(x + 1, y) ? U.white : ramp[row]);
      } else if (body(x, y)) {
        px.set(x, y, ink(x, y - 1) ? sea[0] : sea[1]);
      } else if (body(x - 1, y) || body(x + 1, y) || body(x, y - 1) || body(x, y + 1)) {
        px.set(x, y, U.inkDark);
      } else if (body(x - 1, y - 1) || body(x, y - 2)) {
        px.set(x, y, U.shadow, 0.35);
      }
    }
  }
  px.toTexture(scene, key);
}

/* ----------------------------------------------------------------
   Entry points used by textures.js
---------------------------------------------------------------- */

/** Every nine-slice chrome texture, by the key the widgets ask for. */
export function makeUiPanel(scene, key) {
  if (STYLES[key]) makeChrome(scene, key);
}

export function makeUiIcons(scene) {
  // Anything the widgets use that textures.js does not ask for by name.
  for (const key of Object.keys(STYLES)) {
    if (!scene.textures.exists(key)) makeChrome(scene, key);
  }
  makePieces(scene);
  makeIconSet(scene);
  makeLogo(scene, 'ui_logo', 'POLDERLAND');
}

/** Red/green/blue of a colour — handy for callers composing canvases. */
export { rgb };
