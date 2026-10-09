/**
 * The whole game model lives here: terrain, water, structures and economy.
 *
 * The scene never mutates this state directly — it calls intents (`build`,
 * `upgradeDike`, ...) and reads the result — which keeps rendering and rules
 * separable and makes the water model testable on its own.
 *
 * Water is tracked as a depth in metres on every land tile. Each tile has a
 * ground elevation, so the water *surface* of a tile is elev + depth, and
 * water simply moves from higher surfaces to lower ones. Everything the
 * player builds changes that one equation:
 *   - dikes raise the barrier the sea has to climb to get in,
 *   - canals give the water somewhere to collect,
 *   - pumps lift water from the land into the canals,
 *   - outlets let the canals drain to sea: by gravity at low tide, and by
 *     their machine whenever the tide is too high for gravity.
 */

import {
  GRID, SEA_RING, NATURAL_CREST, DIKE_CREST, INFLOW_RATE, FLOW_RATE,
  FLOOD_DEPTH, FLOOD_DAMAGE, REPAIR_RATE, DIKE_STRESS_RATE, DIKE_RELIEF_RATE,
  DIKE_BREACH_AT, PUMP_RADIUS, PUMP_RATE, PUMP_CANAL_RANGE, CANAL_CAPACITY,
  CANAL_JAM_WARN_DAYS, CANAL_JAM_COOLDOWN_DAYS,
  CANAL_SEEP, SLUICE_RATE, OUTFALL_RATE, CANAL_BED, CANAL_TOP, HOUSE_TAX,
  CHURCH_TAX, PUMP_UPKEEP, DIKE_UPKEEP, OUTLET_UPKEEP,
  CANAL_UPKEEP, CANAL_COST_GROWTH, PUMP_COST_GROWTH, OUTLET_COST_GROWTH,
  COST, SECONDS_PER_DAY, SIM_STEP,
  WIND_FACING, WIND_FLANK, WIND_LEE,
  LAND_YIELD, WORKABLE_DEPTH, SOUR_DECAY, SOUR_PENALTY,
  RECLAIM_DAYS, RECLAIM_LOSS_RATE, RECLAIM_DROWN_RATE,
  SUBSIDE_RATE, SUBSIDE_FLOOR, GROUND_SEEP, HOUSE_VARIANTS,
} from '../constants.js';
import {
  mulberry32, clamp, advanceDate, dateIndex,
} from '../helpers.js';
// `t` is this file's name for a tile, so the translator comes in as `tr`.
import { t as tr } from './i18n.js';
import {
  isWadden, layoutWadden, updateSilt, drainNewPolders, dikeAction, buildMarshDike, marshDikeCost,
  fenceCount, hectares, serializeWadden, restoreWadden,
} from './wadden.js';

/** A brushwood fence on the tidal flat: what it costs, and to keep up. */
const FENCE_COST = 60;
const FENCE_UPKEEP = 0.3;

/** Neighbour offsets, orthogonal only — water does not flow diagonally. */
const N4 = [[1, 0], [-1, 0], [0, 1], [0, -1]];
/** Which edge of a tile faces each neighbour direction, for dike art. */
const EDGE_FOR = { '-1,0': 'xm', '0,-1': 'ym', '1,0': 'xp', '0,1': 'yp' };

export class Simulation {
  constructor(level) {
    this.level = level;
    this.rand = mulberry32(level.seed);

    this.date = { ...level.startDate };
    this.endIndex = level.endDate ? dateIndex(level.endDate) : Infinity;
    this.dayFraction = 0;
    this.elapsedDays = 0;

    this.money = level.startMoney;
    this.seaLevel = level.seaStart;
    this.surge = 0;
    this.tidePhase = 0;

    this.canalVolume = 0;
    // How long the canal has stood at its ceiling, and when that was last
    // said out loud. See the warning in updateCanals.
    this.canalJamDays = 0;
    this.canalWarnedDay = -Infinity;
    this.canalTiles = [];
    this.pumps = [];
    this.outlets = [];
    this.dikes = [];
    this.buildings = [];

    this.stormState = 'calm'; // calm | warning | active
    // A scenario may hold its first storm back to give the player time to
    // build before the weather starts; otherwise it comes on the usual beat.
    this.stormTimer = level.firstStormDay ?? level.stormEveryDays;
    this.stormDaysLeft = 0;
    this.stormPeak = 0;
    this.stormDir = 'ym';
    this.rainIntensity = level.rainPerDay;

    this.outcome = null; // null | 'won' | 'lost'
    this.events = [];
    this.stats = { daysSurvived: 0, breaches: 0, housesLost: 0, peakSea: level.seaStart, spent: 0 };

    this.accumulator = 0;
    this.cols = level.cols ?? GRID;
    this.rows = level.rows ?? GRID;
    this.buildTerrain();
    if (isWadden(level)) layoutWadden(this);
    this.landTiles = this.collectLandTiles();
    this.coast = this.collectCoastalTiles();
    // Order matters: the land is drained first, then settled. Digging the
    // ditches after the village is laid out boxes them in immediately.
    this.digStartingCanals();
    this.placeSettlement();
    this.applyPrebuilt();
    // Last, because which ground is already in production is measured from
    // the village, and skips whatever the ditches and prebuilt works cover.
    this.seedReclaimed();
    this.landTiles = this.collectLandTiles();
    this.refreshDerived();
  }

  /* ==============================================================
     MAP GENERATION
  ============================================================== */

  /** Distance in tiles from the map edge — drives the island's shape. */
  ringOf(x, y) {
    return Math.min(x, y, this.cols - 1 - x, this.rows - 1 - y);
  }

  buildTerrain() {
    const rand = this.rand;
    this.tiles = [];

    // Smooth value noise on a coarse lattice, bilinearly interpolated. A
    // polder is a drained lake bed, so its lows want to be broad basins, not
    // the per-tile speckle a raw hash would give.
    const LAT = 5;
    const lattice = [];
    for (let i = 0; i <= LAT; i++) {
      lattice[i] = [];
      for (let j = 0; j <= LAT; j++) lattice[i][j] = rand();
    }
    const smoothstep = (v) => v * v * (3 - 2 * v);
    const noise = (x, y) => {
      const fx = (x / this.cols) * LAT;
      const fy = (y / this.rows) * LAT;
      const i = Math.min(LAT - 1, Math.floor(fx));
      const j = Math.min(LAT - 1, Math.floor(fy));
      const tx = smoothstep(fx - i);
      const ty = smoothstep(fy - j);
      const a = lattice[i][j] + (lattice[i + 1][j] - lattice[i][j]) * tx;
      const b = lattice[i][j + 1] + (lattice[i + 1][j + 1] - lattice[i][j + 1]) * tx;
      return a + (b - a) * ty;
    };

    for (let x = 0; x < this.cols; x++) {
      this.tiles[x] = [];
      for (let y = 0; y < this.rows; y++) {
        const ring = this.ringOf(x, y);
        const t = {
          x, y, ring,
          base: 'land',
          elev: 0,
          depth: 0,
          canal: false,
          dike: null,
          pump: null,
          outlet: null,
          building: null,
          prop: null,
          tex: Math.floor(rand() * 4),
          everFlooded: false,
          // 0..1, how salt the ground still is after the sea has been on it.
          sour: 0,
        };

        if (ring < SEA_RING) {
          t.base = 'sea';
          t.elev = -5;
        } else if (ring === SEA_RING) {
          // The dike ring itself: dunes and made ground, right at sea level.
          t.elev = 0;
          t.coastal = true;
          // Some stretches of coast simply take the sea harder than others.
          t.exposure = rand() * 0.45;
        } else {
          // Reclaimed polder floor — genuinely below sea level, as it should
          // be, and deepest away from the ring where the old lake was.
          const n = noise(x, y);
          const depthFromEdge = Math.min(1, (ring - SEA_RING) / 3);
          t.elev = clamp(-1 - Math.round(n * 1.1 + depthFromEdge * 1.1), -3, -1);
        }
        this.tiles[x][y] = t;
      }
    }

    // Cache which way each coastal tile faces; storms come from a direction.
    for (let x = 0; x < this.cols; x++) {
      for (let y = 0; y < this.rows; y++) {
        const t = this.tiles[x][y];
        if (t.coastal) t.edges = this.outwardEdges(t);
      }
    }

    this.assignParcels();

    // Scatter scenery on the lower, emptier ground.
    for (let x = 0; x < this.cols; x++) {
      for (let y = 0; y < this.rows; y++) {
        const t = this.tiles[x][y];
        // Coastal ground still takes the rain; it simply sits at sea level,
        // so the seepage term is near nothing there of its own accord.
        if (t.base !== 'land') continue;
        const r = rand();
        if (r < 0.06) t.prop = 'tree';
        else if (r < 0.14) t.prop = 'cow';
      }
    }
  }

