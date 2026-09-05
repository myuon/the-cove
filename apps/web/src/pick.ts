// Turning a click into a creature id, or into nobody.
//
// A pure function of the layout and the positions already computed to draw
// a frame, so a click is answered against exactly what the visitor is
// looking at — including mid-tween, since it is handed `DrawnCreature`s
// (`interpolate.ts`'s interpolated positions) rather than a snapshot's raw
// grid coordinates. Clicking where a creature visibly is should select it
// even between two ticks.

import { cellCentre, type Layout } from "./layout.js";
import { radiusOf } from "./shapes.js";

/** The one thing this file needs from a drawn creature. */
export interface Pickable {
  readonly id: number;
  readonly species: number;
  readonly x: number;
  readonly y: number;
}

/** The one thing this file needs from a catalog entry. */
export interface PickableCatalogEntry {
  readonly size: number;
}

/**
 * The nearest creature whose drawn radius covers `(px, py)` — canvas CSS
 * pixels, the same coordinate space `layout` was computed in — or `null` if
 * none does.
 *
 * The hit target is at least half a cell even for the smallest catalog
 * size, rather than exactly a creature's drawn radius: a shape drawn at a
 * few pixels across is not a target anybody could reliably click, and a
 * miss here reads to a visitor as "nothing is here" rather than as "try
 * again more precisely."
 */
export function pickCreature(
  px: number,
  py: number,
  layout: Layout,
  creatures: readonly Pickable[],
  catalog: readonly PickableCatalogEntry[],
): number | null {
  let bestId: number | null = null;
  let bestDistance = Infinity;
  for (const creature of creatures) {
    const centre = cellCentre(layout, creature.x, creature.y);
    const dx = px - centre.px;
    const dy = py - centre.py;
    const distance = Math.sqrt(dx * dx + dy * dy);
    const size = catalog[creature.species]?.size ?? 3.5;
    const hitRadius = Math.max(radiusOf(layout.cell, size), layout.cell * 0.5);
    if (distance <= hitRadius && distance < bestDistance) {
      bestDistance = distance;
      bestId = creature.id;
    }
  }
  return bestId;
}
