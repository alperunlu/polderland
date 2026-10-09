/**
 * Scenario definitions. Each one is a different argument about the sea:
 * a gentle introduction, a winter of storms, and a century of sea-level rise.
 *
 * The names are proper nouns and stand in both languages; the prose that goes
 * with them lives in the dictionary under `level.<id>.*`.
 */
import { t } from './i18n.js';

export const LEVELS = [
  {
    id: 'beemster',
    name: 'De Beemster',
    // 1612: the Beemster was drained by 43 windmills. Steam drainage does not
    // reach the Netherlands for another 175 years, so the machine the player
    // builds here is a poldermolen, not an engine house.
    machine: 'mill',
    seed: 1017,
    tutorial: true,
    startMoney: 1850,
    startDate: { day: 1, month: 3, year: 1612 },
    endDate: { day: 1, month: 9, year: 1612 },
    seaStart: 0.15,
    seaRisePerDay: 0.004,
    tideAmplitude: 0.35,
    stormEveryDays: 42,
    stormSurge: [1.3, 2.1],
    stormDays: 2,
    rainPerDay: 0.023,
    prebuiltDikeRatio: 1.0,
    prebuiltDikeLevel: 0,
    prebuiltCanal: 6,
    // One outlet: with two, the canal could not fill however many mills the
    // tutorial had the player build, so "build another outlet when the
    // canal stays high" was a lesson the level never gave the chance to learn.
    prebuiltOutlets: 1,
    prebuiltPumps: 1,
    // 1612: the lake was pumped dry four years ago and the floor is still
    // rough ground. Most of the polder is the player's to win.
    startReclaimed: 0.22,
    houses: 14,
    winHouseRatio: 0.6,
    loseHouseRatio: 0.3,
  },
  {
    id: 'winter',
    name: 'Winter van 1665',
    machine: 'mill',
    seed: 665,
    tutorial: false,
    // Enough to raise the north-west bank to full height before the first
    // gale and still buy the mills and the second outlet the rain will need.
    startMoney: 7500,
    // Nothing is growing between November and March, but the cows still
    // milk. It was 0.38 when the ring came fully raised; once raising it
    // became the player's job, every mill or raise pushed the books below
    // zero and the money drained faster than anything could be done about it.
    // At 0.6 (12 seeds): reading the wind wins 11, spending anywhere wins 3,
    // idle and opening-only still win none.
    yieldFactor: 0.6,
    startDate: { day: 1, month: 11, year: 1665 },
    endDate: { day: 15, month: 3, year: 1666 },
    seaStart: 0.5,
    seaRisePerDay: 0.005,
    tideAmplitude: 0.45,
    stormEveryDays: 8,
    // A fortnight's grace before the first gale: the ring has to be raised
    // by the player, not handed over already built.
    firstStormDay: 14,
    // Most North Sea gales come from the north-west, the rest from the
    // north-east. The first draft of this weighting spread storms evenly
    // round the compass; at level 1 that made the player raise the whole
    // ring, fifty-odd tiles, which a winter polder cannot pay for.
    stormDirs: { xm: 7, ym: 3 },
    stormSurge: [1.9, 3.2],
    stormDays: 3,
    // A shade less rain than before (0.036). Pumps were slowed a little to
    // stop a mill clearing a flood in seconds, and this takes back part of
    // what that cost this scenario. (The reclaimed share was tried too and
    // moves nothing here: this winter is won on water, not on money.)
    rainPerDay: 0.034,
    prebuiltDikeRatio: 1.0,
    // The ring starts at level 1, which most gales will top on the side they
    // blow onto. It used to start fully raised, which left the dike — the
    // decision the scenario is about — with nothing to do. Measured (12
    // seeds): a player who raises the north-west bank in the grace period and
    // answers each warning on the facing side wins 9; idle, opening-only and
    // spend-anywhere play win none.
    prebuiltDikeLevel: 1,
    prebuiltCanal: 10,
    // One outlet, not two. Since an outlet drains whatever the tide is doing,
    // two of them carried this winter on their own: a player who built one
    // mill on the first day and then watched won every run. With one, the
    // winter's rain has to be answered with a second outlet, bought out of a
    // season that earns little.
    prebuiltOutlets: 1,
    prebuiltPumps: 3,
    // An old polder, farmed for two generations: it starts in production and
    // the scenario is about not losing it.
    startReclaimed: 0.85,
    houses: 18,
    winHouseRatio: 0.55,
    loseHouseRatio: 0.3,
  },
  {
    id: 'haarlemmermeer',
    name: 'Haarlemmermeer 1852',
    // The first lake in the Netherlands drained by steam. Three stations did
    // it, Leeghwater, Lynden and Cruquius, between 1849 and 1852; the level
    // opens the autumn the lake bed fell dry, with those three at work.
    machine: 'steam',
    // A steam station lifts far more than a mill and burns coal every day it
    // runs: the scenario's question is how many the new land can pay for.
    // Measured (12 seeds): two or three stations and reading the wind win
    // 10-11; five or seven go broke on coal and win 2; idle play wins 1,
    // an opening and nothing more wins 4.
    // 2.13 rather than 2: the base pump rate came down from 3.2 to 3.0 so a
    // mill no longer clears a flood in seconds, and 3.0 x 2.13 is the 3.2 x 2
    // a station lifted before, so this scenario plays as it measured above
    // (the bot: 4 wins in 24, idle play lasting 138 days either way).
    pumpRateFactor: 2.13,
    pumpUpkeepFactor: 3,
    seed: 1852,
    tutorial: false,
    startMoney: 3000,
    // New clay under a lake bed: it pays, but not yet like old farmland.
    yieldFactor: 0.65,
    startDate: { day: 1, month: 9, year: 1852 },
    endDate: { day: 1, month: 6, year: 1853 },
    seaStart: 0.6,
    seaRisePerDay: 0.001,
    tideAmplitude: 0.4,
    stormEveryDays: 16,
    stormSurge: [1.8, 2.8],
    stormDays: 3,
    rainPerDay: 0.032,
    prebuiltDikeRatio: 1.0,
    prebuiltDikeLevel: 1,
    prebuiltCanal: 12,
    prebuiltOutlets: 1,
    // One station at work (with three, the level played itself: idle play
    // won every run); the rest are the player's to build and fuel.
    prebuiltPumps: 1,
    // A lake bed four months dry: nearly all of it still to be won.
    startReclaimed: 0.05,
    houses: 12,
    winHouseRatio: 0.55,
    loseHouseRatio: 0.3,
  },
  {
    id: 'dollard',
    name: 'Dollard 1877',
    // The Johannes Kerkhovenpolder was diked in 1877 on the Groningen shore
    // of the Dollard, in front of the Reiderwolderpolder of 1862. The level
    // opens that year on the new sea dike with the tidal flat in front of it,
    // and goes on for as long as the player can keep winning land.
    coast: 'wadden',
    endless: true,
    // The old land lies across the whole south of the map, as the Groningen
    // shore lies south of the Dollard; the polder stands out from it into
    // the water and can be grown out on any of its three seaward sides.
    cols: 36,
    rows: 36,
    landLine: 44,
    polderLeft: 14,
    polderRight: 24,
    polderTop: 14,
    polderBottom: 24,
    // A young polder on heavy new clay, not yet in full yield.
    yieldFactor: 0.75,
    machine: 'steam',
    // Steam until 1920; the stations built after that are electric: they
    // lift more and cost less to run. Pumps keep the machine they were built as.
    eras: [
      // Cheaper to run than the Haarlemmermeer's engines of 1852: better
      // engines, and coal landed at the Groningen ports. At three times a
      // mill's upkeep each station ate a fifth of the young polder's income,
      // so a player had to choose between the books and the village.
      { year: 1877, machine: 'steam', pumpRateFactor: 2, pumpUpkeepFactor: 2 },
      { year: 1920, machine: 'engine', pumpRateFactor: 2.5, pumpUpkeepFactor: 1.6 },
    ],
    seed: 1877,
    tutorial: false,
    startMoney: 5000,
    startDate: { day: 1, month: 5, year: 1877 },
    endDate: null,
    seaStart: 0.4,
    // The sea never stops rising, so no polder is ever finished. At 0.0012 a
    // player who did nothing never saw the dike tested in the first year and
    // more; at 0.003 the surge is over the crest within a few months.
    seaRisePerDay: 0.003,
    // A storm surge is a three-day sine, so its peak over the crest is brief
    // and the dike rarely reached the stress that opens it: idle for 500 days
    // it never breached, it just let the water over. Doubling the stress
    // makes a crest that is overtopped by half a metre a real risk.
    stressFactor: 2,
    tideAmplitude: 0.5,
    stormEveryDays: 20,
    firstStormDay: 30,
    // Gales off the North Sea come in from the north-west and north.
    stormDirs: { xm: 4, ym: 4, xp: 1 },
    stormSurge: [1.8, 2.9],
    stormDays: 3,
    rainPerDay: 0.03,
    // Young clay settles by centimetres a year, not the metres a peat polder
    // loses in a season: at the usual rate the old village sank to the floor
    // within a year and no coast lasted long enough to grow.
    subsideFactor: 0.05,
    prebuiltDikeRatio: 1.0,
    prebuiltDikeLevel: 1,
    prebuiltCanal: 10,
    prebuiltOutlets: 1,
    prebuiltPumps: 1,
    // Old polder behind the dike: about half of it in production already.
    startReclaimed: 0.5,
    houses: 10,
    loseHouseRatio: 0.3,
    winHouseRatio: 0,
  },
];