  /**
   * Divide the polder into farm parcels: long strips running one way, each
   * cut into a few fields, every field in a single land use.
   *
   * This is what a drained lake bed actually looks like from the air, and it
   * is also what stops the map reading as a checkerboard: colour varies
   * between parcels, never between neighbouring tiles of the same field.
   */
  assignParcels() {
    const rand = this.rand;
    // Strip boundaries along x, then field boundaries along y within them.
    const stripOf = [];
    let strip = 0;
    let x = 0;
    while (x < this.cols) {
      const w = 1 + Math.floor(rand() * 3);
      for (let i = 0; i < w && x < this.cols; i++, x++) stripOf[x] = strip;
      strip++;
    }

    const fieldOf = [];
    for (let sIdx = 0; sIdx < strip; sIdx++) {
      fieldOf[sIdx] = [];
      let y = 0;
      let field = 0;
      while (y < this.rows) {
        const h = 3 + Math.floor(rand() * 4);
        for (let j = 0; j < h && y < this.rows; j++, y++) fieldOf[sIdx][y] = field;
        field++;
      }
    }

    // Land use, weighted heavily toward pasture so the colour accents read.
    const USES = ['pasture', 'pasture', 'pasture', 'pasture', 'pasture',
      'plough', 'tulipRed', 'tulipYellow'];
    const useOfParcel = new Map();

    for (let px = 0; px < this.cols; px++) {
      for (let py = 0; py < this.rows; py++) {
        const t = this.tiles[px][py];
        if (t.base !== 'land' || t.coastal) continue;
        const id = `${stripOf[px]}:${fieldOf[stripOf[px]][py]}`;
        if (!useOfParcel.has(id)) {
          useOfParcel.set(id, {
            use: USES[Math.floor(rand() * USES.length)],
            variant: Math.floor(rand() * 4),
          });
        }
        const parcel = useOfParcel.get(id);
        t.parcel = id;
        // What this parcel becomes once it has been kept dry, and how far
        // along it is. `use` stays null until then: rough ground earns
        // nothing, which is what makes draining worth doing.
        t.plan = parcel.use;
        t.use = null;
        t.dry = 0;
        t.tex = parcel.variant;
      }
    }

    this.landPlots = this.collectLandPlots();
  }

  collectLandPlots() {
    const out = [];
    for (let x = 0; x < this.cols; x++) {
      for (let y = 0; y < this.rows; y++) {
        const t = this.tiles[x][y];
        if (t.base === 'land' && !t.coastal && t.plan) out.push(t);
      }
    }
    return out;
  }

  /**
   * How much of the polder is already in production on day one. A scenario
   * that opens on a freshly drained lake starts near nothing; one set in an
   * old polder that has been farmed for a century starts nearly full.
   *
   * The ground already in production is the ground nearest the village,
   * because that is the order a polder is actually taken into use, and it
   * leaves the player a worked core to push outward from rather than a
   * uniform speckle.
   */
  seedReclaimed() {
    const ratio = this.level.startReclaimed ?? 0.25;
    if (ratio <= 0) return;
    const c = this.villageCentre || { x: this.cols / 2, y: this.rows / 2 };
    const byDistance = [...this.landPlots].sort((a, b) => (
      (Math.abs(a.x - c.x) + Math.abs(a.y - c.y)) - (Math.abs(b.x - c.x) + Math.abs(b.y - c.y))
    ));
    const want = Math.round(byDistance.length * clamp(ratio, 0, 1));
    let done = 0;
    for (const t of byDistance) {
      if (done >= want) break;
      // Occupied ground cannot be brought into production, and must not eat
      // into the budget either, or the ratio silently undershoots: the tiles
      // nearest the village are exactly the ones carrying its houses.
      if (t.canal || t.building || t.pump || t.outlet) continue;
      t.use = t.plan;
      t.dry = RECLAIM_DAYS;
      done += 1;
    }
  }

  /** True when the neighbour across this edge belongs to a different field. */
  parcelEdge(t, dx, dy) {
    if (!t.parcel) return false;
    const n = this.tile(t.x + dx, t.y + dy);
    if (!n || n.base !== 'land' || n.coastal) return false;
    return n.parcel !== t.parcel;
  }

  /** Pick a village centre and lay the houses and the church around it. */
  placeSettlement() {
    const rand = this.rand;
    const mid = this.centre || { x: this.cols / 2, y: this.rows / 2 };
    const cx = Math.floor(mid.x + (rand() - 0.5) * 3);
    const cy = Math.floor(mid.y + (rand() - 0.5) * 3);
    this.villageCentre = { x: cx, y: cy };

    const candidates = [];
    for (let x = 0; x < this.cols; x++) {
      for (let y = 0; y < this.rows; y++) {
        const t = this.tiles[x][y];
        if (t.base !== 'land' || t.coastal || t.canal || t.ring <= SEA_RING) continue;
        const d = Math.abs(x - cx) + Math.abs(y - cy);
        if (d > 7) continue;
        candidates.push({ t, d, r: rand() });
      }
    }
    // Nearer the centre is likelier to be built on, so the village clusters.
    candidates.sort((a, b) => (a.d + a.r * 4) - (b.d + b.r * 4));

    let placed = 0;
    for (const c of candidates) {
      if (placed >= this.level.houses) break;
      if (c.t.building) continue;
      // Leave gaps: a solid block of adjacent houses reads as one wall of
      // brick rather than a village, and gives the water nowhere to show.
      let neighbours = 0;
      for (const [dx, dy] of N4) {
        const n = this.tile(c.t.x + dx, c.t.y + dy);
        if (n && n.building) neighbours++;
      }
      if (neighbours >= 2) continue;
      c.t.prop = null;
      c.t.building = {
        type: 'house',
        variant: Math.floor(rand() * HOUSE_VARIANTS),
        damage: 0,
        lost: false,
        flooded: false,
      };
      this.buildings.push(c.t);
      placed++;
    }

    // The church goes on the highest ground near the middle.
    const church = candidates
      .filter((c) => !c.t.building)
      .sort((a, b) => b.t.elev - a.t.elev || a.d - b.d)[0];
    if (church) {
      church.t.building = { type: 'church', variant: 0, damage: 0, lost: false, flooded: false };
      this.buildings.push(church.t);
    }

    // No decorative windmills: in this game a mill is a machine, and every one
    // on the map is a working poldermolen the player or the scenario put there.
  }

