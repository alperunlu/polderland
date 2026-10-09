import Phaser from 'phaser';
import { P, mix } from '../palette.js';
import {
  panel, label, button, iconButton, bar, tooltipLayer, attachTip, textWidth, capY,
  PANEL_SHADOW, LINE_PITCH, CAP_H,
} from '../ui/widgets.js';
import {
  SPEEDS, DIKE_BREACH_AT, PUMP_RADIUS, PUMP_CANAL_RANGE, LAND_YIELD, FLOOD_DEPTH,
  RECLAIM_DAYS,
} from '../constants.js';
import { formatDate, formatMoney, clamp, isoX, isoY } from '../helpers.js';
import { metricsFor } from '../systems/viewport.js';
import { TUTORIAL, stepTitle, stepText } from '../systems/tutorial.js';
import { allSeenTutorialSteps, markTutorialStepSeen } from '../systems/SaveGame.js';
import { t as tr } from '../systems/i18n.js';
import { MARSH_AT, fencedNear, flatsDrowned } from '../systems/wadden.js';
import { Audio } from '../systems/Audio.js';

/**
 * The build bar, in order. Names and explanations are looked up when the bar
 * is laid out rather than stored here, so a change of language rebuilds them.
 */
const BUILD_ORDER = [
  { kind: 'dike', icon: 'ic_dike', key: '1' },
  { kind: 'canal', icon: 'ic_canal', key: '2' },
  { kind: 'pump', icon: 'ic_pump', key: '3' },
  { kind: 'outlet', icon: 'ic_sluice', key: '4' },
];


/** Florin sign for costs and the treasury. */
const FL = 'ƒ';

function buildTip(kind) {
  // 'outlet.tip.mill' already names a full key; everything else takes `.tip`.
  const key = kind.includes('.tip') ? `build.${kind}` : `build.${kind}.tip`;
  return tr(key, { radius: PUMP_RADIUS, range: PUMP_CANAL_RANGE });
}

/**
 * The heads-up display.
 *
 * Everything is laid out from the live logical viewport rather than from a
 * fixed design size, so the same HUD works at 440x330 on a small phone and at
 * 950x450 on a desktop. The layout is rebuilt on every resize; nothing here
 * caches a coordinate across one.
 *
 * Hierarchy, top bar: the treasury is the biggest thing on it (bold, gold,
 * with its coin); each gauge is a recessed well that names itself in a small
 * caption over its reading, so "100%" always says what it is a percentage
 * of; the calendar is secondary and dim; the clock controls sit together on
 * the right as one group.
 */
export class HudScene extends Phaser.Scene {
  constructor() {
    super({ key: 'HudScene' });
  }

  init(data) {
    this.game_ = data.game;
    this.owned = [];
    this.tutorialStep = 0;
    // Frozen once per session: a step marked seen a moment ago (this very
    // session, as the player reads it) must not vanish before they finish
    // reading it. Only steps seen in an EARLIER session are skipped.
    this.tutorialSeenAtStart = new Set(allSeenTutorialSteps());
  }

  create() {
    this.sim = this.game_.sim;
    this.buildLayout();
    this.scale.on('resize', this.onResize, this);
    this.events.once('shutdown', () => this.scale.off('resize', this.onResize, this));
  }

  onResize() {
    this.buildLayout();
  }

  /** The tools this scenario offers. */
  buildOrder() {
    return BUILD_ORDER;
  }

  /** A new era changes what the pump button builds: lay the bar out again. */
  relabelBuildBar() {
    this.buildLayout();
  }

  /** Track every display object so a re-layout can clear the old one. */
  own(obj) {
    this.owned.push(obj);
    return obj;
  }

  clearLayout() {
    for (const o of this.owned) {
      if (o && o.destroy) o.destroy();
    }
    this.owned = [];
    if (this.tips) this.tips.destroy();
    this.tips = null;
  }

  /* ================================================================
     LAYOUT
  ================================================================ */

  buildLayout() {
    this.clearLayout();
    const W = this.scale.width;
    const H = this.scale.height;
    this.m = metricsFor(W, H, this.scale.zoom);
    this.tips = tooltipLayer(this, 2000);
    // On a touchscreen the tip goes just under the top bar, where the hand
    // reaching the build bar is not.
    this.tips.touch = !!this.game_.touchMode;
    this.tips.anchorY = this.m.topBarTotalH + 6;

    this.buildTopBar(W, H);
    this.buildBuildBar(W, H);
    this.buildOverlays(W, H);

    this.refreshCosts();
    this.refreshSpeed();
    this.onPlacementChanged(this.game_.placement);
    this.onSelectionChanged(this.game_.selected);
  }

