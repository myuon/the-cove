// The accumulator: turning real elapsed time into a whole number of ticks.
//
// Rendering time and simulation time are kept apart on purpose. The tank is
// a fixed step and must hash the same way at any frame rate, so the loop
// never scales a tick — it only decides how many whole ticks are due and
// leaves a remainder for the renderer to interpolate through. That remainder
// is `alpha` in `interpolate.ts`.

/** What one call to the accumulator decided. */
export interface Advance {
  /** How many whole ticks are due. Usually `0` or `1`; more only if a frame
   * ran long enough to fall behind. */
  readonly ticks: number;
  /** Time left over after those ticks, carried into the next frame. */
  readonly remainder: number;
}

/**
 * `elapsed` real milliseconds at `tickMs` milliseconds per tick, added to
 * whatever `carry` was left over last frame.
 *
 * `maxTicks` bounds how far behind a single frame can put the simulation —
 * a tab backgrounded for a minute and brought back must not spend that
 * minute replaying ticks in one frame. The unspent time is dropped, not
 * carried: a tank that fell behind resumes at "now" rather than fast-
 * forwarding through what nobody watched.
 */
export function advance(
  carry: number,
  elapsed: number,
  tickMs: number,
  maxTicks = 12,
): Advance {
  const total = carry + Math.max(0, elapsed);
  const possible = Math.floor(total / tickMs);
  if (possible <= maxTicks) {
    return { ticks: possible, remainder: total - possible * tickMs };
  }
  // More ticks are due than the cap allows: take the cap and drop the rest
  // of the backlog along with the time that produced it, rather than
  // carrying a remainder that would just demand the same number again next
  // frame.
  return { ticks: maxTicks, remainder: 0 };
}

/** `alpha`: how far into the next tick the current remainder sits, `0..1`. */
export function alphaOf(remainder: number, tickMs: number): number {
  if (tickMs <= 0) {
    return 1;
  }
  return Math.min(1, Math.max(0, remainder / tickMs));
}