  /**
   * The drainage network the polder was reclaimed with: a ditch starting in
   * the middle of the basin and working its way out toward the coast, so a
   * outlet can be put at its seaward end.
   */
  digStartingCanals() {
    const want = this.level.prebuiltCanal || 0;
    if (want <= 0) return;

    const mid = this.centre || { x: this.cols / 2, y: this.rows / 2 };
    const seed = this.findCanalSeed(Math.floor(mid.x), Math.floor(mid.y));
    if (!seed) return;
    this.makeCanal(seed);

    let guard = 0;
    while (this.canalTiles.length < want && guard++ < 400) {
      const options = [];
      for (const c of this.canalTiles) {
        for (const [dx, dy] of N4) {
          const n = this.tile(c.x + dx, c.y + dy);
          if (n && !this.validate('canal', n)) options.push(n);
        }
      }
      if (options.length === 0) break;
      // Grow seaward first so the network reaches the ring; ties break on
      // the lower ground, which is where a real ditch would run.
      options.sort((a, b) => (a.ring - b.ring) || (a.elev - b.elev));
      this.makeCanal(options[0]);
    }
  }

  applyPrebuilt() {
    const rand = this.rand;
    const coast = this.coastalTiles();

    for (const t of coast) {
      if (rand() <= this.level.prebuiltDikeRatio) {
        t.dike = { level: this.level.prebuiltDikeLevel, stress: 0, broken: false };
        this.dikes.push(t);
      }
    }

    if (this.level.prebuiltPumps) {
      for (let i = 0; i < this.level.prebuiltPumps; i++) {
        const spot = this.canalTiles
          .map((c) => N4.map(([dx, dy]) => this.tile(c.x + dx, c.y + dy)))
          .flat()
          .find((t) => t && !this.validate('pump', t));
        if (spot) {
          spot.pump = { running: true, starved: false, kind: this.machineAt().machine };
          this.pumps.push(spot);
        }
      }
    }

    // Outlets the scenario starts with. The first one goes on
    // the coastal tile nearest the seaward end of the canal, where a sluice
    // would actually have been cut; the rest fill in along the ring.
    const last = this.canalTiles[this.canalTiles.length - 1];
    const byDistance = last
      ? coast.slice().sort((a, b) => (Math.abs(a.x - last.x) + Math.abs(a.y - last.y))
        - (Math.abs(b.x - last.x) + Math.abs(b.y - last.y)))
      : coast.slice();
    for (let i = 0; i < (this.level.prebuiltOutlets || 0); i++) {
      const spot = byDistance.find((t) => !t.outlet && !t.pump);
      if (!spot) break;
      spot.outlet = { open: true, running: true, flowing: false };
      this.outlets.push(spot);
    }
  }

  /**
   * The workable interior: every land tile that grows something. Cached
   * because the harvest is recomputed on every economy tick, and digging a
   * canal through a parcel is the only thing that changes the list.
   */
  collectLandTiles() {
    const out = [];
    for (let x = 0; x < this.cols; x++) {
      for (let y = 0; y < this.rows; y++) {
        const t = this.tiles[x][y];
        if (t.base === 'land' && !t.coastal && t.use) out.push(t);
      }
    }
    return out;
  }

  collectCoastalTiles() {
    const out = [];
    for (let x = 0; x < this.cols; x++) {
      for (let y = 0; y < this.rows; y++) {
        if (this.tiles[x][y].coastal) out.push(this.tiles[x][y]);
      }
    }
    return out;
  }

  coastalTiles() {
    return this.coast;
  }

  /** First buildable tile just outside the village, to start a ditch from. */
  findCanalSeed(cx, cy) {
    for (let r = 1; r < 6; r++) {
      for (let dx = -r; dx <= r; dx++) {
        for (let dy = -r; dy <= r; dy++) {
          if (Math.abs(dx) + Math.abs(dy) !== r) continue;
          const t = this.tile(cx + dx, cy + dy);
          if (t && !this.validate('canal', t)) return t;
        }
      }
    }
    return null;
  }

  /* ==============================================================
     QUERIES
  ============================================================== */

  /** Map size: columns along x, rows along y. 16 x 16 unless a level says otherwise. */
  inBounds(x, y) {
    return x >= 0 && y >= 0 && x < this.cols && y < this.rows;
  }

  tile(x, y) {
    return this.inBounds(x, y) ? this.tiles[x][y] : null;
  }

  /** Height the sea must climb to enter at this coastal tile. */
  crestOf(t) {
    if (!t.dike || t.dike.broken) return t.elev + NATURAL_CREST;
    return t.elev + DIKE_CREST[t.dike.level];
  }

  /** Water surface of the canal network, in metres. */
  canalSurface() {
    const cap = Math.max(1, this.canalCapacity());
    return CANAL_BED + (CANAL_TOP - CANAL_BED) * clamp(this.canalVolume / cap, 0, 1);
  }

  canalCapacity() {
    // Plus the field ditches of any polder the Dollard has enclosed, which
    // hold water without being drawn as canal.
    return this.canalTiles.length * CANAL_CAPACITY + (this.ditchStorage || 0);
  }

  /**
   * Which quarter a storm blows from, for one draw of the random stream.
   * By default every quarter is equally likely; a scenario can weight them
   * (`stormDirs: { xm: 3, ym: 1, ... }`), the way the North Sea's gales come
   * mostly from the north-west, so that reading the prevailing wind is part
   * of deciding which stretch of the ring to raise first. Still exactly one
   * draw either way, so an unweighted scenario's weather is unchanged.
   */
  pickStormDir(r) {
    const dirs = ['xm', 'xp', 'ym', 'yp'];
    const w = this.level.stormDirs;
    if (!w) return dirs[Math.floor(r * 4)];
    const total = dirs.reduce((a, d) => a + (w[d] || 0), 0);
    let acc = 0;
    for (const d of dirs) {
      acc += (w[d] || 0) / total;
      if (r < acc) return d;
    }
    return dirs.filter((d) => w[d]).pop();
  }

  /**
   * What one machine lifts and what it costs to run, per day. A scenario can
   * scale both: a steam pump lifts far more than a windmill, and burns coal
   * every day it runs.
   */
  pumpRate(p) {
    return PUMP_RATE * this.machineSpec(p?.pump?.kind).pumpRateFactor;
  }

  pumpUpkeep(p) {
    return PUMP_UPKEEP * this.machineSpec(p?.pump?.kind).pumpUpkeepFactor;
  }

  /**
   * The machine a new pump is built as today. A level either names one
   * machine for its whole span, or lists eras by year (`eras: [{ year,
   * machine, pumpRateFactor, pumpUpkeepFactor }]`), so a long game moves on
   * from steam to electric part-way through.
   */
  machineAt() {
    const eras = this.level.eras;
    if (!eras) return this.machineSpec(this.level.machine || 'mill');
    let era = eras[0];
    for (const e of eras) if (this.date.year >= e.year) era = e;
    return this.machineSpec(era.machine);
  }

  /** Lift and running cost of one kind of machine in this level. */
  machineSpec(kind) {
    const eras = this.level.eras;
    const era = eras && (eras.find((e) => e.machine === kind) || null);
    if (era) return { machine: era.machine, pumpRateFactor: era.pumpRateFactor ?? 1, pumpUpkeepFactor: era.pumpUpkeepFactor ?? 1 };
    if (eras && !kind) return this.machineAt();
    return {
      machine: kind || this.level.machine || 'mill',
      pumpRateFactor: this.level.pumpRateFactor ?? 1,
      pumpUpkeepFactor: this.level.pumpUpkeepFactor ?? 1,
    };
  }

  /** Effective sea level right now, including tide and storm surge. */
  effectiveSea() {
    const tide = Math.sin(this.tidePhase) * this.level.tideAmplitude;
    return this.seaLevel + tide + this.surge;
  }

  /**
   * How hard this stretch of coast is taking the current storm. Facing the
   * wind means the full surge; the lee side barely notices it.
   */
  windFactorAt(t) {
    if (!t.edges || t.edges.length === 0) return WIND_LEE;
    if (t.edges.includes(this.stormDir)) return WIND_FACING;
    // Corners catch a glancing blow from an adjacent quarter.
    const flank = { xm: ['ym', 'yp'], xp: ['ym', 'yp'], ym: ['xm', 'xp'], yp: ['xm', 'xp'] };
    if (t.edges.some((e) => flank[this.stormDir].includes(e))) return WIND_FLANK;
    return WIND_LEE;
  }

