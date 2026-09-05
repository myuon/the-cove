// Loading the tank, and nothing else.
//
// The module is the whole simulation and the whole Cove runtime. This file
// instantiates it, supplies the one import it requires, and turns the
// length-prefixed blobs its ABI answers with into JavaScript values. It holds
// no rules: everything about creatures, food and cover is decided inside the
// module, which is what makes a replay a replay.

/**
 * Instantiates the tank module at `url`.
 *
 * The `cove` import is not optional and not defaulted. `cove-runtime` imports
 * `cove_now_millis` unconditionally — its `Instant` is that call on wasm — and
 * a module instantiated without it fails to instantiate, loudly. Nothing in
 * the tank reads it: no deadline is ever set, because a deadline reads a wall
 * clock and no replay could reproduce one.
 */
export async function loadTank(url) {
  const imports = { cove: { cove_now_millis: () => Date.now() } }
  const source = fetch ? fetch(url) : null
  const { instance } = source && typeof WebAssembly.instantiateStreaming === 'function'
    ? await WebAssembly.instantiateStreaming(source, imports)
    : await WebAssembly.instantiate(await (await fetch(url)).arrayBuffer(), imports)
  return new Tank(instance)
}

/** One open tank, as the page talks to it. */
export class Tank {
  constructor(instance) {
    this.exports = instance.exports
    this.decoder = new TextDecoder()
  }

  /** Opens a world on `seed`. Throws with the module's own message if it will not. */
  open(seed, width, height) {
    if (this.exports.tank_open(seed >>> 0, width, height) !== 0) {
      throw new Error(this.#blob(this.exports.tank_error()))
    }
  }

  /** One fixed step. */
  tick() {
    if (this.exports.tank_tick() !== 0) {
      throw new Error(this.#blob(this.exports.tank_error()))
    }
  }

  /** The world as it stands. */
  snapshot() {
    return JSON.parse(this.#blob(this.exports.tank_snapshot()))
  }

  // A blob is a little-endian u32 length and then that many bytes. The
  // pointer is ours to release, and releasing it means handing back the
  // length the module allocated: the four length bytes plus the length they
  // name.
  #blob(pointer) {
    const memory = new Uint8Array(this.exports.memory.buffer)
    const length = new DataView(this.exports.memory.buffer).getUint32(pointer, true)
    const text = this.decoder.decode(memory.subarray(pointer + 4, pointer + 4 + length))
    this.exports.tank_free(pointer, length + 4)
    return text
  }
}
