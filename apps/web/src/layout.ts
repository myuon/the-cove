// Fitting a fixed grid into whatever canvas the window gives it.
//
// A pure function on purpose: it is the one piece of the renderer with no
// canvas in it, which is what lets it run under `node --test` where no
// canvas exists at all.

/** Where the grid sits on the canvas, and how big one cell is drawn. */
export interface Layout {
  /** The pixel size of one grid cell's edge. Cells are always square. */
  readonly cell: number;
  /** The pixel origin of grid cell `(0, 0)`'s top-left corner. */
  readonly offsetX: number;
  readonly offsetY: number;
}

/**
 * Scales `gridWidth` by `gridHeight` cells to fit inside `canvasWidth` by
 * `canvasHeight` pixels, centred, with `margin` pixels of clearance on every
 * side the grid does not fill.
 *
 * The grid is square-celled and never stretched: the limiting dimension
 * decides the cell size and the other dimension centres around what is left
 * over, so a wide window does not warp a round creature into an oval.
 */
export function computeLayout(
  canvasWidth: number,
  canvasHeight: number,
  gridWidth: number,
  gridHeight: number,
  margin = 0,
): Layout {
  const availableWidth = Math.max(canvasWidth - margin * 2, 1);
  const availableHeight = Math.max(canvasHeight - margin * 2, 1);
  const cell = Math.max(
    1,
    Math.floor(
      Math.min(availableWidth / gridWidth, availableHeight / gridHeight),
    ),
  );
  const gridPixelWidth = cell * gridWidth;
  const gridPixelHeight = cell * gridHeight;
  const offsetX = (canvasWidth - gridPixelWidth) / 2;
  const offsetY = (canvasHeight - gridPixelHeight) / 2;
  return { cell, offsetX, offsetY };
}

/** The pixel centre of grid cell `(x, y)` under `layout`. */
export function cellCentre(
  layout: Layout,
  x: number,
  y: number,
): { px: number; py: number } {
  return {
    px: layout.offsetX + (x + 0.5) * layout.cell,
    py: layout.offsetY + (y + 0.5) * layout.cell,
  };
}
