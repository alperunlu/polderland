/**
 * Polderland's typeface: a hand-drawn proportional pixel font with an 8px
 * cap height, a 6px x-height and real two-pixel descenders, generated into a
 * texture atlas at boot and registered as two Phaser bitmap fonts:
 *
 *   'pxfont'    regular, for prose, labels and readouts
 *   'pxfont_b'  bold, derived from the regular by a one-column embolden, for
 *               titles, buttons and the numbers the player watches
 *
 * Glyphs are authored as row strings ('#' = ink, anything else = empty), top
 * row first, so they read and edit as pictures. Row 0 is the cap line, row 7
 * the baseline row and rows 8-9 the descender. A spec that starts with '^'
 * carries one extra row above the cap line, which is where the accents of
 * accented lowercase go so they never touch the letter under them.
 *
 * Metrics: every glyph cell is CELL_H tall (one row of headroom, eight of
 * cap, two of descender) and lines are LINE_PITCH apart. `LINE_H` is kept as
 * the font *size* that bitmap text must be created at: Phaser scales a glyph
 * by fontSize / size, and anything but 1 puts pixel art off the grid.
 */

export const FONT_KEY = 'pxfont';
export const FONT_BOLD_KEY = 'pxfont_b';
/** The size every bitmap text is created at (a scale token, not a height). */
export const LINE_H = 10;
/** Distance between baselines of consecutive lines, at scale 1. */
export const LINE_PITCH = 12;
/** Height of one glyph cell: headroom + cap + descender. */
export const CELL_H = 11;
/** Ink height of a capital, and where it starts inside the cell. */
export const CAP_H = 8;
export const CAP_TOP = 1;
/** Kept for older callers: the ink height of a capital. */
export const GLYPH_H = CAP_H;

