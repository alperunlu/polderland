/**
 * Polderland master palette.
 *
 * A hand-tuned ramp set, warm and bright: a Dutch spring morning rather than
 * the heavy silver-grey of the landscape painters it started from. The first
 * version sat the whole map under a dim, muddy grade — navy sea, olive
 * fields, brown brick — which read as grim at a glance, and nobody plays a
 * game about a village they would not want to live in.
 * Every sprite in the game is drawn from these ramps only — keeping the
 * count low is what makes the art read as a single coherent piece rather
 * than a pile of separately-drawn objects.
 *
 * Each ramp runs dark -> light so shading code can index it numerically.
 *
 * The ramps are hue-shifted, not just darkened: shadows lean toward blue and
 * violet, highlights toward yellow. A ramp that only changes value — the
 * same green with black mixed in — is what made the first palette read as
 * flat and a little dirty, because nothing in daylight shades that way.
 */

export const P = {
  // Neutral outline / shadow ramp. Never pure black — pixel art reads better
  // with a tinted darkest value.
  ink: [0x14121c, 0x231f2e, 0x352f42, 0x4a4356],

  // Polder grass, the dominant colour of the map.
  // Pushed a step greener and brighter at the top: with an ocean now filling
  // the rest of the screen, the polder is what has to hold the eye, and the
  // measured contrast of the playfield had dropped 17% when it did not.
  grass: [0x22473e, 0x2e6843, 0x468a45, 0x6aaa48, 0x96c75a, 0xc8e282],

  // Sun-bleached / trampled grass used for variation and for tiles that have
  // been flooded and drained again.
  grassDry: [0x5c5234, 0x7c6e3a, 0x9c8e48, 0xbaa95c, 0xd8c87c],

  // Tulip fields — the one saturated accent allowed on the terrain.
  tulipRed: [0x8a2230, 0xbc3242, 0xec5462],
  tulipYellow: [0x9a7a1c, 0xd8ac28, 0xfade58],

  // Beach / dune sand along the coastline.
  sand: [0x6f5a4c, 0x9a7f5c, 0xc2a472, 0xdec38e, 0xf3e0b2],

  // Open sea outside the dike ring.
  sea: [0x183866, 0x1e5486, 0x256c9e, 0x2d80b0, 0x4ea6cc, 0x8ad2e4],

  // Standing flood water inside the polder. A cold steel blue-green, kept
  // deliberately bright: water on your fields is the single most important
  // thing on the screen and must never be mistaken for darker grass.
  flood: [0x2e5864, 0x428492, 0x5aaab9, 0x7ecbd6, 0xaae8f0],

  // Canal water — calm, reflective, slightly bluer than flood water.
  canal: [0x1a4460, 0x235e80, 0x2e7aa0, 0x3e98c0, 0x5cb8dc],

  foam: [0xb8d8dd, 0xd8ecef, 0xf2fafb],

  // Brick, the material of most Dutch buildings.
  brick: [0x4e2026, 0x78342a, 0xa04e32, 0xc26a42, 0xdc8e5e],
  plaster: [0x7a6e5a, 0x9e917a, 0xc4b89c, 0xe2d8bc, 0xf8f0da],
  roofTile: [0x5e2426, 0x8c3a28, 0xb4542e, 0xd26e3a, 0xec9458],
  roofSlate: [0x262c4a, 0x3a4464, 0x525e82, 0x6e7c9e],

  wood: [0x372433, 0x573a30, 0x7a563a, 0x9e764c, 0xc29a68],
  stone: [0x36364e, 0x4f4f68, 0x6c6b82, 0x8e8c9f, 0xb6b3c1],

  metal: [0x2a3038, 0x3d4650, 0x556069, 0x717d87, 0x93a0a9],
  copper: [0x1c4a42, 0x2a6b5c, 0x3a8c78, 0x4fae95],

  glass: [0x1f3446, 0x2c4e68, 0x3f6f8f, 0xf2e2a8],

  // Painted and boarded facades, so a street is not one brick house repeated:
  // the green of the Zaan timber houses, limewashed plaster, ochre, slate
  // blue and a pale rose. Each is a dark -> light ramp like the rest.
  facade: {
    zaans: [0x1d3f2c, 0x2a5c3c, 0x3a7c50, 0x52a066, 0x74c282],
    ochre: [0x6a4a18, 0x946a24, 0xbc8e34, 0xdab04c, 0xf0ce72],
    slate: [0x2e3a4c, 0x445670, 0x5e7896, 0x809ab6, 0xa8bed2],
    rose: [0x7a4a48, 0x9e6664, 0xc08884, 0xdaa8a0, 0xf0c8be],
  },

  // Windmill sail canvas.
  sail: [0x9e917a, 0xc4b89c, 0xe2d8bc, 0xfbf5e6],

  // --- buildings & props ---
  // Six-step, hue-shifted ramps for the buildings, machines and props: the
  // shadow end leans cool (violet / blue), the lit end warm (ochre / cream),
  // and the saturation sits in the middle. The older ramps above stay as they
  // were because terrain, dikes and UI still index them.
  bBrick: [0x2e1520, 0x4c1f25, 0x6e2b2a, 0x91402f, 0xb05b3b, 0xcb7c52],
  bKlinker: [0x231722, 0x38202b, 0x512b33, 0x6d3b3c, 0x8a514a, 0xa76c5c],
  bYellowBrick: [0x3a2c33, 0x584538, 0x7c6444, 0x9f8452, 0xbea468, 0xd8c28a],
  bPlaster: [0x4b4453, 0x716a72, 0x9c948f, 0xc4baa8, 0xe2d8c0, 0xf4ecd8],
  bPantile: [0x351421, 0x571c23, 0x7e2a26, 0xa53e2b, 0xc75a35, 0xe07e48],
  bGlazed: [0x111320, 0x1b1f30, 0x282e44, 0x3a435c, 0x566079, 0x7c89a3],
  bSlate: [0x1a1d2c, 0x262c40, 0x353e55, 0x48536b, 0x606d86, 0x8390a8],
  bThatch: [0x2a2328, 0x43372f, 0x62513c, 0x82704b, 0xa18f5f, 0xc0b07c],
  bReed: [0x3a2a1e, 0x5c4228, 0x846233, 0xa98543, 0xc8a95e, 0xe2cb86],
  bWood: [0x1e1820, 0x33262a, 0x4d3730, 0x6c4e3b, 0x8d6a4d, 0xae8b66],
  bGreenPaint: [0x0e2126, 0x163630, 0x1f4d3d, 0x2c684c, 0x43855d, 0x67a374],
  bRedPaint: [0x2c1020, 0x4c1624, 0x74202a, 0x9a3031, 0xbd4a3c],
  // Limewash and paint for the rest of the village: rose, ochre, and the
  // grey-blue of a painted Zaan front. Shadows lean violet like the others.
  bRose: [0x3d2230, 0x6a3a4a, 0x9a5a66, 0xc27f84, 0xdca3a0, 0xf0c8c0],
  bOchre: [0x3f2a24, 0x6a4a2e, 0x97703a, 0xbf9448, 0xd9b461, 0xecd08a],
  bBluePaint: [0x1a2032, 0x283550, 0x3a4d6e, 0x51688a, 0x7088a6, 0x98aec4],
  bWhitePaint: [0x4a4a5c, 0x77788a, 0xa4a3ad, 0xcdc9c6, 0xebe5da, 0xfbf7ee],
  bSandstone: [0x3f3842, 0x625853, 0x8b7d6c, 0xb1a186, 0xd2c4a2, 0xebe0c1],
  bGreyStone: [0x24242f, 0x363744, 0x4c4d5b, 0x676875, 0x878892, 0xabacb1],
  bIron: [0x16181f, 0x242833, 0x363c49, 0x4d5563, 0x6a7380, 0x919aa4],
  bVerdigris: [0x15302f, 0x1f4a43, 0x2d6858, 0x40876c, 0x5ea583, 0x8cc29f],
  bGlass: [0x131a2b, 0x1c2a45, 0x28406a, 0x3b5d8c, 0x6a8fb5, 0xb6d0df],
  bGlow: [0x5c2c1c, 0xa35a24, 0xdc9336, 0xf7c35c, 0xffe79a, 0xfff7d6],
  bCanvas: [0x5d5358, 0x857866, 0xab9c82, 0xcbbd9e, 0xe6dbbd, 0xf8f1dc],
  bTanSail: [0x3a1a1c, 0x5c2621, 0x823a28, 0xa35433, 0xbf7143, 0xd6915a],
  bLeaf: [0x122022, 0x183327, 0x22492c, 0x316432, 0x4a8039, 0x6c9c42, 0x98bb5a],
  bWillow: [0x1a2628, 0x273d36, 0x3a5641, 0x52704c, 0x6f8b5a, 0x93a86f, 0xbcc98f],
  bBark: [0x1a1519, 0x2c2224, 0x42322e, 0x5b463a, 0x76604b, 0x947c61],
  bHide: [0x565869, 0x86879a, 0xb6b4b8, 0xdcd8d0, 0xf4efe4, 0xfffcf4],
  bHideDark: [0x0f0f16, 0x1a1a24, 0x292936, 0x3c3b4a],
  bSmoke: [0x4e4d5c, 0x6f6e7c, 0x94929c, 0xb9b6bb, 0xd9d6d6, 0xefece8],
  bOutline: [0x140f1a, 0x1e1724, 0x2a2130],

  // Sky ramp, dawn -> noon -> dusk -> night, used by the day/night cycle.
  skyNight: [0x0d1224, 0x141c33, 0x1d2846],
  skyDawn: [0x3a2c4a, 0x6b4058, 0xa9645e, 0xd99a72],
  skyDay: [0x3a72aa, 0x5a9aca, 0x88bfe2, 0xbadcf2],
  skyDusk: [0x2a2440, 0x54385c, 0x92546a, 0xc9836f],

  // --- atmosphere ---
  // Title sky, zenith -> horizon: a clear Dutch morning, deep blue overhead
  // thinning through cooler blues to a warm haze where it meets the sea.
  skyTitle: [0x2c5f9e, 0x326ca9, 0x3a79b3, 0x4486bd, 0x5093c6, 0x5fa0ce, 0x71add6,
    0x86badc, 0x9fc7df, 0xbad3df, 0xd7dcd6, 0xf1e4c6],
  // Cumulus, shade -> sunlit: violet-grey undersides, warm cream tops.
  cloud: [0x6c7aa3, 0x8795b8, 0xa6b3cd, 0xc7d1e1, 0xe4e9ef, 0xfbf7ea],
  // Sun disc and the two halo rings around it.
  sun: [0xfffbee, 0xffeebd, 0xf9dc98],
  // Distant water under the haze, horizon -> near.
  seaHaze: [0xc9dde0, 0xa6cadb, 0x80b2d2, 0x5d9ac5],
  // The next polder along, a pale silhouette on the horizon.
  farCoast: [0x85a6c4, 0x9cb8d0],
  // Multiply colours for the time-of-day grade and the cool cast shadow.
  grade: {
    night: 0x2e3b78,
    blue: 0x5f68aa,
    dawn: 0xb08cb4,
    morning: 0xffe6c8,
    golden: 0xffc890,
    sunset: 0xe8927a,
    storm: 0x7a88a2,
  },
  shadowTint: 0x4a5794,
  // Additive sun / moon light over the land from the upper left.
  sunGlow: [0xffb35c, 0xffd79a, 0xff8f6a, 0x7f9ad8],
  // Lit windows: deep amber spill -> hot core.
  lamp: [0xc86a1e, 0xf2a03c, 0xffd878, 0xfff4c8],

  // UI chrome — deep-sea navy with brass fittings, like a ship's chart
  // table. Cool panels so the warm polder (and the warm text on them) reads
  // forward; brass only where something is worth pressing or reading first.
  ui: {
    inkDark: 0x0a0f1d, // outline of every panel and button, never pure black
    panelDark: 0x121a2e, // wells, tooltips, insets
    panel: 0x1b2742, // card / bar face
    panelLit: 0x26365a, // raised button face
    panelHi: 0x3a5079, // 1px top light on a panel
    panelLo: 0x111829, // bottom shade on a panel
    btnHi: 0x5570a3, // 1px top light on a button
    btnLo: 0x161f36, // the visible "thickness" under a button
    btnHover: 0x30446e,
    shadow: 0x04070f,
    edgeLight: 0xf1cf7e, // light brass: headings
    edge: 0xc99a4a, // brass
    edgeDark: 0x7a5528,
    text: 0xf6ecd6,
    textDim: 0xa9b4ca,
    textMute: 0x68748e,
    gold: 0xf9cc5c,
    goldDark: 0xb07d27,
    blue: 0x5ab8e6,
    green: 0x8ccf5e,
    red: 0xf0525e,
    orange: 0xf29a3c,
    white: 0xfcf8ef,
    // Brass ramp, dark -> light, for primary buttons, badges and the logo.
    brass: [0x3e2610, 0x7a5528, 0xb07d27, 0xe0a843, 0xf9cc5c, 0xffe7a6],
    // Bar tracks and their fills' shade/light steps.
    track: 0x0d1424,
  },
};

/** Split a 24-bit colour into components. */
export function rgb(hex) {
  return { r: (hex >> 16) & 0xff, g: (hex >> 8) & 0xff, b: hex & 0xff };
}

export function toHex(r, g, b) {
  return (clamp255(r) << 16) | (clamp255(g) << 8) | clamp255(b);
}

function clamp255(v) {
  return Math.max(0, Math.min(255, Math.round(v)));
}

export function mix(c1, c2, t) {
  const a = rgb(c1);
  const b = rgb(c2);
  return toHex(a.r + (b.r - a.r) * t, a.g + (b.g - a.g) * t, a.b + (b.b - a.b) * t);
}

export function shade(hex, amount) {
  const c = rgb(hex);
  return toHex(c.r + amount, c.g + amount, c.b + amount);
}

/** CSS string for a 24-bit colour, optionally with alpha. */
export function css(hex, alpha = 1) {
  const c = rgb(hex);
  return alpha >= 1 ? `rgb(${c.r},${c.g},${c.b})` : `rgba(${c.r},${c.g},${c.b},${alpha})`;
}