  buildTopBar(W) {
    const m = this.m;
    const t = m.text;
    const h = m.topBarH;
    // The bar's lit face ends at topBarTotalH; its shadow falls below.
    this.own(panel(this, -4, -8, W + 8, m.topBarTotalH + 8 + PANEL_SHADOW)).setDepth(1000);
    const d = 1001;
    // Content sits above the bar's darker base band.
    const bandH = h - 3;

    /* ---- Treasury ---- */
    let x = m.pad;
    const coinScale = m.stackTopBar ? 1 : t;
    const moneyCap = CAP_H * 2;
    const moneyTop = t > 1 ? 5 : 3;
    this.own(this.add.image(x, moneyTop + moneyCap / 2 + (t > 1 && !m.stackTopBar ? 4 : 0), 'ic_coin')
      .setOrigin(0, 0.5).setScale(coinScale).setDepth(d));
    const moneyX = x + 16 * coinScale + (t > 1 ? 6 : 4);
    this.moneyLabel = this.own(label(this, moneyX, moneyTop - 2, '0', {
      size: 2, color: P.ui.gold, bold: true,
    }).setDepth(d));
    // The balance per day, under the treasury.
    const subY = moneyTop + moneyCap + (t > 1 ? 5 : 3) - 1;
    this.incomeLabel = this.own(label(this, moneyX, subY, '', {
      size: 1, color: P.ui.textDim,
    }).setDepth(d));

    if (m.stackTopBar) {
      // Short of width for a treasury, a calendar and the clock controls side
      // by side, the calendar and the day count share the dim line under
      // the money, and the gauges get a row of their own.
      this.dateLabel = null;
      this.dayLabel = null;
    } else {
      x = m.pad + m.moneyBlock;
      // The calendar is context, not a reading: bold at 1x, level with the
      // treasury's cap line, well below the money in weight.
      this.dateLabel = this.own(label(this, x, moneyTop + (t > 1 ? 3 : 2), '', {
        size: 1, color: P.ui.text, bold: true,
      }).setDepth(d));
      this.dayLabel = this.own(label(this, x, subY, '', { size: 1, color: P.ui.textDim })
        .setDepth(d));
      x += m.dateBlock;
    }

    /* ---- Clock and view controls, pinned right ---- */
    const btn = m.topBtn;
    const by = Math.max(2, Math.round((bandH - btn) / 2) + 1);
    const iconScale = t;
    const mk = (icon, tooltip, onClick) => this.own(iconButton(this, {
      x: 0, y: by, size: btn, icon, tooltip, onClick, iconScale, hitPad: m.topBtnHitPad,
    }).setDepth(d));
    let rx = W - m.pad - btn;
    // Silencing the game is something a player wants to do in one tap, from
    // wherever they are — not by opening the pause menu and finding two
    // sliders. The icon carries the current state, so it doubles as the
    // readout for whether sound is on.
    this.muteBtn = mk(Audio.muted ? 'ic_mute' : 'ic_sound',
      tr(Audio.muted ? 'hud.tip.unmute' : 'hud.tip.mute'), () => this.toggleMute());
    this.muteBtn.x = rx;
    rx -= btn + 4;
    // Re-framing the island matters far more on a phone, where the map does
    // not fit on screen, so it gets a button rather than only a key.
    this.fitBtn = mk('ic_fit', tr('hud.tip.fit'), () => this.game_.centreOnMap());
    this.fitBtn.x = rx;
    rx -= btn + 8;
    // The three clock buttons are one group, set tight.
    this.fastBtn = mk('ic_ff', tr('hud.tip.fast'),
      () => this.setSpeed(this.game_.speedIndex >= 1 ? 2 : 1));
    this.fastBtn.x = rx;
    rx -= btn + 2;
    this.slowBtn = mk('ic_play', tr('hud.tip.slow'), () => this.setSpeed(0));
    this.slowBtn.x = rx;
    rx -= btn + 2;
    this.pauseBtn = mk('ic_pause', tr('hud.tip.pause'),
      () => this.game_.requestPause(!this.game_.isPaused));
    this.pauseBtn.x = rx;
    for (const b of [this.pauseBtn, this.slowBtn, this.fastBtn, this.fitBtn, this.muteBtn]) {
      attachTip(b, this.tips);
    }
    rx -= 8;

    /* ---- Gauges ---- */
    this.gauges = [];
    const defs = [
      ['sea', 'ic_drop'],
      ['dry', 'ic_land'],
      ['canal', 'ic_canal'],
      ['homes', 'ic_house'],
    ];

    if (m.stackTopBar) {
      const chipW = Math.floor((W - m.pad * 2 - 3 * m.gap) / 4);
      defs.forEach(([key, icon], i) => {
        const cx = m.pad + i * (chipW + m.gap);
        this.gauges.push(this.makeGauge(key, icon, cx, h, chipW, m.topBarTotalH - h - 4, d, 1));
      });
    } else {
      // Gauges fill whatever is left between the calendar and the buttons,
      // snug against the buttons rather than stretched.
      const available = Math.max(80, rx - x);
      const count = 4;
      const chipW = Math.min(118 * t, Math.floor((available - (count - 1) * m.gap) / count));
      x += Math.max(0, available - (chipW * count + (count - 1) * m.gap));
      defs.forEach(([key, icon], i) => {
        const cx = x + i * (chipW + m.gap);
        this.gauges.push(this.makeGauge(key, icon, cx, 2, chipW, bandH - 1, d, t));
      });
    }

    /* ---- Storm banner: a pill just under the bar ---- */
    this.storm = this.own(this.add.container(0, m.topBarTotalH + 4).setDepth(1002).setVisible(false));
    this.stormBg = panel(this, 0, 0, 40, 20, 'ui_panel_dark');
    this.stormIcon = this.add.image(6, 0, 'ic_storm').setOrigin(0, 0.5).setScale(t);
    this.stormLabel = label(this, 0, 0, '', { size: t, bold: true, color: P.ui.orange });
    this.storm.add([this.stormBg, this.stormIcon, this.stormLabel]);
  }

  /** Which explanation applies depends on the century the scenario is in. */
  tipKindFor(kind) {
    const machine = this.game_.machineKind();
    const mill = machine === 'mill';
    if (kind === 'pump') return machine === 'engine' ? 'pump' : machine;
    if (kind === 'dike' && this.sim.level.coast === 'wadden') return 'dike.tip.wadden';
    if (kind === 'outlet' && mill) return 'outlet.tip.mill';
    if (kind === 'outlet' && machine === 'steam') return 'outlet.tip.steam';
    return kind;
  }

  /**
   * One gauge: a recessed well holding an icon, a caption naming the
   * quantity, its reading, and a bar with the threshold marked.
   */
  makeGauge(key, icon, x, y, w, h, depth, t) {
    const well = this.own(panel(this, x, y, w, h, 'ui_well').setDepth(depth));
    const iconScale = t;
    const img = this.own(this.add.image(x + 4, y + Math.round(h / 2), icon)
      .setOrigin(0, 0.5).setScale(iconScale).setDepth(depth));
    const tx = x + 4 + 16 * iconScale + (t > 1 ? 5 : 3);
    const cap = this.own(label(this, tx, y + 3 - 1, tr(`gauge.${key}.cap`), {
      size: 1, color: P.ui.textDim,
    }).setDepth(depth));
    const valueCapTop = y + 3 + CAP_H + 2;
    const value = this.own(label(this, tx, valueCapTop - t, '', {
      size: t, color: P.ui.text, bold: true,
    }).setDepth(depth));
    const barH = t > 1 ? 7 : 5;
    const barY = Math.min(valueCapTop + CAP_H * t + 3, y + h - barH - 2);
    const g = this.own(bar(this, tx, barY, Math.max(12, x + w - 5 - tx), barH).setDepth(depth));

    // A caption too long for a narrow well yields rather than overrunning.
    const room = x + w - 4 - tx;
    if (cap.width > room) cap.setVisible(false);

    // A hit area so the gauge can explain itself.
    const tip = tr(`gauge.${key}`);
    const zone = this.own(this.add.zone(x, y, w, h).setOrigin(0, 0).setInteractive());
    zone.on('pointerover', () => this.tips.show(tip, { x, y, width: w, height: h }));
    zone.on('pointerout', () => this.tips.hide());

    return {
      key, img, value, bar: g, x, w, well, cap,
    };
  }

