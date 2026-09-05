// Smoothing what the panel reads.
//
// `instructions`, `fuel` and `coveMicros` are read straight off the snapshot
// each tick, and `coveMicros` in particular is a wall-clock reading — the one
// field in the snapshot the issue calls out as not reproducible between two
// runs of the same seed. Read one tick at a time it flickers with whatever
// else the CPU was doing; averaged over a short window it reads as what the
// tank actually costs.

/** A fixed-size ring buffer averaged on read. */
export class RollingAverage {
  private readonly window: number[] = [];
  private readonly size: number;

  constructor(size = 10) {
    if (size < 1) {
      throw new Error("a rolling average needs at least one sample");
    }
    this.size = size;
  }

  push(value: number): void {
    this.window.push(value);
    if (this.window.length > this.size) {
      this.window.shift();
    }
  }

  /** The mean of whatever samples have been pushed so far, or `0` for none. */
  value(): number {
    if (this.window.length === 0) {
      return 0;
    }
    return this.window.reduce((a, b) => a + b, 0) / this.window.length;
  }

  /** Drops every sample. A new world's first tick should not be averaged
   * against the world it replaced. */
  reset(): void {
    this.window.length = 0;
  }
}

/**
 * Decisions per real second, from a rolling count of decisions and a rolling
 * count of the wall-clock milliseconds they were made across. Two rolling
 * averages rather than one, because a single tick's `decisions / seconds`
 * would swing with frame timing the same way `coveMicros` does — dividing
 * two smoothed sums cancels that the way averaging one number alone cannot.
 */
export class DecisionRate {
  private readonly decisions: RollingAverage;
  private readonly millis: RollingAverage;

  constructor(size = 10) {
    this.decisions = new RollingAverage(size);
    this.millis = new RollingAverage(size);
  }

  push(decisions: number, tickMillis: number): void {
    this.decisions.push(decisions);
    this.millis.push(tickMillis);
  }

  perSecond(): number {
    const millis = this.millis.value();
    if (millis <= 0) {
      return 0;
    }
    return (this.decisions.value() * 1000) / millis;
  }

  reset(): void {
    this.decisions.reset();
    this.millis.reset();
  }
}
