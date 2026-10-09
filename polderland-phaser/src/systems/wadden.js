/**
 * The Dollard: an endless coast that is won from the sea a polder at a time.
 *
 * On the Groningen shore of the Dollard the land was not drained from a lake
 * but grown out of the mud. Brushwood fences (kwelderwerken) staked out on
 * the tidal flat in front of the sea dike slowed the tide enough for its silt
 * to settle; over the years the flat rose to salt marsh (kwelder), and once
 * the marsh stood high enough a new dike was thrown round it and the old sea
 * dike became an inland road. The Johannes Kerkhovenpolder was enclosed that
 * way in 1877, in front of the Reiderwolderpolder of 1862, and the Carel
 * Coenraadpolder in front of it again in 1924.
 *
 * The map is a stretch of coast. Its whole south is old land; the polder
 * stands out from it north into the Dollard, ringed by its dike on the three seaward
 * sides, with a belt of tidal flat all round. The player stakes fences on the
 * flat, and fenced mud rises to salt marsh. A new dike can be built on marsh
 * that touches the land; the moment the new dikes and the old ones cut a
 * stretch of flat off from the open sea, whatever they enclose becomes
 * polder, of any shape and on any side. The old sea dike behind it becomes
 * inland ground, the flat moves out in front of the new coast, and the sea
 * keeps rising, so it never ends.
 *
 * Everything here is a function of the simulation it is handed, so the
 * scenarios that do not use it are untouched.
 */

import { mulberry32, clamp } from '../helpers.js';

/** How far out from the sea dike the tidal flat reaches. */
export const MUD_BELT = 3;
/** Mud at or above this (m NAP) is salt marsh, ripe to be diked. */
export const MARSH_AT = 0.2;
/** Silt stops building at this height: marsh does not grow into a dune. */
const SILT_CAP = 0.45;
/** Metres per day: settling on open flat, and in the lee of a fence. */
const SILT_OPEN = 0.004;
const SILT_FENCED = 0.022;
/** Metres per day a storm scours off mud no fence is holding. */
const STORM_SCOUR = 0.03;
/** Depth of the flat just off the dike, and how it shelves further out. */
const FLAT_TOP = -0.8;
const FLAT_SHELF = 0.15;
/** New ground that brings a sluice of its own with it, in tiles. */
const SLUICE_PER_TILES = 30;
/** Hectares of land a tile stands for, for the score. */
export const HA_PER_TILE = 4;
/** What one new stretch of sea dike on the marsh costs: it goes in at level 1. */
export const NEW_DIKE_COST = 300;
/** Field ditches: how fast young polder drains, and what storage it adds. */
const DITCH_RATE = 0.35;
const DITCH_STORAGE = 0.8;
/** Metres a day young clay settles, and how low it goes. */
const KLINK_RATE = 0.0018;
const KLINK_FLOOR = -1.9;
const N4 = [[1, 0], [-1, 0], [0, 1], [0, -1]];

export const isWadden = (level) => level.coast === 'wadden';

/** A blank tile of the given kind at (x, y). */
function blankTile(x, y, base, elev) {
  return {
    x, y, ring: 0, base, elev, depth: 0, canal: false, dike: null, pump: null,
    outlet: null, building: null, prop: null, tex: (x * 7 + y * 3) % 4,
    everFlooded: false, sour: 0, fence: false,
    coastal: false, edges: undefined, exposure: undefined,
    plan: null, use: null, parcel: null, dry: 0, won: false, floor: undefined,
  };
}

/**
 * The old land lies south of a shore that runs straight across the screen
 * (x + y constant on the isometric grid), and on past the map's edges.
 */
export const isOldLand = (level, x, y) => x + y >= level.landLine;

/**
 * Lay the starting map out over what buildTerrain made: the old land of
 * Groningen across the whole south of the map, the polder standing out from it
 * into the Dollard with its dike on the three sides that face the sea, open
 * water everywhere else, and the flat round the polder.
 */
