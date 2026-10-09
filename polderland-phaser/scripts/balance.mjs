/**
 * Scenario balance harness.
 *
 * Runs the real `Simulation` headless, many seeds per scenario, against a few
 * fixed player policies, and reports how each one fares. It exists because
 * eyeballing one playthrough proves nothing: changing anything that alters
 * how often the PRNG is drawn from shifts the whole stream, so a single-seed
 * before/after comparison is not a comparison at all.
 *
 *   node scripts/balance.mjs [scenario ...]
 *
 * The policies are the questions worth asking of a scenario:
 *
 *   idle     builds nothing. Should essentially always lose, or the scenario
 *            plays itself.
 *   opening  builds a sensible opening on day one and then stops. Should
 *            mostly lose, or there is nothing to do after minute two.
 *   engaged  keeps spending on whatever is most urgent. Should win often but
 *            not always, and should not sit on unspent money.
 */

import { LEVELS } from '../src/systems/levels.js';
import { Simulation } from '../src/systems/Simulation.js';
import { COST, PUMP_RADIUS, SECONDS_PER_DAY } from '../src/constants.js';

const SEEDS = Number(process.env.SEEDS || 16);
const STEP = 0.25;            // simulated seconds per tick
const MAX_TICKS = 400000;

/** Try to build `kind` on the first tile that will take it. */
function buildSomewhere(sim, kind, pick) {
  const candidates = [];
  for (let x = 0; x < sim.tiles.length; x++) {
    for (let y = 0; y < sim.tiles.length; y++) {
      const t = sim.tiles[x][y];
      if (sim.validate(kind, t)) continue;
      candidates.push(t);
    }
  }
  if (!candidates.length) return false;
  const t = pick ? pick(candidates) : candidates[0];
  return !!t && sim.build(kind, t).ok;
}

/**
 * Where a player would dig next: touching the canal already there, and as
 * close as possible to the water that needs taking off. Picking the first
 * legal tile in scan order instead put canals in an empty corner, which made
 * the harness look like the economy was failing when it was the digging.
 */
function nextCanal(sim, tiles) {
  const wet = sim.landTiles.filter((t) => t.depth > 0.02);
  if (!wet.length) return tiles[0];
  const cx = wet.reduce((a, t) => a + t.x, 0) / wet.length;
  const cy = wet.reduce((a, t) => a + t.y, 0) / wet.length;
  let best = null;
  let score = Infinity;
  for (const t of tiles) {
    const touches = sim.canalTiles.some(
      (c) => Math.abs(c.x - t.x) + Math.abs(c.y - t.y) === 1,
    );
    if (!touches && sim.canalTiles.length) continue;
    const d = Math.abs(t.x - cx) + Math.abs(t.y - cy);
    if (d < score) { score = d; best = t; }
  }
  return best || tiles[0];
}

/**
 * Where the next mill goes: over the most standing water it can reach that
 * nothing else is already reaching.
 *
 * Scoring by water alone stacked mill after mill on the same wet corner,
 * which wasted most of their capacity and made the tighter scenarios look
 * unwinnable — the polder drowned everywhere the cluster was not. Ground
 * already inside another mill's radius is discounted for exactly that.
 */
function wettest(sim, tiles) {
  let best = null;
  let score = -Infinity;
  for (const t of tiles) {
    let s = 0;
    for (const l of sim.landTiles) {
      if (Math.abs(l.x - t.x) + Math.abs(l.y - t.y) > PUMP_RADIUS) continue;
      const served = sim.pumps.some(
        (p) => Math.abs(l.x - p.x) + Math.abs(l.y - p.y) <= PUMP_RADIUS,
      );
      s += (l.depth + 0.02 + (l.building ? 0.3 : 0)) * (served ? 0.15 : 1);
    }
    if (s > score) { score = s; best = t; }
  }
  return best;
}

