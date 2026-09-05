// Loading the tank, and nothing else.
//
// The module is the whole simulation and the whole Cove runtime. This file
// instantiates it, supplies the one import it requires, and turns the
// length-prefixed blobs its ABI answers with into JavaScript values. It holds
// no rules: everything about creatures, food and cover is decided inside the
// module, which is what makes a replay a replay.
//
// Ported from the working `tank.mjs` rather than rewritten: the ABI and the
// reasoning about it did not change by crossing to TypeScript, only the
// types describing it did.

import type { Snapshot } from "./snapshot.js";

/** The nine `extern "C"` functions the module exports, and no more. */
interface TankExports {
  memory: WebAssembly.Memory;
  tank_open(seed: number, width: number, height: number): number;
  tank_tick(): number;
  tank_snapshot(): number;
  tank_focus(id: number): number;
  tank_source(species: number): number;
  tank_error(): number;
  tank_alloc(len: number): number;
  tank_free(ptr: number, len: number): void;
}

/**
 * Instantiates the tank module at `url`.
 *
 * The `cove` import is not optional and not defaulted. `cove-runtime` imports
 * `cove_now_millis` unconditionally — its `Instant` is that call on wasm — and
 * a module instantiated without it fails to instantiate, loudly. Nothing in
 * the tank reads it: no deadline is ever set, because a deadline reads a wall
 * clock and no replay could reproduce one.
 */
export async function loadTank(url: string): Promise<Tank> {
  // `performance.now()` rather than `Date.now()`: the tank times itself
  // through this import and a tick is about a millisecond, so whole
  // milliseconds would report zeros. Nothing branches on the reading.
  const imports = { cove: { cove_now_millis: () => performance.now() } };
  const { instance } =
    typeof WebAssembly.instantiateStreaming === "function"
      ? await WebAssembly.instantiateStreaming(fetch(url), imports)
      : await WebAssembly.instantiate(
          await (await fetch(url)).arrayBuffer(),
          imports,
        );
  return new Tank(instance.exports as unknown as TankExports);
}

/** One open tank, as the page talks to it. */
export class Tank {
  private readonly exports: TankExports;
  private readonly decoder = new TextDecoder();

  constructor(exports: TankExports) {
    this.exports = exports;
  }

  /** Opens a world on `seed`. Throws with the module's own message if it will not. */
  open(seed: number, width: number, height: number): void {
    if (this.exports.tank_open(seed >>> 0, width, height) !== 0) {
      throw new Error(this.blob(this.exports.tank_error()));
    }
  }

  /** One fixed step. */
  tick(): void {
    if (this.exports.tank_tick() !== 0) {
      throw new Error(this.blob(this.exports.tank_error()));
    }
  }

  /** The world as it stands. Call at most once per tick — the panel's
   * per-tick measurements assume one snapshot means one tick. */
  snapshot(): Snapshot {
    return JSON.parse(this.blob(this.exports.tank_snapshot())) as Snapshot;
  }

  /** Watches creature `id`. A negative id, or one that names no living
   * creature, watches nobody — the next `snapshot()`'s `focus` is `null`
   * either way. `id` is a plain number, not a `BigInt`: the export takes an
   * `i32`, not the `i64` a creature's own id is, on purpose (see
   * `tank_focus`'s doc comment in `crates/tank-wasm/src/lib.rs`). */
  focus(id: number): void {
    if (this.exports.tank_focus(id | 0) !== 0) {
      throw new Error(this.blob(this.exports.tank_error()));
    }
  }

  /** The whole `creature.cove` a species decides with, as text. The same
   * string every tick for a given `species` — fetch it once and cache it,
   * which is `main.ts`'s job and not this file's. */
  source(species: number): string {
    return this.blob(this.exports.tank_source(species >>> 0));
  }

  // A blob is a little-endian u32 length and then that many bytes. The
  // pointer is ours to release, and releasing it means handing back the
  // length the module allocated: the four length bytes plus the length they
  // name.
  private blob(pointer: number): string {
    const memory = new Uint8Array(this.exports.memory.buffer);
    const length = new DataView(this.exports.memory.buffer).getUint32(
      pointer,
      true,
    );
    const text = this.decoder.decode(
      memory.subarray(pointer + 4, pointer + 4 + length),
    );
    this.exports.tank_free(pointer, length + 4);
    return text;
  }
}