  /** Effective water level pressing on one coastal tile. */
  seaAt(t) {
    const tide = Math.sin(this.tidePhase) * this.level.tideAmplitude;
    return this.seaLevel + tide + this.surge * this.windFactorAt(t) + (t.exposure || 0);
  }

  /** Which outward edges of a coastal tile face open water. */
  outwardEdges(t) {
    const edges = [];
    for (const [dx, dy] of N4) {
      const n = this.tile(t.x + dx, t.y + dy);
      // The tidal flat in front of a sea dike is the sea's, as far as the dike is concerned.
      if (n && (n.base === 'sea' || n.base === 'mud')) edges.push(EDGE_FOR[`${dx},${dy}`]);
    }
    return edges;
  }

  hasCanalWithin(t, range) {
    for (let dx = -range; dx <= range; dx++) {
      for (let dy = -range; dy <= range; dy++) {
        if (Math.abs(dx) + Math.abs(dy) > range) continue;
        const n = this.tile(t.x + dx, t.y + dy);
        if (n && n.canal) return true;
      }
    }
    return false;
  }

  intactHouses() {
    return this.buildings.filter((t) => t.building && !t.building.lost
      && (t.building.type === 'house' || t.building.type === 'church')).length;
  }

  totalHouses() {
    return this.buildings.filter((t) => t.building
      && (t.building.type === 'house' || t.building.type === 'church')).length;
  }

  floodedTileCount() {
    let n = 0;
    for (let x = 0; x < this.cols; x++) {
      for (let y = 0; y < this.rows; y++) {
        const t = this.tiles[x][y];
        if (t.base === 'land' && !t.canal && t.depth > FLOOD_DEPTH) n++;
      }
    }
    return n;
  }

  landTileCount() {
    let n = 0;
    for (let x = 0; x < this.cols; x++) {
      for (let y = 0; y < this.rows; y++) {
        if (this.tiles[x][y].base === 'land' && !this.tiles[x][y].canal) n++;
      }
    }
    return n;
  }

  /* ==============================================================
     PLAYER INTENTS
  ============================================================== */

  costOf(kind, t) {
    if (kind === 'fence') return FENCE_COST;
    if (kind === 'dike' && t && t.base === 'mud' && isWadden(this.level)) {
      return this.dikeOnMud(t) === 'dike' ? marshDikeCost(this, t) : FENCE_COST;
    }
    if (kind === 'dike') {
      if (t && t.dike && !t.dike.broken) return COST.dikeUpgrade[t.dike.level + 1] ?? Infinity;
      if (t && t.dike && t.dike.broken) return COST.repairDike;
      return COST.dike;
    }
    if (kind === 'canal') {
      // Ditches dug with an enclosure are the water board's, not the player's:
      // they neither raise the price of the next one nor cost upkeep.
      return Math.round(COST.canal * CANAL_COST_GROWTH ** this.ownCanals());
    }
    if (kind === 'outlet') {
      return Math.round(COST.outlet * OUTLET_COST_GROWTH ** this.outlets.length);
    }
    if (kind === 'pump') {
      return Math.round(COST.pump * PUMP_COST_GROWTH ** this.pumps.length);
    }
    return COST[kind] ?? Infinity;
  }

  /** Why a placement is illegal, or null when it is allowed. */
  validate(kind, t) {
    if (!t) return tr('no.outside');
    if (this.outcome) return tr('no.over');

    if (kind === 'dike' && t.base === 'mud' && isWadden(this.level)) {
      const action = this.dikeOnMud(t);
      return action === 'dike' || action === 'fence' ? null : tr(action);
    }
    if (kind === 'fence') {
      if (!isWadden(this.level) || t.base !== 'mud') return tr('no.fence.flat');
      if (t.fence) return tr('no.occupied');
      return null;
    }
    if (kind === 'dike') {
      if (!t.coastal) return tr('no.dike.coastal');
      if (t.dike && !t.dike.broken && t.dike.level >= DIKE_CREST.length - 1) return tr('no.dike.full');
      return null;
    }
    if (kind === 'canal') {
      if (t.base !== 'land') return tr('no.canal.dry');
      if (t.canal) return tr('no.canal.already');
      if (t.building && !t.building.lost) return tr('no.built');
      if (t.pump || t.outlet) return tr('no.machinery');
      if (t.coastal) return tr('no.canal.ring');
      return null;
    }
    if (kind === 'pump') {
      if (t.base !== 'land') return tr('no.pump.dry');
      if (t.canal || t.pump || t.outlet) return tr('no.occupied');
      if (t.building && !t.building.lost) return tr('no.built');
      if (t.coastal) return tr('no.pump.exposed');
      if (!this.hasCanalWithin(t, PUMP_CANAL_RANGE)) {
        return tr('no.pump.canal', { n: PUMP_CANAL_RANGE });
      }
      return null;
    }
    if (kind === 'outlet') {
      if (!t.coastal) return tr('no.outlet.ring');
      if (t.outlet || t.pump) return tr('no.occupied');
      if (!this.hasCanalWithin(t, 3)) return tr('no.canal.near', { n: 3 });
      return null;
    }
    return tr('no.unknown');
  }

  makeCanal(t) {
    t.canal = true;
    t.prop = null;
    t.elev -= 1;
    this.canalTiles.push(t);
  }

  /**
   * Attempt to build. Returns { ok, reason, cost } so the UI can explain
   * refusals rather than silently doing nothing.
   */
  build(kind, t) {
    const reason = this.validate(kind, t);
    if (reason) return { ok: false, reason };

    const cost = this.costOf(kind, t);
    if (this.money < cost) return { ok: false, reason: tr('no.money') };

    this.money -= cost;
    this.stats.spent += cost;

    if (kind === 'dike' && t.base === 'mud') {
      if (this.dikeOnMud(t) === 'dike') buildMarshDike(this, t);
      else t.fence = true;
      return { ok: true, cost };
    }
    if (kind === 'fence') {
      t.fence = true;
      return { ok: true, cost };
    }

    if (kind === 'dike') {
      if (t.dike && t.dike.broken) {
        t.dike.broken = false;
        t.dike.stress = 0;
        this.pushEvent('dikeRepaired', t);
      } else if (t.dike) {
        t.dike.level += 1;
        t.dike.stress = Math.max(0, t.dike.stress - 40);
      } else {
        t.dike = { level: 0, stress: 0, broken: false };
        this.dikes.push(t);
      }
    } else if (kind === 'canal') {
      this.makeCanal(t);
    } else if (kind === 'pump') {
      t.pump = { running: true, starved: false, kind: this.machineAt().machine };
      this.pumps.push(t);
    } else if (kind === 'outlet') {
      t.outlet = { open: true, running: true, flowing: false };
      this.outlets.push(t);
    }

    this.refreshDerived();
    return { ok: true, cost };
  }

  /**
   * What demolishing this tile would take away, or null. Only works the
   * player can build: machines, outlets, canals and fences. Houses are the
   * village, and a sea dike is the only thing between it and the sea.
   */
  demolishable(t) {
    if (!t || this.outcome) return null;
    if (t.pump) return 'pump';
    if (t.outlet) return 'outlet';
    if (t.fence) return 'fence';
    if (t.canal) return 'canal';
    return null;
  }

  /** What demolishing gives back: a quarter of what one would cost now. */
  demolishRefund(t) {
    const kind = this.demolishable(t);
    if (!kind) return 0;
    const cost = kind === 'fence' ? FENCE_COST : this.costOf(kind, t);
    return Number.isFinite(cost) ? Math.round(cost * 0.25) : 0;
  }