const POLICIES = {
  idle: () => {},

  /**
   * Unlimited money, building as fast as anything is allowed. Not a player —
   * a control. If this cannot keep the polder dry then the scenario is not an
   * economy problem, it is a physics problem, and no amount of retuning the
   * prices will fix it.
   */
  rich: (sim, day, state) => {
    sim.money = 1e6;
    if (day - state.lastAct < 0.5) return;
    state.lastAct = day;
    // Several works per call, because one per half-day is a limit of the
    // harness, not of a player with a full purse, and a control that is
    // throttled below the thing it is meant to bound proves nothing.
    for (let i = 0; i < 6; i++) {
      const weak = sim.dikes.find((t) => t.dike.level < 2);
      if (weak && sim.build('dike', weak).ok) continue;
      if (sim.canalVolume > sim.canalCapacity() * 0.35
        && (buildSomewhere(sim, 'outlet') || buildSomewhere(sim, 'canal', (c) => nextCanal(sim, c)))) continue;
      if (sim.workableShare() < 0.99
        && (buildSomewhere(sim, 'pump', (c) => wettest(sim, c))
          || buildSomewhere(sim, 'canal', (c) => nextCanal(sim, c)))) continue;
      break;
    }
  },

  opening: (sim, day) => {
    if (day > 1) return;
    buildSomewhere(sim, 'canal', (c) => nextCanal(sim, c));
    buildSomewhere(sim, 'pump', (c) => wettest(sim, c));
  },

  engaged: (sim, day, state) => {
    // A player checks in a few times a game day, not once.
    if (day - state.lastAct < 0.3) return;
    state.lastAct = day;
    // Keep enough back that a day's upkeep cannot lay the works up: going
    // broke is a loss condition, not a build order.
    const reserve = sim.dailyUpkeep * 3 + 200;
    const afford = (c) => sim.money > c + reserve;
    // And watch the margin, not just the balance. Buying works whose running
    // cost eats the daily surplus is how a polder that is already 96% dry
    // ends up with twenty mills and no money to keep any of them turning —
    // the traced failure that made this scenario look unwinnable when what
    // was unwinnable was the policy.
    const margin = sim.dailyIncome - sim.dailyUpkeep;
    const sustains = (cost) => margin - cost > 30;

    // Raise the stretch the weather is actually on, not the whole ring. The
    // ring is fifty-odd tiles and a storm only presses one side of it, so a
    // player who upgrades everything is paying four times over — and a
    // harness that models them that way makes a scenario look unaffordable
    // when the affordable answer was to read the wind.
    const facing = (t) => t.edges && t.edges.includes(sim.stormDir);
    const below2 = sim.dikes.filter((t) => t.dike && t.dike.level < 2);
    const weakest = below2.filter(facing).sort((a, b) => a.dike.level - b.dike.level)[0]
      || below2.sort((a, b) => a.dike.level - b.dike.level)[0];

    // The ring, in two speeds. A storm that is actually going to top the
    // weakest stretch is worth the money now; otherwise the ring is where
    // surplus goes once the polder is paying well, and only then. Chasing the
    // worst surge the scenario can produce from day one empties the treasury
    // across fifty-odd tiles before a single mill is built.
    const upgrade = weakest && COST.dikeUpgrade[weakest.dike.level + 1];
    if (weakest && sim.stormState !== 'calm'
      && sim.stormPeak > sim.crestOf(weakest) && afford(upgrade)) {
      if (sim.build('dike', weakest).ok) return;
    }
    // A mill is the expensive thing, and everything else on this list is
    // cheap enough to pass the affordability test forever. Left unordered,
    // the policy dribbled its money into canal after canal and never once
    // saved the price of a mill — three mills at day 50 with the polder
    // drowning and a third of the farmland dug away under it. So: if a mill
    // is what the polder needs, nothing else may spend until it is bought.
    const wet = sim.workableShare() < 0.94;
    const canSite = (k) => {
      for (let x = 0; x < sim.tiles.length; x++) {
        for (let y = 0; y < sim.tiles.length; y++) {
          if (!sim.validate(k, sim.tiles[x][y])) return true;
        }
      }
      return false;
    };
    if (wet && sustains(11)) {
      if (canSite('pump')) {
        if (afford(sim.costOf('pump'))) {
          if (buildSomewhere(sim, 'pump', (c) => wettest(sim, c))) return;
        }
        return;                       // saving for it
      }
      // Nowhere legal to put one: the canal does not reach far enough yet.
      if (afford(sim.costOf('canal'))
        && buildSomewhere(sim, 'canal', (c) => nextCanal(sim, c))) return;
    }
    // The canal is the drain. Somewhere to put the water beats more of it.
    if (sim.canalVolume > sim.canalCapacity() * 0.7) {
      if (afford(sim.costOf('outlet')) && sustains(20) && buildSomewhere(sim, 'outlet')) return;
      if (afford(sim.costOf('canal'))
        && buildSomewhere(sim, 'canal', (c) => nextCanal(sim, c))) return;
    }
    // Surplus into the ring, but only surplus: a healthy margin and several
    // days' upkeep still in hand afterwards.
    if (weakest && margin > 70 && sim.money > upgrade + reserve * 3) {
      sim.build('dike', weakest);
    }
  },
};

