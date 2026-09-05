// The page: opens a tank, drives its loop, and draws what it is given.
//
// This file is the only thing here that is not a pure function of its
// arguments — it owns the wasm instance, the DOM, and the clock. Everything
// it could delegate to a pure module (`layout.ts`, `interpolate.ts`,
// `loop.ts`, `shapes.ts`) it does; what is left is wiring.

import { loadTank } from "./tank.js";
import { computeLayout } from "./layout.js";
import {
  interpolateCreatures,
  departedCreatures,
  type Departed,
} from "./interpolate.js";
import { advance, alphaOf } from "./loop.js";
import {
  render,
  FLASH_MS,
  DEPARTED_MS,
  type Flash,
  type DepartedMarker,
} from "./renderer.js";
import { drawShape, radiusOf } from "./shapes.js";
import { RollingAverage, DecisionRate } from "./panel.js";
import { SPECIES_SUMMARY } from "./legend.js";
import type { Snapshot } from "./snapshot.js";

// The reef this page presents. Fixed rather than read from the window,
// because a shared seed has to mean a shared world: `crates/simulation/src/
// bin/regen_hashes.rs` calls this exact width and height "the world the
// browser check runs, which is the world the page presents", and
// `apps/web/check.mjs` pins its hashes to it.
const WIDTH = 16;
const HEIGHT = 12;
const DEFAULT_SEED = 7;

// Six ticks a (real) second. Fast enough that the tank reads as alive rather
// than as a slideshow, slow enough that a visible decision — a grazer
// stepping into cover, a hunter closing the last cell — is still on screen
// two or three frames after it happens rather than a blur one frame wide.
// The instinct modules only ever look one or two cells out
// (`catalog/instinct/instinct.cove`'s sight ranges), so a chase is a handful
// of these steps, not dozens: six a second is paced to that, not to 60 FPS
// rendering, which stays separate on purpose (see `loop.ts`).
const TICK_MS = 1000 / 6;

function must<T extends Element>(id: string): T {
  const el = document.getElementById(id);
  if (!el) {
    throw new Error(`index.html is missing #${id}`);
  }
  return el as unknown as T;
}

function flashKindOf(result: string): Flash["kind"] | null {
  if (result.startsWith("ate-")) return "ate";
  if (result.startsWith("hunted-")) return "hunted";
  if (result === "spawned") return "spawned";
  return null;
}

function readSeedFromUrl(): number {
  const raw = new URLSearchParams(window.location.search).get("seed");
  if (raw === null) {
    return DEFAULT_SEED;
  }
  const parsed = Number(raw);
  return Number.isFinite(parsed) ? parsed >>> 0 : DEFAULT_SEED;
}

function writeSeedToUrl(seed: number): void {
  const url = new URL(window.location.href);
  url.searchParams.set("seed", String(seed >>> 0));
  window.history.replaceState(null, "", url);
}

function randomSeed(): number {
  return Math.floor(Math.random() * 0x100000000) >>> 0;
}

