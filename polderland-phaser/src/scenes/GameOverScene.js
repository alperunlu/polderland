import Phaser from 'phaser';
import { P, mix } from '../palette.js';
import {
  panel, label, button, headerBand, capY, PANEL_SHADOW, CAP_H,
} from '../ui/widgets.js';
import { metricsFor } from '../systems/viewport.js';
import { LEVELS } from '../systems/levels.js';
import { getProgress } from '../systems/SaveGame.js';
import { Audio } from '../systems/Audio.js';
import { formatMoney } from '../helpers.js';
import { t as tr } from '../systems/i18n.js';
import { transition } from '../systems/nav.js';
import { hasGameCenter, showLeaderboard } from '../systems/GameCenter.js';

export class GameOverScene extends Phaser.Scene {
  constructor() {
    super({ key: 'GameOverScene' });
  }

  init(data) {
    this.result = data;
  }

  create() {
    this.layout();
    this.cameras.main.fadeIn(320, 10, 15, 29);
    this.scale.on('resize', this.onResize, this);
    this.events.once('shutdown', () => this.scale.off('resize', this.onResize, this));
  }

  onResize() {
    this.scene.restart(this.result);
  }

  layout() {
    const W = this.scale.width;
    const H = this.scale.height;
    const m = metricsFor(W, H, this.scale.zoom);
    const t = m.text;
    const r = this.result;
    const won = r.won;
    const verdict = won ? P.ui.green : P.ui.red;

    this.add.rectangle(0, 0, W, H, P.ui.inkDark, 0.78).setOrigin(0, 0);

    const w = Math.min(360 + (t - 1) * 120, W - m.pad * 2);
    // Everything is laid out from y = 0 in one container and measured; the
    // card is then sized to hug it and centred, so there is never a slab of
    // empty panel between the stats and the buttons.
    const c = this.add.container(0, 0);
    const bg = panel(this, 0, 0, w, 10);
    c.add(bg);

    // The verdict, in its colour, on the header band: it reads before any
    // of the words under it do.
    const head = headerBand(this, 0, 0, w, tr(won ? 'over.won' : 'over.lost'), {
      size: 2, color: mix(verdict, P.ui.white, 0.15),
    });
    c.add([head.graphics, head.label]);
    c.add(this.add.rectangle(2, 2, w - 4, 2, verdict).setOrigin(0, 0));

    let y = head.bottom + 5;
    const name = label(this, w / 2, y, r.level.name, {
      size: 1, origin: [0.5, 0], color: P.ui.textDim, bold: true,
    });
    c.add(name);
    y += 14;
    const body = label(this, w / 2, y,
      r.level.endless ? tr('over.endlessBody', { ha: formatMoney(r.score) })
        : tr(won ? 'over.wonBody' : 'over.lostBody', { intact: r.intact, total: r.total }), {
        size: 1, origin: [0.5, 0], color: P.ui.text, align: 'center', maxWidth: w - 32,
      });
    c.add(body);
    y += body.height + 8;

    // The stats: a recessed table, alternate rows banded.
    const homesRatio = r.total > 0 ? r.intact / r.total : 1;
    const rows = [
      [tr('over.days'), String(r.stats.daysSurvived), P.ui.text],
      [tr('over.homes'), `${r.intact} / ${r.total}`,
        homesRatio < 0.5 ? P.ui.red : homesRatio < 0.8 ? P.ui.orange : P.ui.text],
      [tr('over.breaches'), String(r.stats.breaches),
        r.stats.breaches > 0 ? P.ui.orange : P.ui.text],
      [tr('over.peak'), `${r.stats.peakSea.toFixed(2)} m`, P.ui.text],
      [tr('over.spent'), `ƒ ${formatMoney(r.stats.spent)}`, P.ui.text],
    ];
    const rowH = CAP_H * t + (t > 1 ? 8 : 6);
    const tx = 14;
    const tw = w - 28;
    const tableH = rows.length * rowH + 4;
    c.add(panel(this, tx, y, tw, tableH + 2, 'ui_well'));
    rows.forEach(([k, v, tint], i) => {
      const ry = y + 2 + i * rowH;
      if (i % 2 === 1) c.add(this.add.rectangle(tx + 2, ry, tw - 4, rowH, P.ui.panel, 0.6).setOrigin(0, 0));
      c.add(label(this, tx + 8, capY(ry + rowH / 2, t), k, { size: t, color: P.ui.textDim }));
      c.add(label(this, tx + tw - 8, capY(ry + rowH / 2, t), v, {
        size: t, color: tint, origin: [1, 0], bold: true,
      }));
    });
    y += tableH + 10;

    // The score: the biggest number on the card.
    const prog = getProgress(r.level.id);
    c.add(this.add.image(tx + 2, y + CAP_H * 1.5, 'ic_coin').setOrigin(0, 0.5).setScale(2));
    c.add(label(this, tx + 40, capY(y + CAP_H * 1.5, t), tr('over.score'), {
      size: t, color: P.ui.gold, bold: true,
    }));
    // An endless coast is scored in hectares won, like its leaderboard.
    const score = label(this, tx + tw - 2, y - 1, `${formatMoney(r.score)}${r.level.endless ? ' ha' : ''}`, {
      size: 3, color: P.ui.gold, origin: [1, 0], bold: true,
    });
    c.add(score);
    y += CAP_H * 3 + 6;
    const beaten = prog.bestScore > r.score;
    const best = label(this, tx + tw - 2, y, beaten
      ? tr('over.best', { score: formatMoney(prog.bestScore) }) : tr('over.newBest'), {
      size: 1, color: beaten ? P.ui.textMute : P.ui.green, origin: [1, 0], bold: !beaten,
    });
    c.add(best);
    if (!beaten) c.add(this.add.image(tx + tw - 2 - best.width - 4, y + 5, 'ic_star').setOrigin(1, 0.5));
    y += 18;

    // Actions along the bottom. The primary action is whichever one moves
    // the player forward: onward when there is a next scenario to win,
    // otherwise another go at this one.
    const idx = LEVELS.findIndex((l) => l.id === r.level.id);
    const next = LEVELS[idx + 1];
    const showNext = won && next;
    const showBoard = r.level.endless && hasGameCenter();
    const btnH = t > 1 ? 46 : 28;
    const count = 2 + (showNext ? 1 : 0) + (showBoard ? 1 : 0);
    const gap = 6;
    const bw = Math.floor((w - 28 - (count - 1) * gap) / count);
    let bx = 14;
    const retryIsPrimary = !showNext;
    c.add(button(this, {
      x: bx, y, w: bw, h: btnH, text: tr('over.retry'), size: t,
      primary: retryIsPrimary,
      onClick: () => this.restart(r.level),
    }));
    bx += bw + gap;
    if (showNext) {
      c.add(button(this, {
        x: bx, y, w: bw, h: btnH, text: tr('over.next'), size: t,
        primary: true,
        onClick: () => this.restart(next),
      }));
      bx += bw + gap;
    }
    if (showBoard) {
      c.add(button(this, {
        x: bx, y, w: bw, h: btnH, text: tr('over.leaderboard'), size: t,
        onClick: () => showLeaderboard(r.level),
      }));
      bx += bw + gap;
    }
    c.add(button(this, {
      x: bx, y, w: bw, h: btnH, text: tr('over.menu'), size: t,
      onClick: () => this.toMenu(),
    }));
    y += btnH + 12;

    const h = y + PANEL_SHADOW;
    bg.setSize(w, h);
    const scale = h > H - m.pad * 2 ? Math.max(0, (H - m.pad * 2) / h) : 1;
    // A card too tall for a very short screen is pinned to the top rather
    // than scaled: pixel art is never scaled by a fraction.
    c.setPosition(Math.round((W - w) / 2), scale < 1 ? m.pad : Math.round((H - h) / 2));
  }

  restart(level) {
    Audio.stopMusic();
    transition(this, {
      stop: ['GameOverScene', 'HudScene'],
      start: 'GameScene',
      data: { level },
    });
  }

  toMenu() {
    Audio.stopMusic();
    transition(this, {
      stop: ['GameOverScene', 'HudScene', 'GameScene'],
      start: 'MenuScene',
    });
  }
}