export function layoutWadden(sim) {
  const { polderLeft: X0, polderRight: X1, polderTop: Y0, polderBottom: Y1 } = sim.level;
  const rand = mulberry32(sim.level.seed * 13 + 5);
  sim.enclosures = 0;
  for (let x = 0; x < sim.cols; x++) {
    for (let y = 0; y < sim.rows; y++) {
      const t = sim.tiles[x][y];
      if (isOldLand(sim.level, x, y)) {
        // The old land: farms and trees nobody has to pump.
        Object.assign(t, blankTile(x, y, 'old', 1));
        const r = rand();
        t.prop = r < 0.18 ? 'tree' : r < 0.3 ? 'cow' : null;
      } else if (x >= X0 && x <= X1 && y >= Y0 && y <= Y1) {
        const ring = x === X0 || x === X1 || y === Y0 || y === Y1;
        // Keep the generated floor inside; a tile that was sea or ring on
        // the generic map gets an ordinary polder depth.
        const elev = !ring && t.base === 'land' && !t.coastal ? t.elev : -1.5;
        Object.assign(t, {
          base: 'land', coastal: ring, elev: ring ? 0 : elev, canal: false, dike: null,
          pump: null, outlet: null, building: null, fence: false, won: false,
        });
        t.exposure = ring ? 0 : undefined;
        if (ring) { t.plan = null; t.use = null; t.parcel = null; t.prop = null; }
      } else {
        Object.assign(t, blankTile(x, y, 'sea', -5));
      }
    }
  }
  sim.focusX = (X0 + X1) / 2 - 2;
  sim.focusY = (Y0 + Y1) / 2 - 2;
  sim.centre = { x: Math.floor((X0 + X1) / 2), y: Math.floor((Y0 + Y1) / 2) };
  retag(sim);
  belt(sim);
  retag(sim);
  sim.assignParcels();
}

/** Tiles in every direction, for the rare loop that needs all of them. */
function* allTiles(sim) {
  for (let x = 0; x < sim.cols; x++) for (let y = 0; y < sim.rows; y++) yield sim.tiles[x][y];
}

/**
 * Recompute what depends on the coast: which tiles are coastal and which way
 * they face, the ring number (distance from the coast) used for sea shading
 * and canal routing, and the cached lists.
 */
export function retag(sim) {
  const coastal = [];
  for (const t of allTiles(sim)) {
    if (t.base === 'land' && (t.coastal || t.dike)) {
      t.edges = sim.outwardEdges(t);
      t.coastal = t.edges.length > 0;
      if (t.coastal) coastal.push(t);
    }
  }
  // Distance inland from the coast, for land; next to land or not, for sea.
  const dist = new Map();
  const queue = [...coastal];
  for (const t of coastal) dist.set(t, 0);
  while (queue.length) {
    const t = queue.shift();
    for (const [dx, dy] of N4) {
      const n = sim.tile(t.x + dx, t.y + dy);
      if (!n || n.base !== 'land' || dist.has(n)) continue;
      dist.set(n, dist.get(t) + 1);
      queue.push(n);
    }
  }
  for (const t of allTiles(sim)) {
    if (t.base === 'sea') {
      let near = 0;
      for (let dx = -1; dx <= 1; dx++) {
        for (let dy = -1; dy <= 1; dy++) {
          const n = sim.tile(t.x + dx, t.y + dy);
          if (n && n.base !== 'sea') near = 1;
        }
      }
      t.ring = near;
    } else if (t.base === 'land') {
      t.ring = 2 + (dist.get(t) ?? 6);
    }
  }
  sim.mudTiles = [...allTiles(sim)].filter((t) => t.base === 'mud');
}

/**
 * Keep a belt of tidal flat in front of every stretch of sea dike: sea within
 * MUD_BELT of the coast becomes flat, shelving deeper further out.
 */
export function belt(sim) {
  const coast = [...allTiles(sim)].filter((t) => t.base === 'land' && t.coastal);
  const seen = new Map();
  const queue = [];
  for (const t of coast) { seen.set(t, 0); queue.push(t); }
  while (queue.length) {
    const t = queue.shift();
    const d = seen.get(t);
    if (d >= MUD_BELT) continue;
    for (const [dx, dy] of N4) {
      const n = sim.tile(t.x + dx, t.y + dy);
      if (!n || seen.has(n) || (n.base !== 'sea' && n.base !== 'mud')) continue;
      seen.set(n, d + 1);
      queue.push(n);
      if (n.base === 'sea') {
        const elev = FLAT_TOP - d * FLAT_SHELF;
        Object.assign(n, blankTile(n.x, n.y, 'mud', elev));
        n.floor = elev - 0.2;
      }
    }
  }
  sim.mudTiles = [...allTiles(sim)].filter((t) => t.base === 'mud');
}

