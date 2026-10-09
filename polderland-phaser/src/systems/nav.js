/**
 * Scene transitions, in one place.
 *
 * The overlay scenes — pause, result — used to shut themselves down and then
 * ask their own plugin to start the next scene. That works only as long as
 * Phaser tolerates being driven through a scene that is already stopping, and
 * it runs in the middle of the tap handler that asked for it, while the scene
 * is still rendering the frame it was tapped on.
 *
 * Everything here goes through the game's scene manager instead of a scene's
 * own plugin, and runs after the current frame rather than inside it. Nothing
 * about the order is left to chance.
 */

export function transition(scene, { stop = [], start = null, data = {} } = {}) {
  const { game } = scene;
  const run = () => {
    const manager = game.scene;
    for (const key of stop) {
      if (manager.getScene(key)) manager.stop(key);
    }
    if (start) manager.start(start, data);
  };
  // One frame later: the tap handler and this frame's render finish first.
  game.events.once('postrender', run);
}
