/**
 * The tutorial is a list of goals rather than a scripted sequence: each step
 * says what to do and knows when it has been done, so a player who works it
 * out early simply skips ahead instead of being held up.
 *
 * The prose lives in the dictionary; each step only names its own key, so the
 * text follows whatever language is selected.
 */

import { t } from './i18n.js';

const STEPS = [
  { key: 'tut.1', done: (sim, scene) => scene.hasPanned === true },
  { key: 'tut.2', done: (sim, scene) => scene.selected !== null && scene.selected !== undefined },
  { key: 'tut.3', done: (sim) => sim.canalTiles.length >= (sim.level.prebuiltCanal || 0) + 1 },
  { key: 'tut.4', done: (sim) => sim.pumps.length >= (sim.level.prebuiltPumps || 0) + 1 },
  { key: 'tut.6', done: (sim) => sim.stats.daysSurvived >= 12 },
  { key: 'tut.7', done: (sim) => sim.pumps.length >= (sim.level.prebuiltPumps || 0) + 3 },
  {
    key: 'tut.8',
    done: (sim) => sim.dikes.some((d) => d.dike.level > (sim.level.prebuiltDikeLevel || 0)),
  },
];

export const TUTORIAL = STEPS;

export function stepTitle(step) {
  return t(`${step.key}.title`);
}

export function stepText(step) {
  return t(`${step.key}.text`);
}