  demolish(t) {
    const kind = this.demolishable(t);
    if (!kind) return { ok: false };
    const refund = this.demolishRefund(t);
    if (kind === 'pump') t.pump = null;
    else if (kind === 'outlet') t.outlet = null;
    else if (kind === 'fence') t.fence = false;
    else if (kind === 'canal') {
      t.canal = false;
      t.boardDitch = false;
      t.elev += 1;
    }
    this.money += refund;
    this.refreshDerived();
    if (kind === 'canal') this.landTiles = this.collectLandTiles();
    // A shorter canal holds less: what no longer fits stands on the land.
    const cap = this.canalCapacity();
    if (this.canalVolume > cap) {
      t.depth += this.canalVolume - cap;
      this.canalVolume = cap;
    }
    return { ok: true, kind, refund };
  }

  refreshDerived() {
    this.canalTiles = this.canalTiles.filter((t) => t.canal);
    this.landTiles = this.landTiles.filter((t) => !t.canal);
    this.pumps = this.pumps.filter((t) => t.pump);
    this.outlets = this.outlets.filter((t) => t.outlet);
    this.dikes = this.dikes.filter((t) => t.dike);
  }

  pushEvent(type, tile = null, extra = {}) {
    this.events.push({ type, tile, ...extra });
  }

  drainEvents() {
    const e = this.events;
    this.events = [];
    return e;
  }

  /* ==============================================================
     SIMULATION
  ============================================================== */

  /** Advance by real seconds, at the given speed multiplier. */
  update(realDt, speed) {
    if (this.outcome) return;
    this.accumulator += realDt * speed;
    let guard = 0;
    while (this.accumulator >= SIM_STEP && guard < 20) {
      this.stepFixed(SIM_STEP);
      this.accumulator -= SIM_STEP;
      guard++;
    }
    if (guard >= 20) this.accumulator = 0; // recover from a long tab stall
  }

  stepFixed(dt) {
    const dayDelta = dt / SECONDS_PER_DAY;
    this.tidePhase += dt * 0.55;
    this.advanceCalendar(dayDelta);
    this.updateWeather(dayDelta);
    this.updateSeaExchange(dayDelta);
    this.updateRain(dayDelta);
    this.flowWater(dt);
    this.updateCanals(dayDelta);
    this.updatePumps(dayDelta);
    this.updateLand(dayDelta);
    this.updateBuildings(dayDelta);
    if (isWadden(this.level)) {
      updateSilt(this, dayDelta);
      drainNewPolders(this, dayDelta);
    }
    this.updateEconomy(dayDelta);
    this.checkOutcome();

    const sea = this.effectiveSea();
    if (sea > this.stats.peakSea) this.stats.peakSea = sea;
  }

  advanceCalendar(dayDelta) {
    this.dayFraction += dayDelta;
    this.elapsedDays += dayDelta;
    while (this.dayFraction >= 1) {
      this.dayFraction -= 1;
      advanceDate(this.date);
      this.stats.daysSurvived += 1;
      this.seaLevel += this.level.seaRisePerDay;
      this.pushEvent('newDay');
    }
  }

  updateWeather(dayDelta) {
    if (this.stormState === 'calm') {
      this.stormTimer -= dayDelta;
      this.surge = Math.max(0, this.surge - dayDelta * 2);
      if (this.stormTimer <= 2) {
        this.stormState = 'warning';
        this.stormDir = this.pickStormDir(this.rand());
        const [lo, hi] = this.level.stormSurge;
        this.stormPeak = lo + this.rand() * (hi - lo);
        this.pushEvent('stormWarning', null, { dir: this.stormDir, peak: this.stormPeak });
      }
    } else if (this.stormState === 'warning') {
      this.stormTimer -= dayDelta;
      if (this.stormTimer <= 0) {
        this.stormState = 'active';
        this.stormDaysLeft = this.level.stormDays;
        this.pushEvent('stormStart', null, { peak: this.stormPeak, dir: this.stormDir });
      }
    } else {
      this.stormDaysLeft -= dayDelta;
      // Surge follows a smooth rise and fall across the storm's length.
      const total = this.level.stormDays;
      const progress = clamp(1 - this.stormDaysLeft / total, 0, 1);
      this.surge = this.stormPeak * Math.sin(progress * Math.PI);
      if (this.stormDaysLeft <= 0) {
        this.stormState = 'calm';
        // The next storm is scheduled with a little jitter.
        this.stormTimer = this.level.stormEveryDays * (0.75 + this.rand() * 0.5);
        this.surge = 0;
        this.pushEvent('stormEnd');
      }
    }

    // Rainfall in metres per day. Storms multiply it; the value also drives
    // how heavy the on-screen rain looks.
    const stormy = this.stormState === 'active';
    const warning = this.stormState === 'warning';
    const target = this.level.rainPerDay * (stormy ? 6 : warning ? 2 : 1);
    this.rainIntensity += (target - this.rainIntensity) * Math.min(1, dayDelta * 3);
  }

  /** The sea pushing against, over and through the ring dike. */
  updateSeaExchange(dayDelta) {
    for (const t of this.coastalTiles()) {
      const sea = this.seaAt(t);
      const crest = this.crestOf(t);
      const over = sea - crest;

      if (over > 0) {
        // Water pours over (or through) into the tile behind the crest.
        const inflow = over * INFLOW_RATE * dayDelta;
        t.depth += inflow;
        // Spread part of it one tile inland so breaches are felt immediately.
        const inland = this.inlandNeighbour(t);
        if (inland) inland.depth += inflow * 0.4;

        if (t.dike && !t.dike.broken) {
          t.dike.stress += over * DIKE_STRESS_RATE * (this.level.stressFactor ?? 1) * dayDelta;
          if (t.dike.stress >= DIKE_BREACH_AT) {
            t.dike.broken = true;
            t.dike.stress = DIKE_BREACH_AT;
            this.stats.breaches += 1;
            this.pushEvent('breach', t);
          }
        }
      } else if (t.dike && !t.dike.broken) {
        t.dike.stress = Math.max(0, t.dike.stress - DIKE_RELIEF_RATE * dayDelta);
      }

      // With the crest gone, a tile can also drain back out at low water.
      if ((!t.dike || t.dike.broken) && t.depth > 0) {
        const surface = t.elev + t.depth;
        if (surface > sea) {
          const out = Math.min(t.depth, (surface - sea) * INFLOW_RATE * dayDelta);
          t.depth -= out;
        }
      }
    }
  }

  /** 0..1 how hard it is raining, for the rain emitter and sky tint. */
  weatherSeverity() {
    const base = Math.max(0.004, this.level.rainPerDay);
    return clamp((this.rainIntensity / (base * 6)), 0, 1);
  }

  inlandNeighbour(t) {
    let best = null;
    let bestRing = t.ring;
    for (const [dx, dy] of N4) {
      const n = this.tile(t.x + dx, t.y + dy);
      if (n && n.base === 'land' && n.ring > bestRing) {
        best = n;
        bestRing = n.ring;
      }
    }
    return best;
  }

  /**
   * Water arriving on the land: rain from above, and groundwater from below.
   *
   * The seepage term is what gives elevation its meaning. It is proportional
   * to how far the ground lies beneath the sea outside the ring, so a deep
   * polder is permanently harder work than a shallow one, and ground that has
   * subsided asks for pumping it did not ask for last month.
   */
  updateRain(dayDelta) {
    const rain = this.rainIntensity * dayDelta;
    const sea = this.effectiveSea();
    for (let x = 0; x < this.cols; x++) {
      for (let y = 0; y < this.rows; y++) {
        const t = this.tiles[x][y];
        if (t.base !== 'land' || t.coastal) continue;
        const head = Math.max(0, sea - t.elev);
        const add = rain + GROUND_SEEP * head * dayDelta;
        if (add <= 0) continue;
        if (t.canal) this.canalVolume += add * 0.5;
        else t.depth += add;
      }
    }
  }

