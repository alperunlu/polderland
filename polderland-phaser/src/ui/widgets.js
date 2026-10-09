/**
 * Pixel-art UI primitives shared by every scene: lit nine-slice panels,
 * bitmap-font labels, buttons that respond to pointer and keyboard alike,
 * gauges, a slider and tooltips.
 *
 * Nothing here knows about the game rules — widgets take values and callbacks.
 *
 * One light for everything: from the upper left. Panels and buttons carry a
 * lit top edge and a darker base; a pressed button sinks onto its base, so
 * its contents drop by the thickness it lost.
 */

import Phaser from 'phaser';
import { P, mix } from '../palette.js';
import {
  FONT_KEY, FONT_BOLD_KEY, LINE_H, LINE_PITCH, CELL_H, CAP_H, CAP_TOP, measureText,
} from '../art/font.js';
import { SLICE } from '../art/chrome.js';
import { Audio } from '../systems/Audio.js';
import { Haptics } from '../systems/Haptics.js';

export const PANEL_SLICE = SLICE;
/** Rows a panel's baked drop shadow takes under its visible box. */
export const PANEL_SHADOW = 2;
/** A raised button's base: how far its face sinks when pressed. */
const BTN_LIP = 3;
const BTN_SINK = 2;

export { LINE_PITCH, CELL_H, CAP_H };

/** A lit panel sized to any rectangle. */
export function panel(scene, x, y, w, h, key = 'ui_panel') {
  return scene.add.nineslice(
    Math.round(x), Math.round(y), key, undefined, Math.round(w), Math.round(h),
    SLICE, SLICE, SLICE, SLICE,
  ).setOrigin(0, 0);
}

/**
 * A bitmap-font label. `size` is a whole-number scale so glyphs stay on the
 * pixel grid — no fractional scaling anywhere in the UI. `bold` picks the
 * heavy weight; `shadow` drops a one-(game)-pixel shade under the ink, which
 * is what lifts small type off a panel.
 */
export function label(scene, x, y, text, {
  size = 1, color = P.ui.text, origin = [0, 0], align = 'left', maxWidth = 0,
  bold = false, shadow = true, shadowColor = P.ui.inkDark, shadowAlpha = 0.85,
} = {}) {
  const t = scene.add.bitmapText(Math.round(x), Math.round(y),
    bold ? FONT_BOLD_KEY : FONT_KEY, text, LINE_H);
  t.setScale(size);
  t.setTint(color);
  t.setOrigin(origin[0], origin[1]);
  // Phaser measures wrap width in world pixels, so it is not divided by
  // the label's scale.
  if (maxWidth > 0) t.setMaxWidth(Math.floor(maxWidth));
  if (align === 'center') t.setCenterAlign();
  else if (align === 'right') t.setRightAlign();
  if (shadow) t.setDropShadow(0, 1, shadowColor, shadowAlpha);
  return t;
}

export function textWidth(str, size = 1, bold = false) {
  return measureText(str, bold) * size;
}

/** The y to put a label at so its capitals are centred on `cy`. */
export function capY(cy, size = 1) {
  return Math.round(cy - (CAP_TOP + CAP_H / 2) * size);
}

/** Height a label of `lines` lines takes, top of cell to bottom of cell. */
export function textHeight(lines = 1, size = 1) {
  return ((lines - 1) * LINE_PITCH + CELL_H) * size;
}

/**
 * A push button with optional icon, a bold title, an optional sub-label and
 * an optional keycap (the keyboard shortcut, for mouse players only).
 * Returns a container augmented with setEnabled / setActive2 / setSub.
 */
