# The Cove — the browser tank

The page: a Canvas 2D aquarium driven by the WebAssembly module
`crates/tank-wasm` builds. The browser holds no simulation logic of its own —
it opens a tank, ticks it, and draws the snapshot it is handed. Everything
about what a creature does, why, and what the world let it do lives in Cove
source under `catalog/species/` and the Rust simulation in
`crates/simulation`; this is the page that watches it. The reef itself is
continuous — a place is two floats, not two cells — and `docs/look.md` is the
art direction this page draws to: dim, slow, luminous water rather than a
diagram of one.

There is no framework and no bundler. TypeScript is the only dependency, and
it compiles straight to ES modules the browser loads directly.

## Building it

```console
$ cd apps/web
$ npm install
$ ./build.sh
```

`build.sh` is the full pipeline: it builds `tank-wasm` for
`wasm32-unknown-unknown`, compiles the TypeScript to `dist/`, and copies the
compiled module in as `dist/tank_wasm.wasm` — it has to land next to
`dist/main.js`, not next to `index.html`, because `src/main.ts` fetches it
with `new URL("./tank_wasm.wasm", import.meta.url)`, resolved against the
compiled script's own location.

`npm run build` alone only does the middle step (`tsc`); run `build.sh` after
changing anything in `crates/tank-wasm` or the catalog, and `npm run build` on
its own is enough while only `src/*.ts` changed and the module is already
built.

## Running it

Any static file server works — this is the deployment target, a static site
with no application server behind it:

```console
$ npx serve apps/web
# or
$ python3 -m http.server 8000 --directory apps/web
```

Then open `index.html` (`/index.html` or `/`, depending on the server) in a
browser. Opening the file directly (`file://`) does not work: `fetch` cannot
read a `.wasm` module across that scheme, which is exactly why the build
copies it to be fetched over HTTP instead.

## Checking it

```console
$ node check.mjs
```

The gate: instantiates the built module directly (no TypeScript involved),
opens the same seed and reef `crates/simulation/src/bin/regen_hashes.rs`
calls "the world the browser check runs, which is the world the page
presents", ticks it sixty times, and compares every hash against
`fixtures/browser-hashes.txt`, which the native simulation wrote. That
agreement is the whole claim a shared replay link stands on. Run it after any
change that touches the loader or the wasm module.

```console
$ npm test
```

Runs `node --test` over `test/*.test.mjs`, which exercises the pure functions
the loop and renderer are built from — reef layout, tick accumulation,
cross-tick interpolation, the plain-language sentence builder, the rolling
averages the panel reads — against the compiled `dist/`. Run `npm run build`
first; it imports compiled output, not the TypeScript source.

## What the page does

**The loop.** The simulation is a fixed step and its hash must not depend on
frame rate, so rendering time and simulation time are kept apart
(`src/loop.ts`): each frame accumulates real elapsed time and spends it down
in whole ticks, never a fraction of one, and interpolates a creature's drawn
position, facing and speed through whatever fraction is left over
(`src/interpolate.ts`) — a creature turns a bounded amount each tick, so its
drawn heading eases the same way its drawn position does, never snapping the
instant a tick resolves. The tank is ticked **three times a second** by
default — it was six, and the first person to open the deployed page said
six read as too quick to watch; a default that reads as "slowed down" is a
default apologising for itself. `tank_snapshot()` is called at most once per
tick, never per frame.