async function main(): Promise<void> {
  const canvas = must<HTMLCanvasElement>("tank");
  const context = canvas.getContext("2d");
  if (!context) {
    throw new Error("canvas 2d context unavailable");
  }
  // Rebound to a name TypeScript will keep narrowed to non-null inside the
  // `function` declarations below: a hoisted `function` (unlike a `const`
  // arrow function) could in principle be called before the guard above
  // runs, so the checker will not carry the narrowing of `context` itself
  // into them — but it will carry the narrowed *type* of a fresh binding
  // it never has to guard again.
  const ctx: CanvasRenderingContext2D = context;

  const wasmUrl = new URL("./tank_wasm.wasm", import.meta.url);
  const tank = await loadTank(wasmUrl.toString());

  // --- Mutable state the loop reads and writes. Grouped here rather than
  // scattered because every one of these fields resets together on "new
  // world" and it should be obvious that they do. ---
  let seed = DEFAULT_SEED;
  let paused = false;
  let speed = 1;
  let carry = 0;
  let prevSnapshot: Snapshot | null = null;
  let currSnapshot: Snapshot | null = null;
  let departedMarkers: DepartedMarker[] = [];
  const flashes = new Map<number, Flash>();
  const instructionsAvg = new RollingAverage();
  const fuelAvg = new RollingAverage();
  const microsAvg = new RollingAverage();
  const decisionRate = new DecisionRate();
  let lastTickAt = performance.now();

  // The canvas is sized from the box it is laid out in and not from the
  // window, because the panel sits beside it rather than over it. A tank the
  // window's size with a panel drawn on top of it is a tank whose left-hand
  // third the visitor is watching through a window.
  let cssWidth = canvas.clientWidth;
  let cssHeight = canvas.clientHeight;

  function resize(): void {
    const dpr = window.devicePixelRatio || 1;
    cssWidth = canvas.clientWidth;
    cssHeight = canvas.clientHeight;
    canvas.width = Math.round(cssWidth * dpr);
    canvas.height = Math.round(cssHeight * dpr);
    canvas.style.width = `${cssWidth}px`;
    canvas.style.height = `${cssHeight}px`;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  }
  window.addEventListener("resize", resize);
  resize();

  function applyFreshSnapshot(fresh: Snapshot, isFirst: boolean): void {
    const now = performance.now();
    if (!isFirst && currSnapshot) {
      const departedNow: Departed[] = departedCreatures(currSnapshot, fresh);
      for (const gone of departedNow) {
        departedMarkers.push({ ...gone, startedAt: now });
      }
    }
    departedMarkers = departedMarkers.filter(
      (m) => now - m.startedAt <= DEPARTED_MS,
    );

    for (const creature of fresh.creatures) {
      const kind = flashKindOf(creature.result);
      if (kind) {
        flashes.set(creature.id, { kind, startedAt: now });
      }
    }
    for (const [id, flash] of flashes) {
      if (now - flash.startedAt > FLASH_MS) {
        flashes.delete(id);
      }
    }

    if (!isFirst) {
      decisionRate.push(fresh.decisions, now - lastTickAt);
      instructionsAvg.push(fresh.instructions);
      fuelAvg.push(fresh.fuel);
      microsAvg.push(fresh.coveMicros);
    }
    lastTickAt = now;

    prevSnapshot = currSnapshot;
    currSnapshot = fresh;
    updateStats(fresh);
  }

  function stepOnce(): void {
    tank.tick();
    applyFreshSnapshot(tank.snapshot(), false);
  }

  function openWorld(nextSeed: number): void {
    tank.open(nextSeed, WIDTH, HEIGHT);
    seed = nextSeed;
    prevSnapshot = null;
    currSnapshot = null;
    carry = 0;
    departedMarkers = [];
    flashes.clear();
    instructionsAvg.reset();
    fuelAvg.reset();
    microsAvg.reset();
    decisionRate.reset();
    writeSeedToUrl(seed);
    // One snapshot, handed to both: `tank_snapshot()` is called at most once
    // per tick everywhere else in this file, and opening a tank is still a
    // tick (tick 0) that rule applies to.
    const initial = tank.snapshot();
    applyFreshSnapshot(initial, true);
    buildLegend(initial);
  }

  // --- Panel ---
  const statSeed = must<HTMLElement>("statSeed");
  const statTick = must<HTMLElement>("statTick");
  const statCreatures = must<HTMLElement>("statCreatures");
  const statTurnover = must<HTMLElement>("statTurnover");
  const statDecisions = must<HTMLElement>("statDecisions");
  const statInstructions = must<HTMLElement>("statInstructions");
  const statFuel = must<HTMLElement>("statFuel");
  const statMicros = must<HTMLElement>("statMicros");
  const statFailures = must<HTMLElement>("statFailures");
  const legendList = must<HTMLUListElement>("legend");

  function updateStats(snapshot: Snapshot): void {
    statSeed.textContent = String(seed);
    statTick.textContent = String(snapshot.tick);
    statCreatures.textContent = String(snapshot.creatures.length);
    statTurnover.textContent = `${snapshot.births} / ${snapshot.deaths}`;
    statDecisions.textContent = decisionRate.perSecond().toFixed(1);
    statInstructions.textContent = Math.round(
      instructionsAvg.value(),
    ).toString();
    statFuel.textContent = Math.round(fuelAvg.value()).toString();
    statMicros.textContent = microsAvg.value().toFixed(0);
    const failures = snapshot.failedFuel + snapshot.failedFault;
    statFailures.textContent =
      failures === 0 ? "none" : `${failures} (${snapshot.refusals} refused)`;
  }

  let legendBuilt = false;
  function buildLegend(snapshot: Snapshot): void {
    if (legendBuilt) {
      return;
    }
    legendBuilt = true;
    legendList.replaceChildren(
      ...snapshot.catalog.map((entry) => {
        const item = document.createElement("li");
        const swatch = document.createElement("canvas");
        swatch.width = 32;
        swatch.height = 32;
        const swatchCtx = swatch.getContext("2d");
        if (swatchCtx) {
          drawShape(
            swatchCtx,
            entry.shape,
            16,
            16,
            radiusOf(28, entry.size),
            entry.colour,
            0,
            false,
          );
        }
        const text = document.createElement("div");
        const name = document.createElement("div");
        name.className = "name";
        name.textContent = entry.name;
        const summary = document.createElement("div");
        summary.className = "summary";
        summary.textContent = SPECIES_SUMMARY[entry.id] ?? entry.role;
        text.append(name, summary);
        item.append(swatch, text);
        return item;
      }),
    );
  }

  // --- Controls ---
  const playPause = must<HTMLButtonElement>("playPause");
  playPause.addEventListener("click", () => setPaused(!paused));
  window.addEventListener("keydown", (event) => {
    if (event.code === "Space") {
      event.preventDefault();
      setPaused(!paused);
    }
  });

  function setPaused(next: boolean): void {
    paused = next;
    playPause.textContent = paused ? "Play" : "Pause";
  }

  const speedButtons = Array.from(
    document.querySelectorAll<HTMLButtonElement>("[data-speed]"),
  );
  for (const button of speedButtons) {
    button.addEventListener("click", () => {
      const value = Number(button.dataset["speed"]);
      if (!Number.isFinite(value) || value <= 0) {
        return;
      }
      speed = value;
      for (const other of speedButtons) {
        other.classList.toggle("active", other === button);
      }
    });
  }

  must<HTMLButtonElement>("newWorld").addEventListener("click", () => {
    openWorld(randomSeed());
  });

  // --- The loop ---
  let lastFrameAt = performance.now();

  function frame(now: number): void {
    const dt = Math.min(now - lastFrameAt, 250);
    lastFrameAt = now;

    if (!paused) {
      const step = advance(carry, dt * speed, TICK_MS);
      carry = step.remainder;
      for (let i = 0; i < step.ticks; i += 1) {
        stepOnce();
      }
    }

    if (currSnapshot) {
      const alpha = paused ? 1 : alphaOf(carry, TICK_MS);
      const layout = computeLayout(cssWidth, cssHeight, WIDTH, HEIGHT, 16);
      const drawn = interpolateCreatures(prevSnapshot, currSnapshot, alpha);
      render(
        ctx,
        cssWidth,
        cssHeight,
        layout,
        currSnapshot,
        drawn,
        departedMarkers,
        flashes,
        now,
      );
    }
    requestAnimationFrame(frame);
  }

  openWorld(readSeedFromUrl());
  requestAnimationFrame(frame);
}

main().catch((error: unknown) => {
  // Nothing fancy: a page that fails to open its tank says so where a
  // first-time visitor is already looking, rather than only in the console.
  document.body.innerHTML = `<pre style="color:#f88;padding:24px;white-space:pre-wrap;">${
    error instanceof Error ? error.stack ?? error.message : String(error)
  }</pre>`;
  throw error;
});