const BASE = {
  ' ': '.../.../.../.../.../.../.../...',

  A: '.###./#...#/#...#/#...#/#####/#...#/#...#/#...#',
  B: '####./#...#/#...#/####./#...#/#...#/#...#/####.',
  C: '.###./#...#/#..../#..../#..../#..../#...#/.###.',
  D: '####./#...#/#...#/#...#/#...#/#...#/#...#/####.',
  E: '####/#.../#.../###./#.../#.../#.../####',
  F: '####/#.../#.../###./#.../#.../#.../#...',
  G: '.###./#...#/#..../#..../#.###/#...#/#...#/.###.',
  H: '#...#/#...#/#...#/#####/#...#/#...#/#...#/#...#',
  I: '###/.#./.#./.#./.#./.#./.#./###',
  J: '...#/...#/...#/...#/...#/...#/#..#/.##.',
  K: '#...#/#..#./#.#../##.../##.../#.#../#..#./#...#',
  L: '#.../#.../#.../#.../#.../#.../#.../####',
  M: '#.....#/##...##/#.#.#.#/#..#..#/#.....#/#.....#/#.....#/#.....#',
  N: '#...#/##..#/##..#/#.#.#/#.#.#/#..##/#..##/#...#',
  O: '.###./#...#/#...#/#...#/#...#/#...#/#...#/.###.',
  P: '####./#...#/#...#/#...#/####./#..../#..../#....',
  Q: '.###./#...#/#...#/#...#/#...#/#...#/#..#./.##.#',
  R: '####./#...#/#...#/#...#/####./#..#./#...#/#...#',
  S: '.###./#...#/#..../.###./....#/....#/#...#/.###.',
  T: '#####/..#../..#../..#../..#../..#../..#../..#..',
  U: '#...#/#...#/#...#/#...#/#...#/#...#/#...#/.###.',
  V: '#...#/#...#/#...#/#...#/.#.#./.#.#./.#.#./..#..',
  W: '#.....#/#.....#/#.....#/#..#..#/#..#..#/#.#.#.#/##...##/#.....#',
  X: '#...#/#...#/.#.#./..#../..#../.#.#./#...#/#...#',
  Y: '#...#/#...#/.#.#./.#.#./..#../..#../..#../..#..',
  Z: '#####/....#/....#/...#./..#../.#.../#..../#####',

  a: '...../...../.###./....#/.####/#...#/#...#/.####',
  b: '#..../#..../####./#...#/#...#/#...#/#...#/####.',
  c: '..../..../.###/#.../#.../#.../#.../.###',
  d: '....#/....#/.####/#...#/#...#/#...#/#...#/.####',
  e: '...../...../.###./#...#/#####/#..../#..../.####',
  f: '..##/.#../###./.#../.#../.#../.#../.#..',
  g: '...../...../.####/#...#/#...#/#...#/#...#/.####/....#/.###.',
  h: '#..../#..../####./#...#/#...#/#...#/#...#/#...#',
  i: '#/./#/#/#/#/#/#',
  j: '..#/.../..#/..#/..#/..#/..#/..#/..#/##.',
  k: '#.../#.../#..#/#.#./##../##../#.#./#..#',
  l: '#./#./#./#./#./#./#./.#',
  m: '......./......./###.##./#..#..#/#..#..#/#..#..#/#..#..#/#..#..#',
  n: '...../...../####./#...#/#...#/#...#/#...#/#...#',
  o: '...../...../.###./#...#/#...#/#...#/#...#/.###.',
  p: '...../...../####./#...#/#...#/#...#/#...#/####./#..../#....',
  q: '...../...../.####/#...#/#...#/#...#/#...#/.####/....#/....#',
  r: '..../..../#.##/##../#.../#.../#.../#...',
  s: '..../..../.###/#.../.##./...#/...#/###.',
  t: '..../.#../###./.#../.#../.#../.#../..##',
  u: '...../...../#...#/#...#/#...#/#...#/#...#/.####',
  v: '...../...../#...#/#...#/#...#/.#.#./.#.#./..#..',
  w: '......./......./#.....#/#.....#/#..#..#/#..#..#/#..#..#/.##.##.',
  x: '...../...../#...#/.#.#./..#../..#../.#.#./#...#',
  y: '...../...../#...#/#...#/#...#/#...#/#...#/.####/....#/.###.',
  z: '...../...../#####/...#./..#../.#.../#..../#####',

  // Figures share one width so a changing number never shuffles sideways.
  0: '.###./#...#/#...#/#...#/#...#/#...#/#...#/.###.',
  1: '..#../.##../#.#../..#../..#../..#../..#../#####',
  2: '.###./#...#/....#/...#./..#../.#.../#..../#####',
  3: '.###./#...#/....#/..##./....#/....#/#...#/.###.',
  4: '...#./..##./.#.#./#..#./#####/...#./...#./...#.',
  5: '#####/#..../#..../####./....#/....#/#...#/.###.',
  6: '..##./.#.../#..../####./#...#/#...#/#...#/.###.',
  7: '#####/....#/....#/...#./..#../..#../..#../..#..',
  8: '.###./#...#/#...#/.###./#...#/#...#/#...#/.###.',
  9: '.###./#...#/#...#/#...#/.####/....#/...#./.##..',

  '.': './././././././#',
  ',': '../../../../../../../.#/#.',
  ':': './././#/./././#',
  ';': '../../../.#/../../../.#/#.',
  '!': '#/#/#/#/#/#/./#',
  '?': '.###./#...#/....#/...#./..#../..#../...../..#..',
  '-': '..../..../..../..../####',
  '–': '...../...../...../...../#####',
  '—': '......./......./......./......./#######',
  '+': '...../...../..#../..#../#####/..#../..#..',
  '=': '..../..../..../####/..../####',
  '/': '...#/...#/..#./..#./.#../.#../#.../#...',
  '\\': '#.../#.../.#../.#../..#./..#./...#/...#',
  '(': '.#/#./#./#./#./#./#./.#',
  ')': '#./.#/.#/.#/.#/.#/.#/#.',
  '[': '##/#./#./#./#./#./#./##',
  ']': '##/.#/.#/.#/.#/.#/.#/##',
  '{': '..#/.#./.#./#../.#./.#./.#./..#',
  '}': '#../.#./.#./..#/.#./.#./.#./#..',
  '%': '##...#/##..#./...#../..#.../.#..../#..##./...##',
  "'": '#/#',
  '"': '#.#/#.#',
  '`': '#./.#',
  '*': '...../..#../#.#.#/.###./#.#.#/..#..',
  '<': '..../...#/..#./.#../#.../.#../..#./...#',
  '>': '..../#.../.#../..#./...#/..#./.#../#...',
  '#': '...../.#.#./#####/.#.#./.#.#./#####/.#.#.',
  '&': '.##../#..#./#.#../.#.../#.#.#/#..#./#..#./.##.#',
  '@': '.####./#....#/#.##.#/#.#..#/#.#..#/#..##./#...../.####.',
  '_': '...../...../...../...../...../...../...../...../#####',
  '|': '#/#/#/#/#/#/#/#/#',
  '^': '..#../.#.#./#...#',
  '~': '...../...../...../.##.#/#.##.',
  '$': '..#../.####/#.#../.###./..#.#/..#.#/####./..#..',
  '·': '././././#',
  '…': '...../...../...../...../...../...../...../#.#.#',
  '×': '...../...../#...#/.#.#./..#../.#.#./#...#',
  '°': '.#./#.#/.#.',
  // The florin, for costs and the treasury.
  'ƒ': '..##/.#../.#../###./.#../.#../.#../.#../.#../#...',
  '’': '.#/.#/#.',
  '‘': '.#/#./#.',
  '“': '.#.#/#.#./#.#.',
  '”': '.#.#/.#.#/#.#.',
};