/**
 * Whether a tile of flat is held by a fence: its own, and only its own. A
 * fence that sped up the tiles round it too made the player work out which
 * tiles to skip; one fence, one tile of marsh, is a rule that needs no maths.
 */
export const fencedNear = (sim, t) => t.base === 'mud' && !!t.fence;

/**
 * Young polders drain themselves. Their field ditches (sloten) carry the rain
 * off high new clay into the canal network, as long as the water stands
 * higher than the canal does: the gravity drainage that kept a new Dollard
 * polder dry through its own sluice. Old ground sinks below the canal over
 * the years and needs pumps again.
 */
export function drainNewPolders(sim, dayDelta) {
  if (!sim.wonTiles) return;
  // Young clay settles (klink) as it dries out: fast in the first years,
  // until it lies as low as the older polder behind it. A new polder drains
  // itself only while it stands high; after that it wants canals and pumps
  // like the rest.
  for (const t of sim.wonTiles) {
    if (t.base === 'land' && !t.coastal && !t.canal && t.elev > KLINK_FLOOR) {
      t.elev = Math.max(KLINK_FLOOR, t.elev - KLINK_RATE * dayDelta);
    }
  }
  if (!sim.canalTiles.length) return;
  const surface = sim.canalSurface();
  const cap = sim.canalCapacity();
  for (const t of sim.wonTiles) {
    if (t.base !== 'land' || t.canal || t.coastal || t.depth <= 0) continue;
    if (t.elev + t.depth <= surface || sim.canalVolume >= cap) continue;
    const take = Math.min(t.depth, DITCH_RATE * dayDelta);
    t.depth -= take;
    sim.canalVolume += take;
  }
}

/** True while a storm tide stands over the flats. */
export const flatsDrowned = (sim) => sim.stormState === 'active' && sim.surge > 0.3;

/**
 * Silt settles on the flat, fast where a fence holds the tide. A storm puts
 * the flat under water: it stops growing, and scours where it is not fenced.
 */
export function updateSilt(sim, dayDelta) {
  const storm = flatsDrowned(sim);
  for (const t of sim.mudTiles || []) {
    const held = fencedNear(sim, t);
    const wasMarsh = t.elev >= MARSH_AT;
    if (storm) {
      // Under a storm tide the flat is sea: nothing settles, and what no
      // fence holds is scoured away.
      if (!held) t.elev = Math.max(t.floor ?? FLAT_TOP - 0.6, t.elev - STORM_SCOUR * dayDelta);
    } else {
      t.elev = Math.min(SILT_CAP, t.elev + (held ? SILT_FENCED : SILT_OPEN) * dayDelta);
    }
    // Which stretches of marsh there are is cached (marshPatch); a tile
    // crossing into or out of marsh changes them.
    if ((t.elev >= MARSH_AT) !== wasMarsh) sim.marshVersion = (sim.marshVersion || 0) + 1;
  }
}

export const isMarsh = (t) => t && t.base === 'mud' && t.elev >= MARSH_AT;

const isWater = (n) => !!n && (n.base === 'sea' || n.base === 'mud');
/** Ground a new dike can be joined on to: the old land, or the sea dike. */
const isShore = (n) => !!n && (n.base === 'old' || (n.base === 'land' && (n.coastal || !!n.dike)));

/**
 * The stretch of salt marsh one click of the dike tool dikes in: the marsh
 * connected to the clicked tile, less any spur of it a single tile wide.
 * Its tiles that face open water get the new dike; the rest become polder
 * behind it. Returns { tiles, walls }, or a reason key when there is none.
 *
 * Laid a tile at a time, new dike stood out from the old as a row of teeth,
 * each one a block with water on three sides, until the row was closed. A
 * stretch at once has no teeth, and spurs are left out for the same reason.
 * Worked out for every tile of marsh at once and cached until the marsh
 * changes, because the tool's preview asks about every tile every frame.
 */