/**
 * Scenarios kept out of the menu. Delta 2100 was the fourth level until the
 * Dollard took its place; its definition stays so it can be brought back.
 */
export const ARCHIVED_LEVELS = [
  {
    id: 'delta',
    name: 'Delta 2100',
    machine: 'engine',
    seed: 2100,
    tutorial: false,
    startMoney: 3000,
    startDate: { day: 1, month: 1, year: 2100 },
    endDate: { day: 1, month: 1, year: 2101 },
    seaStart: 0.9,
    // The sea has to stay beatable. At 0.0058/day with surges to 2.5m, the
    // worst storm of the year reached 6.12m against a 4.80m crest on a ring
    // at full height — overtopped by 1.3m whatever the player built, so a
    // strong player lost 12 runs in 12, and still lost 4 in 12 given
    // unlimited money. Money was never the problem: raising the starting
    // treasury changed nothing. Now the worst case is
    // 4.70m, just under a fully raised ring, so holding the polder demands
    // raising all of it and nothing less — a strong player wins about two
    // runs in three, an average one about one in three, and a passive one
    // never. Still the hardest of the three, which it should be.
    seaRisePerDay: 0.0030,
    tideAmplitude: 0.6,
    stormEveryDays: 20,
    stormSurge: [1.3, 2.1],
    stormDays: 3,
    rainPerDay: 0.040,
    prebuiltDikeRatio: 1.0,
    prebuiltDikeLevel: 1,
    prebuiltCanal: 14,
    // One outlet for three engines. With three, each pumping out faster than
    // an engine lifts water in, the canal never left its bed all year and
    // its gauge sat at -1.2 m through every storm: the outlet decision was
    // already made. With one, the canal rises with rain and with every
    // engine the player adds, and another outlet is something to buy.
    prebuiltOutlets: 1,
    prebuiltPumps: 3,
    // A modern polder in full production; 2100 is about holding it.
    startReclaimed: 0.9,
    houses: 24,
    winHouseRatio: 0.55,
    loseHouseRatio: 0.25,
  },
];

export function levelSubtitle(level) {
  return t(`level.${level.id}.subtitle`);
}

export function levelById(id) {
  return LEVELS.find((l) => l.id === id) || LEVELS[0];
}