  buildBuildBar(W, H) {
    const m = this.m;
    const t = m.text;
    const order = this.buildOrder();
    const n = order.length;
    // When a single row would make each button too narrow to read, the bar
    // wraps — and it wraps evenly: four buttons are two and two, never three
    // and a stray one.
    const rows = m.buildBarRows;
    const perRow = Math.ceil(n / rows);
    const barH = m.buildBarH + m.pad;
    const y = H - barH;
    this.buildBarY = y;
    this.own(panel(this, -4, y, W + 8, barH + 8)).setDepth(1000);

    const bw = Math.floor((W - m.pad * 2 - (perRow - 1) * m.gap) / perRow);
    this.buildButtons = [];
    // The shortcut digits are for a keyboard; a finger has no use for them.
    const keys = !this.game_.touchMode;

    order.forEach((def, i) => {
      const row = Math.floor(i / perRow);
      const col = i % perRow;
      const b = this.own(button(this, {
        x: m.pad + col * (bw + m.gap),
        y: y + Math.floor(m.pad / 2) + 1 + row * (m.buttonH + 4),
        w: bw,
        h: m.buttonH,
        text: this.game_.labelFor(def.kind),
        sub: `${FL} --`,
        icon: def.kind === 'pump'
          ? ({ mill: 'ic_mill', steam: 'ic_steam' }[this.game_.machineKind()] || def.icon) : def.icon,
        size: t,
        subSize: t,
        // The tool pictures are drawn at 16px; a build button is tall
        // enough to show them doubled at any scale.
        iconScale: m.buttonH >= 40 ? 2 : t,
        keycap: keys ? def.key : '',
        accent: this.game_.accentFor(def.kind),
        tooltip: buildTip(this.tipKindFor(def.kind)),
        onClick: () => this.game_.startPlacement(def.kind),
      }).setDepth(1001));
      attachTip(b, this.tips);
      b.kind = def.kind;
      this.buildButtons.push(b);
    });

    // One running message line above the bar, on its own dark pill so it
    // reads over any terrain. On touch the confirmation strip sits in the
    // same place, so the message goes above that instead.
    const confirmH = this.confirmHeight();
    this.messageY = this.game_.touchMode ? y - confirmH - 12 : y - 6;
    this.message = this.own(this.add.container(0, 0).setDepth(1001).setVisible(false));
    this.messageBg = panel(this, 0, 0, 20, 20, 'ui_panel_dark');
    this.messageLabel = label(this, 0, 0, '', {
      size: 1, color: P.ui.textDim, maxWidth: W - m.pad * 2 - 16,
    });
    this.message.add([this.messageBg, this.messageLabel]);
  }

  confirmHeight() {
    const t = this.m.text;
    return t > 1 ? 58 : 40;
  }