export function marshPatch(sim, t) {
  if (!isMarsh(t)) return null;
  if (sim.patchCacheVersion !== sim.marshVersion || !sim.patchCache) {
    sim.patchCache = new Map();
    sim.patchCacheVersion = sim.marshVersion;
  }
  if (!sim.patchCache.has(t)) computePatches(sim, t);
  return sim.patchCache.get(t);
}

function computePatches(sim, start) {
  const flood = (from, inside) => {
    const seen = new Set([from]);
    const queue = [from];
    while (queue.length) {
      const c = queue.shift();
      for (const [dx, dy] of N4) {
        const n = sim.tile(c.x + dx, c.y + dy);
        if (n && !seen.has(n) && inside(n)) { seen.add(n); queue.push(n); }
      }
    }
    return seen;
  };
  const marsh = flood(start, isMarsh);
  const open = (p, set) => N4.filter(([dx, dy]) => {
    const n = sim.tile(p.x + dx, p.y + dy);
    return isWater(n) && !set.has(n);
  }).length;
  // Prune spurs: a tile with water on three sides stands out alone.
  const kept = new Set(marsh);
  for (let changed = true; changed;) {
    changed = false;
    for (const p of [...kept]) if (open(p, kept) >= 3) { kept.delete(p); changed = true; }
  }
  for (const p of marsh) if (!kept.has(p)) sim.patchCache.set(p, 'dike.narrow');
  for (const p of kept) {
    if (sim.patchCache.has(p)) continue;
    const comp = flood(p, (n) => kept.has(n));
    const tiles = [...comp];
    const joined = tiles.some((c) => N4.some(([dx, dy]) => isShore(sim.tile(c.x + dx, c.y + dy))));
    const result = joined ? { tiles, walls: tiles.filter((c) => open(c, comp) > 0) } : 'dike.join';
    for (const c of tiles) sim.patchCache.set(c, result);
  }
}

/** True when some salt marsh by the coast is ready to be diked in. */
export function ripe(sim) {
  return (sim.mudTiles || []).some((t) => {
    const patch = marshPatch(sim, t);
    return !!patch && typeof patch === 'object';
  });
}

/**
 * What the dike tool does on a tile of flat: 'dike' (dike in the stretch of
 * marsh it belongs to), 'fence', or a reason key.
 */
export function dikeAction(sim, t) {
  if (t.base !== 'mud') return 'no.fence.flat';
  if (isMarsh(t)) {
    const patch = marshPatch(sim, t);
    return typeof patch === 'string' ? patch : 'dike';
  }
  return t.fence ? 'no.occupied' : 'fence';
}

/** What diking in the marsh at `t` costs: one stretch of new dike per wall tile. */
export const marshDikeCost = (sim, t) => {
  const patch = marshPatch(sim, t);
  return patch && typeof patch === 'object' ? NEW_DIKE_COST * patch.walls.length : Infinity;
};

/**
 * Dike in the stretch of marsh at `t`: new sea dike along its open side,
 * polder behind it, and the old dike behind that turned to ground.
 */
export function buildMarshDike(sim, t) {
  const patch = marshPatch(sim, t);
  if (!patch || typeof patch !== 'object') return;
  for (const w of patch.walls) {
    Object.assign(w, blankTile(w.x, w.y, 'land', clamp(w.elev, 0, 0.3)));
    w.coastal = true;
    w.exposure = 0;
    w.newLand = true;
    w.dike = { level: 1, stress: 0, broken: false };
    sim.dikes.push(w);
  }
  // The rest of the stretch has no open water left beside it: the
  // enclosure takes it in as polder, with the old dike behind.
  enclose(sim, patch.walls);
}

function refreshLists(sim) {
  sim.refreshDerived();
  sim.dikes = [...allTiles(sim)].filter((t) => t.dike);
  sim.outlets = [...allTiles(sim)].filter((t) => t.outlet);
  sim.wonTiles = [...allTiles(sim)].filter((t) => t.won);
  sim.landPlots = sim.collectLandPlots();
  sim.landTiles = sim.collectLandTiles();
  sim.coast = sim.collectCoastalTiles();
}

