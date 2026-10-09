import Phaser from 'phaser';
import { BootScene, installAudioUnlock } from './scenes/BootScene.js';
import { MenuScene } from './scenes/MenuScene.js';
import { GameScene } from './scenes/GameScene.js';
import { HudScene } from './scenes/HudScene.js';
import { PauseScene } from './scenes/PauseScene.js';
import { GameOverScene } from './scenes/GameOverScene.js';
import { HelpScene } from './scenes/HelpScene.js';
import { Audio } from './systems/Audio.js';
import { computeViewport, installViewport } from './systems/viewport.js';

/**
 * The canvas is sized by `viewport.js`: one game pixel is always a whole
 * number of screen pixels, and the logical size is whatever that leaves.
 * Scale mode NONE keeps Phaser out of the way while we do that.
 */
const start = computeViewport();

const config = {
  type: Phaser.AUTO,
  width: start.width,
  height: start.height,
  parent: 'game',
  backgroundColor: '#0d1224',
  pixelArt: true,
  roundPixels: true,
  antialias: false,
  scale: {
    mode: Phaser.Scale.NONE,
    // The page centres the canvas with flexbox, inside padding that keeps it
    // clear of the notch and the home indicator. Phaser's own centring would
    // fight that: it sets a margin measured against the parent's full height,
    // which does not know the padding is there, and the canvas ends up pushed
    // halfway back over the home indicator.
    autoCenter: Phaser.Scale.NO_CENTER,
    zoom: start.zoom,
  },
  scene: [BootScene, MenuScene, GameScene, HudScene, PauseScene, GameOverScene, HelpScene],
  input: {
    activePointers: 3,
  },
  disableContextMenu: true,
};

const game = new Phaser.Game(config);
installAudioUnlock(game);
installViewport(game);

// Losing focus should stop the clock, not let the polder drown unattended.
document.addEventListener('visibilitychange', () => {
  if (document.hidden) {
    const gs = game.scene.getScene('GameScene');
    if (gs && gs.scene.isActive() && !gs.isPaused) gs.requestPause(true);
  }
});

// Exposed so tests and screenshot tooling can drive the running game.
window.__polderland = game;
// The audio engine is a module singleton, so it is otherwise unreachable
// from a console or a test harness. Exposed alongside the game for the same
// reason the game is: there is no other way to measure what it is doing.
window.__audio = Audio;
