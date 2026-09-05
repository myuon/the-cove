# The Cove — the browser tank

The page: a Canvas 2D tide pool driven by the WebAssembly module
`crates/tank-wasm` builds. The browser holds no simulation logic of its own —
it opens a tank, ticks it, and draws the snapshot it is handed. Everything
about what a creature does, why, and what the world let it do lives in Cove
source under `catalog/species/` and the Rust simulation in
`crates/simulation`; this is the page that watches it.

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
the loop and renderer are built from — grid layout, tick accumulation,
cross-tick interpolation, cover, the rolling averages the panel reads — against
the compiled `dist/`. Run `npm run build` first; it imports compiled output,
not the TypeScript source.

## What the page does

**The loop.** The simulation is a fixed step and its hash must not depend on
frame rate, so rendering time and simulation time are kept apart
(`src/loop.ts`): each frame accumulates real elapsed time and spends it down
in whole ticks, never a fraction of one, and interpolates a creature's drawn
position through whatever fraction is left over (`src/interpolate.ts`). The
tank is ticked **six times a second** by default — fast enough to read as
alive, slow enough that a visible decision (a grazer stepping into cover, a
hunter closing the last cell) is still on screen a couple of frames after it
happens rather than a blur one frame wide. The instinct modules only look one
or two cells out, so a chase is a handful of these steps, not dozens; six a
second is paced to that, not to the 60 FPS the canvas itself targets.
`tank_snapshot()` is called at most once per tick, never per frame.

**The tank.** A fixed 16×12 reef, seeded from `?seed=` in the URL (default
`7`, the seed `regen_hashes.rs` calls "the world the page presents") so a
reload or a shared link reproduces the same world. "New world" draws a fresh
random seed and rewrites the URL. Drawn back to front: reef floor, food
(denser cells greener and darker — `src/renderer.ts`'s `foodColour`), cover
cells (`(x*3 + y*5) % 7 === 0`, computed the same way the tank does, in
`src/cover.ts` — not in the snapshot because it does not need to be, it is a
pure function of coordinates), then creatures.

**A creature** is its catalog colour *and* shape (`round`, `wedge`, `ring`,
`spiral`, `src/shapes.ts`) at its catalog size, so a colour-blind visitor can
still tell species apart. A hidden creature is drawn faint and outline-only.
A creature that just ate, was just hunted, or just spawned gets a fading
coloured halo for a moment (`src/renderer.ts`'s `Flash`), and a creature that
vanished between two ticks — starved or eaten — leaves a fading ripple at
its last cell (`Departed`) rather than disappearing without a trace: a death
that is not visible is a death nobody connects to the hunter beside it.

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

## What was not verified in a browser

This was built and checked without ever opening one — Node has no DOM, no
canvas, and no `requestAnimationFrame`. What Node verified: the wasm module
instantiates and runs (via `check.mjs` and an ad hoc HTTP-served run of
`loadTank` during development), the TypeScript compiles clean under `strict`,
and every pure function the loop, layout and renderer are built from —
`computeLayout`, `interpolateCreatures`, `departedCreatures`, `advance`,
`alphaOf`, `isCover`, `headingAngleOf`, `radiusOf`, the rolling averages — is
exercised by `test/*.test.mjs`, including a 200-tick run confirming every
departure `departedCreatures` reports matches the snapshot's own death count
and that `ate`, `hunted`, and `spawned` all actually occur and are detected.

What was **not** verified: that anything draws correctly on screen, that the
panel's DOM updates read cleanly, that resize/devicePixelRatio scaling looks
right, that the space bar and buttons work under real event dispatch, that
60 FPS holds in a real event loop, or that the legend's per-species `<canvas>`
swatches render the right shape. All of that needs an actual browser.