/**
 * Whatever the dikes have cut off from the open sea becomes polder. Found by
 * flooding outward from the edges of the map through sea and flat: any flat
 * or sea the flood cannot reach is enclosed. Returns whether it enclosed any.
 */
export function enclose(sim, walls = []) {
  const reach = new Set();
  const queue = [];
  for (const t of allTiles(sim)) {
    const edge = t.x === 0 || t.y === 0 || t.x === sim.cols - 1 || t.y === sim.rows - 1;
    if (edge && (t.base === 'sea' || t.base === 'mud')) { reach.add(t); queue.push(t); }
  }
  while (queue.length) {
    const t = queue.shift();
    for (const [dx, dy] of N4) {
      const n = sim.tile(t.x + dx, t.y + dy);
      if (!n || reach.has(n) || (n.base !== 'sea' && n.base !== 'mud')) continue;
      reach.add(n);
      queue.push(n);
    }
  }
  const cut = [...allTiles(sim)].filter((t) => (t.base === 'sea' || t.base === 'mud') && !reach.has(t));

  const rand = mulberry32(sim.level.seed * 31 + sim.enclosures * 977);
  const USES = ['pasture', 'pasture', 'pasture', 'plough', 'plough', 'tulipYellow'];
  const use = USES[Math.floor(rand() * USES.length)];
  const parcel = `wad${sim.enclosures}`;
  const toLand = (t, elev) => {
    Object.assign(t, blankTile(t.x, t.y, 'land', elev));
    Object.assign(t, { plan: use, parcel, tex: Math.floor(rand() * 4), won: true });
  };
  // Marsh becomes young clay; any flat or sea caught inside unripe is a wet
  // hollow, lower, that will want pumping.
  for (const t of cut) toLand(t, t.base === 'mud' ? clamp(t.elev - 0.3, -1.2, 0.2) : -1.5);

  // Dikes that no longer face the sea become ground.
  retag(sim);
  const gained = walls.length + cut.length + settleInland(sim, toLand);

  // Every new polder on the Dollard drained through a sluice (zijl) of its
  // own in the new sea dike. Without them the one sluice the level starts
  // with had to carry the rain off every hectare ever won, and in the end
  // the canal backed up over the old village. One comes with each so much
  // new ground, in the middle of the new dike.
  sim.sluiceCredit = (sim.sluiceCredit || 0) + gained;
  const sites = walls.filter((w) => w.coastal && w.dike && !w.outlet);
  while (sim.sluiceCredit >= SLUICE_PER_TILES && sites.length) {
    const site = sites.splice(Math.floor(sites.length / 2), 1)[0];
    site.outlet = { open: true, running: true, flowing: false };
    sim.sluiceCredit -= SLUICE_PER_TILES;
  }

  // A farm on the new ground: the Groningen kop-hals-romp that followed every
  // enclosure onto the new clay.
  const spots = cut.filter((t) => !t.building);
  if (spots.length >= 4) {
    const farm = spots[Math.floor(rand() * spots.length)];
    farm.building = { type: 'house', variant: Math.floor(rand() * 8), damage: 0, lost: false, flooded: false };
    sim.buildings.push(farm);
  }

  sim.ditchStorage = (sim.ditchStorage || 0) + DITCH_STORAGE * gained;
  sim.stats.landWon = (sim.stats.landWon || 0) + gained;
  if (gained > 0) sim.enclosures += 1;
  retag(sim);
  belt(sim);
  retag(sim);
  refreshLists(sim);
  sim.marshVersion = (sim.marshVersion || 0) + 1;
  if (gained > 0) sim.pushEvent('enclosed', null, { landWon: sim.stats.landWon, gained });
  return cut.length > 0;
}

/**
 * Dikes that no longer face the sea are inland now: the old sea dike becomes
 * ground (a road on the old crest, in life), and any sluice in it moves out
 * to the nearest stretch of sea dike that has none. Returns how many.
 */
function settleInland(sim, toLand) {
  let n = 0;
  for (const t of allTiles(sim)) {
    if (!t.dike || t.coastal) continue;
    const sluice = t.outlet;
    const building = t.building;
    toLand(t, -0.2);
    t.building = building;
    n += 1;
    if (sluice) {
      const spots = [...allTiles(sim)].filter((c) => c.coastal && c.dike && !c.outlet)
        .sort((a, b) => (Math.abs(a.x - t.x) + Math.abs(a.y - t.y)) - (Math.abs(b.x - t.x) + Math.abs(b.y - t.y)));
      if (spots[0]) spots[0].outlet = sluice;
    }
  }
  return n;
}

