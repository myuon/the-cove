// The page: opens a tank, drives its loop, and draws what it is given.
//
// This file is the only thing here that is not a pure function of its
// arguments — it owns the wasm instance, the DOM, and the clock. Everything
// it could delegate to a pure module (`layout.ts`, `interpolate.ts`,
// `loop.ts`, `shapes.ts`, `sentence.ts`, `highlight.ts`, `camera.ts`,
// `pick.ts`) it does; what is left is wiring.

import { loadTank } from "./tank.js";
import { computeLayout, zoomedLayout } from "./layout.js";
import {
  interpolateCreatures,
  departedCreatures,
  type Departed,
  type DrawnCreature,
} from "./interpolate.js";
import { advance, alphaOf } from "./loop.js";
import {
  render,
  FLASH_MS,
  DEPARTED_MS,
  TRAIL_MS,
  CARCASS_BLOOM_MS,
  type Flash,
  type DepartedMarker,
  type Selection,
  type TrailPoint,
} from "./renderer.js";
import { drawShape, radiusOf } from "./shapes.js";
import { RollingAverage, DecisionRate } from "./panel.js";
import { SPECIES_SUMMARY } from "./legend.js";
import { buildSentence, reasonWord, memoryWord } from "./sentence.js";
import { highlightedLines } from "./highlight.js";
import { clampCamera, easeCamera, type Camera } from "./camera.js";
import { pickCreature } from "./pick.js";
import type { FocusSnapshot, Snapshot } from "./snapshot.js";

// The reef's size is the reef's, and the page is told it rather than told to
// remember it. `tank_open` takes zero to mean "your own size", so there is one
// number and it lives in `simulation::world::REEF_WIDTH` where it was
// measured. A page carrying its own copy is a page holding one of the reef's
// dimensions in a second language, which is the shape of every drift this
// project has had -- three of them so far, and every one invisible until
// something looked wrong on screen.
let WIDTH = 0;
let HEIGHT = 0;
const DEFAULT_SEED = 7;

// Three ticks a (real) second. Fast enough that the tank reads as alive
// rather than as a slideshow, slow enough that a visible decision — a grazer
// turning for cover, a hunter closing the last few units — is still on
// screen for a beat rather than a blur one frame wide. This is paced to the
// world and not to the 60 FPS render loop, which stays separate on purpose
// (see `loop.ts`) and is what `interpolate.ts` smooths the gap with.
//
// It was six, and six was too quick to watch: the first person to open the
// deployed page said so, and the honest fix is to move the base rate rather
// than to ship with the `0.5x` button pre-pressed. A default that reads as
// "slowed down" is a default apologising for itself, and it leaves nowhere to
// go for somebody who wants it slower still.
const TICK_MS = 1000 / 3;

// How following eases: the real milliseconds in which half the remaining
// distance to the followed creature closes. Not tied to `TICK_MS` or
// `speed` — a visitor watching one animal live should see the camera settle
// at the same real-world pace whether the tank is paused, at 1x, or at 4x.
const CAMERA_HALF_LIFE_MS = 200;
const FOLLOW_ZOOM = 2;

// How often a trail point is sampled, in real milliseconds. Every render
// frame (up to 60 a second) would be far more points than the renderer ever
// draws — it only shows the last `TRAIL_MS` of them — so this throttles
// sampling to a rate closer to what actually ends up on screen.
const TRAIL_SAMPLE_MS = 90;

function must<T extends Element>(id: string): T {
  const el = document.getElementById(id);
  if (!el) {
    throw new Error(`index.html is missing #${id}`);
  }
  return el as unknown as T;
}

