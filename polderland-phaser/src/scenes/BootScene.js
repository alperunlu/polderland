import Phaser from 'phaser';
import { P, css } from '../palette.js';
import { createPixelFont, FONT_KEY, LINE_H } from '../art/font.js';
import { buildAllTextures } from '../art/textures.js';
import { Audio } from '../systems/Audio.js';
import { t as tr, setLang, detectLang } from '../systems/i18n.js';
import { loadSettings } from '../systems/SaveGame.js';
import { loadHapticSetting } from '../systems/Haptics.js';

/** Offsets from the middle of the canvas: the bar, and the update note under it. */
const BAR_DY = 44;
const NOTE_DY = 82;

/**
 * Generates the entire sprite set before anything else runs.
 *
 * The work is split across frames so the loading bar actually moves and the
 * browser never sees a multi-hundred-millisecond script block — which on a
 * phone is the difference between a loading screen and a "page unresponsive"
 * prompt.
 */
export class BootScene extends Phaser.Scene {
  constructor() {
    super({ key: 'BootScene' });
  }

  create() {
    const { width, height } = this.scale;
    this.cameras.main.setBackgroundColor(css(P.skyNight[0]));

    // Pick the language before a single word is drawn: a stored choice if the
    // player has made one, otherwise whatever the device asks for.
    const saved = loadSettings().lang;
    setLang(saved || detectLang());
    loadHapticSetting();

    // The font has to exist before anything can be written on screen.
    createPixelFont(this);

    this.titleText = this.add.bitmapText(width / 2, height / 2 - 40, FONT_KEY, 'POLDERLAND', LINE_H)
      .setScale(this.scale.width >= 640 ? 4 : 3).setOrigin(0.5).setTint(P.ui.edgeLight);
    this.statusText = this.add.bitmapText(width / 2, height / 2 + 18, FONT_KEY, tr('boot.status'), LINE_H)
      .setScale(2).setOrigin(0.5).setTint(P.ui.textDim);
    this.scale.on('resize', this.layout, this);
    this.events.once('shutdown', () => this.scale.off('resize', this.layout, this));

    this.barG = this.add.graphics();

    // The iOS app sets this when it is starting on an over-the-air update it
    // has not run before, so the player can tell why this launch is slower and
    // that the game is not stuck.
    this.noteText = null;
    if (typeof window !== 'undefined' && window.__POLDERLAND_UPDATED__) {
      this.noteText = this.add.bitmapText(width / 2, height / 2 + NOTE_DY, FONT_KEY, tr('boot.updated'), LINE_H)
        .setScale(1).setOrigin(0.5).setTint(P.ui.green);
    }
    this.paintedFrames = 0;

    this.steps = [
      [tr('boot.step.land'), () => buildAllTextures(this)],
    ];
    this.stepIndex = 0;
    this.progress = 0;
    this.drawBar(0);
  }

  /**
   * Everything on this screen hangs off the middle of the canvas, and is put
   * there from one place. The bar used to be placed from the live size every
   * time it was drawn while the words were placed once, at creation, so if
   * the canvas changed size afterwards (a phone settling its safe area, a
   * rotation) the bar slid over the words.
   */
  layout() {
    const { width, height } = this.scale;
    const cx = width / 2;
    const cy = height / 2;
    this.titleText.setPosition(cx, cy - 40);
    this.statusText.setPosition(cx, cy + 18);
    if (this.noteText) this.noteText.setPosition(cx, cy + NOTE_DY);
    this.drawBar(this.progressNow || 0);
  }

  drawBar(t) {
    this.progressNow = t;
    const { width, height } = this.scale;
    const w = Math.min(320, this.scale.width - 48);
    const h = 12;
    const x = Math.round((width - w) / 2);
    const y = Math.round(height / 2 + BAR_DY);
    this.barG.clear();
    this.barG.fillStyle(P.ink[0], 1);
    this.barG.fillRect(x - 1, y - 1, w + 2, h + 2);
    this.barG.fillStyle(P.ui.panelDark, 1);
    this.barG.fillRect(x, y, w, h);
    this.barG.fillStyle(P.ui.edge, 1);
    this.barG.fillRect(x, y, Math.round(w * t), h);
    this.barG.fillStyle(P.ui.edgeLight, 1);
    this.barG.fillRect(x, y, Math.round(w * t), 1);
  }

  update() {
    // Let the loading screen reach the glass before the heavy work starts.
    // Building every texture is one long synchronous job, and it used to start
    // on the very first update, ahead of the first render, so the screen sat
    // empty for the whole build and the title, the status and the bar were
    // never seen. Two frames are painted first, and only then is the host told
    // there is something to look at (the iOS app keeps its splash up until it
    // hears this).
    if (this.paintedFrames < 3) {
      this.paintedFrames += 1;
      if (this.paintedFrames === 2) announceReady();
      return;
    }
    if (this.stepIndex >= this.steps.length) {
      if (!this.done) {
        this.done = true;
        this.drawBar(1);
        // One frame of the finished bar before moving on.
        this.time.delayedCall(120, () => {
          this.scene.start('MenuScene');
        });
      }
      return;
    }

    const [name, fn] = this.steps[this.stepIndex];
    this.statusText.setText(name);
    fn();
    this.stepIndex += 1;
    this.drawBar(this.stepIndex / this.steps.length);
  }
}

/**
 * Tell the iOS host the game is on screen. Outside the app there is no host
 * and this does nothing.
 */
function announceReady() {
  try {
    const host = typeof window !== 'undefined' ? window.ReactNativeWebView : null;
    if (host) host.postMessage(JSON.stringify({ type: 'polderland:ready' }));
  } catch (e) {
    // Not worth a failure: the host has a timeout of its own.
  }
}

/** Wire up the one-time audio unlock on first interaction. */
export function installAudioUnlock(game) {
  const unlock = () => {
    Audio.unlock();
    window.removeEventListener('pointerdown', unlock);
    window.removeEventListener('keydown', unlock);
  };
  window.addEventListener('pointerdown', unlock);
  window.addEventListener('keydown', unlock);
}