/*
 * Accented lowercase. The mark sits on the headroom row and the cap-line row,
 * with the row above the x-height left clear, so it never touches its letter.
 */
const MARKS5 = {
  acute: ['...#.', '..#..'],
  grave: ['.#...', '..#..'],
  dier: ['.....', '.#.#.'],
  circ: ['..#..', '.#.#.'],
  tilde: ['..#.#', '.#.#.'],
};
const MARKS4 = {
  acute: ['..#.', '.#..'],
  grave: ['#...', '.#..'],
  dier: ['....', '#.#.'],
  circ: ['.#..', '#.#.'],
  tilde: ['.#.#', '#.#.'],
};

function accent(base, mark) {
  const rows = BASE[base].split('/');
  const marks = (rows[0].length === 4 ? MARKS4 : MARKS5)[mark];
  return `^${[marks[0], marks[1], ...rows.slice(1)].join('/')}`;
}

const ACCENTED = {
  'á': ['a', 'acute'], 'à': ['a', 'grave'], 'ä': ['a', 'dier'], 'â': ['a', 'circ'],
  'é': ['e', 'acute'], 'è': ['e', 'grave'], 'ë': ['e', 'dier'], 'ê': ['e', 'circ'],
  'ó': ['o', 'acute'], 'ò': ['o', 'grave'], 'ö': ['o', 'dier'], 'ô': ['o', 'circ'],
  'ú': ['u', 'acute'], 'ù': ['u', 'grave'], 'ü': ['u', 'dier'], 'û': ['u', 'circ'],
  'ñ': ['n', 'tilde'], 'ý': ['y', 'acute'],
};
for (const [ch, [base, mark]] of Object.entries(ACCENTED)) BASE[ch] = accent(base, mark);
// The i loses its dot for a mark, and its mark is wider than its stem.
Object.assign(BASE, {
  'í': '^.#/#./../#./#./#./#./#./#.',
  'ì': '^#./.#/../.#/.#/.#/.#/.#/.#',
  'ï': '^.../#.#/.../.#./.#./.#./.#./.#./.#.',
  'î': '^.#./#.#/.../.#./.#./.#./.#./.#./.#.',
  'ç': '..../..../.###/#.../#.../#.../#.../.###/..#./.##.',
  'ÿ': '^...../.#.#./...../#...#/#...#/#...#/#...#/#...#/.####/....#/.###.',
});

/** Every glyph the font can draw, by character. The i18n check reads this. */
export const GLYPHS = BASE;

/** Parse a spec into { rows, top } where `top` is -1 for a headroom glyph. */
function parse(spec) {
  const head = spec.startsWith('^');
  const rows = (head ? spec.slice(1) : spec).split('/');
  return { rows, top: head ? -1 : 0, w: Math.max(...rows.map((r) => r.length)) };
}

