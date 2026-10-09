/**
 * Entry point.
 *
 * `registerRootComponent` is what tells the native side which component to
 * mount. Pointing `main` straight at App.js instead leaves nothing registered
 * under the name native asks for, and the app aborts a few hundred
 * milliseconds after launch with a crash log that points at React Native's
 * error reporting rather than at the cause.
 */
import { registerRootComponent } from 'expo';

import App from './App';

registerRootComponent(App);
