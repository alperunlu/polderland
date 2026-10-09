/**
 * Tuning constants. Units are deliberately physical: elevations and water
 * levels are in metres relative to NAP (Dutch ordnance datum), money is in
 * guilders, and time runs in days — which makes the numbers readable and the
 * balance arguable rather than arbitrary.
 */

/* ---- Map ---- */
export const GRID = 16;
/** Width of the open-sea border around the island, in tiles. */
export const SEA_RING = 2;
/** Pixels of screen height per metre of elevation. */
export const PX_PER_M = 6;

/* ---- Water ---- */
/** Natural crest of an undiked coastal tile, above its own ground level. */
export const NATURAL_CREST = 0.5;
/** Crest height of a dike above the tile it stands on, per upgrade level. */
export const DIKE_CREST = [2.0, 3.4, 4.8];
/**
 * Metres of water admitted per day, per metre of overtopping. Deliberately
 * violent: half a metre over the crest should feel like an emergency.
 */
export const INFLOW_RATE = 9.0;
/** How fast neighbouring tiles equalise their water surface (0..1 per tick). */
export const FLOW_RATE = 0.22;
/** Depth at which a tile counts as flooded for buildings and scoring. */
export const FLOOD_DEPTH = 0.35;
/** Damage per day taken by a building standing in water. */
export const FLOOD_DAMAGE = 8;
/** Damage repaired per day once a building is dry again. */
export const REPAIR_RATE = 7;

/* ---- Dikes ---- */
/**
 * Stress accumulated per day per metre of overtopping. High enough that a
 * storm which beats the crest for three days will open the dike: before this
 * was tuned, a breach was something only the last scenario ever saw, and the
 * whole stress-and-alarm loop went unused where most players are.
 */
export const DIKE_STRESS_RATE = 80;
/** Stress relieved per day when the sea is below the crest. */
export const DIKE_RELIEF_RATE = 25;
/** A dike breaches once stress passes this. */
export const DIKE_BREACH_AT = 100;

/* ---- Pumps ---- */
/** Tile radius a pumping station can reach. */
export const PUMP_RADIUS = 3;
/** Tile-metres of water lifted per day, spread over the tiles in range. */
export const PUMP_RATE = 3.0;
/** A pump only runs if a canal tile is within this many tiles. */
export const PUMP_CANAL_RANGE = 2;

/* ---- Canals & outlets ---- */
/** Metres of water one canal tile can hold before backing up. */
export const CANAL_CAPACITY = 3.2;
/** Water drawn per day from each flooded tile that stands above the canal. */
export const CANAL_SEEP = 0.5;
/**
 * An outlet is a sluice with a machine on its head — a mill in the centuries
 * that had mills, an engine in the ones that had engines — and it drains from
 * the day it is built. It pumps at a flat rate whatever the sea is doing, and
 * lets the water run out by gravity instead whenever that is faster, because
 * no keeper ever worked the machine when the tide would do it for nothing.
 *
 * It used to be two purchases: a bare gravity sluice, and then the machine
 * built onto it later. The sluice alone could not keep up with the tide, so
 * the polder drowned for every player who had not found the second step, and
 * finding it was the whole difficulty of the first scenario.
 */
export const SLUICE_RATE = 14.0;
export const OUTFALL_RATE = 9.0;
/**
 * A canal pinned at its ceiling stalls every mill in the polder at once, so
 * it warns — but only after it has stayed there long enough to be a problem
 * rather than a passing peak, and then only occasionally, because a warning
 * that fires every day is one the player learns to ignore.
 */
export const CANAL_JAM_WARN_DAYS = 0.6;
export const CANAL_JAM_COOLDOWN_DAYS = 25;
/**
 * Water surface of the canal network when empty and when full. The network
 * is embanked and sits well above the polder floor, which is why gravity
 * drainage works at low tide and fails once the sea has risen past it.
 */
export const CANAL_BED = -1.2;
export const CANAL_TOP = 0.6;

/* ---- Economy (per day) ---- */
/**
 * The polder's income is the land it keeps dry. These used to be multiplied by
 * a per-windmill bonus, which was a fiction — a poldermolen grinds no corn, it
 * lifts water — so the bonus is gone and the rates carry what it carried.
 */
/**
 * What a tile of drained land pays per day, by what is grown on it.
 *
 * This is the point of a polder, and until now the game did not model it: a
 * house paid the same tax whether the fields around it were meadow or lake,
 * so every pump, canal and dike the player built was pure cost and the only
 * economic feedback in the game was losing a house. Land yield is what makes
 * draining a parcel pay, and what makes a flood cost something the same day
 * rather than only once a home finally goes under.
 *
 * Tulip beds pay best and are worth draining first — the bulb trade was the
 * reason a lot of this ground was worth reclaiming at all.
 */
/* ---- Reclamation ---- */
/**
 * Land is not farmland because the map says so. A new polder floor is rough,
 * reedy ground worth nothing, and it becomes pasture or arable by being kept
 * dry long enough to be worth breaking — which is what the player is actually
 * doing when they drain it, and what the income should therefore be paid for.
 *
 * One counter per parcel, in days, running 0..RECLAIM_DAYS. It fills while the
 * ground is workable and drains while it is wet, so a parcel that floods
 * briefly keeps most of its progress and one left under water loses the lot.
 * The hysteresis is the point: reclaiming is slow, losing it is faster, and
 * neither happens the instant a tile crosses a threshold.
 */
