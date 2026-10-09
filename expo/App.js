import React, { useCallback, useEffect, useRef, useState } from 'react';
import { StyleSheet, View } from 'react-native';
import { WebView } from 'react-native-webview';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { StatusBar } from 'expo-status-bar';
import * as SplashScreen from 'expo-splash-screen';
import * as Haptics from 'expo-haptics';
import { setAudioModeAsync } from 'expo-audio';
import * as Updates from 'expo-updates';

import GAME_HTML from './src/gameHtml';
import * as GameCenter from './modules/polderland-game-center';

/**
 * Game Center is switched off for the first release: the leaderboard only
 * serves the Dollard mode, and the capability needs the provisioning profile
 * and App Store Connect set up first. To bring it back, set this to true,
 * restore the `com.apple.developer.game-center` entitlement in app.json, set
 * ENABLED in the game's systems/GameCenter.js, and bump `version`.
 */
const GAME_CENTER = false;

/**
 * Polderland on iOS.
 *
 * The game is a self-contained HTML page rendered in a WebView. It is loaded
 * from a string rather than from a file, which gives the document an opaque
 * origin — so `localStorage` throws inside it and saves have to go through
 * the native side instead. The game detects the host and posts its state
 * here; this component hands the state back on the next launch.
 *
 * Two other things the page cannot do for itself and asks for the same way:
 *
 * - **Sound.** Audio from a WebView plays through the app's audio session,
 *   and the default one is silenced by the ring switch. A game that goes
 *   quiet when the phone is on silent looks broken rather than considerate,
 *   so the session is set to play regardless — while still mixing with
 *   whatever else is playing, because nobody wants a polder sim to stop
 *   their music.
 * - **Haptics.** iOS gives web content no vibration API at all. The page
 *   posts the kind of feedback it wants and this maps it onto the real one.
 * - **Game Center.** The Dollard's hectares go to a leaderboard. The page
 *   posts scores and asks for the leaderboard; this signs the player in on
 *   launch and hands both to the local module in modules/.
 */

/** What the page may ask for, and what each one feels like. */
const HAPTICS = {
  light: () => Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light),
  medium: () => Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium),
  heavy: () => Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Heavy),
  success: () => Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success),
  warning: () => Haptics.notificationAsync(Haptics.NotificationFeedbackType.Warning),
  error: () => Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error),
};

const SAVE_KEY = 'polderland.v2';
/** The over-the-air update this device last started on. */
const UPDATE_KEY = 'polderland.lastUpdate';
/**
 * The splash stays up until the game says its loading screen is painted, so
 * the player goes from the splash to a screen with words on it and never sees
 * an empty one. If the page never says so, this is how long to wait.
 */
const SPLASH_TIMEOUT_MS = 15000;

SplashScreen.preventAutoHideAsync().catch(() => {
  // Not fatal: the splash simply hides on its own.
});

export default function App() {
  const [saved, setSaved] = useState(null);
  const [ready, setReady] = useState(false);
  // Is this the first launch on a new over-the-air update? null until checked.
  const [justUpdated, setJustUpdated] = useState(null);
  const writeQueue = useRef(Promise.resolve());

  useEffect(() => {
    let cancelled = false;
    (async () => {
      let fresh = false;
      try {
        const id = Updates.updateId;
        // Launching the build's own bundle is not an update.
        if (id && !Updates.isEmbeddedLaunch) {
          const last = await AsyncStorage.getItem(UPDATE_KEY);
          fresh = last !== id;
          if (fresh) await AsyncStorage.setItem(UPDATE_KEY, id);
        }
      } catch {
        // No update support (a development run) or no storage: say nothing.
      }
      if (!cancelled) setJustUpdated(fresh);
    })();
    return () => { cancelled = true; };
  }, []);

  const hideSplash = useCallback(() => {
    SplashScreen.hideAsync().catch(() => {});
  }, []);

  useEffect(() => {
    // Play through the silent switch, but do not interrupt anything else.
    setAudioModeAsync({
      playsInSilentMode: true,
      interruptionMode: 'mixWithOthers',
      shouldPlayInBackground: false,
      allowsRecording: false,
      shouldRouteThroughEarpiece: false,
    }).catch(() => {
      // An audio session that will not configure is a quieter game, not a
      // broken one.
    });
  }, []);

  useEffect(() => {
    let cancelled = false;
    AsyncStorage.getItem(SAVE_KEY)
      .then((value) => {
        if (!cancelled) setSaved(value ?? '');
      })
      .catch(() => {
        if (!cancelled) setSaved('');
      });
    return () => { cancelled = true; };
  }, []);

  // Sign in to Game Center once, quietly: a player who declines still plays.
  useEffect(() => {
    if (GAME_CENTER) GameCenter.authenticate();
  }, []);

  const onMessage = useCallback((event) => {
    let message;
    try {
      message = JSON.parse(event.nativeEvent.data);
    } catch {
      return;
    }
    if (message.type === 'polderland:haptic') {
      const fire = HAPTICS[message.kind];
      if (fire) fire().catch(() => {});
      return;
    }
    if (message.type === 'polderland:ready') {
      hideSplash();
      return;
    }
    if (message.type === 'polderland:gc.score') {
      if (GAME_CENTER) GameCenter.submitScore(message.leaderboard, message.score);
      return;
    }
    if (message.type === 'polderland:gc.show') {
      if (GAME_CENTER) GameCenter.showLeaderboard(message.leaderboard);
      return;
    }
    if (message.type !== 'polderland:save' || typeof message.payload !== 'string') return;
    // Serialise writes so a burst of autosaves cannot interleave.
    writeQueue.current = writeQueue.current
      .then(() => AsyncStorage.setItem(SAVE_KEY, message.payload))
      .catch(() => {});
  }, [hideSplash]);

  const onLoadEnd = useCallback(() => {
    setReady(true);
    // Normally the game's own message hides the splash, long before this.
    setTimeout(hideSplash, SPLASH_TIMEOUT_MS);
  }, [hideSplash]);

  // Wait for the stored state before mounting, so it is available to the page
  // before the game's first frame reads it.
  if (saved === null || justUpdated === null) {
    return <View style={styles.root}><StatusBar hidden /></View>;
  }

  const injectSave = `window.__POLDERLAND_SAVE__ = ${JSON.stringify(saved)}; `
    + `window.__POLDERLAND_UPDATED__ = ${justUpdated ? 'true' : 'false'}; true;`;

  return (
    <View style={styles.root}>
      <StatusBar hidden />
      <WebView
        style={styles.web}
        containerStyle={styles.web}
        source={{ html: GAME_HTML, baseUrl: '' }}
        originWhitelist={['*']}
        injectedJavaScriptBeforeContentLoaded={injectSave}
        onMessage={onMessage}
        onLoadEnd={onLoadEnd}
        javaScriptEnabled
        domStorageEnabled
        // A game, not a document: no scrolling, no rubber-banding, no zoom,
        // no text selection, no link previews.
        scrollEnabled={false}
        bounces={false}
        overScrollMode="never"
        scalesPageToFit={false}
        automaticallyAdjustContentInsets={false}
        contentInsetAdjustmentBehavior="never"
        allowsLinkPreview={false}
        menuItems={[]}
        // Sound effects start from a tap inside the page, so the WebView must
        // not require its own separate gesture.
        allowsInlineMediaPlayback
        mediaPlaybackRequiresUserAction={false}
        setSupportMultipleWindows={false}
        cacheEnabled={false}
        androidLayerType="hardware"
        testID="polderland-webview"
      />
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: '#0d1224' },
  web: { flex: 1, backgroundColor: '#0d1224' },
});