export function button(scene, {
  x, y, w, h, text, sub = '', icon = null, size = 1, iconScale = size, onClick,
  tooltip = '', accent = P.ui.gold, primary = false, keycap = '', align = null,
  subSize = 1, subColor = null,
}) {
  const c = scene.add.container(Math.round(x), Math.round(y));
  const bg = scene.add.nineslice(0, 0, primary ? 'ui_btn_gold' : 'ui_btn', undefined, w, h,
    SLICE, SLICE, SLICE, SLICE).setOrigin(0, 0);
  c.add(bg);

  // The face: everything above the base and the one-pixel shadow.
  const faceTop = 1;
  const faceBottom = h - 1 - BTN_LIP - 1;
  const cy = Math.round((faceTop + faceBottom) / 2);

  let iconImg = null;
  const hasSub = sub !== '';
  const centred = align ? align === 'center' : !icon;
  const pad = Math.max(6, 5 * iconScale);
  const iconW = icon ? 16 * iconScale : 0;
  if (icon) {
    iconImg = scene.add.image(pad, cy, icon).setOrigin(0, 0.5).setScale(iconScale);
    c.add(iconImg);
  }

  const textX = icon ? pad + iconW + Math.max(4, 3 * iconScale) : pad;
  const titleH = CAP_H * size;
  const subH = CAP_H * subSize;
  // Clear of the title's descenders (two rows at its scale).
  const gap = Math.max(3, 3 * size);
  const blockH = hasSub ? titleH + gap + subH : titleH;
  // Cap tops, so the pair is centred on its ink rather than on its cells.
  const titleCapTop = Math.round(cy - blockH / 2);
  const titleY = titleCapTop - CAP_TOP * size;
  const subY = titleCapTop + titleH + gap - CAP_TOP * subSize;

  const title = label(scene, centred ? Math.round(w / 2) : textX, titleY, text, {
    size, bold: true, origin: [centred ? 0.5 : 0, 0],
    shadowColor: primary ? P.ui.brass[5] : P.ui.inkDark, shadowAlpha: primary ? 0.55 : 0.85,
  });
  c.add(title);

  let subLabel = null;
  if (hasSub) {
    subLabel = label(scene, centred ? Math.round(w / 2) : textX, subY, sub, {
      size: subSize, color: P.ui.textDim, origin: [centred ? 0.5 : 0, 0],
      shadow: !primary,
    });
    c.add(subLabel);
  }

  let key = null;
  if (keycap) {
    key = scene.add.container(w - 11 - 4, 4);
    key.add(scene.add.image(0, 0, 'ui_key').setOrigin(0, 0));
    key.add(label(scene, 6, 0, keycap, { color: P.ui.textDim, origin: [0.5, 0], shadow: false }));
    c.add(key);
  }

  const state = {
    enabled: true, active: false, hover: false, down: false, subTint: subColor,
  };

  const redraw = () => {
    let tex = primary ? 'ui_btn_gold' : 'ui_btn';
    if (!state.enabled) tex = 'ui_btn_off';
    else if (state.down) tex = primary ? 'ui_btn_gold_dn' : 'ui_btn_dn';
    else if (state.active) tex = primary ? 'ui_btn_gold_hi' : 'ui_btn_on';
    else if (state.hover) tex = primary ? 'ui_btn_gold_hi' : 'ui_btn_hi';
    bg.setTexture(tex);
    title.setTint(!state.enabled ? P.ui.textMute
      : primary ? P.ui.brass[0] : (state.active ? mix(accent, P.ui.white, 0.15) : P.ui.text));
    if (subLabel) {
      subLabel.setTint(!state.enabled ? (state.subTint ?? P.ui.textMute)
        : primary ? P.ui.brass[1] : (state.subTint ?? P.ui.textDim));
    }
    if (iconImg) {
      iconImg.setAlpha(state.enabled ? 1 : 0.45);
      iconImg.setTint(state.enabled ? 0xffffff : 0x9aa4b8);
    }
    // Pressed buttons sink onto their base, like a real key.
    const drop = state.down ? BTN_SINK : 0;
    title.y = titleY + drop;
    if (subLabel) subLabel.y = subY + drop;
    if (iconImg) iconImg.y = cy + drop;
    if (key) key.y = 4 + drop;
  };
  redraw();

  bg.setInteractive(new Phaser.Geom.Rectangle(0, 0, w, h), Phaser.Geom.Rectangle.Contains);
  bg.on('pointerover', () => {
    if (!state.enabled) { if (tooltip) c.emit('tip', tooltip, c); return; }
    state.hover = true;
    Audio.hover();
    redraw();
    if (tooltip) c.emit('tip', tooltip, c);
  });
  bg.on('pointerout', () => {
    state.hover = false;
    state.down = false;
    redraw();
    c.emit('tipout');
  });
  bg.on('pointerdown', () => {
    if (!state.enabled) { Audio.deny(); return; }
    state.down = true;
    redraw();
  });
  bg.on('pointerup', () => {
    if (!state.enabled) return;
    const wasDown = state.down;
    state.down = false;
    redraw();
    if (wasDown) {
      Audio.click();
      Haptics.tap();
      onClick?.();
    }
  });

  c.setSize(w, h);
  c.bg = bg;
  c.titleLabel = title;
  c.subLabel = subLabel;
  c.setEnabled = (v) => { if (state.enabled !== v) { state.enabled = v; redraw(); } return c; };
  c.setActive2 = (v) => { if (state.active !== v) { state.active = v; redraw(); } return c; };
  c.setSub = (v, tint) => {
    if (!subLabel) return c;
    if (subLabel.text !== v) subLabel.setText(v);
    if (tint !== undefined && tint !== state.subTint) { state.subTint = tint; redraw(); }
    return c;
  };
  c.setText2 = (v) => { title.setText(v); return c; };
  c.isEnabled = () => state.enabled;
  return c;
}