  /**
   * Relax water between neighbouring land tiles toward a level surface.
   * Transfers are gathered first and applied afterwards so the result does
   * not depend on iteration order.
   */
  flowWater(dt) {
    const delta = new Float32Array(this.cols * this.rows);
    const idx = (x, y) => x * this.rows + y;
    const rate = Math.min(0.45, FLOW_RATE * (dt / SIM_STEP));

    for (let x = 0; x < this.cols; x++) {
      for (let y = 0; y < this.rows; y++) {
        const a = this.tiles[x][y];
        if (a.base !== 'land' || a.canal || a.depth <= 0.0005) continue;
        const surfA = a.elev + a.depth;

        for (const [dx, dy] of N4) {
          const b = this.tile(x + dx, y + dy);
          if (!b || b.base !== 'land' || b.canal) continue;
          const surfB = b.elev + b.depth;
          if (surfA <= surfB) continue;
          // Move half the difference, capped by what is actually there.
          const move = Math.min(a.depth, (surfA - surfB) * 0.5) * rate;
          delta[idx(x, y)] -= move;
          delta[idx(b.x, b.y)] += move;
        }
      }
    }

    for (let x = 0; x < this.cols; x++) {
      for (let y = 0; y < this.rows; y++) {
        const t = this.tiles[x][y];
        if (t.base !== 'land' || t.canal) continue;
        t.depth = Math.max(0, t.depth + delta[idx(x, y)]);
        if (t.depth > FLOOD_DEPTH) {
          t.everFlooded = true;
          // Salt goes into the ground as fast as the water covers it and
          // comes out slowly, so a breach costs the polder a season's yield
          // rather than a week's.
          t.sour = 1;
        } else if (t.sour > 0) {
          t.sour = Math.max(0, t.sour - SOUR_DECAY * (dt / SECONDS_PER_DAY));
        }
        // Drained peat oxidises and the ground goes down with it. Only dry
        // ground sinks — the water is what was holding it up — so the better
        // the polder is drained the faster it needs draining, which is both
        // the real history of this landscape and the reason a finished polder
        // does not stay finished.
        // `plan`, not `use`: peat oxidises because the ground has been
        // drained, not because someone is farming it. This used to read
        // `use`, which meant the same thing back when every inland tile was
        // born with one — now that a parcel has to earn its use, testing it
        // would quietly stop the polder sinking until it was farmed.
        if (t.depth < WORKABLE_DEPTH && t.elev > SUBSIDE_FLOOR && t.plan) {
          t.elev -= SUBSIDE_RATE * (this.level.subsideFactor ?? 1) * (dt / SECONDS_PER_DAY);
        }
      }
    }
  }

  /**
   * Reclamation. Ground kept workable long enough is broken and comes into
   * production; ground left under water goes back to rush and reed. This is
   * where draining the polder turns into money, rather than every tile paying
   * from day one whatever the player does.
   */
  updateLand(dayDelta) {
    let changed = false;
    for (const t of this.landPlots) {
      // A ditch, a mill or a house takes the ground under it out of
      // production. It is not a field any more, so it does not pay like one.
      if (t.canal || t.building || t.pump || t.outlet) {
        if (t.use) { t.use = null; changed = true; }
        t.dry = 0;
        continue;
      }
      if (t.depth < WORKABLE_DEPTH) {
        t.dry = Math.min(RECLAIM_DAYS, t.dry + dayDelta);
      } else {
        const rate = t.depth >= FLOOD_DEPTH ? RECLAIM_DROWN_RATE : RECLAIM_LOSS_RATE;
        t.dry = Math.max(0, t.dry - rate * dayDelta);
      }
      if (!t.use && t.dry >= RECLAIM_DAYS) {
        t.use = t.plan;
        changed = true;
        this.pushEvent('reclaimed', t);
      } else if (t.use && t.dry <= 0) {
        t.use = null;
        changed = true;
        this.pushEvent('fieldLost', t);
      }
    }
    if (changed) this.landTiles = this.collectLandTiles();
  }

  /** Canals collect from their banks and discharge through the outlets. */
  updateCanals(dayDelta) {
    if (this.canalTiles.length === 0) return;
    const cap = this.canalCapacity();
    const surface = this.canalSurface();

    // Seepage from flooded ground into the ditch network.
    for (const c of this.canalTiles) {
      for (const [dx, dy] of N4) {
        const n = this.tile(c.x + dx, c.y + dy);
        if (!n || n.base !== 'land' || n.canal || n.depth <= 0) continue;
        if (n.elev + n.depth <= surface) continue;
        const take = Math.min(n.depth, CANAL_SEEP * dayDelta);
        n.depth -= take;
        this.canalVolume += take;
      }
    }

    // Every outlet discharges by gravity while the canal stands above the sea,
    // and pumps when it does not — whichever of the two is doing more, because
    // a keeper with a working head does not fire the boiler.
    let discharged = 0;
    for (const o of this.outlets) {
      const st = o.outlet;
      if (!st.open || st.laidUp) { st.flowing = false; continue; }
      const head = this.canalSurface() - this.seaAt(o);
      const byGravity = head > 0 ? head * SLUICE_RATE : 0;
      const byEngine = st.running ? OUTFALL_RATE : 0;
      const rate = Math.max(byGravity, byEngine);
      st.gravity = byGravity >= byEngine && byGravity > 0;
      st.flowing = rate > 0.05;
      if (rate <= 0) continue;
      const out = Math.min(this.canalVolume, rate * dayDelta);
      this.canalVolume -= out;
      discharged += out;
    }
    this.lastDischarge = dayDelta > 0 ? discharged / dayDelta : 0;

    // Overfull canals back up onto the surrounding land.
    if (this.canalVolume > cap) {
      const spill = this.canalVolume - cap;
      this.canalVolume = cap;
      const banks = [];
      for (const c of this.canalTiles) {
        for (const [dx, dy] of N4) {
          const n = this.tile(c.x + dx, c.y + dy);
          if (n && n.base === 'land' && !n.canal) banks.push(n);
        }
      }
      if (banks.length) {
        const each = spill / banks.length;
        for (const b of banks) b.depth += each;
      }
    }
    this.canalVolume = Math.max(0, this.canalVolume);

    // A full canal stops every mill in the polder at the same moment, and it
    // used to do it in silence — the same failure the laid-up warning exists
    // for, arrived at a different way. The player sees every machine go red
    // at once with nothing saying why, and the obvious guess (dig more
    // ditch) is the wrong one: the canal surface is a fill fraction, so a
    // longer network sits lower and drains worse through a gravity sluice.
    // What actually helps is more discharge, so that is what it says.
    const jammed = this.pumps.length > 0 && this.canalVolume >= cap - 0.01;
    this.canalJamDays = jammed ? this.canalJamDays + dayDelta : 0;
    if (this.canalJamDays >= CANAL_JAM_WARN_DAYS
      && this.elapsedDays - this.canalWarnedDay >= CANAL_JAM_COOLDOWN_DAYS) {
      this.canalWarnedDay = this.elapsedDays;
      this.pushEvent('canalFull');
    }
  }