export const RECLAIM_DAYS = 14;
/** Progress lost per day of standing water short of a flood. */
export const RECLAIM_LOSS_RATE = 1.4;
/** Progress lost per day once the water is deep enough to drown the crop. */
export const RECLAIM_DROWN_RATE = 3.5;

export const LAND_YIELD = {
  pasture: 2.1,
  plough: 3.2,
  tulipRed: 5.0,
  tulipYellow: 5.0,
};

/** Standing water below this is a wet field; above it, no crop at all. */
export const WORKABLE_DEPTH = 0.06;

/**
 * Salt. Ground the sea has stood on is sour for a long time afterwards, which
 * is why a breach was a disaster for years and not for a week. `SOUR_DECAY`
 * is how much of that wears off per day; `SOUR_PENALTY` how much of the
 * yield it takes at its worst.
 */
/**
 * Subsidence. Peat that is drained oxidises and compacts, so the ground of a
 * working polder sinks — which is why Dutch drainage is not a job you finish
 * but one you keep paying for, and why the country's deepest land is its
 * oldest reclaimed land. In the game it is what stops a solved polder from
 * being solved: the mills that were enough last month are not enough now,
 * and money has somewhere to go all the way to the end of a scenario.
 *
 * Metres per day of dry ground, and the floor it will not sink past.
 */
/**
 * Groundwater pressing up through the polder floor, per metre the ground lies
 * below the sea outside, per day. Without this the depth of a polder is only
 * a colour on the map: rain falls at the same rate on land one metre down and
 * land four metres down, so subsidence costs nothing and a drained polder
 * stays drained forever. With it, the deeper the polder the harder it has to
 * be pumped — which is the whole bargain of living below the sea.
 */
export const GROUND_SEEP = 0.0021;

export const SUBSIDE_RATE = 0.006;
export const SUBSIDE_FLOOR = -4.5;

export const SOUR_DECAY = 0.025;
export const SOUR_PENALTY = 0.75;

/**
 * Tax on the buildings. Deliberately the minority of the polder's income now
 * that the land pays: with tax dominant, a player could let the whole polder
 * go under and still bank money every day, which is precisely the complaint
 * that the works had no effect on anything.
 */
export const HOUSE_TAX = 5.4;
export const CHURCH_TAX = 8.8;
/**
 * Running costs. Deliberately heavy: a polder whose works cost a quarter of
 * what the land pays is a polder you finish building and then watch, with the
 * treasury filling up and nothing to decide. A mill needed a miller living in
 * it and an engine needed coal, and at these rates every additional one is a
 * real choice rather than an obvious yes.
 */
export const PUMP_UPKEEP = 8;
export const DIKE_UPKEEP = 0.9;
/** Upkeep per outlet: the keeper, and the coal or the millwright. */
export const OUTLET_UPKEEP = 15;
export const CANAL_UPKEEP = 0.5;

/* ---- Build costs ---- */
/**
 * Each extra canal tile costs a little more than the last. Storage alone must
 * never out-compete actually draining the polder.
 */
/**
 * Each of these costs more than the last one did.
 *
 * The canal already worked this way; mills and outlets now do too, for the
 * same reason and the historical one: the good sites go first. The first mill
 * stands where the ground falls toward the water of its own accord, the sixth
 * needs its site dug out and its water carried further, and by then you are
 * bidding against yourself for millwrights. In play it is what stops the
 * back half of a scenario being a formality once the polder pays — the
 * treasury had nothing left to buy, which is a dull way to win.
 *
 * Dikes are deliberately excluded: the ring is already priced per tile, so it
 * charges for scale without needing a curve on top.
 */
export const CANAL_COST_GROWTH = 1.03;
export const PUMP_COST_GROWTH = 1.08;
export const OUTLET_COST_GROWTH = 1.18;

export const COST = {
  dike: 140,
  dikeUpgrade: [0, 230, 460],
  pump: 480,
  canal: 110,
  outlet: 980,
  repairDike: 90,
};

/* ---- Time ---- */
/** Real seconds per in-game day at 1x speed. */
export const SECONDS_PER_DAY = 2.6;
export const SPEEDS = [1, 2, 4];
/** Fixed simulation step, in seconds. Keeps the water model stable. */
export const SIM_STEP = 1 / 20;

/* ---- Camera ---- */
export const ZOOM_LEVELS = [1, 2, 3];
/** Start framed on the whole island; zoom in for detail. */
export const DEFAULT_ZOOM_INDEX = 0;
export const CAM_KEY_SPEED = 420;

/** How much of the surge a coastal tile takes when the storm faces it. */
export const WIND_FACING = 1.0;
export const WIND_FLANK = 0.45;
export const WIND_LEE = 0.2;

/* ---- Presentation ---- */
/**
 * Game days pass far too quickly for a light cycle of one day each, so the
 * sun runs on its own slower clock spanning this many days.
 */
export const LIGHT_CYCLE_DAYS = 16;
export const STORM_WARN_DAYS = 2;
/**
 * How fast standing water is *drawn* receding, in metres of depth per day.
 * The simulation clears a flooded patch within a day or two of a mill being
 * built, which on the map is a few seconds and reads as the land snapping
 * dry. Water still rises on screen the moment it rises in the model; it
 * only takes its time going down. The model, the gauges and the money are
 * not touched, so for a day or two a tile may look wet that already counts
 * as dry.
 */
export const FLOOD_RECEDE = 0.15;

/**
 * How many house designs there are. The simulation picks one per house with
 * a single draw of its seeded random, so changing this changes which house
 * looks like what and nothing else about the map.
 */
export const HOUSE_VARIANTS = 8;
