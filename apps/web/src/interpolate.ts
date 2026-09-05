// Turning two ticks into motion.
//
// The simulation is a fixed step: it advances by a whole tick or not at all,
// and its hash must not depend on how fast a frame is drawn. So the renderer
// never asks it to advance a fraction of a tick — instead it holds the last
// two snapshots and interpolates a creature's drawn position between them,
// which is smooth motion built entirely on the drawing side of the line the
// determinism has to sit on.
//
// A creature's id is handed out once, from a counter that only grows
// (`next_id` in `crates/simulation/src/world.rs`) — a dead creature's id is
// never reissued. So an id present in both snapshots is one creature that
// moved, one present only in the new snapshot is a birth, and one present
// only in the old snapshot is a death; none of the three can be confused for
// another, which is what makes matching by id rather than by array position
// safe.

import type { CreatureSnapshot, Snapshot } from "./snapshot.js";

/** A creature at a point between two ticks, ready to draw. */
export interface DrawnCreature extends Omit<CreatureSnapshot, "x" | "y"> {
  readonly x: number;
  readonly y: number;
}

/** A creature that left between the last two snapshots, and where it was. */
export interface Departed {
  readonly id: number;
  readonly species: number;
  readonly x: number;
  readonly y: number;
}

/**
 * Every live creature, positioned `alpha` of the way from `prev` to `curr`
 * (`0` is `prev`'s position, `1` is `curr`'s). `alpha` is clamped to `[0, 1]`
 * so a caller that has not yet reset its accumulator cannot draw a creature
 * past where the simulation has put it.
 *
 * `prev === null` — the first snapshot a tank ever produces — draws every
 * creature at rest at `curr`'s position, which is correct: there is no
 * earlier position to move from.
 */
export function interpolateCreatures(
  prev: Snapshot | null,
  curr: Snapshot,
  alpha: number,
): DrawnCreature[] {
  const clamped = Math.min(1, Math.max(0, alpha));
  const before = new Map<number, CreatureSnapshot>();
  if (prev) {
    for (const creature of prev.creatures) {
      before.set(creature.id, creature);
    }
  }
  return curr.creatures.map((creature) => {
    const was = before.get(creature.id);
    if (!was) {
      return { ...creature };
    }
    return {
      ...creature,
      x: was.x + (creature.x - was.x) * clamped,
      y: was.y + (creature.y - was.y) * clamped,
    };
  });
}

/**
 * Every creature that was in `prev` and is not in `curr` — a death or a
 * hunt's target — at the position it was last seen. The renderer fades these
 * out rather than dropping them the instant the id disappears: a death that
 * vanishes on the same frame as the hunter's strike reads as nothing at all.
 */
export function departedCreatures(
  prev: Snapshot | null,
  curr: Snapshot,
): Departed[] {
  if (!prev) {
    return [];
  }
  const still = new Set(curr.creatures.map((c) => c.id));
  return prev.creatures
    .filter((c) => !still.has(c.id))
    .map((c) => ({ id: c.id, species: c.species, x: c.x, y: c.y }));
}
