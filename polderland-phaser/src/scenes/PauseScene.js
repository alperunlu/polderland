import Phaser from 'phaser';
import { P } from '../palette.js';
import {
  panel, label, button, slider, textWidth, headerBand, capY, PANEL_SHADOW, LINE_PITCH,
} from '../ui/widgets.js';
import { metricsFor } from '../systems/viewport.js';
import { Audio } from '../systems/Audio.js';
import { loadSettings, saveGame, clearSave } from '../systems/SaveGame.js';
import { t as tr } from '../systems/i18n.js';
import { transition } from '../systems/nav.js';

export class PauseScene extends Phaser.Scene {
  constructor() {
    super({ key: 'PauseScene' });
  }

  init(data) {
    this.game_ = data.game;
  }

  create() {
    // Above the HUD, so its dim covers the bars too and the card is the
    // only lit thing on screen.
    this.scene.bringToTop();
    this.layout();
    this.input.keyboard.on('keydown-ESC', () => this.game_.requestPause(false));
    this.scale.on('resize', this.onResize, this);
    this.events.once('shutdown', () => this.scale.off('resize', this.onResize, this));
  }

  onResize() {
    this.scene.restart({ game: this.game_ });
  }

  layout() {
    const W = this.scale.width;
    const H = this.scale.height;
    const m = metricsFor(W, H, this.scale.zoom);
    const t = m.text;

    this.add.rectangle(0, 0, W, H, P.ui.inkDark, 0.66).setOrigin(0, 0).setDepth(0);

    const w = Math.min(300 + (t - 1) * 120, W - m.pad * 2);
    // Everything is placed from y = 0 in a container, measured, and the
    // card is then sized to it and centred.
    const c = this.add.container(0, 0).setDepth(1);
    const bg = panel(this, 0, 0, w, 10);
    c.add(bg);

    const head = headerBand(this, 0, 0, w, tr('pause.title'), { size: 2, color: P.ui.edgeLight });
    c.add([head.graphics, head.label]);
    const name = label(this, w / 2, head.bottom + 5, this.game_.level.name, {
      size: 1, origin: [0.5, 0], color: P.ui.textDim,
    });
    c.add(name);

    const bw = w - 32;
    const bx = 16;
    const bh = t > 1 ? 46 : 28;
    let by = name.y + LINE_PITCH + 6;
    const step = bh + (t > 1 ? 6 : 5);

    c.add(button(this, {
      x: bx, y: by, w: bw, h: bh, text: tr('pause.resume'), size: t, primary: true,
      icon: 'ic_play', align: 'center', iconScale: t,
      onClick: () => this.game_.requestPause(false),
    }));
    by += step;

    c.add(button(this, {
      x: bx, y: by, w: bw, h: bh, text: tr('pause.saveQuit'), size: t,
      onClick: () => {
        saveGame(this.game_.sim.serialize());
        this.leaveToMenu();
      },
    }));
    by += step;

    c.add(button(this, {
      x: bx, y: by, w: bw, h: bh, text: tr('pause.restart'), size: t,
      onClick: () => {
        clearSave();
        transition(this, {
          stop: ['PauseScene', 'HudScene'],
          start: 'GameScene',
          data: { level: this.game_.level },
        });
      },
    }));
    by += bh + 10;

    // A rule between what you do and how it sounds.
    c.add(this.add.rectangle(bx, by, bw, 1, P.ui.panelLo).setOrigin(0, 0));
    c.add(this.add.rectangle(bx, by + 1, bw, 1, P.ui.panelHi).setOrigin(0, 0));
    by += 10;

    const s = loadSettings();
    // Dutch labels are wider than English ones, so the sliders start after
    // whichever of the two needs the most room.
    const labelW = Math.max(52,
      textWidth(tr('menu.music'), 1), textWidth(tr('menu.effects'), 1)) + 10;
    const rowGap = t > 1 ? 34 : 24;
    // Reaching for a volume slider means you want to hear something, so it
    // lifts the HUD's mute rather than leaving the player dragging a control
    // that makes no sound and no explanation of why.
    c.add(label(this, bx, capY(by + 7, 1), tr('menu.music'), { size: 1, color: P.ui.text }));
    c.add(slider(this, {
      x: bx + labelW, y: by, w: bw - labelW, value: s.musicVolume,
      onChange: (v) => { Audio.setMuted(false); Audio.setMusicVolume(v); },
    }));
    by += rowGap;

    c.add(label(this, bx, capY(by + 7, 1), tr('menu.effects'), { size: 1, color: P.ui.text }));
    c.add(slider(this, {
      x: bx + labelW, y: by, w: bw - labelW, value: s.sfxVolume,
      onChange: (v) => { Audio.setMuted(false); Audio.setSfxVolume(v); Audio.click(); },
    }));
    by += rowGap - 4;

    // Keyboard shortcuts, for the player who has a keyboard: a two-column
    // table, since a proportional face cannot line columns up with spaces.
    if (!this.game_.touchMode) {
      const rows = tr('pause.keys').split('\n').map((l) => l.trim().split(/\s{2,}/));
      const keyW = Math.max(...rows.map(([k]) => textWidth(k, 1, true))) + 12;
      if (by + rows.length * LINE_PITCH + 16 < H - m.pad * 2) {
        for (const [k, v] of rows) {
          c.add(label(this, bx, by, k, { size: 1, bold: true, color: P.ui.textDim }));
          c.add(label(this, bx + keyW, by, v || '', { size: 1, color: P.ui.textMute }));
          by += LINE_PITCH;
        }
        by += 2;
      }
    }

    const h = Math.min(by + 10 + PANEL_SHADOW, H - m.pad * 2);
    bg.setSize(w, h);
    c.setPosition(Math.round((W - w) / 2), Math.max(m.pad, Math.round((H - h) / 2)));
  }

  leaveToMenu() {
    Audio.stopMusic();
    transition(this, {
      stop: ['PauseScene', 'HudScene', 'GameScene'],
      start: 'MenuScene',
    });
  }
}
