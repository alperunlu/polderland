/**
 * Viewport policy.
 *
 * A pixel-art game must never be scaled by a fraction, and it must never be
 * scaled down: shrinking a 1280x720 layout onto a phone is what makes the UI
 * unreadable. So instead of scaling the design to the device, the device
 * picks how many screen pixels one game pixel is worth, and the game is laid
 * out at whatever logical size that leaves.
 *
 * The result is a logical viewport of roughly 500-950 x 350-450 on every
 * device, from an iPhone SE to a 4K monitor, with each game pixel drawn as a
 * whole number of screen pixels.
 */

/**
 * What the HUD needs, per orientation. A phone held upright is a different
 * shape of problem from one held sideways: there is no room across for a row
 * of five build buttons, and plenty of room down for two rows of them. So the
 * floor and the preferred size are asked of the shape actually in front of us
 * rather than of one design size.
 */
const SHAPE = {
  landscape: { minW: 440, minH: 330, prefW: 560, prefH: 350 },
  portrait: { minW: 320, minH: 460, prefW: 380, prefH: 560 },
};

/** Smallest logical viewport the HUD can lay out in at all. */
export const MIN_LOGICAL_W = SHAPE.landscape.minW;
export const MIN_LOGICAL_H = SHAPE.landscape.minH;
/** Room the HUD would rather have, when the screen can afford it. */
export const PREFERRED_W = SHAPE.landscape.prefW;
export const PREFERRED_H = SHAPE.landscape.prefH;
export const MAX_ZOOM = 4;

/**
 * Pick the largest whole-number magnification that still leaves the HUD a
 * workable logical viewport. Magnifying as far as possible is what keeps the
 * game legible at arm's length; the floor is what stops a 13-inch tablet from
 * ending up with less usable space than a phone.
 */
/**
 * The screen minus the parts of it the system owns: the notch, the rounded
 * corners, the home indicator. `window.innerHeight` counts all of them, which
 * is how a build bar ends up under the bar you swipe to go home.
 */
export function safeInsets() {
  if (typeof getComputedStyle === 'undefined') return { top: 0, right: 0, bottom: 0, left: 0 };
  const css = getComputedStyle(document.documentElement);
  const read = (name) => {
    const v = parseFloat(css.getPropertyValue(name));
    return Number.isFinite(v) ? Math.max(0, Math.round(v)) : 0;
  };
  return {
    top: read('--safe-top'),
    right: read('--safe-right'),
    bottom: read('--safe-bottom'),
    left: read('--safe-left'),
  };
}

export function computeViewport() {
  const inset = safeInsets();
  const w = Math.max(300, Math.floor(window.innerWidth) - inset.left - inset.right);
  const h = Math.max(300, Math.floor(window.innerHeight) - inset.top - inset.bottom);
  const shape = h > w ? SHAPE.portrait : SHAPE.landscape;

  const fits = (zoom, minW, minH) => w / zoom >= minW && h / zoom >= minH;
  let zoom = 1;
  for (let z = MAX_ZOOM; z >= 1; z--) {
    if (fits(z, shape.prefW, shape.prefH)) { zoom = z; break; }
  }
  if (zoom === 1 && !fits(1, shape.prefW, shape.prefH)) {
    // Nothing satisfies the preferred size, so fall back to the hard floor.
    for (let z = MAX_ZOOM; z >= 1; z--) {
      if (fits(z, shape.minW, shape.minH)) { zoom = z; break; }
    }
  }
  return { zoom, width: Math.floor(w / zoom), height: Math.floor(h / zoom) };
}

/** Apply the computed viewport to a running game. */
export function applyViewport(game) {
  // Phaser defers booting until the document is ready, so the canvas may not
  // exist yet when this is called from a synchronous classic script.
  if (!game.canvas) return false;
  const { zoom, width, height } = computeViewport();
  const scale = game.scale;
  if (scale.width === width && scale.height === height && scale.zoom === zoom) return false;
  // setZoom must come first: it is what lets Phaser rewrite the canvas CSS
  // size on a later resize.
  scale.setZoom(zoom);
  scale.resize(width, height);

  // In NONE mode Phaser writes the canvas CSS size only when the zoom itself
  // changes. Turning a phone from upright to sideways keeps the zoom at 1 and
  // swaps the two dimensions, so the drawing buffer would be relaid out while
  // the element on the page kept the old shape — the game rendered into a
  // portrait box inside a landscape window. Set it here and it cannot drift.
  const { style } = game.canvas;
  style.width = `${width * zoom}px`;
  style.height = `${height * zoom}px`;
  return true;
}

