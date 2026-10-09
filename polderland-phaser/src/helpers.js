import { GRID, PX_PER_M } from './constants.js';
import { t, formatNumber } from './systems/i18n.js';
import { TILE_W, TILE_H } from './art/px.js';

/** Grid -> screen. The map's origin tile sits at world (0, 0). */
export function isoX(tx, ty) {
  return (tx - ty) * (TILE_W / 2);
}

export function isoY(tx, ty, elev = 0) {
  return (tx + ty) * (TILE_H / 2) - elev * PX_PER_M;
}

/** Screen -> grid, ignoring elevation (good enough for picking). */
export function screenToTile(wx, wy) {
  const a = wx / (TILE_W / 2);
  const b = wy / (TILE_H / 2);
  return { x: Math.round((a + b) / 2 - 0.5), y: Math.round((b - a) / 2 - 0.5) };
}

export function inBounds(x, y) {
  return x >= 0 && y >= 0 && x < GRID && y < GRID;
}

export function clamp(v, lo, hi) {
  return v < lo ? lo : v > hi ? hi : v;
}

export function lerp(a, b, t) {
  return a + (b - a) * t;
}

/** Small, fast, seedable PRNG so a scenario always builds the same map. */
export function mulberry32(seed) {
  let a = seed >>> 0;
  return function rand() {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const MONTH_DAYS = [31, 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];

export function isLeap(year) {
  return year % 4 === 0 && (year % 100 !== 0 || year % 400 === 0);
}

export function daysInMonth(month, year) {
  return month === 2 && isLeap(year) ? 29 : MONTH_DAYS[month - 1];
}

/** Advance a { day, month, year } record by one day, in place. */
export function advanceDate(date) {
  date.day += 1;
  if (date.day > daysInMonth(date.month, date.year)) {
    date.day = 1;
    date.month += 1;
    if (date.month > 12) {
      date.month = 1;
      date.year += 1;
    }
  }
  return date;
}

export function formatDate(date) {
  return `${String(date.day).padStart(2, '0')} ${t(`month.${date.month}`)} ${date.year}`;
}

/** Serial day number, for comparing two dates cheaply. */
export function dateIndex(date) {
  let d = date.year * 365 + date.day;
  for (let m = 1; m < date.month; m++) d += MONTH_DAYS[m - 1];
  return d;
}

/** Season 0..3 from the month, used by the day/night and weather tint. */
export function seasonOf(month) {
  return Math.floor((month % 12) / 3);
}

export function formatMoney(v) {
  return formatNumber(v);
}