  buildOverlays(W) {
    const m = this.m;
    const t = m.text;
    const top = m.topBarTotalH + m.pad;

    /* ---- Alert toast ---- */
    // Headline beside an icon with the note under it, the box always sized
    // to the text it was given, so nothing can spill out of it.
    this.alertMaxW = Math.min(300 + 80 * t, W - 24);
    this.alertPanel = this.own(panel(this, 0, 0, 10, 10, 'ui_panel_dark')
      .setDepth(1500).setVisible(false));
    this.alertAccent = this.own(this.add.rectangle(0, 0, 2, 10, P.ui.orange).setOrigin(0, 0)
      .setDepth(1501).setVisible(false));
    this.alertIcon = this.own(this.add.image(0, 0, 'ic_warn').setOrigin(0, 0).setScale(t)
      .setDepth(1501).setVisible(false));
    this.alertTitle = this.own(label(this, 0, 0, '', {
      size: t, color: P.ui.red, bold: true,
    }).setDepth(1501).setVisible(false));
    this.alertBody = this.own(label(this, 0, 0, '', {
      size: t > 1 ? t : 1, color: P.ui.text,
      // Longer notes wrap themselves rather than carrying hand-placed line
      // breaks: how many characters fit depends on the UI scale and on the
      // language, so any break authored for one of them is wrong for the rest.
      maxWidth: this.alertMaxW - (16 * t + 24),
    }).setDepth(1501).setVisible(false));

    /* ---- Tile inspector, right-hand side ---- */
    const iw = m.narrow
      ? Math.floor(W - m.pad * 2)
      : Math.min(156 + 30 * t, Math.floor(W * 0.32));
    this.inspectorW = iw;
    this.inspector = this.own(this.add.container(W - iw - m.pad, top).setDepth(1200).setVisible(false));
    const ibg = panel(this, 0, 0, iw, 124, 'ui_panel');
    this.inspBg = ibg;
    // A coloured tab beside the title names the kind of thing selected —
    // water blue, defence orange, a machine its own accent — before the
    // player has read a single word of the panel under it.
    this.inspHeadH = CAP_H * t + 10;
    this.inspHead = this.add.rectangle(2, 2, iw - 4, this.inspHeadH, P.ui.panelLo).setOrigin(0, 0);
    this.inspTab = this.add.rectangle(2, 2, 3, this.inspHeadH, P.ui.edgeLight).setOrigin(0, 0);
    this.inspTitle = label(this, 10, capY(2 + this.inspHeadH / 2, t), '', {
      size: t, color: P.ui.edgeLight, bold: true,
    });
    this.inspector.add([ibg, this.inspHead, this.inspTab, this.inspTitle]);

    // The body is a pool of key/value label pairs so a row of concern —
    // high dike stress, a stalled pump, salted ground — can be tinted on
    // its own rather than disappearing into a wall of same-coloured text.
    // Sized generously; unused rows are simply hidden.
    const poolSize = 12;
    this.inspRows = [];
    for (let i = 0; i < poolSize; i++) {
      const k = label(this, 8, 0, '', { size: 1, color: P.ui.textDim }).setVisible(false);
      const v = label(this, iw - 8, 0, '', { size: 1, color: P.ui.text, origin: [1, 0], bold: true })
        .setVisible(false);
      this.inspector.add([k, v]);
      this.inspRows.push({ k, v });
    }
    this.inspDivider = this.add.rectangle(8, 0, iw - 16, 1, P.ui.panelHi).setOrigin(0, 0)
      .setVisible(false);
    this.inspector.add(this.inspDivider);

    // Demolish: under the rows, for the works the player can take down.
    this.inspDemolishH = m.buttonH >= 40 ? 34 : 24;
    this.inspDemolish = button(this, {
      x: 8, y: 0, w: iw - 16, h: this.inspDemolishH,
      text: tr('insp.demolish'), sub: '', size: 1, subSize: 1,
      onClick: () => this.game_.demolishSelected(),
    }).setVisible(false);
    this.inspector.add(this.inspDemolish);

    /* ---- Tutorial, left-hand side ---- */
    if (this.game_.level.tutorial) {
      const tw = m.narrow
        ? Math.floor(W - m.pad * 2)
        : Math.min(206 + 40 * t, Math.floor(W * 0.36));
      this.tutorialPanel = this.own(this.add.container(m.pad, top).setDepth(1200));
      const tbg = panel(this, 0, 0, tw, 92, 'ui_panel');
      this.tutorialBg = tbg;
      this.tutorialW = tw;
      const headH = CAP_H * t + 10;
      this.tutorialHeadH = headH;
      const head = this.add.rectangle(2, 2, tw - 4, headH, P.ui.panelLo).setOrigin(0, 0);
      // The step counter as a brass badge, the title beside it.
      this.tutorialBadge = this.add.graphics();
      this.tutorialStepLabel = label(this, 0, capY(2 + headH / 2, 1), '', {
        size: 1, bold: true, color: P.ui.brass[0], shadow: false,
      });
      this.tutorialTitle = label(this, 8, capY(2 + headH / 2, t), '', {
        size: t, color: P.ui.gold, bold: true,
      });
      this.tutorialBody = label(this, 9, 2 + headH + 6, '', {
        size: 1, color: P.ui.text, maxWidth: tw - 18,
      });
      this.tutorialPanel.add([tbg, head, this.tutorialBadge, this.tutorialStepLabel,
        this.tutorialTitle, this.tutorialBody]);
      this.updateTutorial(true);
    }

    /* ---- Touch confirmation strip, used when placing by tapping ---- */
    const cw = Math.min(300 + 80 * t, W - m.pad * 2);
    const ch = this.confirmHeight();
    this.confirmBar = this.own(this.add.container(Math.round((W - cw) / 2),
      this.buildBarY - ch - 6).setDepth(1400).setVisible(false));
    const cbg = panel(this, 0, 0, cw, ch + PANEL_SHADOW, 'ui_panel');
    const bh = ch - 10;
    const okW = 50 + 34 * t;
    const noW = 40 + 26 * t;
    this.confirmLabel = label(this, 10, 0, '', {
      size: t, color: P.ui.text, maxWidth: cw - okW - noW - 28,
    });
    const okBtn = button(this, {
      x: cw - okW - noW - 12, y: 5, w: okW, h: bh, text: tr('place.confirm'), size: t,
      primary: true, onClick: () => this.game_.confirmAim(),
    });
    const noBtn = button(this, {
      x: cw - noW - 6, y: 5, w: noW, h: bh, text: tr('place.cancel'), size: t,
      onClick: () => this.game_.cancelPlacement(),
    });
    this.confirmBar.add([cbg, this.confirmLabel, okBtn, noBtn]);
    this.confirmOk = okBtn;
    this.confirmCy = Math.round((ch - 1) / 2);
  }

  /* ================================================================
     STATE IN
  ================================================================ */

  setSpeed(i) {
    if (this.game_.isPaused) this.game_.requestPause(false);
    this.game_.speedIndex = i;
    this.refreshSpeed();
  }

  toggleMute() {
    const muted = Audio.toggleMuted();
    this.muteBtn.setIcon(muted ? 'ic_mute' : 'ic_sound')
      .setTooltip(tr(muted ? 'hud.tip.unmute' : 'hud.tip.mute'));
    // The button's own click was swallowed by the mute that followed it, so
    // turning sound back on would otherwise be confirmed by nothing but an
    // icon. Wait out the fade, then say something.
    if (!muted) this.time.delayedCall(120, () => Audio.click());
  }

  refreshSpeed() {
    if (!this.pauseBtn) return;
    const paused = this.game_.isPaused;
    const i = this.game_.speedIndex;
    this.pauseBtn.setIcon(paused ? 'ic_play' : 'ic_pause').setActive2(paused);
    this.slowBtn.setActive2(!paused && i === 0);
    this.fastBtn.setActive2(!paused && i > 0);
  }

  refreshCosts() {
    if (!this.buildButtons) return;
    for (const b of this.buildButtons) {
      const cost = this.sim.costOf(b.kind, this.game_.hoverTile);
      const afford = this.sim.money >= cost && !this.sim.outcome;
      b.setSub(Number.isFinite(cost) ? `${FL} ${formatMoney(cost)}` : '--',
        afford ? P.ui.edgeLight : mix(P.ui.red, P.ui.textMute, 0.25));
      b.setEnabled(afford);
    }
  }

  onPlacementChanged(kind) {
    if (!this.buildButtons) return;
    for (const b of this.buildButtons) b.setActive2(b.kind === kind);
    if (!kind) {
      this.confirmBar.setVisible(false);
    } else {
      this.flashMessage(tr(this.game_.touchMode ? 'place.hintTouch' : 'place.hintMouse'), 'info');
    }
  }