/** The endless score: hectares won, the leaderboard's number. */
export const hectares = (sim) => (sim.stats.landWon || 0) * HA_PER_TILE;

/** Brushwood fences standing on the flat, for upkeep. */
export const fenceCount = (sim) => (sim.mudTiles || []).filter((t) => t.fence).length;

/**
 * Save: every tile the coast has changed. Land the sea gave up (with its
 * farm, if it got one), the new dikes, and the whole flat as it stands.
 */
export function serializeWadden(sim) {
  const land = [];
  const mud = [];
  for (const t of allTiles(sim)) {
    if (t.base === 'land' && (t.won || t.newLand)) {
      land.push([t.x, t.y, Math.round(t.elev * 1000) / 1000, t.won ? 1 : 0, t.plan || '', t.parcel || '',
        t.coastal ? 1 : 0, t.building && t.building.type === 'house' && t.won ? t.building.variant : -1]);
    } else if (t.base === 'mud') {
      mud.push([t.x, t.y, Math.round(t.elev * 1000) / 1000, t.fence ? 1 : 0]);
    }
  }
  return {
    version: 3, enclosures: sim.enclosures, landWon: sim.stats.landWon || 0,
    ditchStorage: sim.ditchStorage || 0, sluiceCredit: sim.sluiceCredit || 0, land, mud,
  };
}

/**
 * A save keeps the flat as it stood, so a game started when the belt was four
 * tiles wide came back four wide however narrow the belt is now. Give back to
 * the sea any flat beyond MUD_BELT of the coast that nobody is working: no
 * fence, not yet marsh. Whatever the player fenced or raised stays, and the
 * distance is measured through the flat as it was, so trimming one tile
 * cannot move the line for the next.
 */
function trimBelt(sim) {
  const dist = new Map();
  const queue = [];
  for (const t of allTiles(sim)) {
    if (t.base === 'land' && t.coastal) { dist.set(t, 0); queue.push(t); }
  }
  while (queue.length) {
    const t = queue.shift();
    const d = dist.get(t);
    for (const [dx, dy] of N4) {
      const n = sim.tile(t.x + dx, t.y + dy);
      if (!n || dist.has(n) || n.base !== 'mud') continue;
      dist.set(n, d + 1);
      queue.push(n);
    }
  }
  for (const [t, d] of dist) {
    if (t.base !== 'mud' || d <= MUD_BELT || t.fence || t.elev >= MARSH_AT) continue;
    Object.assign(t, blankTile(t.x, t.y, 'sea', -5));
  }
}

/** Load: put the changed coast back before the rest of the save is replayed. */
export function restoreWadden(sim, data) {
  if (!data || data.version !== 3) return;
  for (const [x, y, elev, won, plan, parcel, coastal, house] of data.land || []) {
    const t = sim.tile(x, y);
    if (!t) continue;
    Object.assign(t, blankTile(x, y, 'land', elev));
    Object.assign(t, { won: !!won, newLand: !won, plan: plan || null, parcel: parcel || null, coastal: !!coastal });
    if (coastal) t.exposure = 0;
    if (house >= 0 && !sim.buildings.includes(t)) {
      t.building = { type: 'house', variant: house, damage: 0, lost: false, flooded: false };
      sim.buildings.push(t);
    }
  }
  for (const [x, y, elev, fence] of data.mud || []) {
    const t = sim.tile(x, y);
    if (!t) continue;
    if (t.base !== 'mud') Object.assign(t, blankTile(x, y, 'mud', elev));
    t.elev = elev;
    t.fence = !!fence;
  }
  trimBelt(sim);
  sim.enclosures = data.enclosures || 0;
  sim.stats.landWon = data.landWon || 0;
  sim.ditchStorage = data.ditchStorage || 0;
  sim.sluiceCredit = data.sluiceCredit || 0;
  sim.marshVersion = (sim.marshVersion || 0) + 1;
  retag(sim);
  refreshLists(sim);
}
