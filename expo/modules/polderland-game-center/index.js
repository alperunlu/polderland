/**
 * Game Center from JavaScript. The native side lives in ios/; where it is not
 * built in (Expo Go, Android, the simulator without the module) every call
 * quietly does nothing, so the game never depends on it.
 */
import { requireOptionalNativeModule } from 'expo-modules-core';

const native = requireOptionalNativeModule('PolderlandGameCenter');

export const available = !!native;

export async function authenticate() {
  if (!native) return false;
  try { return await native.authenticate(); } catch { return false; }
}

export async function submitScore(leaderboardId, score) {
  if (!native) return false;
  try { return await native.submitScore(String(leaderboardId), Math.round(score)); } catch { return false; }
}

export async function showLeaderboard(leaderboardId) {
  if (!native) return;
  try { await native.showLeaderboard(String(leaderboardId)); } catch { /* sheet not shown */ }
}