  /** Show or hide the touch confirmation strip for the aimed tile. */
  onAimChanged(tile, reason, cost) {
    if (!this.confirmBar) return;
    if (!tile || !this.game_.placement) {
      this.confirmBar.setVisible(false);
      return;
    }
    this.confirmBar.setVisible(true);
    const label_ = this.game_.labelFor(this.game_.placement, tile);
    if (reason) {
      this.confirmLabel.setText(reason).setTint(P.ui.red);
      this.confirmOk.setEnabled(false);
    } else if (this.sim.money < cost) {
      this.confirmLabel.setText(tr('no.money')).setTint(P.ui.red);
      this.confirmOk.setEnabled(false);
    } else {
      this.confirmLabel
        .setText(tr('place.here', { what: label_, cost: formatMoney(cost) }))
        .setTint(P.ui.text);
      this.confirmOk.setEnabled(true);
    }
    // Centre the text block on the strip, however many lines it wrapped to.
    this.confirmLabel.y = Math.round(this.confirmCy - this.confirmLabel.height / 2) + this.m.text;
  }

  setHoverInfo(tile, reason, cost) {
    if (this.game_.touchMode) return;
    if (!tile) { this.flashMessage('', 'info'); return; }
    if (reason) this.setMessage(reason, P.ui.red);
    else if (this.sim.money < cost) this.setMessage(tr('no.money'), P.ui.red);
    else this.setMessage(tr('place.buildHere', { cost: formatMoney(cost) }), P.ui.green);
  }

  /** Put a line on the message pill and size the pill to it. */
  setMessage(text, color) {
    if (!this.message) return;
    if (this.messageTween) { this.messageTween.stop(); this.messageTween = null; }
    this.message.setAlpha(1);
    if (!text) { this.message.setVisible(false); return; }
    const lbl = this.messageLabel;
    if (lbl.text !== text) lbl.setText(text);
    lbl.setTint(color);
    const padX = 8;
    const padY = 4;
    const w = Math.round(lbl.width + padX * 2);
    const lines = Math.max(1, Math.round((lbl.height - 11) / LINE_PITCH) + 1);
    const h = (lines - 1) * LINE_PITCH + CAP_H + 2 + padY * 2 + PANEL_SHADOW;
    this.messageBg.setSize(w, h);
    lbl.setPosition(padX, padY - 1);
    this.message.setPosition(this.m.pad, Math.round(this.messageY - h)).setVisible(true);
  }

  flashMessage(text, tone = 'info') {
    if (!this.messageLabel) return;
    const color = { good: P.ui.green, bad: P.ui.red, warn: P.ui.orange, info: P.ui.textDim }[tone];
    this.setMessage(text, color);
    if (!text) return;
    this.messageTween = this.tweens.add({
      targets: this.message, alpha: 0.35, delay: 3200, duration: 900,
    });
  }

  alert(title, body, tone = 'warn') {
    if (!this.alertPanel) return;
    const color = { bad: P.ui.red, warn: P.ui.orange, good: P.ui.green }[tone] || P.ui.orange;
    const t = this.m.text;
    const targets = [this.alertPanel, this.alertTitle, this.alertBody, this.alertIcon, this.alertAccent];
    this.alertTitle.setText(title).setTint(color);
    this.alertBody.setText(body || '');
    this.alertIcon.setTexture(tone === 'good' ? 'ic_star' : 'ic_warn');
    this.alertAccent.setFillStyle(color);

    // Lay the toast out around the text it was just given, measured, so a
    // note that wraps grows the box instead of spilling out of it.
    const W = this.scale.width;
    const padX = 6 + 2 * t;
    const padY = 4 + 2 * t;
    const iconW = 16 * t;
    const gap = 4 + 2 * t;
    const tw = this.alertTitle.width;
    const bw = body ? this.alertBody.width : 0;
    const textW = Math.max(tw, bw);
    const w = Math.min(this.alertMaxW, padX + iconW + gap + textW + padX + 2);
    const titleH = CAP_H * t;
    const bodyInk = body ? this.alertBody.height - 3 * (this.alertBody.scaleY || 1) : 0;
    const textH = titleH + (body ? 4 + bodyInk : 0);
    const inner = Math.max(iconW, textH);
    const h = inner + padY * 2 + PANEL_SHADOW;
    // Clear the storm banner when one is up.
    const y = this.m.topBarTotalH + 6
      + (this.storm && this.storm.visible ? this.stormBg.height + 4 : 0);
    const x = Math.round((W - w) / 2);
    this.alertPanel.setPosition(x, y).setSize(Math.round(w), Math.round(h));
    this.alertAccent.setPosition(x + 2, y + 3).setSize(2, h - PANEL_SHADOW - 6);
    this.alertIcon.setPosition(x + padX, y + padY + Math.round((inner - iconW) / 2));
    const tx = x + padX + iconW + gap;
    const ty = y + padY + Math.round((inner - textH) / 2);
    this.alertTitle.setPosition(tx, ty - t);
    this.alertBody.setPosition(tx, ty + titleH + 4 - this.alertBody.scaleY);
    this.alertVisibleUntil = this.time.now + 4100;

    targets.forEach((o) => o.setAlpha(1).setVisible(true));
    this.alertBody.setVisible(!!body);
    if (this.alertTween) this.alertTween.stop();
    this.alertTween = this.tweens.add({
      targets, alpha: 0, delay: 3400, duration: 700,
      onComplete: () => targets.forEach((o) => o.setVisible(false)),
    });
  }

  pingTile(tile) {
    const cam = this.game_.cameras.main;
    cam.pan(isoX(tile.x, tile.y), isoY(tile.x, tile.y, this.game_.renderElev(tile)),
      600, 'Sine.easeInOut');
  }

  onSelectionChanged(tile) {
    if (!this.inspector) return;
    this.inspector.setVisible(!!tile);
    if (tile) this.updateInspector(tile);
  }

  /** Which accent a tile's title tab takes, so the kind of thing selected
   * reads before any of the words under it do. Ordered most to least
   * specific: a machine or a house on a dike tile is what the player is
   * looking at, not the ring it happens to sit on. */
  inspectorAccent(t) {
    if (t.building) return t.building.lost ? P.ui.red : P.ui.gold;
    if (t.outlet) return P.ui.gold;
    if (t.pump) return P.ui.green;
    if (t.dike) return P.ui.orange;
    if (t.canal || t.base === 'sea') return P.ui.blue;
    return P.ui.edgeLight;
  }