function flashKindOf(result: string): Flash["kind"] | null {
  // `ActionResult.name()` in `catalog/contract/contract.cove`: `Ate(_)` is
  // just `"ate"`, not `"ate-1"` — the amount taken never named itself in the
  // word, only in the value the old grid version never carried either.
  if (result === "ate") return "ate";
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

/** Why the world stopped asking a watched creature anything at all. */
interface DeathNotice {
  readonly tick: number;
  readonly cause: "hunted" | "starved";
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
  // A short fading path behind each creature (`docs/look.md`: "three or
  // four seconds of path"). Sampled at most once every `TRAIL_SAMPLE_MS` of
  // real time rather than every render frame — a point every frame would be
  // sixty a second per creature, and the renderer only ever draws a few
  // dozen of the most recent ones anyway.
  const trails = new Map<number, TrailPoint[]>();
  let lastTrailSampleAt = -Infinity;
  // Which indices of `food` arrived as a carcass, and when — `food` only
  // ever grows (`crates/simulation/src/world.rs`: "carcasses only ever add
  // to this"), so an index beyond the previous snapshot's length is always
  // a fresh one landing this tick, never a coincidence of reordering.
  const carcasses = new Map<number, number>();
  const instructionsAvg = new RollingAverage();
  const fuelAvg = new RollingAverage();
  const microsAvg = new RollingAverage();
  const decisionRate = new DecisionRate();
  let lastTickAt = performance.now();

  // --- The inspector's own state. `selectedId` survives ticks and worlds by
  // id, not by array position — the same reason `interpolate.ts` matches
  // creatures that way. `lastFocus` is the one exception to "read straight
  // off the current snapshot": it is deliberately allowed to go stale, which
  // is what lets the panel hold a creature's last state after it dies rather
  // than blank the moment `focus` itself goes `null`. ---
  let selectedId: number | null = null;
  let lastFocus: FocusSnapshot | null = null;
  let deathNotice: DeathNotice | null = null;
  let follow = false;
  let debugOn = false;
  // Every species whose catalog name a visitor has earned, by having seen
  // one of it alive on the reef — not merely listed in the legend, which
  // names all four before anybody has looked at the tank at all. Kept
  // across "new world": a visitor who has met a Kelp Hunter does not forget
  // it because the seed changed.
  const metSpecies = new Set<number>();
  // `creature.cove` is the same text for a species on every tick and every
  // world this module ever opens (it is compiled in, not read off a disk
  // that could change) — fetched once per species and never invalidated.
  const sourceCache = new Map<number, string>();

  let camera: Camera = { x: WIDTH / 2, y: HEIGHT / 2, zoom: 1 };
  // What the last drawn frame actually put on screen, for the click handler
  // to test hits against — the same positions a visitor is looking at,
  // including mid-tween, rather than the last snapshot's raw reef
  // coordinates.
  let currentLayout = computeLayout(0, 0, WIDTH, HEIGHT, 16);
  let currentDrawn: readonly DrawnCreature[] = [];

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
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  }

  // A `ResizeObserver` and not the window's `resize` event, and the canvas is
  // never given an explicit CSS width. Both were wrong the first time and both
  // showed up as the same symptom: opening the inspector takes three hundred
  // pixels away from the tank without the window changing size at all, so no
  // resize event fires, the backing store keeps the width it had, and the
  // browser stretches it to fit. Every circle on the reef became an ellipse
  // and the whole world was squashed sideways — which reads as a bug in the
  // drawing and is a bug in the sizing.
  new ResizeObserver(resize).observe(canvas);
  resize();

  function applyFreshSnapshot(fresh: Snapshot, isFirst: boolean): void {
    const now = performance.now();
    // The reef's own shape, handed to CSS. On a phone the tank is a row in a
    // column and has to be given a height, and a height chosen by hand
    // letterboxes whatever the reef does not happen to be — so the shape comes
    // from the snapshot, which is the only thing that knows it, rather than
    // from a `4 / 3` written into a stylesheet that nothing would update when
    // the world changed size.
    canvas.style.setProperty(
      "--world-aspect",
      `${fresh.reef.x} / ${fresh.reef.y}`,
    );
    WIDTH = fresh.reef.x;
    HEIGHT = fresh.reef.y;
    if (!isFirst && currSnapshot) {
      const departedNow: Departed[] = departedCreatures(currSnapshot, fresh);
      for (const gone of departedNow) {
        departedMarkers.push({ ...gone, startedAt: now });
      }
      // `food` only ever grows; an index this snapshot has and the last one
      // did not is a carcass landing this tick, never a reshuffle.
      for (let index = currSnapshot.food.length; index < fresh.food.length; index += 1) {
        carcasses.set(index, now);
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
      metSpecies.add(creature.species);
    }
    for (const [id, flash] of flashes) {
      if (now - flash.startedAt > FLASH_MS) {
        flashes.delete(id);
      }
    }
    for (const [index, bornAt] of carcasses) {
      if (now - bornAt > CARCASS_BLOOM_MS) {
        carcasses.delete(index);
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
    updateInspector();
  }

  function stepOnce(): void {
    tank.tick();
    applyFreshSnapshot(tank.snapshot(), false);
  }

  function openWorld(nextSeed: number): void {
    tank.open(nextSeed, 0, 0);
    seed = nextSeed;
    prevSnapshot = null;
    currSnapshot = null;
    carry = 0;
    departedMarkers = [];
    flashes.clear();
    trails.clear();
    lastTrailSampleAt = -Infinity;
    carcasses.clear();
    instructionsAvg.reset();
    fuelAvg.reset();
    microsAvg.reset();
    decisionRate.reset();
    // A world's creature ids start over at 1, so a selection from the last
    // one names nobody in this one.
    selectedId = null;
    lastFocus = null;
    deathNotice = null;
    camera = { x: WIDTH / 2, y: HEIGHT / 2, zoom: 1 };
    loadedSourceSpecies = null;
    highlightedReason = null;
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

  // --- The inspector ---
  const inspector = must<HTMLDivElement>("inspector");
  const inspWho = must<HTMLElement>("inspWho");
  const inspHeadline = must<HTMLElement>("inspHeadline");
  const inspNote = must<HTMLElement>("inspNote");
  const inspEnergyFill = must<HTMLElement>("inspEnergyFill");
  const inspEnergy = must<HTMLElement>("inspEnergy");
  const inspAge = must<HTMLElement>("inspAge");
  const inspDoing = must<HTMLElement>("inspDoing");
  const inspMemory = must<HTMLElement>("inspMemory");
  const inspDebugLine = must<HTMLElement>("inspDebugLine");
  const followToggle = must<HTMLInputElement>("followToggle");
  const debugToggle = must<HTMLInputElement>("debugToggle");
  const inspCove = must<HTMLDetailsElement>("inspCove");
  const inspSource = must<HTMLPreElement>("inspSource");
  const inspInvocation = must<HTMLDListElement>("inspInvocation");
  const inspTrace = must<HTMLOListElement>("inspTrace");

  followToggle.addEventListener("change", () => {
    follow = followToggle.checked;
  });
  debugToggle.addEventListener("change", () => {
    debugOn = debugToggle.checked;
    renderInspectorContent();
  });

  // Which species' text is currently sitting in `inspSource`, and which
  // reason its lines are last highlighted for — both `null` until a
  // creature is first selected, and both reset whenever a new world starts
  // (the DOM element is the same one; the content in it is not, once a
  // fresh selection loads a species).
  let loadedSourceSpecies: number | null = null;
  let sourceLineEls: HTMLElement[] = [];
  let highlightedReason: string | null = null;

  inspCove.addEventListener("toggle", () => {
    if (inspCove.open) {
      sourceLineEls
        .find((el) => el.classList.contains("hl"))
        ?.scrollIntoView({ block: "center" });
    }
  });

  function sourceFor(species: number): string {
    let text = sourceCache.get(species);
    if (text === undefined) {
      text = tank.source(species);
      sourceCache.set(species, text);
    }
    return text;
  }

  function renderSource(focus: FocusSnapshot): void {
    if (loadedSourceSpecies !== focus.species) {
      const text = sourceFor(focus.species);
      inspSource.replaceChildren(
        ...text.split("\n").map((line) => {
          const el = document.createElement("div");
          el.className = "line";
          // A blank line still needs height to keep every later line number
          // aligned with where it actually is in the file.
          el.textContent = line.length > 0 ? line : " ";
          return el;
        }),
      );
      sourceLineEls = Array.from(inspSource.children) as HTMLElement[];
      loadedSourceSpecies = focus.species;
      highlightedReason = null; // force the highlight below to reapply
    }

    if (focus.reason !== highlightedReason) {
      const hits = new Set(
        highlightedLines(sourceFor(focus.species), focus.reason),
      );
      let first: HTMLElement | null = null;
      for (const [index, el] of sourceLineEls.entries()) {
        const hit = hits.has(index);
        el.classList.toggle("hl", hit);
        if (hit && !first) {
          first = el;
        }
      }
      if (first && inspCove.open) {
        first.scrollIntoView({ block: "center" });
      }
      highlightedReason = focus.reason;
    }
  }

  function renderInvocation(focus: FocusSnapshot): void {
    const rows: ReadonlyArray<readonly [string, string]> = [
      ["Creature", `#${focus.id}`],
      ["Tick", String(focus.tick)],
      ["Instructions", String(focus.instructions)],
      ["Fuel", String(focus.fuel)],
    ];
    inspInvocation.replaceChildren(
      ...rows.flatMap(([key, value]) => {
        const dt = document.createElement("dt");
        dt.textContent = key;
        const dd = document.createElement("dd");
        dd.textContent = value;
        return [dt, dd];
      }),
    );
    inspTrace.replaceChildren(
      ...focus.trace.map((line) => {
        const li = document.createElement("li");
        li.textContent = line;
        return li;
      }),
    );
  }

  function renderInspectorContent(): void {
    const focus = lastFocus;
    if (!focus || !currSnapshot) {
      return;
    }
    const entry = currSnapshot.catalog[focus.species];
    inspWho.textContent = `${entry?.name ?? `species ${focus.species}`} #${focus.id}`;

    if (deathNotice) {
      inspHeadline.textContent =
        deathNotice.cause === "hunted"
          ? `This creature was hunted on tick ${deathNotice.tick}.`
          : `This creature starved on tick ${deathNotice.tick}.`;
      inspHeadline.classList.add("dead");
      inspNote.textContent = "";
    } else {
      const sentence = buildSentence(focus, currSnapshot.catalog, metSpecies);
      inspHeadline.textContent = sentence.headline;
      inspHeadline.classList.remove("dead");
      inspNote.textContent = sentence.note ?? "";
    }

    const fraction = Math.max(
      0,
      // The world's own constant, read off the snapshot rather than mirrored
      // here. A rule held in a second language is a rule that drifts, and this
      // project has had that happen once already: `contract.cove` and the host
      // disagreed about how far a wildcard sees, and nothing could have caught
      // it. A full energy bar is exactly the shape of the next one.
      Math.min(1, focus.self.energy / (currSnapshot?.maxEnergy ?? 1)),
    );
    inspEnergyFill.style.width = `${Math.round(fraction * 100)}%`;
    inspEnergyFill.style.background =
      fraction < 0.2 ? "#d4553c" : fraction < 0.5 ? "#e0b23c" : "#5fbf8f";
    inspEnergy.textContent = String(focus.self.energy);
    inspAge.textContent = String(focus.self.age);
    inspDoing.textContent = reasonWord(focus.reason);
    inspMemory.textContent = memoryWord(focus.self.memory);

    inspDebugLine.hidden = !debugOn;
    if (debugOn) {
      inspDebugLine.textContent = `This decision: ${focus.instructions} instructions, ${focus.fuel} fuel.`;
    }

    renderSource(focus);
    renderInvocation(focus);
  }

  /**
   * Reconciles the inspector with whatever `currSnapshot` just became —
   * called after every tick and after every selection change, since either
   * one can change what `focus` says.
   *
   * The order matters: a creature that dies this tick is missing from
   * `creatures` but *is* still in `focus` (the tank asked it one last time
   * before resolving the tick that killed it — `crates/tank-wasm/src/
   * lib.rs`'s `decisions()` asks everyone alive when the tick starts, and
   * this one was), so `lastFocus` is updated with its final decision before
   * `deathNotice` is computed from its absence.
   */
  function updateInspector(): void {
    if (selectedId === null) {
      inspector.hidden = true;
      return;
    }
    inspector.hidden = false;
    const snap = currSnapshot;
    if (!snap) {
      return;
    }
    if (snap.focus && snap.focus.id === selectedId) {
      lastFocus = snap.focus;
    }
    const stillAlive = snap.creatures.some((c) => c.id === selectedId);
    if (!stillAlive && !deathNotice) {
      // The world does not record *why* a creature disappeared against its
      // own id — only the hunter's own result says who it caught. A watched
      // creature absent from this tick's cast and not named by any
      // `hunted-{id}` among the survivors ran out of energy instead; those
      // are the only two ways `crates/simulation/src/world.rs`'s `resolve`
      // removes one.
      const caught = snap.creatures.some(
        (c) => c.result === `hunted-${selectedId}`,
      );
      deathNotice = { tick: snap.tick, cause: caught ? "hunted" : "starved" };
    }
    renderInspectorContent();
  }

  function selectCreature(id: number): void {
    selectedId = id;
    deathNotice = null;
    lastFocus = null;
    tank.focus(id);
    // The snapshot already on hand is this tick's; only its `focus` field
    // is stale (it named whoever — or nobody — was watched before this
    // click). Re-reading it costs nothing a fresh tick would not have cost
    // anyway and does not touch the rolling averages `applyFreshSnapshot`
    // feeds — those stay keyed to actual ticks, not to clicks.
    currSnapshot = tank.snapshot();
    updateInspector();
  }

  function clearSelection(): void {
    selectedId = null;
    deathNotice = null;
    lastFocus = null;
    tank.focus(-1);
    currSnapshot = tank.snapshot();
    inspector.hidden = true;
  }

  canvas.addEventListener("click", (event) => {
    const rect = canvas.getBoundingClientRect();
    const x = event.clientX - rect.left;
    const y = event.clientY - rect.top;
    const hit = currSnapshot
      ? pickCreature(x, y, currentLayout, currentDrawn, currSnapshot.catalog)
      : null;
    if (hit !== null) {
      selectCreature(hit);
    } else {
      clearSelection();
    }
  });

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
      const base = computeLayout(cssWidth, cssHeight, WIDTH, HEIGHT, 16);
      const drawn = interpolateCreatures(prevSnapshot, currSnapshot, alpha);

      // The camera eases in real time (`dt`, never `dt * speed`) towards
      // whichever creature Follow is watching, or back to the reef's own
      // centre at `zoom: 1` when it is not — the same target regardless of
      // *why* nothing is followed, whether Follow is off or the followed
      // creature just died and vanished from `drawn`.
      const followed =
        follow && selectedId !== null
          ? drawn.find((c) => c.id === selectedId)
          : undefined;
      const target: Camera = followed
        ? { x: followed.x, y: followed.y, zoom: FOLLOW_ZOOM }
        : { x: WIDTH / 2, y: HEIGHT / 2, zoom: 1 };
      camera = clampCamera(
        easeCamera(camera, target, dt, CAMERA_HALF_LIFE_MS),
        WIDTH,
        HEIGHT,
        cssWidth,
        cssHeight,
        base.cell,
      );
      const layout = zoomedLayout(
        base,
        cssWidth,
        cssHeight,
        camera.zoom,
        camera.x,
        camera.y,
      );
      currentLayout = layout;
      currentDrawn = drawn;

      // One trail point per creature at most every `TRAIL_SAMPLE_MS`, kept
      // for `TRAIL_MS`. Dropping a dead creature's whole trail once it has
      // nothing left worth drawing rather than filtering an ever-growing
      // map every frame.
      if (now - lastTrailSampleAt >= TRAIL_SAMPLE_MS) {
        lastTrailSampleAt = now;
        for (const creature of drawn) {
          const points = trails.get(creature.id) ?? [];
          points.push({ x: creature.x, y: creature.y, t: now });
          trails.set(creature.id, points);
        }
        for (const [id, points] of trails) {
          const trimmed = points.filter((p) => now - p.t <= TRAIL_MS);
          if (trimmed.length === 0) {
            trails.delete(id);
          } else if (trimmed.length !== points.length) {
            trails.set(id, trimmed);
          }
        }
      }

      const selection: Selection = {
        id: selectedId,
        focus: lastFocus,
        debug: debugOn,
      };
      render(
        ctx,
        cssWidth,
        cssHeight,
        layout,
        currSnapshot,
        drawn,
        departedMarkers,
        flashes,
        trails,
        carcasses,
        now,
        selection,
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
