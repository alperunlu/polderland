/**
 * Game Center, from inside the WebView.
 *
 * The game itself cannot reach Game Center: it runs as a web page. On iOS the
 * Expo host (expo/App.js) listens for these messages and does the native
 * calls; in a browser there is no host and every call here is a no-op, so the
 * web build plays exactly the same without it.
 *
 * Messages, all JSON on window.ReactNativeWebView.postMessage:
 *   { type: 'polderland:gc.score', leaderboard, score }  submit a score
 *   { type: 'polderland:gc.show', leaderboard }          open the leaderboard
 */

/**
 * Off for the first release (see GAME_CENTER in expo/App.js). With this false
 * the game never offers a leaderboard and never posts a score.
 */
const ENABLED = false;

/** Leaderboard IDs as configured in App Store Connect. */
export const LEADERBOARDS = {
  dollard: 'polderland.dollard.hectares',
};

function host() {
  return typeof window !== 'undefined' && window.ReactNativeWebView ? window.ReactNativeWebView : null;
}

/** True when running inside the iOS app, where Game Center exists. */
export const hasGameCenter = () => ENABLED && !!host();

function send(message) {
  if (!ENABLED) return false;
  const h = host();
  if (!h) return false;
  try {
    h.postMessage(JSON.stringify(message));
    return true;
  } catch (e) {
    return false;
  }
}

/**
 * Submit a score to a level's leaderboard, if it has one. Game Center keeps
 * each player's best, so sending every improvement is safe.
 */
export function submitScore(level, score) {
  const leaderboard = LEADERBOARDS[level?.id];
  if (!leaderboard || !(score > 0)) return false;
  return send({ type: 'polderland:gc.score', leaderboard, score: Math.round(score) });
}

/** Open the Game Center leaderboard for a level. */
export function showLeaderboard(level) {
  const leaderboard = LEADERBOARDS[level?.id];
  if (!leaderboard) return false;
  return send({ type: 'polderland:gc.show', leaderboard });
}
