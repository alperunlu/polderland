/**
 * Persistence. Everything goes through here so a browser that refuses
 * localStorage (private windows, blocked site data) degrades to an in-memory
 * session instead of throwing halfway through a frame.
 *
 * Inside the iOS app the game runs in a WebView loaded from a string, which
 * gives the document an opaque origin, and `localStorage` throws a
 * SecurityError there. So when a native host is present, reads come from the
 * state it injected before the page loaded and writes are posted back to it.
 */

const KEY = 'polderland.v2';

/** The React Native host, when the game is running inside the iOS app. */
function nativeHost() {
  return typeof window !== 'undefined' && window.ReactNativeWebView
    ? window.ReactNativeWebView
    : null;
}

/** State the native host injected before the page loaded, if any. */
function injectedState() {
  if (typeof window === 'undefined') return null;
  const raw = window.__POLDERLAND_SAVE__;
  if (typeof raw !== 'string' || raw.length === 0) return null;
  try {
    return JSON.parse(raw);
  } catch {
    return null;
  }
}

const DEFAULTS = {
  settings: {
    musicVolume: 0.5,
    sfxVolume: 0.7,
    // Kept separate from the two volumes so unmuting restores the mix the
    // player had rather than a default.
    muted: false,
    showGrid: false,
    edgePan: true,
    // null until the player picks one; the device's preference is used until
    // then, so a first run in the Netherlands opens in Dutch.
    lang: null,
    haptics: true,
  },
  progress: {
    // levelId -> { completed, bestScore, bestDays }
  },
  autosave: null,
  // Tutorial step keys ('tut.1', ...) the player has already been shown,
  // across every scenario — once shown, a step never needs to say the same
  // thing again even if a later playthrough never satisfies its `done()`.
  tutorialSeen: [],
};

let memory = null;

function read() {
  if (memory) return memory;
  const injected = injectedState();
  if (injected) {
    memory = { ...DEFAULTS, ...injected };
  } else {
    try {
      const raw = window.localStorage.getItem(KEY);
      memory = raw ? { ...DEFAULTS, ...JSON.parse(raw) } : structuredClone(DEFAULTS);
    } catch {
      memory = structuredClone(DEFAULTS);
    }
  }
  memory.settings = { ...DEFAULTS.settings, ...(memory.settings || {}) };
  memory.progress = memory.progress || {};
  memory.tutorialSeen = memory.tutorialSeen || [];
  return memory;
}

function write() {
  const payload = JSON.stringify(memory);
  const host = nativeHost();
  if (host) {
    // The native side owns the file; it acknowledges nothing, and it does not
    // need to — the in-memory copy is authoritative for this session.
    try {
      host.postMessage(JSON.stringify({ type: 'polderland:save', payload }));
      return;
    } catch {
      // Fall through and try the browser's own storage.
    }
  }
  try {
    window.localStorage.setItem(KEY, payload);
  } catch {
    // Storage unavailable — the in-memory copy still serves this session.
  }
}

export function loadSettings() {
  return { ...read().settings };
}

export function saveSettings(partial) {
  const s = read();
  s.settings = { ...s.settings, ...partial };
  write();
  return { ...s.settings };
}

export function getProgress(levelId) {
  return read().progress[levelId] || { completed: false, bestScore: 0, bestDays: 0 };
}

export function allProgress() {
  return { ...read().progress };
}

export function recordResult(levelId, { won, score, days }) {
  const s = read();
  const prev = s.progress[levelId] || { completed: false, bestScore: 0, bestDays: 0 };
  s.progress[levelId] = {
    completed: prev.completed || won,
    bestScore: Math.max(prev.bestScore, score),
    bestDays: Math.max(prev.bestDays, days),
  };
  write();
  return s.progress[levelId];
}

/**
 * A level is unlocked once the previous one has been completed — or once it
 * has been played at all, so that a scenario added into the middle of the
 * list does not lock a player out of one they had already reached.
 */
export function isUnlocked(levels, index) {
  if (index === 0) return true;
  // Testing aid: \`?unlock\` on the dev server opens every scenario. Vite
  // compiles this out of production builds, where DEV is false.
  if (import.meta.env?.DEV && typeof location !== 'undefined'
    && new URLSearchParams(location.search).has('unlock')) return true;
  if (read().progress[levels[index].id]) return true;
  return getProgress(levels[index - 1].id).completed;
}

/* ---- Tutorial hints, shown at most once each ---- */

export function hasSeenTutorialStep(key) {
  return read().tutorialSeen.includes(key);
}

/** A snapshot to freeze at session start — see markTutorialStepSeen. */
export function allSeenTutorialSteps() {
  return [...read().tutorialSeen];
}

export function markTutorialStepSeen(key) {
  const s = read();
  if (s.tutorialSeen.includes(key)) return;
  s.tutorialSeen = [...s.tutorialSeen, key];
  write();
}

/* ---- Autosave of an in-progress scenario ---- */

export function saveGame(snapshot) {
  const s = read();
  s.autosave = { ...snapshot, savedAt: Date.now() };
  write();
}

export function loadGame() {
  return read().autosave;
}

export function clearSave() {
  const s = read();
  s.autosave = null;
  write();
}
