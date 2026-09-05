// The tank runs in a JavaScript host, or this exits non-zero.
//
// The gate the browser build has to pass before anything is drawn: the module
// instantiates with the one import it demands, opens a world, ticks it, and
// answers a snapshot whose hash matches what the native simulation computes
// for the same seed. That last part is the whole point — if the two ever
// disagree, a shared replay link means nothing.
//
//   $ cargo build -p tank-wasm --profile checked --target wasm32-unknown-unknown
//   $ node apps/web/check.mjs

import { readFile } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'

const here = dirname(fileURLToPath(import.meta.url))
const root = join(here, '..', '..')
// The profile to check, because the site ships one and the tests run another.
// `checked` is release with the debug assertions and the overflow checks back
// on and is what `cargo t` uses; `release` is what is deployed. The hashes
// must be the same either way -- the arithmetic is integer and stays in range
// by design -- and this is where that is actually established rather than
// assumed.
const profile = process.env.TANK_PROFILE ?? 'checked'
const wasm = join(root, 'target', 'wasm32-unknown-unknown', profile, 'tank_wasm.wasm')
const golden = join(root, 'fixtures', 'browser-hashes.txt')

// `performance.now()` rather than `Date.now()`: the tank times itself through
// this import, a tick is about a millisecond, and whole milliseconds would
// report a column of zeros. Nothing branches on the reading — no deadline is
// ever set — so a monotonic sub-millisecond clock is only better reporting.
const imports = { cove: { cove_now_millis: () => performance.now() } }
const { instance } = await WebAssembly.instantiate(await readFile(wasm), imports)
const { tank_open, tank_tick, tank_snapshot, tank_free, memory } = instance.exports

function blob(pointer) {
  const view = new DataView(memory.buffer)
  const length = view.getUint32(pointer, true)
  const bytes = new Uint8Array(memory.buffer, pointer + 4, length)
  const text = new TextDecoder().decode(bytes)
  tank_free(pointer, length + 4)
  return text
}

function fail(why) {
  console.error(`not ok: ${why}`)
  process.exit(1)
}

// The seed and reef `regen_hashes` computed the fixture over — `BROWSER_SEED`,
// `BROWSER_WIDTH` and `BROWSER_HEIGHT` in `crates/simulation/src/bin/
// regen_hashes.rs`. They are here rather than read from the file because a
// check that took its own parameters from the thing it is checking is not a
// check.
const SEED = 7
// Zero means the reef's own size, which is the only place it is written.
const WIDTH = 0
const HEIGHT = 0

const expected = (await readFile(golden, 'utf8'))
  .split('\n')
  .filter((line) => line && !line.startsWith('#'))

if (tank_open(SEED, WIDTH, HEIGHT) !== 0) fail('the tank would not open')
let seen = JSON.parse(blob(tank_snapshot()))
if (seen.tick !== 0) fail(`a new tank is at tick ${seen.tick}`)
if (!(seen.reef.x > 0 && seen.reef.y > 0)) {
  fail(`a reef of ${seen.reef.x}x${seen.reef.y}`)
}
if (seen.creatures.length < 8 || seen.creatures.length > 14) {
  fail(`a cast of ${seen.creatures.length}`)
}
if (seen.catalog.length !== 4) fail(`a catalog of ${seen.catalog.length}`)
// The reef is continuous: no more cells to count, only morsels drifting in
// patches (at least `MORSELS` in `crates/simulation/src/world.rs`, and
// growing by one carcass per death) and a handful of kelp beds (`BEDS`,
// fixed for the life of a world).
if (seen.food.length < 26) fail(`only ${seen.food.length} morsels of food`)
if (seen.kelp.length !== 5) fail(`a reef of ${seen.kelp.length} kelp beds`)
if (
  seen.creatures.some(
    (c) =>
      typeof c.facingX !== 'number' ||
      typeof c.facingY !== 'number' ||
      typeof c.speed !== 'number',
  )
) {
  fail('a creature with no facing or speed')
}

const hashes = []
for (let step = 0; step < expected.length; step += 1) {
  if (tank_tick() !== 0) fail(`tick ${step} failed`)
  seen = JSON.parse(blob(tank_snapshot()))
  hashes.push(seen.hash)
}
if (seen.tick !== expected.length) {
  fail(`${expected.length} ticks left the tank at ${seen.tick}`)
}
if (new Set(hashes).size < expected.length - 10) fail('the tank stopped changing')

// The claim a shared replay link stands on: a seed means the same world in a
// browser as it does natively. Neither side can make it alone, so it is made
// here, against hashes `cargo run -p simulation --bin regen_hashes` wrote.
for (let step = 0; step < expected.length; step += 1) {
  if (String(hashes[step]) !== expected[step]) {
    fail(
      `tick ${step + 1}: WebAssembly says ${hashes[step]}, ` +
        `native says ${expected[step]}`
    )
  }
}
// A creature `result === 'spawned'` this tick has not been asked anything
// yet — `crates/tank-wasm/src/lib.rs`'s `snapshot` writes `""` for both
// `intent` and `reason` when nothing in `tank.last` names it, which is
// exactly the fresh-spawn case — so it is the one creature this check does
// not hold to having a reason.
if (
  seen.creatures.some(
    (c) => c.result !== 'spawned' && (typeof c.reason !== 'string' || c.reason === ''),
  )
) {
  fail('a creature acted for no reason')
}
if (seen.failedFuel !== 0 || seen.failedFault !== 0) {
  fail(`${seen.failedFuel} fuel stops and ${seen.failedFault} faults`)
}
// Same exception as above, the other way round: `decisions` counts the
// population `decisions()` asked *before* this tick's respawns landed, so a
// tick that respawned a slot always asks one fewer than it now holds.
const spawnedThisTick = seen.creatures.filter((c) => c.result === 'spawned').length
if (seen.decisions !== seen.creatures.length - spawnedThisTick) {
  fail(`${seen.decisions} decisions for ${seen.creatures.length} creatures`)
}
if (seen.instructions <= 0) fail('a tick cost no instructions')
if (seen.fuel !== seen.instructions) {
  fail(`fuel ${seen.fuel} and instructions ${seen.instructions} disagree`)
}

console.log(`ok [${profile}]: ${seen.creatures.length} creatures, 60 ticks, hash ${seen.hash}`)
console.log(`   ${seen.catalog.map((s) => `${s.name} (${s.role})`).join(', ')}`)
console.log(`   ${expected.length} hashes agree with the native simulation`)
console.log(
  `   last tick: ${seen.decisions} decisions, ${seen.instructions} instructions, ` +
    `${seen.coveMicros}us inside Cove`
)
