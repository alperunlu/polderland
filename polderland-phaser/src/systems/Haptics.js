/**
 * Touch feedback.
 *
 * The game runs inside a WebView, and iOS gives web content no way to vibrate
 * at all — `navigator.vibrate` does not exist there. So the game asks the
 * native host, the same way it asks it to save, and the host calls the real
 * haptics API. In a browser that has `navigator.vibrate` (Android, mostly)
 * that is used instead; everywhere else this is silently a no-op, which is
 * the right behaviour rather than something to apologise for.
 *
 * The vocabulary is deliberately small. A phone that buzzes at everything is
 * worse than one that never buzzes, so this is reserved for the moments that
 * are worth feeling: something built, something refused, something lost.
 */

import { loadSettings } from './SaveGame.js';

/** How long each kind buzzes for, when all we have is a duration. */
const FALLBACK_MS = {
  light: 8,
  medium: 14,
  heavy: 22,
  success: [10, 40, 16],
  warning: [16, 50, 16],
  error: [22, 40, 22, 40, 22],
};

let enabled = true;

export function loadHapticSetting() {
  const s = loadSettings();
  enabled = s.haptics !== false;
  return enabled;
}

export function setHapticsEnabled(on) {
  enabled = !!on;
}

export function hapticsEnabled() {
  return enabled;
}

function host() {
  return typeof window !== 'undefined' && window.ReactNativeWebView
    ? window.ReactNativeWebView
    : null;
}

function fire(kind) {
  if (!enabled) return;
  const native = host();
  if (native) {
    try {
      native.postMessage(JSON.stringify({ type: 'polderland:haptic', kind }));
      return;
    } catch {
      // Fall through to the browser's own vibration, if it has one.
    }
  }
  if (typeof navigator !== 'undefined' && typeof navigator.vibrate === 'function') {
    try {
      navigator.vibrate(FALLBACK_MS[kind] ?? 10);
    } catch {
      // A browser that refuses to vibrate is not an error worth reporting.
    }
  }
}

export const Haptics = {
  /** A control responded. */
  tap: () => fire('light'),
  /** Something was placed on the map. */
  build: () => fire('medium'),
  /** The tap was understood and refused. */
  refused: () => fire('warning'),
  /** The scenario was won. */
  success: () => fire('success'),
  /** A dike gave way, or a house went under. */
  disaster: () => fire('error'),
  /** A storm is coming. */
  warning: () => fire('warning'),
};