function run(level, seed, policy) {
  const sim = new Simulation({ ...level, seed });
  const act = POLICIES[policy];
  const state = { lastAct: -99 };
  let ticks = 0;
  let idleTicks = 0;
  let samples = 0;
  while (!sim.outcome && ticks++ < MAX_TICKS) {
    sim.update(STEP, 4);
    const day = sim.elapsedDays;
    act(sim, day, state);
    if (process.env.TIMELINE && ticks % 26 === 0) {
      console.log(`    d${String(Math.round(day)).padStart(3)}`
        + ` f${String(Math.round(sim.money)).padStart(5)}`
        + ` in ${String(Math.round(sim.dailyIncome)).padStart(3)}`
        + ` up ${String(Math.round(sim.dailyUpkeep)).padStart(3)}`
        + ` mills ${String(sim.pumps.length).padStart(2)}`
        + ` canals ${String(sim.canalTiles.length).padStart(2)}`
        + ` out ${sim.outlets.length}`
        + ` next f${sim.costOf('pump')}`
        + ` laidUp ${sim.laidUpCount()}`
        + ` dry ${String(Math.round(sim.workableShare() * 100)).padStart(3)}%`
        + ` houses ${sim.intactHouses()}/${sim.totalHouses()}`);
    }
    if (ticks % 40 === 0) {
      samples++;
      // "Cash idle" means capital genuinely spare — several works' worth on
      // top of a sensible reserve. At a lower bar this mostly measured the
      // policy's own reserve rule rather than the scenario.
      if (sim.money > sim.costOf('pump') * 3 + sim.dailyUpkeep * 3) idleTicks++;
    }
  }
  return {
    outcome: sim.outcome || 'ran-out',
    houses: `${sim.intactHouses()}/${sim.totalHouses()}`,
    won: sim.outcome === 'won',
    days: Math.round(sim.elapsedDays),
    money: Math.round(sim.money),
    breaches: sim.stats.breaches,
    idle: samples ? idleTicks / samples : 0,
    dry: sim.workableShare(),
  };
}

const wanted = process.argv.slice(2);
const levels = wanted.length ? LEVELS.filter((l) => wanted.includes(l.id)) : LEVELS;

for (const level of levels) {
  console.log(`\n${level.id}`);
  for (const policy of Object.keys(POLICIES)) {
    const rows = [];
    for (let i = 0; i < SEEDS; i++) rows.push(run(level, level.seed + i * 7919, policy));
    if (process.env.VERBOSE) {
      rows.forEach((r, i) => console.log(`    ${policy} +${i}`, JSON.stringify(r)));
    }
    const wins = rows.filter((r) => r.won).length;
    const mean = (f) => rows.reduce((a, r) => a + f(r), 0) / rows.length;
    console.log(
      `  ${policy.padEnd(8)} ${String(wins).padStart(2)}/${SEEDS}`
      + `  idle ${(mean((r) => r.idle) * 100).toFixed(0).padStart(3)}%`
      + `  dry ${(mean((r) => r.dry) * 100).toFixed(0).padStart(3)}%`
      + `  breaches ${mean((r) => r.breaches).toFixed(1)}`
      + `  end f ${Math.round(mean((r) => r.money))}`,
    );
  }
}
