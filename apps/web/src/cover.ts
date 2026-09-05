// Cover: the cells a hunt does not reach into.
//
// Not in the snapshot, because it is not state — it is a pure function of a
// cell's coordinates, fixed for the life of the module and cheap enough to
// recompute every frame rather than cache. Drawing it is a third of what
// makes the world legible: a grazer or scavenger stepping onto one of these
// cells is stepping somewhere a hunter's `Intent.Hunt` cannot follow it, and
// a visitor who cannot see the cells cannot see why the flight ended there.
export function isCover(x: number, y: number): boolean {
  return (x * 3 + y * 5) % 7 === 0;
}