  /** Pumps lift standing water off the land and into the canal network. */
  updatePumps(dayDelta) {
    const cap = this.canalCapacity();
    for (const p of this.pumps) {
      const st = p.pump;
      st.starved = false;

      if (st.laidUp) {
        st.running = false;
        continue;
      }
      if (!this.hasCanalWithin(p, PUMP_CANAL_RANGE)) {
        st.running = false;
        st.starved = true;
        continue;
      }
      if (this.canalVolume >= cap - 0.01) {
        // Nowhere to put the water: the pump is running against a full canal.
        st.running = false;
        st.starved = true;
        continue;
      }

      // Gather the wettest tiles in range, deepest first.
      const targets = [];
      for (let dx = -PUMP_RADIUS; dx <= PUMP_RADIUS; dx++) {
        for (let dy = -PUMP_RADIUS; dy <= PUMP_RADIUS; dy++) {
          if (dx * dx + dy * dy > PUMP_RADIUS * PUMP_RADIUS) continue;
          const t = this.tile(p.x + dx, p.y + dy);
          if (t && t.base === 'land' && !t.canal && t.depth > 0.002) targets.push(t);
        }
      }
      if (targets.length === 0) {
        st.running = false;
        continue;
      }
      targets.sort((a, b) => b.depth - a.depth);

      st.running = true;
      let budget = Math.min(this.pumpRate(p) * dayDelta, cap - this.canalVolume);
      for (const t of targets) {
        if (budget <= 0) break;
        const take = Math.min(t.depth, budget / Math.min(targets.length, 4));
        t.depth -= take;
        this.canalVolume += take;
        budget -= take;
      }
    }
  }

  updateBuildings(dayDelta) {
    for (const t of this.buildings) {
      const b = t.building;
      if (!b || b.lost) continue;
      const wet = t.depth > FLOOD_DEPTH;
      b.flooded = wet;
      if (wet) {
        b.damage += FLOOD_DAMAGE * dayDelta * (1 + Math.min(1, t.depth));
        if (b.damage >= 100) {
          b.damage = 100;
          b.lost = true;
          this.stats.housesLost += 1;
          this.pushEvent('buildingLost', t);
        }
      } else if (b.damage > 0) {
        b.damage = Math.max(0, b.damage - REPAIR_RATE * dayDelta);
      }
    }
  }

  /**
   * What one tile of land pays today: full yield when it is dry enough to
   * work, nothing once it is properly under, and a straight line between —
   * so a mill that takes a parcel from ankle-deep to damp is worth money the
   * same day, not eventually. Ground the sea has been over pays less until
   * the salt washes out of it.
   */
  tileYield(t) {
    if (t.base !== 'land' || t.canal || t.coastal) return 0;
    // Anything standing on a parcel takes it out of production, not only a
    // ruin: a mill's yard and a house's plot are not growing anything.
    if (t.building || t.pump || t.outlet) return 0;
    // Scenarios can be worth more or less per acre. A winter scenario runs
    // from November to March, when nothing is growing and the ground is
    // paying for hay and not for harvest — without that, holding the polder
    // through the worst season in its history made you rich.
    const rate = LAND_YIELD[t.use] * (this.level.yieldFactor ?? 1);
    if (!rate) return 0;
    const wet = (t.depth - WORKABLE_DEPTH) / (FLOOD_DEPTH - WORKABLE_DEPTH);
    const workable = 1 - clamp(wet, 0, 1);
    if (workable <= 0) return 0;
    return rate * workable * (1 - SOUR_PENALTY * t.sour);
  }

  /** The polder's whole harvest today, and what it would pay if all were dry. */
  landIncome() {
    let earned = 0;
    let potential = 0;
    for (const t of this.landTiles) {
      const rate = LAND_YIELD[t.use] * (this.level.yieldFactor ?? 1);
      if (!rate) continue;
      potential += rate;
      earned += this.tileYield(t);
    }
    return { earned, potential };
  }

  /** How much of the polder is dry enough to work, 0..1. Drives the gauge. */
  workableShare() {
    const { earned, potential } = this.landIncome();
    return potential > 0 ? earned / potential : 1;
  }

  updateEconomy(dayDelta) {
    let income = 0;
    for (const t of this.buildings) {
      const b = t.building;
      if (!b || b.lost || b.flooded) continue;
      if (b.type === 'house') income += HOUSE_TAX;
      else if (b.type === 'church') income += CHURCH_TAX;
    }
    const land = this.landIncome();
    this.dailyLand = land.earned;
    this.dailyPotential = land.potential;
    income += land.earned;

    // Only machines that are actually running cost anything to run.
    let upkeep = this.dikes.length * DIKE_UPKEEP + this.ownCanals() * CANAL_UPKEEP;
    if (isWadden(this.level)) upkeep += this.fenceCount() * FENCE_UPKEEP;
    for (const p of this.pumps) if (!p.pump.laidUp) upkeep += this.pumpUpkeep(p);
    for (const o of this.outlets) {
      if (!o.outlet.laidUp) upkeep += OUTLET_UPKEEP;
    }

    this.dailyIncome = income;
    this.dailyUpkeep = upkeep;
    this.money += (income - upkeep) * dayDelta;

    if (this.money < 0) {
      this.money = 0;
      this.layUpOne();
    } else if (this.money > 150 && income > upkeep + 10) {
      this.recommissionOne();
    }
    this.broke = this.laidUpCount() > 0;
  }

  /**
   * What the dike tool does on the tidal flat: a new stretch of sea dike on
   * marsh that touches the land ('dike'), a brushwood fence ('fence'), or
   * neither (a reason key). The fence is the first stage of a dike on the
   * Dollard, so it lives on the same tool rather than a fifth one.
   */
  dikeOnMud(t) {
    return dikeAction(this, t);
  }

  /** Canal tiles the player (or the scenario) dug, not the enclosures' ditches. */
  ownCanals() {
    return this.canalTiles.length - this.canalTiles.filter((t) => t.boardDitch).length;
  }

  fenceCount() {
    return fenceCount(this);
  }

  /** Homes standing in water right now — the number that is costing you. */
  floodedHomes() {
    let n = 0;
    for (const t of this.buildings) {
      const b = t.building;
      if (b && !b.lost && b.flooded) n++;
    }
    return n;
  }

  laidUpCount() {
    let n = 0;
    for (const p of this.pumps) if (p.pump.laidUp) n++;
    for (const o of this.outlets) if (o.outlet.laidUp) n++;
    return n;
  }

  /**
   * What happens when the money runs out.
   *
   * Stopping everything at once is a death spiral: the flooding that follows
   * drowns the houses, the houses are the income, and there is no way back.
   * So the works are laid up one at a time until the books balance: the
   * pumps first, dearest first, and the outlets last. An outlet is not one
   * machine among many — with it stopped the canal fills and every pump in
   * the polder stalls at once — so laying it up first, as this used to,
   * turned a short week into a drowned village. The last outlet running is
   * the very last thing to go. Paying off the deficit brings them back.
   */
  layUpOne() {
    let worst = null;
    let tile = null;
    let kind = 'pump';
    let cost = 0;
    for (const p of this.pumps) {
      if (!p.pump.laidUp && this.pumpUpkeep(p) > cost) {
        worst = p.pump; tile = p; kind = 'pump'; cost = this.pumpUpkeep(p);
      }
    }
    if (!worst) {
      const running = this.outlets.filter((o) => !o.outlet.laidUp);
      // The last one only once nothing else is left.
      const o = running.length > 1 ? running[running.length - 1] : running[0];
      if (o) { worst = o.outlet; tile = o; kind = 'outlet'; }
    }
    if (!worst) return;
    worst.laidUp = true;
    worst.running = false;
    this.pushEvent('laidUp', tile, { kind, left: this.laidUpCount() });
  }

  /** Bring laid-up works back once there is money again: outlets first, then the cheapest pump. */
  recommissionOne() {
    let best = null;
    let tile = null;
    let kind = 'pump';
    const o = this.outlets.find((t) => t.outlet.laidUp);
    if (o) {
      best = o.outlet; tile = o; kind = 'outlet';
    } else {
      let cost = Infinity;
      for (const p of this.pumps) {
        if (p.pump.laidUp && this.pumpUpkeep(p) < cost) {
          best = p.pump; tile = p; kind = 'pump'; cost = this.pumpUpkeep(p);
        }
      }
    }
    if (!best) return;
    best.laidUp = false;
    best.running = true;
    this.pushEvent('backOn', tile, { kind, left: this.laidUpCount() });
  }