  updateInspector(t) {
    let title = tr('insp.polder');
    if (t.base === 'sea') title = tr('insp.sea');
    else if (t.base === 'old') title = tr('insp.old');
    else if (t.base === 'mud') title = tr(t.elev >= MARSH_AT ? 'insp.marsh' : 'insp.flat');
    else if (t.canal) title = tr('insp.canal');
    else if (t.coastal) title = tr('insp.ring');
    if (t.building && !t.building.lost) {
      title = tr({ house: 'insp.house', church: 'insp.church' }[t.building.type]) || title;
    } else if (t.building && t.building.lost) title = tr('insp.ruin');

    // Rows carry their own colour, so a row worth worrying about —
    // three-quarters dike stress, a stalled mill, ground still salt from a
    // flood — stands out on sight instead of reading identically to the
    // ground elevation above it. `group` marks the boundary between what
    // the tile *is* (site facts) and what is happening on it right now
    // (status), which gets a divider between them.
    const rows = [];
    const row = (key, value, tint = P.ui.text, group = 'site') => {
      rows.push({ key: tr(key), value, tint, group });
    };
    const warnColor = (ratio) => (ratio >= 0.8 ? P.ui.red : ratio >= 0.5 ? P.ui.orange : P.ui.text);

    row('insp.ground', `${t.elev.toFixed(1)} m NAP`);
    if (t.base === 'mud') {
      // How far this flat has to rise before it is marsh that can be diked.
      const left = MARSH_AT - t.elev;
      if (left > 0) row('insp.toMarsh', `${left.toFixed(2)} m`, P.ui.text, 'status');
      const held = fencedNear(this.sim, t);
      if (flatsDrowned(this.sim)) {
        rows.push({ note: tr(held ? 'insp.drownedHeld' : 'insp.drowned'), tint: held ? P.ui.orange : P.ui.red, group: 'status' });
      } else {
        rows.push({ note: tr(held ? 'insp.fenced' : 'insp.unfenced'), tint: held ? P.ui.green : P.ui.textDim, group: 'status' });
      }
    } else if (t.canal) {
      // A canal tile holds no water of its own: it shares the network's
      // level. Showing its own depth read "dry" beside a flooded field.
      const fill = this.sim.canalVolume / Math.max(1, this.sim.canalCapacity());
      row('insp.canalLevel', `${this.sim.canalSurface().toFixed(1)} m NAP`,
        fill > 0.9 ? P.ui.red : fill > 0.7 ? P.ui.orange : P.ui.text);
    } else if (t.base === 'land') {
      const wet = t.depth >= 0.005;
      row('insp.water', wet ? `${t.depth.toFixed(2)} m` : tr('insp.dry'),
        wet ? (t.depth >= FLOOD_DEPTH ? P.ui.red : P.ui.orange) : P.ui.text);
      // Water only runs into the canal by itself while it stands higher than
      // the canal does. Below that it has to be lifted: say so, on the spot.
      if (wet && !t.coastal && t.elev + t.depth <= this.sim.canalSurface() && this.sim.canalTiles.length) {
        rows.push({ note: tr('insp.belowCanal'), tint: P.ui.orange, group: 'status' });
      }
    }
    // What this tile is actually paying today, and what it would pay dry.
    // Without this the player can see that land is wet but not that wet
    // land is the reason the treasury has stopped filling.
    if (t.use) {
      const now = this.sim.tileYield(t);
      const full = LAND_YIELD[t.use] || 0;
      const short = full > 0 ? 1 - now / full : 0;
      row(`insp.use.${t.use}`, tr('insp.yield', {
        n: now.toFixed(1), full: full.toFixed(1),
      }), short > 0.5 ? P.ui.orange : P.ui.text);
      if (t.sour > 0.02) {
        row('insp.salt', `${Math.round(t.sour * 100)}%`,
          t.sour > 0.5 ? P.ui.red : P.ui.orange);
      }
    } else if (t.plan && !t.building && !t.pump && !t.outlet && !t.canal) {
      // Rough ground: say what it is worth once it is broken, and how far
      // along it is, so the player can see that keeping it dry is doing
      // something before the day it finally turns over.
      const pct = Math.round((t.dry / RECLAIM_DAYS) * 100);
      row('insp.rough', tr('insp.roughValue', {
        n: (LAND_YIELD[t.plan] || 0).toFixed(1),
      }), P.ui.textDim);
      row('insp.reclaim', `${pct}%`, pct > 0 ? P.ui.green : P.ui.textDim);
    }
    if (t.coastal) {
      const sea = this.sim.seaAt(t);
      const crest = this.sim.crestOf(t);
      row('insp.seaLevel', `${sea.toFixed(2)} m`,
        sea >= crest ? P.ui.red : sea >= crest - 0.4 ? P.ui.orange : P.ui.text, 'status');
      row('insp.crest', `${crest.toFixed(2)} m`, P.ui.text, 'status');
    }
    if (t.dike) {
      row('insp.dike', t.dike.broken ? tr('insp.breached') : tr('insp.level', { n: t.dike.level + 1 }),
        t.dike.broken ? P.ui.red : P.ui.text, 'status');
      if (!t.dike.broken) {
        const ratio = t.dike.stress / DIKE_BREACH_AT;
        row('insp.stress', `${Math.round(ratio * 100)}%`, warnColor(ratio), 'status');
      }
    }
    if (t.pump) {
      const tint = t.pump.starved ? P.ui.red : t.pump.running ? P.ui.green : P.ui.textDim;
      row(this.game_.machineKind() === 'mill' ? 'insp.mill' : 'insp.pump',
        tr(t.pump.starved ? 'insp.stalled' : t.pump.running ? 'insp.running' : 'insp.idle'),
        tint, 'status');
    }
    if (t.outlet) {
      // What drives it, and whether it is actually moving water.
      const stage = `insp.stage.${this.game_.machineKind()}`;
      row('insp.outlet', tr(stage), P.ui.text, 'status');
      const flowTint = t.outlet.flowing ? P.ui.green : P.ui.textDim;
      row('insp.water', tr(t.outlet.flowing
        ? (t.outlet.gravity ? 'insp.draining' : 'insp.pumping')
        : 'insp.shut'), flowTint, 'status');
    }
    if (t.building && !t.building.lost) {
      const dmg = t.building.damage;
      row('insp.repair', `${Math.round(100 - dmg)}%`, warnColor(dmg / 100), 'status');
      if (t.building.flooded) rows.push({ note: tr('insp.flooded'), tint: P.ui.red, group: 'status' });
    }

    if (this.inspTitle.text !== title) this.inspTitle.setText(title);
    const accent = this.inspectorAccent(t);
    this.inspTab.setFillStyle(accent);
    this.inspTitle.setTint(mix(accent, P.ui.white, 0.25));

    // Row text is always drawn at size 1, so its pitch is the font's own
    // line pitch regardless of the UI scale; only the header above it grows
    // with the scale.
    const rowH = LINE_PITCH;
    let y = 2 + this.inspHeadH + 6;
    let lastGroup = null;
    let usedDivider = false;
    for (let i = 0; i < this.inspRows.length; i++) {
      const slot = this.inspRows[i];
      const r = rows[i];
      if (!r) { slot.k.setVisible(false); slot.v.setVisible(false); continue; }
      // One thin rule where the site facts give way to what is happening on
      // the tile right now — only once, and only when both groups are
      // actually present.
      if (lastGroup !== null && lastGroup !== r.group && !usedDivider) {
        usedDivider = true;
        this.inspDivider.setPosition(8, y + 2).setVisible(true);
        y += 7;
      }
      lastGroup = r.group;
      if (r.note) {
        // A full-width note (no key/value split) for things like "flooded"
        // that are a statement, not a reading.
        if (slot.k.text !== r.note) slot.k.setText(r.note);
        slot.k.setTint(r.tint).setPosition(8, y).setVisible(true);
        slot.v.setVisible(false);
      } else {
        if (slot.k.text !== r.key) slot.k.setText(r.key);
        if (slot.v.text !== r.value) slot.v.setText(r.value);
        slot.k.setTint(P.ui.textDim).setPosition(8, y).setVisible(true);
        slot.v.setTint(r.tint).setPosition(this.inspectorW - 8, y).setVisible(true);
      }
      y += rowH;
    }
    if (!usedDivider) this.inspDivider.setVisible(false);

    const kind = this.sim.demolishable(t);
    if (kind) {
      // What taking it down gives back, on the line above the button.
      const slot = this.inspRows.find((r) => !r.k.visible);
      if (slot) {
        slot.k.setText(tr('insp.refund')).setTint(P.ui.textDim).setPosition(8, y).setVisible(true);
        slot.v.setText(`+${FL} ${formatMoney(this.sim.demolishRefund(t))}`).setTint(P.ui.gold)
          .setPosition(this.inspectorW - 8, y).setVisible(true);
        y += LINE_PITCH;
      }
    }
    if (kind && this.inspDemolish) {
      y += 4;
      this.inspDemolish.setPosition(8, y).setVisible(true);
      y += this.inspDemolishH;
    } else if (this.inspDemolish) {
      this.inspDemolish.setVisible(false);
    }

    this.inspBg.setSize(this.inspectorW, y + 5 + PANEL_SHADOW);
  }