/**
 * A compact square button holding only an icon. `hitPad` grows the touch
 * target past the drawn button, so a small-looking control still meets the
 * 46pt minimum under a finger.
 */
export function iconButton(scene, {
  x, y, size = 22, icon, onClick, tooltip = '', iconScale = 1, hitPad = 0,
}) {
  const c = scene.add.container(Math.round(x), Math.round(y));
  const bg = scene.add.nineslice(0, 0, 'ui_btn', undefined, size, size,
    SLICE, SLICE, SLICE, SLICE).setOrigin(0, 0);
  const cy = Math.round((1 + (size - 1 - BTN_LIP - 1)) / 2) + 1;
  const img = scene.add.image(Math.round(size / 2), cy, icon).setOrigin(0.5).setScale(iconScale);
  c.add([bg, img]);

  const state = { hover: false, active: false, enabled: true, down: false };
  const redraw = () => {
    bg.setTexture(!state.enabled ? 'ui_btn_off'
      : state.down ? 'ui_btn_dn'
        : state.active ? 'ui_btn_on'
          : state.hover ? 'ui_btn_hi' : 'ui_btn');
    img.setAlpha(state.enabled ? 1 : 0.4);
    img.y = cy + (state.down ? BTN_SINK : 0);
  };
  redraw();

  bg.setInteractive(new Phaser.Geom.Rectangle(-hitPad, -hitPad, size + hitPad * 2, size + hitPad * 2),
    Phaser.Geom.Rectangle.Contains);
  bg.on('pointerover', () => { state.hover = true; Audio.hover(); redraw(); if (tooltip) c.emit('tip', tooltip, c); });
  bg.on('pointerout', () => { state.hover = false; state.down = false; redraw(); c.emit('tipout'); });
  bg.on('pointerdown', () => { if (state.enabled) { state.down = true; redraw(); } });
  bg.on('pointerup', () => {
    const wasDown = state.down;
    state.down = false;
    redraw();
    if (!state.enabled) { Audio.deny(); Haptics.refused(); return; }
    if (!wasDown) return;
    Audio.click();
    Haptics.tap();
    onClick?.();
  });

  c.setSize(size, size);
  c.setIcon = (k) => { img.setTexture(k); return c; };
  // For a button whose icon states its meaning — mute, say — the tip has to
  // change with the icon, or it ends up describing the wrong half of a toggle.
  // A tip already on screen is republished rather than left to go stale: the
  // pointer is still on the button the player just clicked.
  c.setTooltip = (s) => {
    tooltip = s;
    if (state.hover && tooltip) c.emit('tip', tooltip, c);
    return c;
  };
  c.setActive2 = (v) => { if (state.active !== v) { state.active = v; redraw(); } return c; };
  c.setEnabled = (v) => { state.enabled = v; redraw(); return c; };
  return c;
}

/**
 * A gauge bar with rounded end caps, a lit fill and an optional marker (a
 * threshold: the crest the sea must not pass, the share of homes you need).
 */