**The tank.** A continuous 100×75 reef (not a grid of cells), seeded from
`?seed=` in the URL (default `7`, the seed `regen_hashes.rs` calls "the world
the page presents") so a reload or a shared link reproduces the same world.
"New world" draws a fresh random seed and rewrites the URL. Drawn back to
front (`src/renderer.ts`): a water gradient and drifting light bands (screen
space, holding still while the camera pans or zooms), kelp beds — clumps of
swaying fronds, not circles — food patches (soft pulsing blobs, a carcass
reading warmer and arriving with a bloom), each creature's fading trail, a
faint sight-radius ring on every creature, a reaction line to whatever a
creature is fleeing or hunting, the creatures themselves, a second pass of
kelp fronds in front of any creature hidden in the weed, motes, and a
vignette.

**A creature** is a body and a tail, not a glyph: an ellipse oriented along
its `facing`, and a tail whose undulation frequency and amplitude follow its
`speed` — a creature at rest barely moves; a fleeing one thrashes. Each
species keeps its catalog colour and silhouette (`round`, `wedge`, `ring`,
`spiral`, drawn per-creature in `src/renderer.ts`; `src/shapes.ts` only draws
the legend's static swatch icon) and a soft glow in its own colour, which is
where "luminous" comes from. A hidden creature is drawn dimmer, with kelp
fronds passing in front of it, so it reads as *in* the weed rather than
merely marked as hidden. A creature that just ate, was just hunted, or just
spawned gets a fading coloured halo for a moment (`Flash`), and a creature
that vanished between two ticks — starved or eaten — leaves a fading ripple
at its last position (`Departed`) rather than disappearing without a trace.

The sight circle and the reaction line are the two load-bearing pieces
(`docs/look.md` says so): a creature's beliefs are its perception, and a
line to whatever it is reacting to turns "it moved" into "it moved away from
*that*". Exact for the selected creature (from `tank_focus`'s own
observation); an approximation — the nearest creature of a hunting role
within a per-role sight radius mirroring `crates/simulation/src/world.rs` —
for everyone else, and only when the reason is worth interrupting somebody
for (`fleeing_threat` or `hunting`).

**The panel** reads tick, seed, population, births/deaths, and the
measurements the tank exposes — decisions/second, instructions/tick,
fuel/tick, microseconds inside Cove/tick, and any fuel or fault failures —
each smoothed over the last several ticks (`src/panel.ts`) so they read as
what the tank costs rather than flickering with whatever else the CPU was
doing that frame. Below the numbers, **the legend**: each species by its
shape and colour, its name, and one sentence of what it does, taken verbatim
from the comment at the top of its `catalog/species/<id>/creature.cove`
(`src/legend.ts`) — this is what the exit criterion actually rests on. Shape
and colour let a visitor tell four creatures apart; the sentence is what lets
them connect a creature they are watching to a rule they can reason about
without opening a source file.

**Controls**: pause/play (also the space bar), speed (0.5×/1×/2×/4×, which
scales how much real time the accumulator is fed rather than the tick
interval itself), and "new world".

**The inspector** (`src/sentence.ts`, `src/highlight.ts`, `src/camera.ts`,
`src/pick.ts`, wired up in `src/main.ts`). Clicking a creature selects it — a
clear ring, everything else dimmed a touch — and opens a panel with three
layers, each readable on its own:

1. **Plain language.** One sentence built only from what `tank_focus()`'s
   `observation` carried the creature that tick — the whole of what it could
   have reasoned from — plus a second sentence when the world did something
   other than what was asked (refused, or the invocation never reached a
   `Decision` at all). A distance is always one of four bands — "right
   beside it" through "at the edge of sight" — never a raw number of reef
   units, and never a compass direction: a continuous swim goes `toward` or
   `away` from a place, not `move-north`. `src/sentence.ts`'s `buildSentence`
   is the pure function this is, and it is what `test/inspector.test.mjs`
   spends most of its lines on.
2. **State.** Energy (a bar as well as a number — this world has no separate
   health, and the caption says so once), age, what it is doing, and what it
   remembers (`self.memory`: what the world did with *last* tick's intent,
   the only thing that carries between two ticks).
3. **Cove.** Collapsed by default: the species' whole `creature.cove`
   (`tank_source()`, fetched once per species and cached), with the line
   naming this tick's reason highlighted — a text search for
   `Reason.<Variant>`, captioned as exactly that and not a compiler span —
   and the invocation itself: id, tick, instructions, fuel, and the
   runtime's own trace, in order.

A creature that dies while selected does not blank the panel: the headline
becomes "This creature was hunted/starved on tick N" (which of the two is
read off the survivors' own `result` fields, the same data a visitor could
check by hand, rather than invented) and everything below holds its last
live state. **Follow** eases the camera to 2× on the selected creature rather
than snapping, and turns itself off — reverting the camera, not the toggle —
the moment there is nothing left to follow. **Debug** adds this decision's
raw instruction and fuel counts to the panel and to the on-canvas ring.

## The renderer is outside the determinism rule

The simulation may not call a trigonometric function — two machines can
disagree in the last bits of a `sin`, and a shared replay link is a bet that
they do not. `src/renderer.ts` is the one place in this page allowed to: it
computes nothing the state hash sees, so every swaying frond, drifting mote
and undulating tail may use `Math.sin`, `performance.now()`, and randomness
of the renderer's own seeding. None of it is allowed to feed back into a
decision.

## What was not verified in a browser

This was built and checked without ever opening one — Node has no DOM, no
canvas, and no `requestAnimationFrame`. What Node verified: the wasm module
instantiates and runs (via `check.mjs` and an ad hoc run of `loadTank` during
development), the TypeScript compiles clean under `strict`, and every pure
function the loop, layout and renderer are built from — `computeLayout`,
`zoomedLayout`, `toPixel`, `interpolateCreatures`, `departedCreatures`,
`advance`, `alphaOf`, `radiusOf`, the rolling averages, `buildSentence`,
`band`, `foodWord`, `reactionTarget`, `reasonWord`, `memoryWord`,
`highlightedLines`, `easeCamera`, `pickCreature` — is exercised by
`test/*.test.mjs`, including a from-`dist/` run of `tank_focus` /
`tank_source` against the real wasm module driving `buildSentence` and
`highlightedLines` end to end with real captured `Ask`s, one per `reason`,
plus the `refusal` case.

What was **not** verified: that anything draws correctly on screen — the
water, the kelp's sway, a creature's tail undulating with its speed, the
sight circle and reaction line, the selection ring, the dimming, the energy
bar, the highlighted source line, the `<details>` collapse/expand and its
scroll-into-view — that the panel's DOM updates read cleanly, that
resize/devicePixelRatio scaling looks right, that clicking a creature (or the
water around it) dispatches and hits what it should under a real pointer
event, that Follow's easing looks like easing rather than a stutter, that the
space bar and buttons work under real event dispatch, that 60 FPS holds in a
real event loop with the new per-frame drawing, or that the legend's
per-species `<canvas>` swatches render the right shape. All of that needs an
actual browser.