/** The one-column embolden that makes the bold weight. */
function embolden(g) {
  const rows = g.rows.map((r) => {
    let out = '';
    for (let x = 0; x <= g.w; x++) {
      out += (r[x] === '#' || r[x - 1] === '#') ? '#' : '.';
    }
    return out;
  });
  return { rows, top: g.top, w: g.w + 1 };
}

const REGULAR = {};
const BOLD = {};
for (const [ch, spec] of Object.entries(BASE)) {
  const g = parse(spec);
  REGULAR[ch] = g;
  // A space stays a space; only ink gets heavier.
  BOLD[ch] = ch === ' ' ? { ...g, w: g.w + 1 } : embolden(g);
}

/** Pixels a glyph moves the pen: its width plus one column of tracking. */
function advanceOf(g) {
  return g.w + 1;
}

function faceFor(bold) {
  return bold ? BOLD : REGULAR;
}

/**
 * Paint a face into a canvas atlas and register it with Phaser. Glyphs are
 * white so text can be tinted to any palette colour at use time.
 */
function buildFace(scene, key, face) {
  if (scene.cache.bitmapFont.exists(key)) return;
  const keys = Object.keys(face);
  const cellW = Math.max(...keys.map((k) => face[k].w)) + 1;
  const cellH = CELL_H + 1;
  const cols = 16;
  const rowsN = Math.ceil(keys.length / cols);
  const texW = cols * cellW;
  const texH = rowsN * cellH;

  const canvasTex = scene.textures.createCanvas(key, texW, texH);
  const ctx = canvasTex.getContext();
  ctx.clearRect(0, 0, texW, texH);
  ctx.fillStyle = '#ffffff';

  const chars = {};
  keys.forEach((ch, i) => {
    const ox = (i % cols) * cellW;
    const oy = Math.floor(i / cols) * cellH;
    const g = face[ch];
    g.rows.forEach((line, y) => {
      for (let x = 0; x < line.length; x++) {
        if (line[x] === '#') ctx.fillRect(ox + x, oy + CAP_TOP + g.top + y, 1, 1);
      }
    });
    chars[ch.codePointAt(0)] = {
      x: ox,
      y: oy,
      width: g.w,
      height: CELL_H,
      centerX: g.w / 2,
      centerY: CELL_H / 2,
      xOffset: 0,
      yOffset: 0,
      xAdvance: advanceOf(g),
      data: {},
      kerning: {},
      u0: ox / texW,
      v0: oy / texH,
      u1: (ox + g.w) / texW,
      v1: (oy + CELL_H) / texH,
    };
  });
  canvasTex.refresh();

  scene.cache.bitmapFont.add(key, {
    data: { font: key, size: LINE_H, lineHeight: LINE_PITCH, chars },
    texture: key,
    frame: null,
  });
}

/** Register both weights. Safe to call more than once. */
export function createPixelFont(scene) {
  buildFace(scene, FONT_KEY, REGULAR);
  buildFace(scene, FONT_BOLD_KEY, BOLD);
}

/** Width in pixels of a string at scale 1, matching the atlas advances. */
export function measureText(str, bold = false) {
  const face = faceFor(bold);
  let widest = 0;
  for (const line of String(str).split('\n')) {
    let w = 0;
    for (const ch of line) {
      const g = face[ch];
      w += g ? advanceOf(g) : 4;
    }
    widest = Math.max(widest, w - 1);
  }
  return Math.max(0, widest);
}

/**
 * Draw a string straight into a 2D canvas context, one rect per ink pixel,
 * with its top-left at (x, y) and the cap line at y + CAP_TOP. Used for
 * baked pieces of chrome such as the title logo.
 */
export function paintText(ctx, str, x, y, { bold = false, scale = 1 } = {}) {
  const face = faceFor(bold);
  let pen = x;
  for (const ch of str) {
    const g = face[ch];
    if (!g) { pen += 4 * scale; continue; }
    g.rows.forEach((line, gy) => {
      for (let gx = 0; gx < line.length; gx++) {
        if (line[gx] === '#') {
          ctx.fillRect(pen + gx * scale, y + (CAP_TOP + g.top + gy) * scale, scale, scale);
        }
      }
    });
    pen += advanceOf(g) * scale;
  }
  return pen - x - scale;
}