  updateTutorial(force = false) {
    if (!this.tutorialPanel) return;
    // A step that has already been shown to this player in some earlier
    // scenario is skipped just like a completed one — repeating "look
    // around" on a second playthrough teaches nothing.
    while (this.tutorialStep < TUTORIAL.length
      && (TUTORIAL[this.tutorialStep].done(this.sim, this.game_)
        || this.tutorialSeenAtStart.has(TUTORIAL[this.tutorialStep].key))) {
      this.tutorialStep += 1;
    }
    if (this.tutorialStep >= TUTORIAL.length) {
      this.tutorialPanel.setVisible(false);
      return;
    }
    const step = TUTORIAL[this.tutorialStep];
    if (force || this.shownStep !== this.tutorialStep) {
      this.shownStep = this.tutorialStep;
      markTutorialStepSeen(step.key);
      const t = this.m.text;
      // Step counter badge.
      const counter = `${this.tutorialStep + 1}/${TUTORIAL.length}`;
      this.tutorialStepLabel.setText(counter);
      const bw = textWidth(counter, 1, true) + 8;
      const bh = CAP_H + 6;
      const by = 2 + Math.round((this.tutorialHeadH - bh) / 2);
      const g = this.tutorialBadge;
      g.clear();
      g.fillStyle(P.ui.brass[1], 1);
      g.fillRect(7, by, bw + 2, bh);
      g.fillRect(6, by + 1, bw + 4, bh - 2);
      g.fillStyle(P.ui.brass[4], 1);
      g.fillRect(8, by + 1, bw, bh - 2);
      g.fillStyle(P.ui.brass[5], 1);
      g.fillRect(8, by + 1, bw, 1);
      this.tutorialStepLabel.setPosition(12, by + 3 - 1);
      this.tutorialTitle.setText(stepTitle(step)).setX(8 + bw + 4 + 4 + t);
      // Let the panel wrap the prose itself; hard line breaks authored for a
      // wide screen wrap twice on a narrow one and look broken.
      this.tutorialBody.setText(stepText(step));
      this.tutorialBg.setSize(this.tutorialW,
        this.tutorialBody.y + this.tutorialBody.height + 5 + PANEL_SHADOW);
    }
    // The alert banner and the inspector both want this corner; the tutorial
    // is the least urgent of the three, so it yields.
    const alerting = this.alertPanel && this.alertPanel.visible;
    this.tutorialPanel.setVisible(!alerting && !(this.m.veryNarrow && this.game_.selected));
  }

  /* ================================================================
     FRAME
  ================================================================ */

