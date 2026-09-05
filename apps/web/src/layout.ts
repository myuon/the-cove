// Fitting the reef — a continuous 100 by 75 rectangle, not a grid — into
// whatever canvas the window gives it.
//
// A pure function on purpose: it is the one piece of the renderer with no
// canvas in it, which is what lets it run under `node --test` where no
// canvas exists at all. The reef has no cells any more, so this file no
// longer rounds a scale to a whole pixel per cell or centres a coordinate
// inside one — a place is a float and it maps to a pixel by one
// multiplication, the same one at every point in the reef.

/** Where the reef sits on the canvas, and how many pixels one reef unit is
 * drawn as. */
export interface Layout {
  /** The pixel size of one reef unit. */
  readonly cell: number;
  /** The pixel origin of reef position `(0, 0)`. */
  readonly offsetX: number;
  readonly offsetY: number;
}

/**
 * Scales a `reefWidth` by `reefHeight` reef to fit inside `canvasWidth` by
 * `canvasHeight` pixels, centred, with `margin` pixels of clearance on every
 * side the reef does not fill.
 *
 * The reef is never stretched: the limiting dimension decides the scale and
 * the other dimension centres around what is left over, so a wide window
 * does not warp a round creature into an oval.
 */
export function computeLayout(
  canvasWidth: number,
  canvasHeight: number,
  reefWidth: number,
  reefHeight: number,
  margin = 0,
): Layout {
  const availableWidth = Math.max(canvasWidth - margin * 2, 1);
  const availableHeight = Math.max(canvasHeight - margin * 2, 1);
  const cell = Math.max(
    0.001,
    Math.min(availableWidth / reefWidth, availableHeight / reefHeight),
  );
  const reefPixelWidth = cell * reefWidth;
  const reefPixelHeight = cell * reefHeight;
  const offsetX = (canvasWidth - reefPixelWidth) / 2;
  const offsetY = (canvasHeight - reefPixelHeight) / 2;
  return { cell, offsetX, offsetY };
}

/** The pixel position of reef position `(x, y)` under `layout`. */
export function toPixel(
  layout: Layout,
  x: number,
  y: number,
): { px: number; py: number } {
  return {
    px: layout.offsetX + x * layout.cell,
    py: layout.offsetY + y * layout.cell,
  };
}

/**
 * `base` (whatever `computeLayout` fit the whole reef into), re-centred on
 * `(cameraX, cameraY)` in reef units and scaled by `zoom` around that point.
 *
 * The result is still a `Layout` — a scale and an origin — so every drawing
 * function that takes one keeps working unchanged; the camera is `main.ts`'s
 * idea of where to look, and this is what it costs the reef's own coordinate
 * system. Reef positions fully off-canvas are neither an error nor
 * special-cased: a caller draws all of them and the canvas clips what does
 * not fit, the same as it always has.
 *
 * `zoom = 1` centred on the reef's own centre reproduces `base` exactly —
 * `computeLayout`'s offset is `(canvasSize - cell * reefSize) / 2`, which is
 * `canvasSize / 2 - cell * (reefSize / 2)`, the same arithmetic this
 * function does with `cameraX = reefWidth / 2`. That is what lets `main.ts`
 * run every frame through this function rather than branching on whether
 * the camera is following anything.
 */
export function zoomedLayout(
  base: Layout,
  canvasWidth: number,
  canvasHeight: number,
  zoom: number,
  cameraX: number,
  cameraY: number,
): Layout {
  const cell = base.cell * zoom;
  return {
    cell,
    offsetX: canvasWidth / 2 - cameraX * cell,
    offsetY: canvasHeight / 2 - cameraY * cell,
  };
}