export function bar(scene, x, y, w, h, { color = P.ui.blue, bg = P.ui.track } = {}) {
  const g = scene.add.graphics().setPosition(Math.round(x), Math.round(y));
  let value = 0;
  let fillColor = color;
  let marker = null;

  // A rounded run: full height inside, corners clipped by one pixel.
  const pill = (x0, x1, y0, hh, c, a = 1) => {
    if (x1 < x0) return;
    g.fillStyle(c, a);
    if (x1 - x0 < 2) { g.fillRect(x0, y0 + 1, x1 - x0 + 1, hh - 2); return; }
    g.fillRect(x0 + 1, y0, x1 - x0 - 1, hh);
    g.fillRect(x0, y0 + 1, 1, hh - 2);
    g.fillRect(x1, y0 + 1, 1, hh - 2);
  };

  const draw = () => {
    g.clear();
    // Track: a dark slot with a lit lower lip, the way a groove catches light.
    pill(0, w - 1, 0, h, P.ui.inkDark);
    pill(1, w - 2, 1, h - 2, bg);
    g.fillStyle(mix(bg, P.ui.panelHi, 0.5), 1);
    g.fillRect(2, h - 2, w - 4, 1);
    const inner = w - 2;
    const fw = Math.round(inner * Phaser.Math.Clamp(value, 0, 1));
    if (fw > 0) {
      pill(1, fw, 1, h - 2, fillColor);
      // Light on the top row, shade on the bottom row of the fill.
      g.fillStyle(mix(fillColor, P.ui.white, 0.45), 1);
      g.fillRect(2, 1, Math.max(0, fw - 2), 1);
      g.fillStyle(mix(fillColor, P.ui.inkDark, 0.35), 1);
      g.fillRect(2, h - 2, Math.max(0, fw - 2), 1);
    }
    if (marker !== null) {
      const mx = 1 + Math.round((w - 3) * Phaser.Math.Clamp(marker, 0, 1));
      g.fillStyle(P.ui.white, 1);
      g.fillRect(mx, 0, 1, h);
      g.fillStyle(P.ui.inkDark, 0.8);
      g.fillRect(mx + 1, 1, 1, h - 1);
    }
  };
  draw();

  g.setValue = (v, c) => {
    if (v === value && (c === undefined || c === fillColor)) return g;
    value = v;
    if (c !== undefined) fillColor = c;
    draw();
    return g;
  };
  g.setMarker = (v) => { if (v !== marker) { marker = v; draw(); } return g; };
  return g;
}

/** A floating tooltip that follows whichever widget asked for it. */
export function tooltipLayer(scene, depth = 900) {
  const box = scene.add.nineslice(0, 0, 'ui_panel_dark', undefined, 40, 20,
    SLICE, SLICE, SLICE, SLICE).setOrigin(0, 0).setDepth(depth).setVisible(false);
  const txt = label(scene, 0, 0, '', { size: 1 }).setDepth(depth + 1).setVisible(false);
  const PADX = 7;
  const PADY = 5;

  const layer = {
    /**
     * Where a tooltip goes on a touchscreen, and whether to use it.
     *
     * A finger is on the control it is asking about, so anchoring the tip to
     * that control puts it under the hand — the player holds the button down
     * and reads their own knuckle. On touch the tip is parked in a band the
     * hand is not in instead, spanning the width it needs, and it lingers a
     * moment after release so there is time to read it.
     */
    touch: false,
    anchorY: 8,
    linger: null,

    show(text, target) {
      if (layer.linger) { clearTimeout(layer.linger); layer.linger = null; }
      txt.setText(text);
      const lines = text.split('\n');
      const w = measureText(text) + PADX * 2;
      // Box height from the ink: cap top to the last line's descender, plus
      // the pad, plus the baked shadow rows.
      const h = (lines.length - 1) * LINE_PITCH + CAP_H + 2 + PADY * 2 + PANEL_SHADOW;
      const sw = scene.scale.width;
      const sh = scene.scale.height;
      const th = target.height || 0;

      let x;
      let y;
      if (layer.touch) {
        x = Phaser.Math.Clamp((sw - w) / 2, 4, Math.max(4, sw - w - 4));
        y = Phaser.Math.Clamp(layer.anchorY, 4, Math.max(4, sh - h - 4));
      } else {
        // Put the tip on whichever side of the widget actually has room for
        // it, then clamp on both axes so it can never run off the screen.
        const above = target.y - h - 3;
        const below = target.y + th + 3;
        y = above >= 4 ? above : (below + h <= sh - 4 ? below : Math.max(4, above));
        y = Phaser.Math.Clamp(y, 4, Math.max(4, sh - h - 4));
        x = target.x + (target.width || 0) / 2 - w / 2;
        x = Phaser.Math.Clamp(x, 4, Math.max(4, sw - w - 4));
      }
      box.setPosition(Math.round(x), Math.round(y)).setSize(Math.round(w), Math.round(h))
        .setVisible(true);
      txt.setPosition(Math.round(x) + PADX, Math.round(y) + PADY - CAP_TOP).setVisible(true);
    },
    hide() {
      if (layer.linger) { clearTimeout(layer.linger); layer.linger = null; }
      if (layer.touch) {
        // Lifting a finger is how a touch device says "pointer out", which
        // would otherwise take the tip away at the exact moment the player
        // starts reading it.
        layer.linger = setTimeout(() => {
          layer.linger = null;
          box.setVisible(false);
          txt.setVisible(false);
        }, 2200);
        return;
      }
      box.setVisible(false);
      txt.setVisible(false);
    },
    destroy() {
      if (layer.linger) { clearTimeout(layer.linger); layer.linger = null; }
      box.destroy();
      txt.destroy();
    },
  };
  return layer;
}