  checkOutcome() {
    const total = this.totalHouses();
    const intact = this.intactHouses();
    if (total > 0 && intact / total < this.level.loseHouseRatio) {
      this.outcome = 'lost';
      this.pushEvent('lost');
      return;
    }
    if (!this.level.endless && dateIndex(this.date) >= this.endIndex) {
      this.outcome = intact / Math.max(1, total) >= this.level.winHouseRatio ? 'won' : 'lost';
      this.pushEvent(this.outcome);
    }
  }

  /* ==============================================================
     SAVE / RESTORE

     Map generation is seeded and deterministic, so a save only needs the
     things the player and the weather changed since. Rebuilding from the
     seed and applying those deltas reproduces the exact same polder.
  ============================================================== */

  serialize() {
    const structures = [];
    for (let x = 0; x < this.cols; x++) {
      for (let y = 0; y < this.rows; y++) {
        const t = this.tiles[x][y];
        if (t.base !== 'land') continue;
        const rec = { x, y };
        let interesting = false;
        if (t.depth > 0.001) { rec.d = Math.round(t.depth * 1000) / 1000; interesting = true; }
        // Ground level and salt are earned state, not terrain: the map is
        // regenerated from the seed on load, so without these a saved polder
        // came back un-subsided and washed clean, handing back every metre it
        // had sunk and every season of salt it was carrying.
        if (t.plan) {
          rec.v = Math.round(t.elev * 1000) / 1000;
          if (t.sour > 0.01) rec.q = Math.round(t.sour * 100) / 100;
          // Which parcels have been brought into production, and how far
          // along the rest are. Both are earned over a season of draining;
          // without them a reload handed back a polder of rough ground.
          // `w`, not `y`: this record's x and y are the tile's coordinates.
          if (t.dry > 0) rec.w = Math.round(t.dry * 10) / 10;
          if (t.use) rec.f = 1;
          interesting = true;
        }
        if (t.canal) { rec.c = 1; interesting = true; }
        if (t.dike) { rec.k = [t.dike.level, Math.round(t.dike.stress), t.dike.broken ? 1 : 0]; interesting = true; }
        if (t.pump) { rec.p = t.pump.kind || 1; interesting = true; }
        if (t.outlet) { rec.u = 1; interesting = true; }
        if (t.building && (t.building.damage > 0 || t.building.lost)) {
          rec.b = [Math.round(t.building.damage), t.building.lost ? 1 : 0];
          interesting = true;
        }
        if (interesting) structures.push(rec);
      }
    }
    return {
      levelId: this.level.id,
      version: 4,
      date: { ...this.date },
      dayFraction: this.dayFraction,
      elapsedDays: this.elapsedDays,
      money: this.money,
      seaLevel: this.seaLevel,
      surge: this.surge,
      tidePhase: this.tidePhase,
      canalVolume: this.canalVolume,
      rainIntensity: this.rainIntensity,
      storm: {
        state: this.stormState,
        timer: this.stormTimer,
        daysLeft: this.stormDaysLeft,
        peak: this.stormPeak,
        dir: this.stormDir,
      },
      stats: { ...this.stats },
      structures,
      wadden: isWadden(this.level) ? serializeWadden(this) : undefined,
    };
  }

  /** Rebuild a simulation from a save produced by `serialize`. */
  static restore(level, data) {
    const sim = new Simulation(level);
    if (!data || data.levelId !== level.id) return sim;
    // The changed coast is put back first, so the tiles the save names are
    // the right kind. A save from the old one-way Dollard does not fit this
    // map at all, so it starts afresh rather than half-loading.
    if (isWadden(level)) {
      if (data.wadden?.version !== 3) return sim;
      restoreWadden(sim, data.wadden);
    }

    // Clear everything the player could have changed, then replay the save.
    for (let x = 0; x < sim.cols; x++) {
      for (let y = 0; y < sim.rows; y++) {
        const t = sim.tiles[x][y];
        if (t.base !== 'land') continue;
        t.depth = 0;
        if (t.canal) { t.canal = false; t.elev += 1; }
        // Reclamation is replayed from the save like everything else the
        // player earned, so it is cleared first rather than left at whatever
        // the freshly generated map seeded.
        if (t.plan) { t.use = null; t.dry = 0; }
        t.dike = null;
        t.pump = null;
        t.outlet = null;
        if (t.building) { t.building.damage = 0; t.building.lost = false; t.building.flooded = false; }
      }
    }
    sim.canalTiles = [];
    sim.pumps = [];
    sim.outlets = [];
    sim.dikes = [];

    for (const r of data.structures || []) {
      const t = sim.tile(r.x, r.y);
      if (!t) continue;
      if (r.d) t.depth = r.d;
      if (r.v !== undefined) t.elev = r.v;
      if (r.q !== undefined) t.sour = r.q;
      if (r.w !== undefined) t.dry = r.w;
      if (r.f && t.plan) { t.use = t.plan; t.dry = Math.max(t.dry, RECLAIM_DAYS); }
      if (r.c) sim.makeCanal(t);
      if (r.k) {
        t.dike = { level: r.k[0], stress: r.k[1], broken: !!r.k[2] };
        sim.dikes.push(t);
      }
      if (r.p) {
        const kind = typeof r.p === 'string' ? r.p : sim.machineAt().machine;
        t.pump = { running: true, starved: false, kind };
        sim.pumps.push(t);
      }
      // `u` marks an outlet; it once held the outlet's stage, and `s` and `o`
      // are the separate sluice and outfall of save version 2. Outlets have a
      // single stage now, so any of them restores as one.
      if (r.u !== undefined || r.o || r.s) {
        t.outlet = { open: true, running: true, flowing: false };
        sim.outlets.push(t);
      }
      if (r.b && t.building) {
        t.building.damage = r.b[0];
        t.building.lost = !!r.b[1];
      }
    }

    sim.date = { ...data.date };
    sim.dayFraction = data.dayFraction || 0;
    sim.elapsedDays = data.elapsedDays || 0;
    sim.money = data.money;
    sim.seaLevel = data.seaLevel;
    sim.surge = data.surge || 0;
    sim.tidePhase = data.tidePhase || 0;
    sim.canalVolume = data.canalVolume || 0;
    sim.rainIntensity = data.rainIntensity ?? level.rainPerDay;
    if (data.storm) {
      sim.stormState = data.storm.state;
      sim.stormTimer = data.storm.timer;
      sim.stormDaysLeft = data.storm.daysLeft;
      sim.stormPeak = data.storm.peak;
      sim.stormDir = data.storm.dir;
    }
    if (data.stats) sim.stats = { ...sim.stats, ...data.stats };
    // Which parcels are in production came from the save, not the seed, so
    // the earning list has to be rebuilt from what was just replayed.
    sim.landTiles = sim.collectLandTiles();
    sim.refreshDerived();
    return sim;
  }

  /** Final score: mostly about what you saved, a little about how you did it. */
  score() {
    // An endless coast is scored by the land won from the sea, in hectares:
    // the number the leaderboard ranks.
    if (this.level.endless) return hectares(this);
    const total = Math.max(1, this.totalHouses());
    const intact = this.intactHouses();
    const survival = (intact / total) * 1000;
    const days = this.stats.daysSurvived * 3;
    const thrift = Math.min(500, this.money / 4);
    const damage = this.stats.breaches * 40;
    const mult = { beemster: 1, winter: 1.4, delta: 1.8 }[this.level.id] ?? 1;
    return Math.max(0, Math.round((survival + days + thrift - damage) * mult));
  }
}