/** Hook the viewport to the window, coalescing bursts of resize events. */
export function installViewport(game) {
  let pending = null;
  const update = () => {
    pending = null;
    applyViewport(game);
  };

  // Whichever comes first: the game is already booted, or it is about to be.
  game.events.once('ready', update);
  const schedule = () => {
    if (pending !== null) clearTimeout(pending);
    pending = setTimeout(update, 80);
  };
  window.addEventListener('resize', schedule);
  window.addEventListener('orientationchange', () => setTimeout(update, 120));
  if (window.visualViewport) window.visualViewport.addEventListener('resize', schedule);
  update();
}

/**
 * Layout metrics for the current viewport: the interface scale, and whether
 * each bar has room for one row or needs two.
 */
export function metricsFor(width, height, zoom = 1, buttons = 4) {
  // At zoom 1 the device is a phone: one game pixel is one CSS pixel, so
  // 7-pixel type lands around 7pt, half Apple's readable minimum. Scaling the
  // whole interface there swallows the screen, so only the text the player
  // actually reads while playing is enlarged, and the bars and panels grow
  // just enough to hold it.
  //
  // The typeface has an 8px cap height, so at zoom 1 it still lands near
  // 8pt: the readouts and labels the player acts on stay at 2x there, while
  // captions and secondary lines (gauge names, the day counter, the
  // inspector's rows) are drawn at 1x, which the taller face now carries.
  const text = zoom === 1 ? 2 : 1;
  const narrow = width < 640;
  const veryNarrow = width < 540;
  const short = height < 380;
  const portrait = height > width;
  const pad = narrow ? 6 : 10;
  const gap = narrow ? 4 : 6;
  // A 46pt button clears Apple's 44pt minimum touch target.
  const buttonH = text > 1 ? 54 : (short ? 42 : 46);
  const topBarH = text > 1 ? 48 : 36;
  // The top bar's square buttons. On a phone they are drawn at 38 and given
  // a hit area that reaches 46.
  const topBtn = text > 1 ? 38 : (short ? 24 : 26);
  const topBtnHitPad = text > 1 ? 4 : 0;

  // Whether each bar fits on one row is a question about width, not about
  // which way up the phone is: a landscape phone with side cutouts can be
  // narrower than a portrait tablet. So both are decided by measuring.
  // The HUD lays its top bar out from these same block widths.
  const speedBlock = topBtn * 5 + 2 * 2 + 4 * 2 + 8;
  // Room for a six-figure treasury at double size beside its coin.
  const moneyBlock = text > 1 ? 136 : 112;
  const dateBlock = text > 1 ? 84 : 72;
  const gaugeRoom = width - pad * 2 - moneyBlock - dateBlock - speedBlock;
  const chipW = Math.floor((gaugeRoom - 3 * gap) / 4);
  // Below this a gauge's caption and value no longer fit beside its icon.
  const stackTopBar = chipW < (text > 1 ? 104 : 66);

  const oneRowButton = Math.floor((width - pad * 2 - (buttons - 1) * gap) / buttons);
  // Enough for the icon and the longest label at this text size.
  const buildBarRows = oneRowButton >= (text > 1 ? 132 : 74) ? 1 : 2;

  return {
    text,
    portrait,
    narrow,
    veryNarrow,
    short,
    stackTopBar,
    buttonH,
    topBarH,
    buildBarRows,
    topBtn,
    topBtnHitPad,
    moneyBlock,
    dateBlock,
    // How tall each bar is in total, rows included. The HUD lays out from
    // these and the world camera measures its band from them, so the two
    // cannot disagree about where the playfield is.
    buildBarH: buttonH * buildBarRows + 4 * (buildBarRows - 1),
    // Stacked, the gauges get a row of their own under the treasury.
    topBarTotalH: stackTopBar ? topBarH + (text > 1 ? 44 : 34) : topBarH,
    pad,
    gap,
  };
}