  update() {
    const sim = this.sim;
    if (!this.moneyLabel) return;

    const money = formatMoney(sim.money);
    if (this.moneyLabel.text !== money) this.moneyLabel.setText(money);
    const net = (sim.dailyIncome || 0) - (sim.dailyUpkeep || 0);
    const perDay = tr('hud.perDay', { sign: net >= 0 ? '+' : '', n: Math.round(net) });
    const day = tr('hud.day', {
      n: sim.stats.daysSurvived,
      speed: this.game_.isPaused ? 'II' : `${SPEEDS[this.game_.speedIndex]}x`,
    });

    if (this.dateLabel) {
      this.setText(this.incomeLabel, perDay).setTint(net >= 0 ? P.ui.green : P.ui.red);
      this.setText(this.dateLabel, formatDate(sim.date));
      this.setText(this.dayLabel, day.replace(/\s{2,}/g, ' · '));
    } else {
      // Stacked: one line carries the balance, the calendar and the day —
      // as much of that as fits before the clock buttons. The day and the
      // speed outrank the calendar: the speed is the state of a control the
      // player is looking at, the date is colour. On a phone the line is only
      // 130-190 px, so with the date in front of them the day and speed were
      // always the first to go, and were never shown at all.
      const room = this.pauseBtn.x - this.incomeLabel.x - 6;
      const clock = day.replace(/\s{2,}/g, ' · ');
      const date = formatDate(sim.date);
      const options = [
        [perDay, date, clock],
        [perDay, clock],
        [perDay, date],
        [perDay],
      ].map((parts) => parts.join(' · '));
      const line = options.find((o) => textWidth(o) <= room) || perDay;
      this.setText(this.incomeLabel, line).setTint(P.ui.textDim);
    }

    const sea = sim.effectiveSea();
    const weakest = this.weakestCrest();
    const cap = Math.max(1, sim.canalCapacity());
    const fill = sim.canalVolume / cap;
    const intact = sim.intactHouses();
    const total = sim.totalHouses();

    for (const g of this.gauges) {
      if (g.key === 'sea') {
        const ratio = clamp((sea + 1) / (weakest + 1.4), 0, 1);
        this.setText(g.value, `${sea.toFixed(1)} m`).setTint(sea > weakest ? P.ui.red : P.ui.text);
        g.bar.setValue(ratio, sea > weakest ? P.ui.red : sea > weakest - 0.6 ? P.ui.orange : P.ui.blue)
          .setMarker(clamp((weakest + 1) / (weakest + 1.4), 0, 1));
      } else if (g.key === 'dry') {
        // The polder's pulse: the share of the land that is workable today,
        // which is also the share of its yield you are actually collecting.
        const dry = sim.workableShare();
        this.setText(g.value, `${Math.round(dry * 100)}%`)
          .setTint(dry > 0.85 ? P.ui.text : P.ui.red);
        g.bar.setValue(dry, dry > 0.85 ? P.ui.green : dry > 0.6 ? P.ui.orange : P.ui.red);
      } else if (g.key === 'canal') {
        // The canal's water level, in metres like the sea beside it. A
        // percentage of storage read as "the canal is dry" at 0%, and the
        // level puts the two numbers the outlets live by side by side.
        this.setText(g.value, sim.canalTiles.length ? `${sim.canalSurface().toFixed(1)} m` : '--')
          .setTint(fill > 0.9 ? P.ui.red : fill > 0.7 ? P.ui.orange : P.ui.text);
        g.bar.setValue(fill, fill > 0.9 ? P.ui.red : fill > 0.7 ? P.ui.orange : P.ui.blue);
      } else {
        const need = Math.ceil(total * sim.level.winHouseRatio);
        this.setText(g.value, `${intact}/${total}`)
          .setTint(intact < need ? P.ui.red : P.ui.text);
        g.bar.setValue(intact / Math.max(1, total), intact < need ? P.ui.red : P.ui.green)
          .setMarker(sim.level.winHouseRatio);
      }
    }

    this.updateStormBanner();
    this.refreshCosts();
    if (this.game_.selected) this.updateInspector(this.game_.selected);
    this.updateTutorial();
  }

  /** Set a label's text only when it changed: re-laying glyphs every frame is waste. */
  setText(lbl, s) {
    if (lbl.text !== s) lbl.setText(s);
    return lbl;
  }

  weakestCrest() {
    let lowest = Infinity;
    for (const t of this.sim.coastalTiles()) {
      const c = this.sim.crestOf(t);
      if (c < lowest) lowest = c;
    }
    return Number.isFinite(lowest) ? lowest : 0;
  }

  updateStormBanner() {
    const sim = this.sim;
    const show = sim.stormState !== 'calm';
    this.storm.setVisible(show);
    // The side panels step down under the banner while it is up, rather
    // than all three fighting for the same strip under the bar.
    const top = this.m.topBarTotalH + this.m.pad;
    const drop = show ? this.stormBg.height + 2 : 0;
    if (this.inspector) this.inspector.y = top + drop;
    if (this.tutorialPanel) this.tutorialPanel.y = top + drop;
    if (!show) return;
    const dir = this.game_.compass(sim.stormDir).toUpperCase();
    const warn = sim.stormState === 'warning';
    const text = warn
      ? tr('storm.warnBanner', { n: Math.max(0, sim.stormTimer).toFixed(1), dir, peak: sim.stormPeak.toFixed(1) })
      : tr('storm.activeBanner', { n: Math.max(0, sim.stormDaysLeft).toFixed(1), dir });
    if (this.stormLabel.text === text) return;
    // Doubled on a phone when it fits across the screen, else single size.
    this.stormLabel.setScale(1);
    const t = this.m.text > 1 && textWidth(text, 2, true) + 60 < this.scale.width - this.m.pad * 2
      ? 2 : 1;
    this.stormLabel.setScale(t);
    this.stormIcon.setScale(t);
    this.stormLabel.setText(text).setTint(warn ? P.ui.orange : P.ui.red);
    const padX = 6 + t;
    const iconW = 16 * t;
    const inner = Math.max(iconW, CAP_H * t);
    const h = inner + 8 + PANEL_SHADOW;
    const w = padX + iconW + 4 + this.stormLabel.width + padX;
    this.stormBg.setSize(Math.round(w), h);
    this.stormIcon.setPosition(padX, 4 + inner / 2);
    this.stormLabel.setPosition(padX + iconW + 4, capY(4 + inner / 2, t));
    this.storm.x = Math.round((this.scale.width - w) / 2);
  }
}