/** Wire a widget's tip events into a tooltip layer. */
export function attachTip(widget, tips) {
  widget.on('tip', (text, target) => tips.show(text, target));
  widget.on('tipout', () => tips.hide());
  return widget;
}

/**
 * A horizontal 0..1 slider, used for the volume settings: a rounded groove,
 * a lit fill and a brass knob. The hit area is taller than the drawing so a
 * finger does not have to land on a 4px line.
 */
export function slider(scene, { x, y, w, value = 0.5, onChange }) {
  const h = 14;
  const c = scene.add.container(Math.round(x), Math.round(y));
  const g = scene.add.graphics();
  const knob = scene.add.image(0, 0, 'ui_knob').setOrigin(0, 0);
  c.add([g, knob]);
  let v = value;
  const kw = 10;
  const ty = 5;
  const th = 5;

  const draw = () => {
    g.clear();
    g.fillStyle(P.ui.inkDark, 1);
    g.fillRect(1, ty, w - 2, th);
    g.fillRect(0, ty + 1, w, th - 2);
    g.fillStyle(P.ui.track, 1);
    g.fillRect(1, ty + 1, w - 2, th - 2);
    const fx = Math.round((w - kw) * v) + kw / 2;
    g.fillStyle(P.ui.blue, 1);
    g.fillRect(1, ty + 1, fx, th - 2);
    g.fillStyle(mix(P.ui.blue, P.ui.white, 0.45), 1);
    g.fillRect(1, ty + 1, fx, 1);
    knob.setPosition(Math.round((w - kw) * v), 0);
  };
  draw();

  const zone = scene.add.zone(-4, -8, w + 8, h + 16).setOrigin(0, 0)
    .setInteractive({ useHandCursor: true });
  c.add(zone);
  const set = (px) => {
    v = Phaser.Math.Clamp((px - kw / 2) / (w - kw), 0, 1);
    draw();
    onChange?.(v);
  };
  // Phaser hands over the pointer in the zone's own space, which stays right
  // however deeply the slider is nested in containers.
  zone.on('pointerdown', (p, lx) => set(lx - 4));
  zone.on('pointermove', (p, lx) => { if (p.isDown) set(lx - 4); });

  c.setSize(w, h);
  c.getValue = () => v;
  return c;
}

/**
 * A coloured headline ribbon for dialogs: a band across the top of a card
 * with the title in bold on it. Returns the bottom y of the band.
 */
export function headerBand(scene, x, y, w, text, {
  size = 1, color = P.ui.edgeLight, depth = 2,
} = {}) {
  const hh = Math.round(CAP_H * size + 10 + 2 * size);
  const g = scene.add.graphics().setDepth(depth);
  g.fillStyle(P.ui.panelLo, 1);
  g.fillRect(x + 2, y + 2, w - 4, hh);
  g.fillStyle(mix(P.ui.panelLo, P.ui.inkDark, 0.5), 1);
  g.fillRect(x + 2, y + 2 + hh, w - 4, 1);
  g.fillStyle(P.ui.panel, 1);
  g.fillRect(x + 2, y + 3 + hh, w - 4, 1);
  const t = label(scene, x + w / 2, capY(y + 2 + hh / 2, size), text, {
    size, bold: true, color, origin: [0.5, 0],
  }).setDepth(depth + 1);
  return { bottom: y + 4 + hh, graphics: g, label: t };
}
