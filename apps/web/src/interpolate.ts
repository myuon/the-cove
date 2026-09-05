// Turning two ticks into motion.
//
// The simulation is a fixed step: it advances by a whole tick or not at all,
// and its hash must not depend on how fast a frame is drawn. So the renderer
// never asks it to advance a fraction of a tick — instead it holds the last
// two snapshots and interpolates a creature's drawn position, facing and
// speed between them, which is smooth motion built entirely on the drawing
// side of the line the determinism has to sit on.
//
// `facing` is interpolated too, and not just position: a creature turns a
// bounded amount each tick (`agility` in `crates/simulation/src/world.rs`),
// so between two ticks its drawn heading should ease the same way its drawn
// position does, rather than snapping the instant the tick resolves. Facing
// is a unit vector, so the two components are blended and the result
// re-normalised — this is not a spherical interpolation, but the turn a
// single tick can make is always small, so a linear blend of the two
// components and a re-normalisation is indistinguishable from one at the
// distances this reef ever asks for.
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
export interface DrawnCreature extends CreatureSnapshot {}

/** A creature that left between the last two snapshots, and where it was. */
export interface Departed {
  readonly id: number;
  readonly species: number;
  readonly x: number;
  readonly y: number;
}

/** `a + (b - a) * t`, the one piece of arithmetic every field below shares. */
function lerp(a: number, b: number, t: number): number {
  return a + (b - a) * t;
}

/**
 * `was.facing` blended towards `is.facing` by `t` and re-normalised — see
 * the module comment for why a linear blend is enough here. Falls back to
 * `is`'s own facing on the vanishing chance the blend cancels to (almost)
 * nothing, which only a near-perfect reversal within one tick could cause.
 */
function lerpFacing(
  was: { readonly facingX: number; readonly facingY: number },
  is: { readonly facingX: number; readonly facingY: number },
  t: number,
): { facingX: number; facingY: number } {
  const x = lerp(was.facingX, is.facingX, t);
  const y = lerp(was.facingY, is.facingY, t);
  const length = Math.sqrt(x * x + y * y);
  if (length < 1e-6) {
    return { facingX: is.facingX, facingY: is.facingY };
  }
  return { facingX: x / length, facingY: y / length };
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
      x: lerp(was.x, creature.x, clamped),
      y: lerp(was.y, creature.y, clamped),
      ...lerpFacing(was, creature, clamped),
      speed: lerp(was.speed, creature.speed, clamped),
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

/**
 * The same creatures, eased towards where the tick interpolation put them.
 *
 * Interpolating between two snapshots is smooth *within* a tick and has a
 * corner *at* every tick boundary: the drawn velocity changes instantly when a
 * new snapshot arrives, and the eye reads that as a flick. Slowing the world
 * down does not fix it — it gives the same corner longer to be looked at.
 *
 * So the drawn position and speed are low-passed: each frame they move a fixed
 * fraction of the way to where interpolation says they should be, with the
 * fraction set by a half-life rather than by the frame rate, so a slow machine
 * and a fast one ease at the same speed in real time.
 *
 * The facing is *not* low-passed. It slews at a constant angular rate, because
 * an exponential turn eases out of itself and that is how an animal turns —
 * and the creatures here are meant to read as instruments rather than animals.
 * A servo turns at one rate until it arrives, and then it stops.
 *
 * It costs a little lag, and lag is free here. Nobody is steering anything;
 * this is a thing to watch.
 */
export function easeDrawn(
  held: Map<number, DrawnCreature>,
  target: readonly DrawnCreature[],
  dtMs: number,
  halfLifeMs: number,
  turnDegPerSecond: number,
): DrawnCreature[] {
  const k = halfLifeMs <= 0 ? 1 : 1 - Math.pow(0.5, dtMs / halfLifeMs);
  const out: DrawnCreature[] = [];
  const seen = new Set<number>();
  for (const want of target) {
    seen.add(want.id);
    const was = held.get(want.id);
    if (!was) {
      // A creature nobody has drawn yet has nowhere to ease from: it arrives
      // where it is. Easing it in from the last one's position would drag a
      // ghost across the reef every time a slot refilled.
      held.set(want.id, want);
      out.push(want);
      continue;
    }
    // Position and speed are low-passed; the *facing* slews at a constant
    // angular rate instead. An exponential turn eases out of itself, which is
    // how an animal turns and is exactly the reading this drawing does not
    // want. A servo turns at one rate until it arrives and then stops.
    const wasAngle = Math.atan2(was.facingY, was.facingX);
    const wantAngle = Math.atan2(want.facingY, want.facingX);
    let delta = wantAngle - wasAngle;
    while (delta > Math.PI) {
      delta -= Math.PI * 2;
    }
    while (delta < -Math.PI) {
      delta += Math.PI * 2;
    }
    const most = ((turnDegPerSecond * Math.PI) / 180) * (dtMs / 1000);
    const turned = wasAngle + Math.max(-most, Math.min(most, delta));
    const eased: DrawnCreature = {
      ...want,
      x: was.x + (want.x - was.x) * k,
      y: was.y + (want.y - was.y) * k,
      facingX: Math.cos(turned),
      facingY: Math.sin(turned),
      speed: was.speed + (want.speed - was.speed) * k,
    };
    held.set(want.id, eased);
    out.push(eased);
  }
  for (const id of [...held.keys()]) {
    if (!seen.has(id)) {
      held.delete(id);
    }
  }
  return out;
}
