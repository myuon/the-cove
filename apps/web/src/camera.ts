// Easing the camera towards wherever it should be pointed, one frame at a
// time — the "easing rather than snapping" the Follow toggle asks for.
//
// Kept separate from `layout.ts` because it is a different kind of pure
// function: `layout.ts` answers "where does this grid sit right now", with
// no memory of any earlier frame, and this answers "how far should the
// camera have moved by now", which is a function of *two* points and the
// time between them. Composing the two — ease the camera, then lay the grid
// out around where it ended up — is `main.ts`'s job; this file only owns
// the easing.

/** Where the camera is pointed, in grid units, and how much it is zoomed. */
export interface Camera {
  readonly x: number;
  readonly y: number;
  readonly zoom: number;
}

/**
 * `current` moved a fraction of the way to `target`, that fraction set by
 * `elapsedMs` against `halfLifeMs` — the time in which half the remaining
 * distance closes. An exponential rather than a linear step so the camera
 * looks like it is catching up to something rather than being towed behind
 * it: fast while it is far off, and slowing rather than overshooting as it
 * arrives, with no separate "arrived" case to fall out of.
 *
 * `elapsedMs` is clamped to `0` so a caller that has not yet reset its own
 * clock cannot run the camera backwards.
 */
export function easeCamera(
  current: Camera,
  target: Camera,
  elapsedMs: number,
  halfLifeMs: number,
): Camera {
  const dt = Math.max(0, elapsedMs);
  // `halfLifeMs <= 0` is "snap": nothing left to close after any elapsed
  // time at all, including zero.
  const t = halfLifeMs <= 0 ? 1 : 1 - Math.pow(0.5, dt / halfLifeMs);
  return {
    x: current.x + (target.x - current.x) * t,
    y: current.y + (target.y - current.y) * t,
    zoom: current.zoom + (target.zoom - current.zoom) * t,
  };
}

/**
 * The same camera, moved just far enough to keep the reef under the view.
 *
 * A follow camera that centres on its creature shows the water outside the
 * world whenever that creature is near an edge — half the canvas empty, and a
 * visitor reading it as a bug rather than as a camera doing what it was told.
 * So the centre is clamped: on an axis where the reef is wider than the view
 * the camera stays inside it, and on an axis where the reef is narrower there
 * is nothing to choose and the reef is centred.
 */
export function clampCamera(
  camera: Camera,
  worldWidth: number,
  worldHeight: number,
  canvasWidth: number,
  canvasHeight: number,
  baseCell: number,
): Camera {
  const cell = baseCell * camera.zoom;
  const halfX = canvasWidth / 2 / cell;
  const halfY = canvasHeight / 2 / cell;
  return {
    zoom: camera.zoom,
    x: clampAxis(camera.x, halfX, worldWidth),
    y: clampAxis(camera.y, halfY, worldHeight),
  };
}

function clampAxis(centre: number, half: number, extent: number): number {
  if (half * 2 >= extent) {
    return extent / 2;
  }
  return Math.min(Math.max(centre, half), extent - half);
}
