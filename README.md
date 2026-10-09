# Polderland

A pixel-art strategy game about the one problem the Netherlands has never
stopped solving: the polder floor lies below sea level, and the water has to
be kept out by hand, every day, forever.

You inherit a reclaimed polder with a ring dike around it, a village in the
middle, and a sea outside that is higher than your fields. Keep the village
dry until the end of the scenario.

It is built to be played on a phone, in landscape, and runs equally well in a
desktop browser.

```
cd polderland-phaser
npm install
npm run dev
```

## How it works

Every land tile has a ground level in metres relative to NAP, and a depth of
water standing on it. Water moves from higher surfaces to lower ones, and
everything you build changes that one equation:

| Structure | What it does |
|---|---|
| **Dike** | Raises the crest the sea has to climb. Only on the coastal ring; build on an existing dike to raise it further. |
| **Canal** | Storage and conduit for the water your pumps lift. Each new one costs a little more than the last. |
| **Pump** | Lifts standing water off the land within 3 tiles and into a canal. Needs a canal within 2 tiles to discharge into. |
| **Outlet** | A sluice in the ring with a mill or an engine on it. Pumps the canal out to sea whatever the tide is doing, and lets it run out by gravity whenever that is faster. Each one costs more than the last. |

The chain that keeps you alive is **land → pump → canal → outlet → sea**.
Break any link and the polder starts filling.

### The sea

Sea level is the scenario's clock: it rises a little every day, a tide runs
over the top of it, and storms add a surge on top of that. A storm blows from
one quarter, so only the stretch of coast facing it takes the full surge —
you get two days' warning and a compass bearing, and reinforcing the right
side is the whole game. Some stretches of coast are naturally more exposed
than others.

A dike that is overtopped accumulates stress, and a dike under enough stress
**breaches**: the crest is gone, the sea comes straight in, and you are paying
to close a hole instead of raising a crest.

### Rain

Ordinary rain is a background drain on your pumps. A storm drops roughly six
times as much, so a pump fleet sized for a quiet week will be overwhelmed by
the first gale. Build for the storm.

### Money

Dry houses pay tax; flooded ones pay nothing and lose condition every day
they stand in water, until they are lost for good. Pumps, dikes, outlets
and canals all carry daily upkeep. Run out of guilders and the
pumps stop, which is how most polders are actually lost.

## Scenarios

1. **De Beemster (1612)** — a calm spring in a young polder. The tutorial.
2. **Winter van 1665** — gales, mostly from the north-west; the ring is yours to raise.
3. **Haarlemmermeer 1852** — steam drains the lake, and every station burns coal.
4. **Dollard 1877** — endless: stake brushwood fences on the tidal flat, let
   the silt build salt marsh, dike it in, and push the coast out into the sea
   for as long as you can hold it. Scored in hectares, on a Game Center
   leaderboard. Steam pumps give way to electric ones in 1920.

Finishing one unlocks the next. Progress, settings and an in-progress game
are saved in the browser.

## Controls

| | |
|---|---|
| Drag / arrow keys / WASD | Pan |
| Scroll / pinch | Zoom (whole steps only, to keep the pixels crisp) |
| Home, or the frame button | Re-frame the whole island |
| 1 – 4 | Dike, canal, pump, outlet |
| Tap or click a tile | Inspect ground level, water depth, dike stress, machinery |
| Right click / Esc | Cancel placement, or deselect |
| Space | Pause |
| Tab | Fast forward |

On a touch screen, building is aim-then-confirm: the first tap puts a marker on
a tile and shows what it would cost, the second tap (or the BUILD button)
commits it. A mis-tap should never cost 980 guilders. The game switches between
that and mouse hover from how you last touched the screen, not from what kind
of device it thinks you have.

Played in landscape. iOS is configured landscape-only; the browser build asks
you to rotate a phone held upright.

## On a phone

The canvas is not scaled down to fit the screen — that is what makes most
ported pixel-art games unreadable on a phone. Instead the device picks the
largest whole-number magnification that still leaves the interface a workable
logical viewport, so one game pixel is always a whole number of screen pixels:

| Device | Screen | Magnification | Logical viewport |
|---|---|---|---|
| iPhone SE, landscape | 667 x 375 | 1x | 667 x 375 |
| iPhone 16 Pro Max, landscape | 932 x 430 | 1x | 932 x 430 |
| iPad Pro 13", landscape | 1376 x 1032 | 2x | 688 x 516 |
| Desktop | 1280 x 720 | 2x | 640 x 360 |
| Desktop | 1920 x 1080 | 3x | 640 x 360 |

Where the canvas is not magnified — which in practice means a phone — the text
the player reads while playing is drawn at double size instead, so it lands
around 14pt rather than 7pt. Touch targets are 46pt or larger throughout.

## iOS

The iOS app is an [Expo](https://expo.dev) app in `expo/` whose only job is to
host the web build in a WebView, so it ships through EAS Build and EAS Submit.
No Mac is needed.

```bash
cd polderland-phaser && npm run build:single   # one self-contained HTML page
cd ../expo && npm run sync                     # embed it as a JS string
npx eas build --platform ios --profile production
npx eas submit --platform ios --latest
```

Or let CI do it: `.github/workflows/ios-testflight.yml` runs the same thing on
a push of an `ios-v*` tag, given one `EXPO_TOKEN` secret. It rebuilds the game,
refuses to run if the committed bundle is stale, and checks the exported
production bundle before spending a build.

The page is embedded as a string rather than shipped as a file, which means no
file access and no asset resolution to get wrong — but it also gives the
document an opaque origin, where `localStorage` throws. Saves therefore go
through the native side: the game posts its state to the host, which keeps it
in `AsyncStorage` and injects it back before the page loads. In a browser the
same code path uses `localStorage`.

## Technical notes

Built with [Phaser 3](https://phaser.io) and Vite. There are no asset files:
every sprite, the UI chrome, the 5×7 bitmap font and all the music and sound
effects are generated procedurally at boot, from a single 48-colour palette,
which is why the whole game ships as one JavaScript bundle.

- `src/art/` — the pixel-drawing engine, sprite generators and the bitmap font
- `src/systems/` — simulation, scenarios, audio, saves, tutorial, viewport policy
- `src/scenes/` — boot, menu, game, HUD, pause, results
- `src/ui/` — nine-slice panels, buttons, gauges
- `../expo/` — the Expo app that wraps the game for iOS

The simulation is deliberately separable from the rendering: `Simulation`
never touches a sprite, which is what lets the scenarios be balance-tested
headlessly in Node.

## History

- **July 2023** — development started, with a first prototype built in
  Flutter.
- **March 2025** — the game was rebuilt in Godot; the main script of that
  version is kept in `legacy/polderland.gd`.
- **July 2026** — the project migrated to Phaser 3 and Vite, and an Expo app
  was added to ship it on iOS.

## Licence

MIT — see [LICENSE](LICENSE).

---

*"God created the world, but the Dutch created the Netherlands."*
