// Drawing the reef: a field of perception, in line work.
//
// The direction is `docs/look.md`. The short version is that this world *is*
// a field of forces and beliefs, so the honest way to draw it is to draw the
// field rather than to illustrate the animals in it. Everything here is line
// work over near-black: a lattice, a few families of parallel lines, thin
// rings, and one geometric mark per creature. Nothing is a soft blob, because
// soft over soft is mush and mush is what the first pass was.
//
// # The lattice is the picture and it is also the product
//
// A regular grid of points, drawn dim, and brightened and pushed outward
// wherever a creature can see. That is a creature's sight radius rendered as
// something rather than as an annotation — the water visibly bends around
// what is being perceived — and it is the whole of what `docs/look.md` means
// by calling perception load-bearing. Delete every other thing in this file
// and the reef would still say what it is about.
//
// # The one thing that makes this file possible
//
// The renderer is outside the determinism rule. Nothing the simulation does
// depends on a single pixel here, so this is the one place in the page
// allowed to call `Math.sin`, read `performance.now()`, or seed its own
// randomness — and none of it is allowed to feed back into a decision.
//
// # What is reef-space and what is screen-space
//
// The ground, the drifting hatch and the vignette are drawn in plain canvas
// pixels and never touch `layout` — they are the glass, not the contents, so
// they hold still while the camera pans. The lattice, the kelp, the food, the
// creatures and the two load-bearing overlays go through `layout.ts`'s
// `toPixel`, which is the reef's own coordinate system.
//
// # What a non-selected creature's reaction line is approximating
//
// `contract.cove`'s `Observation` is bounded and only ever handed out for the
// one creature `tank_focus` is watching. So the sight radius and the reaction
// line for every *other* creature are this file's own approximation, built
// from the full snapshot rather than from a belief. It can point at a
// different creature than the one actually driving a decision when several
// are clustered, which is a cost worth paying: the alternative is no line at
// all for the thirteen creatures nobody has clicked.

import { toPixel, type Layout } from "./layout.js";
import { HUNTING_ROLES, PREY_ROLES, reactionTarget } from "./sentence.js";
import type {
  Bed,
  CatalogEntry,
  FocusSnapshot,
  Morsel,
  Snapshot,
} from "./snapshot.js";
import type { DrawnCreature, Departed } from "./interpolate.js";

/** A departed creature, plus the real time its death marker started fading. */
export interface DepartedMarker extends Departed {
  readonly startedAt: number;
}

/** How long a just-ate/just-hunted/just-spawned halo stays visible. */
export const FLASH_MS = 450;
/** How long a death marker lingers where a creature was last seen. */
export const DEPARTED_MS = 700;
/** How long a trail behind a creature lasts. `docs/look.md`: "three or four
 * seconds of path." */
export const TRAIL_MS = 3500;
/** How long a freshly-arrived carcass reads as one — warmer, redder, with a
 * bloom — before it fades into an ordinary patch of food. Brief on purpose:
 * `docs/look.md` asks for an arrival, not a permanent second colour, and a
 * carcass a tick has drifted and refilled at 0.9 (`RESPAWN_MORSEL_AMOUNT` in
 * `crates/simulation/src/world.rs`) is indistinguishable from any other
 * patch by then anyway. */
export const CARCASS_BLOOM_MS = 1600;

/** One event this tick worth flashing, and when it started. */
export interface Flash {
  readonly kind: "ate" | "hunted" | "spawned";
  readonly startedAt: number;
}

/** One sampled point of a creature's trail. */
export interface TrailPoint {
  readonly x: number;
  readonly y: number;
  readonly t: number;
}

/**
 * What the inspector is watching, for the one creature this affects how the
 * reef itself is drawn: a clear ring around it, everything else dimmed a
 * touch so the eye goes to it without the rest disappearing, and — only
 * with `debug` on — the raw cost of the tick it just decided.
 */
export interface Selection {
  readonly id: number | null;
  readonly focus: FocusSnapshot | null;
  readonly debug: boolean;
}

// --- A tiny, dependency-free seeded generator and a positional hash. ---
//
// Both are the renderer's own randomness — never the reef's — used to give
// kelp fronds and motes a layout that holds still from one frame to the
// next without either the tank or this file keeping a mutable array of
// "where every frond is" across frames. A frond's shape is instead a pure
// function of its bed's position and its own index, so it can be recomputed
// every frame for a few cents of arithmetic rather than cached at all.

/** A stable pseudo-random fraction in `[0, 1)` from two numbers, by folding
 * them through a sine the way a shader hashes a coordinate. Deterministic
 * only in the sense that matters here — same inputs, same frond, forever —
 * never claimed to be uniform or cryptographic. */
function hash2(a: number, b: number): number {
  const s = Math.sin(a * 127.1 + b * 311.7) * 43758.5453123;
  return s - Math.floor(s);
}

/** `mulberry32`: a small, fast, seeded generator for the sixty motes, which
 * only need a stable layout picked once and never a fresh draw per frame. */
function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return function next(): number {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const APPROX_SIGHT_BY_ROLE: Readonly<Record<string, number>> = {
  grazer: 14,
  ambusher: 14,
  hunter: 22,
  scavenger: 16,
  cooperator: 14,
  wildcard: 7,
};

function approxSight(role: string | undefined): number {
  if (role === undefined) {
    return 14;
  }
  return APPROX_SIGHT_BY_ROLE[role] ?? 14;
}

function approxReactionTarget(
  self: DrawnCreature,
  catalog: readonly CatalogEntry[],
  all: readonly DrawnCreature[],
): { x: number; y: number } | null {
  if (self.reason === "hunting" && self.intent.startsWith("hunt-")) {
    const targetId = Number(self.intent.slice("hunt-".length));
    const target = all.find((c) => c.id === targetId);
    return target ? { x: target.x, y: target.y } : null;
  }
  if (self.reason !== "fleeing_threat" && self.reason !== "hunting") {
    return null;
  }
  const roles = self.reason === "fleeing_threat" ? HUNTING_ROLES : PREY_ROLES;
  const sight = approxSight(catalog[self.species]?.role);
  let best: DrawnCreature | null = null;
  let bestDistance = Infinity;
  for (const other of all) {
    if (other.id === self.id) {
      continue;
    }
    if (self.reason === "hunting" && other.hidden) {
      continue;
    }
    const role = catalog[other.species]?.role;
    if (!role || !roles.has(role)) {
      continue;
    }
    const distance = Math.hypot(other.x - self.x, other.y - self.y);
    if (distance > sight || distance >= bestDistance) {
      continue;
    }
    bestDistance = distance;
    best = other;
  }
  return best ? { x: best.x, y: best.y } : null;
}


// --- The glass: ground, a drifting hatch, a vignette. Screen space. ---

const GROUND_TOP = "#071320";
const GROUND_BOTTOM = "#02050b";
const LINE = "168, 226, 255";

interface ScreenCache {
  readonly width: number;
  readonly height: number;
  readonly ground: CanvasGradient;
  readonly vignette: CanvasGradient;
}

let screenCache: ScreenCache | null = null;

function ensureScreenCache(
  ctx: CanvasRenderingContext2D,
  width: number,
  height: number,
): ScreenCache {
  if (screenCache && screenCache.width === width && screenCache.height === height) {
    return screenCache;
  }
  const ground = ctx.createLinearGradient(0, 0, 0, height);
  ground.addColorStop(0, GROUND_TOP);
  ground.addColorStop(1, GROUND_BOTTOM);
  const vignette = ctx.createRadialGradient(
    width / 2,
    height / 2,
    Math.min(width, height) * 0.34,
    width / 2,
    height / 2,
    Math.hypot(width, height) * 0.62,
  );
  vignette.addColorStop(0, "rgba(0, 0, 0, 0)");
  vignette.addColorStop(1, "rgba(0, 0, 0, 0.72)");
  screenCache = { width, height, ground, vignette };
  return screenCache;
}

function drawGround(
  ctx: CanvasRenderingContext2D,
  width: number,
  height: number,
  cache: ScreenCache,
): void {
  ctx.fillStyle = cache.ground;
  ctx.fillRect(0, 0, width, height);
}

/// Light as a hatch rather than a shaft.
///
/// Parallel lines at a fixed angle, drifting slowly across, with the spacing
/// held constant so the whole family reads as one ruled surface. A soft
/// gradient shaft was tried first and it was the thing that made the picture
/// look blurred: there was nothing crisp anywhere for the eye to hold on to.
function drawHatch(
  ctx: CanvasRenderingContext2D,
  width: number,
  height: number,
  now: number,
): void {
  const spacing = 26;
  const diag = Math.hypot(width, height);
  ctx.save();
  ctx.beginPath();
  ctx.rect(0, 0, width, height);
  ctx.clip();
  ctx.translate(width / 2, height / 2);
  ctx.rotate(-0.52);
  ctx.lineWidth = 1;
  const drift = ((now / 90) % spacing) - spacing;
  for (let x = -diag + drift; x < diag; x += spacing) {
    // A slow swell across the family, so the light is never a static ruling.
    const swell = 0.5 + 0.5 * Math.sin(x * 0.004 + now / 5200);
    ctx.strokeStyle = `rgba(${LINE}, ${0.008 + swell * 0.022})`;
    ctx.beginPath();
    ctx.moveTo(x, -diag);
    ctx.lineTo(x, diag);
    ctx.stroke();
  }
  ctx.restore();
}

function drawVignette(
  ctx: CanvasRenderingContext2D,
  width: number,
  height: number,
  cache: ScreenCache,
): void {
  ctx.fillStyle = cache.vignette;
  ctx.fillRect(0, 0, width, height);
}

// --- The lattice: the reef's own field, and what perception looks like. ---

/// How far apart the lattice points sit, in reef units.
const LATTICE_STEP = 2.0;
/// How far a point is pushed away from a creature that can see it, at most.
const LATTICE_PUSH = 0.7;

/**
 * The field, brightened and displaced wherever something is looking.
 *
 * Every point is dim on its own. A creature within its own sight radius
 * lifts the points around it and pushes them outward, falling off to nothing
 * at the edge of what it can see, so a sight range is drawn as a *disturbance
 * in the water* rather than as a circle laid over it. Two creatures whose
 * ranges overlap brighten the same points twice, which is exactly the picture
 * anybody would want of two animals watching the same patch of reef.
 */
function drawLattice(
  ctx: CanvasRenderingContext2D,
  layout: Layout,
  reef: { readonly x: number; readonly y: number },
  creatures: readonly DrawnCreature[],
  sights: readonly number[],
  now: number,
): void {
  const swell = 0.5 + 0.5 * Math.sin(now / 3400);
  const dotBase = Math.max(0.7, layout.cell * 0.05);
  for (let gy = LATTICE_STEP * 0.5; gy < reef.y; gy += LATTICE_STEP) {
    for (let gx = LATTICE_STEP * 0.5; gx < reef.x; gx += LATTICE_STEP) {
      let lift = 0;
      let pushX = 0;
      let pushY = 0;
      for (let i = 0; i < creatures.length; i += 1) {
        const creature = creatures[i]!;
        const sight = sights[i]!;
        const dx = gx - creature.x;
        const dy = gy - creature.y;
        const distance = Math.hypot(dx, dy);
        if (distance >= sight || distance < 1e-6) {
          continue;
        }
        // Strongest at the creature and gone at the rim, squared so the
        // brightening reads as a pool rather than as a disc with an edge.
        const near = 1 - distance / sight;
        const weight = near * near;
        lift += weight;
        pushX += (dx / distance) * weight;
        pushY += (dy / distance) * weight;
      }
      const alpha = 0.085 + swell * 0.025 + Math.min(0.62, lift * 0.55);
      const at = toPixel(
        layout,
        gx + pushX * LATTICE_PUSH,
        gy + pushY * LATTICE_PUSH,
      );
      const size = dotBase * (1 + Math.min(1.8, lift * 1.3));
      ctx.fillStyle = `rgba(${LINE}, ${alpha})`;
      ctx.fillRect(at.px - size, at.py - size, size * 2, size * 2);
    }
  }
}

// --- Kelp: a family of parallel lines, which is what a bed of weed is and
// also what a line field is. Two readings of one drawing. ---

const KELP = "96, 232, 208";

function drawKelp(
  ctx: CanvasRenderingContext2D,
  layout: Layout,
  kelp: readonly Bed[],
  now: number,
): void {
  for (const bed of kelp) {
    const centre = toPixel(layout, bed.x, bed.y);
    const r = bed.radius * layout.cell;
    ctx.save();
    ctx.beginPath();
    ctx.arc(centre.px, centre.py, r, 0, Math.PI * 2);
    ctx.clip();

    // The blades: exactly spaced, each swaying on its own phase. Even spacing
    // is what makes it read as a grown thing rather than as scattered marks;
    // the phase offset is what stops it reading as a comb.
    const spacing = Math.max(2.5, layout.cell * 0.3);
    ctx.lineWidth = Math.max(0.8, layout.cell * 0.035);
    ctx.lineCap = "round";
    for (let x = centre.px - r; x <= centre.px + r; x += spacing) {
      const seed = hash2(bed.x + x, bed.y);
      const height = r * (0.75 + seed * 0.55);
      const period = 5200 + seed * 4200;
      const lean = Math.sin(now / period + seed * 8) * r * 0.2;
      const rootY = centre.py + r;
      ctx.strokeStyle = `rgba(${KELP}, ${0.13 + seed * 0.17})`;
      ctx.beginPath();
      ctx.moveTo(x, rootY);
      ctx.quadraticCurveTo(x + lean * 0.4, rootY - height * 0.55, x + lean, rootY - height);
      ctx.stroke();
    }
    ctx.restore();

    // The bed's own outline, dashed, so a visitor can see where cover ends
    // without the fronds having to reach the rim.
    ctx.save();
    ctx.setLineDash([layout.cell * 0.3, layout.cell * 0.45]);
    ctx.strokeStyle = `rgba(${KELP}, 0.22)`;
    ctx.lineWidth = Math.max(0.8, layout.cell * 0.025);
    ctx.beginPath();
    ctx.arc(centre.px, centre.py, r, 0, Math.PI * 2);
    ctx.stroke();
    ctx.restore();
  }
}

// --- Food: concentric rings. Amount is radius, and nothing is a blob. ---

const FOOD = "196, 240, 176";
const CARCASS_COLOUR = "255, 150, 110";

function drawFood(
  ctx: CanvasRenderingContext2D,
  layout: Layout,
  food: readonly Morsel[],
  carcasses: ReadonlyMap<number, number>,
  now: number,
): void {
  ctx.lineWidth = Math.max(0.7, layout.cell * 0.028);
  for (let index = 0; index < food.length; index += 1) {
    const morsel = food[index];
    if (!morsel || morsel.amount <= 0) {
      continue;
    }
    const centre = toPixel(layout, morsel.x, morsel.y);
    const fullness = Math.min(1, morsel.amount / 4);
    const bornAt = carcasses.get(index);
    const bloomAge = bornAt === undefined ? Infinity : now - bornAt;
    const blooming = bloomAge >= 0 && bloomAge < CARCASS_BLOOM_MS;
    const colour = blooming ? CARCASS_COLOUR : FOOD;
    const r = morsel.radius * layout.cell * (0.3 + fullness * 0.4);
    const breath = 1 + Math.sin(now / 2600 + index * 1.7) * 0.05;

    // An asterisk, not a ring. Rings are what creatures are, and thirty
    // concentric circles scattered over a reef of circular creatures is a
    // picture nobody can read. Spokes have no silhouette to confuse with a
    // body, and the count of them rising with the amount gives food a scale
    // that is legible without a legend.
    const spokes = 3 + Math.round(fullness * 3);
    ctx.strokeStyle = `rgba(${colour}, ${0.11 + fullness * 0.22})`;
    ctx.lineWidth = Math.max(0.7, layout.cell * 0.03);
    for (let i = 0; i < spokes; i += 1) {
      const a = (i / spokes) * Math.PI + index * 0.31 + now / 26000;
      const arm = r * breath;
      ctx.beginPath();
      ctx.moveTo(centre.px - Math.cos(a) * arm, centre.py - Math.sin(a) * arm);
      ctx.lineTo(centre.px + Math.cos(a) * arm, centre.py + Math.sin(a) * arm);
      ctx.stroke();
    }
    ctx.fillStyle = `rgba(${colour}, ${0.35 + fullness * 0.4})`;
    ctx.beginPath();
    ctx.arc(centre.px, centre.py, Math.max(1, r * 0.11), 0, Math.PI * 2);
    ctx.fill();

    if (blooming) {
      const t = bloomAge / CARCASS_BLOOM_MS;
      ctx.strokeStyle = `rgba(${CARCASS_COLOUR}, ${(1 - t) * 0.55})`;
      ctx.beginPath();
      ctx.arc(centre.px, centre.py, r * (0.6 + t * 2.2), 0, Math.PI * 2);
      ctx.stroke();
    }
  }
}

// --- Trails: a path as a row of marks, not a smear. ---

function drawTrails(
  ctx: CanvasRenderingContext2D,
  layout: Layout,
  trails: ReadonlyMap<number, readonly TrailPoint[]>,
  catalog: readonly CatalogEntry[],
  creatures: readonly DrawnCreature[],
  now: number,
): void {
  for (const creature of creatures) {
    const path = trails.get(creature.id);
    const entry = catalog[creature.species];
    if (!path || !entry || path.length < 2) {
      continue;
    }
    for (let i = 0; i < path.length; i += 1) {
      const point = path[i]!;
      const age = (now - point.t) / TRAIL_MS;
      if (age < 0 || age > 1) {
        continue;
      }
      const fade = 1 - age;
      const at = toPixel(layout, point.x, point.y);
      const size = Math.max(0.5, layout.cell * 0.05 * fade);
      ctx.globalAlpha = fade * fade * 0.5;
      ctx.fillStyle = entry.colour;
      ctx.fillRect(at.px - size, at.py - size, size * 2, size * 2);
    }
  }
  ctx.globalAlpha = 1;
}

// --- One creature: a geometric mark, oriented along `facing`. ---
//
// A drawn fish was tried and it was the wrong register: an illustration of an
// animal sitting on top of a diagram of a world. A mark is honest about what
// this is, it stays crisp at any size, and it tells four species apart by
// *shape* before any colour is read — which is what the accessibility
// criterion asks for anyway.

type MarkKind = "chevron" | "circle" | "diamond" | "hex";

const MARKS: Readonly<Record<string, MarkKind>> = {
  wedge: "chevron",
  round: "circle",
  ring: "diamond",
  spiral: "hex",
};

const CRUISE_REFERENCE = 1.6;

function markPath(
  ctx: CanvasRenderingContext2D,
  kind: MarkKind,
  px: number,
  py: number,
  r: number,
  angle: number,
): void {
  ctx.beginPath();
  switch (kind) {
    case "chevron": {
      // A dart. The only mark with a point, for the only role that has one.
      const back = angle + Math.PI;
      ctx.moveTo(px + Math.cos(angle) * r * 1.45, py + Math.sin(angle) * r * 1.45);
      ctx.lineTo(px + Math.cos(back - 0.42) * r * 1.1, py + Math.sin(back - 0.42) * r * 1.1);
      ctx.lineTo(px + Math.cos(back) * r * 0.45, py + Math.sin(back) * r * 0.45);
      ctx.lineTo(px + Math.cos(back + 0.42) * r * 1.1, py + Math.sin(back + 0.42) * r * 1.1);
      ctx.closePath();
      break;
    }
    case "circle":
      ctx.arc(px, py, r, 0, Math.PI * 2);
      break;
    case "diamond":
    case "hex": {
      const sides = kind === "diamond" ? 4 : 6;
      for (let i = 0; i < sides; i += 1) {
        const a = angle + (i / sides) * Math.PI * 2;
        const x = px + Math.cos(a) * r;
        const y = py + Math.sin(a) * r;
        if (i === 0) {
          ctx.moveTo(x, y);
        } else {
          ctx.lineTo(x, y);
        }
      }
      ctx.closePath();
      break;
    }
  }
}

function drawCreatureMark(
  ctx: CanvasRenderingContext2D,
  layout: Layout,
  entry: CatalogEntry,
  creature: DrawnCreature,
  now: number,
  alphaMul: number,
): void {
  const centre = toPixel(layout, creature.x, creature.y);
  const angle = Math.atan2(creature.facingY, creature.facingX);
  const kind = MARKS[entry.shape] ?? "circle";
  const r = (0.7 + entry.size * 0.13) * layout.cell;
  const speedFrac = Math.min(1, Math.max(0, creature.speed / CRUISE_REFERENCE));

  ctx.save();
  ctx.globalAlpha = alphaMul;
  ctx.lineJoin = "round";

  // A halo, but a ring rather than a smear: the one soft thing on the reef
  // would be the one thing that looked out of place.
  ctx.globalAlpha = alphaMul * (0.1 + speedFrac * 0.16);
  ctx.strokeStyle = entry.colour;
  ctx.lineWidth = Math.max(1, layout.cell * 0.12);
  markPath(ctx, kind, centre.px, centre.py, r * 1.5, angle);
  ctx.stroke();

  // The mark itself: filled faintly so it has body, outlined brightly so it
  // has an edge. Contrast of edge against near-black is what the first pass
  // had none of.
  ctx.globalAlpha = alphaMul * 0.26;
  ctx.fillStyle = entry.colour;
  markPath(ctx, kind, centre.px, centre.py, r, angle);
  ctx.fill();

  ctx.globalAlpha = alphaMul;
  ctx.strokeStyle = entry.colour;
  ctx.lineWidth = Math.max(1, layout.cell * 0.055);
  markPath(ctx, kind, centre.px, centre.py, r, angle);
  ctx.stroke();

  // Where it is going, as a line out of the front. Length follows speed, so
  // a creature at rest has none and a fleeing one is visibly urgent.
  if (speedFrac > 0.02) {
    const reach = r * (0.6 + speedFrac * 2.4);
    ctx.globalAlpha = alphaMul * (0.25 + speedFrac * 0.5);
    ctx.lineWidth = Math.max(0.8, layout.cell * 0.03);
    ctx.beginPath();
    ctx.moveTo(px(centre.px, angle, r * 1.1), py(centre.py, angle, r * 1.1));
    ctx.lineTo(px(centre.px, angle, r * 1.1 + reach), py(centre.py, angle, r * 1.1 + reach));
    ctx.stroke();
  }

  // The core. One bright dot, so a creature has a definite position even at
  // the far end of a zoomed-out reef.
  ctx.globalAlpha = alphaMul;
  ctx.fillStyle = entry.colour;
  ctx.beginPath();
  ctx.arc(centre.px, centre.py, Math.max(1, r * 0.2), 0, Math.PI * 2);
  ctx.fill();
  ctx.restore();
}

function px(from: number, angle: number, distance: number): number {
  return from + Math.cos(angle) * distance;
}

function py(from: number, angle: number, distance: number): number {
  return from + Math.sin(angle) * distance;
}

// --- The two load-bearing overlays. ---

/// The sight radius, as a dashed ring with ticks at the quarters.
///
/// The lattice already shows the perception as a field; this is the edge of
/// it, said precisely, for the creature somebody has actually asked about.
function drawSightRing(
  ctx: CanvasRenderingContext2D,
  layout: Layout,
  cx: number,
  cy: number,
  sightUnits: number,
  selected: boolean,
): void {
  if (!selected) {
    return;
  }
  const r = sightUnits * layout.cell;
  ctx.save();
  ctx.strokeStyle = `rgba(${LINE}, 0.32)`;
  ctx.lineWidth = Math.max(0.8, layout.cell * 0.022);
  ctx.setLineDash([layout.cell * 0.22, layout.cell * 0.5]);
  ctx.beginPath();
  ctx.arc(cx, cy, r, 0, Math.PI * 2);
  ctx.stroke();
  ctx.setLineDash([]);
  ctx.strokeStyle = `rgba(${LINE}, 0.5)`;
  for (let i = 0; i < 4; i += 1) {
    const a = (i / 4) * Math.PI * 2;
    ctx.beginPath();
    ctx.moveTo(cx + Math.cos(a) * r * 0.965, cy + Math.sin(a) * r * 0.965);
    ctx.lineTo(cx + Math.cos(a) * r * 1.035, cy + Math.sin(a) * r * 1.035);
    ctx.stroke();
  }
  ctx.restore();
}

const REASON_LINE_COLOUR: Readonly<Record<string, string>> = {
  fleeing_threat: "255, 128, 96",
  hunting: "255, 90, 72",
  sheltering: KELP,
  seeking_food: FOOD,
  crowded: "180, 160, 255",
};

/// A line to what a creature is reacting to, with a mark on the far end.
///
/// The mark matters as much as the line: a line alone reads as a connection
/// between equals, and this is a creature attending to a thing.
function drawReactionLine(
  ctx: CanvasRenderingContext2D,
  layout: Layout,
  fromX: number,
  fromY: number,
  toX: number,
  toY: number,
  reason: string,
  selected: boolean,
): void {
  const colour = REASON_LINE_COLOUR[reason];
  if (!colour) {
    return;
  }
  const a = toPixel(layout, fromX, fromY);
  const b = toPixel(layout, toX, toY);
  ctx.save();
  ctx.strokeStyle = `rgba(${colour}, ${selected ? 0.6 : 0.24})`;
  ctx.lineWidth = Math.max(0.7, layout.cell * (selected ? 0.03 : 0.02));
  ctx.setLineDash([layout.cell * 0.16, layout.cell * 0.22]);
  ctx.beginPath();
  ctx.moveTo(a.px, a.py);
  ctx.lineTo(b.px, b.py);
  ctx.stroke();
  ctx.setLineDash([]);
  const tick = Math.max(2, layout.cell * 0.12);
  ctx.strokeStyle = `rgba(${colour}, ${selected ? 0.85 : 0.4})`;
  ctx.strokeRect(b.px - tick / 2, b.py - tick / 2, tick, tick);
  ctx.restore();
}

// --- Selection, flashes, and what is left where something died. ---

function drawSelectionRing(
  ctx: CanvasRenderingContext2D,
  layout: Layout,
  cx: number,
  cy: number,
  radius: number,
  debugText: string | null,
): void {
  const r = radius * 2.1;
  ctx.save();
  ctx.strokeStyle = "rgba(236, 252, 255, 0.9)";
  ctx.lineWidth = Math.max(1, layout.cell * 0.03);
  // Four corner brackets rather than a closed ring: a ring around a circular
  // mark is two circles, and brackets say "this one" without competing with
  // the shape they are pointing at.
  for (let i = 0; i < 4; i += 1) {
    const a = (i / 4) * Math.PI * 2 + Math.PI / 4;
    ctx.beginPath();
    ctx.arc(cx, cy, r, a - 0.28, a + 0.28);
    ctx.stroke();
  }
  ctx.restore();
  if (debugText) {
    ctx.save();
    ctx.fillStyle = "rgba(236, 252, 255, 0.8)";
    ctx.font = `${Math.max(9, Math.round(layout.cell * 0.42))}px ui-monospace, monospace`;
    ctx.textAlign = "center";
    ctx.fillText(debugText, cx, cy - r - layout.cell * 0.3);
    ctx.restore();
  }
}

function drawFlash(
  ctx: CanvasRenderingContext2D,
  layout: Layout,
  cx: number,
  cy: number,
  radius: number,
  flash: Flash,
  now: number,
): void {
  const age = now - flash.startedAt;
  if (age < 0 || age > FLASH_MS) {
    return;
  }
  const t = age / FLASH_MS;
  const colour =
    flash.kind === "hunted"
      ? "255, 96, 76"
      : flash.kind === "ate"
        ? FOOD
        : "236, 252, 255";
  ctx.save();
  ctx.strokeStyle = `rgba(${colour}, ${(1 - t) * 0.85})`;
  ctx.lineWidth = Math.max(1, layout.cell * 0.05 * (1 - t));
  ctx.beginPath();
  ctx.arc(cx, cy, radius * (1.2 + t * 3.2), 0, Math.PI * 2);
  ctx.stroke();
  ctx.restore();
}

function drawDeparted(
  ctx: CanvasRenderingContext2D,
  layout: Layout,
  departed: readonly DepartedMarker[],
  now: number,
): void {
  for (const gone of departed) {
    const age = now - gone.startedAt;
    if (age < 0 || age > DEPARTED_MS) {
      continue;
    }
    const t = age / DEPARTED_MS;
    const at = toPixel(layout, gone.x, gone.y);
    const r = layout.cell * (0.9 + t * 1.6);
    ctx.save();
    ctx.globalAlpha = 1 - t;
    ctx.strokeStyle = "rgba(255, 132, 108, 0.85)";
    ctx.lineWidth = Math.max(1, layout.cell * 0.035);
    // A cross, collapsing. Nothing else on the reef is a straight X, so it is
    // never read as a creature.
    for (const a of [Math.PI / 4, -Math.PI / 4]) {
      ctx.beginPath();
      ctx.moveTo(at.px - Math.cos(a) * r, at.py - Math.sin(a) * r);
      ctx.lineTo(at.px + Math.cos(a) * r, at.py + Math.sin(a) * r);
      ctx.stroke();
    }
    ctx.restore();
  }
}

/**
 * One frame.
 *
 * Order matters and it is the order of a picture rather than of a scene
 * graph: the glass, then the field, then the things standing in it, then the
 * two overlays that say what any of it means, then the glass again.
 */
export function render(
  ctx: CanvasRenderingContext2D,
  cssWidth: number,
  cssHeight: number,
  layout: Layout,
  snapshot: Snapshot,
  creatures: readonly DrawnCreature[],
  departed: readonly DepartedMarker[],
  flashes: ReadonlyMap<number, Flash>,
  trails: ReadonlyMap<number, readonly TrailPoint[]>,
  carcasses: ReadonlyMap<number, number>,
  now: number,
  selection: Selection,
): void {
  ctx.clearRect(0, 0, cssWidth, cssHeight);
  const screen = ensureScreenCache(ctx, cssWidth, cssHeight);
  const focus =
    selection.focus && selection.focus.id === selection.id
      ? selection.focus
      : null;

  // Every creature's sight radius, once, because the lattice needs all of
  // them and so do the rings.
  const sights = creatures.map((creature) =>
    creature.id === selection.id && focus
      ? focus.observation.sight
      : approxSight(snapshot.catalog[creature.species]?.role),
  );

  drawGround(ctx, cssWidth, cssHeight, screen);
  drawHatch(ctx, cssWidth, cssHeight, now);
  drawLattice(ctx, layout, snapshot.reef, creatures, sights, now);
  drawKelp(ctx, layout, snapshot.kelp, now);
  drawFood(ctx, layout, snapshot.food, carcasses, now);
  drawTrails(ctx, layout, trails, snapshot.catalog, creatures, now);
  drawDeparted(ctx, layout, departed, now);

  for (let i = 0; i < creatures.length; i += 1) {
    const creature = creatures[i]!;
    const centre = toPixel(layout, creature.x, creature.y);
    drawSightRing(
      ctx,
      layout,
      centre.px,
      centre.py,
      sights[i]!,
      creature.id === selection.id,
    );
  }

  for (const creature of creatures) {
    const selected = creature.id === selection.id;
    const target =
      selected && focus
        ? reactionTarget(focus)
        : approxReactionTarget(creature, snapshot.catalog, creatures);
    if (target) {
      drawReactionLine(
        ctx,
        layout,
        creature.x,
        creature.y,
        target.x,
        target.y,
        creature.reason,
        selected,
      );
    }
  }

  for (const creature of creatures) {
    const entry = snapshot.catalog[creature.species];
    if (!entry) {
      continue;
    }
    const selected = creature.id === selection.id;
    const dimmed = selection.id !== null && !selected;
    const alphaMul = (creature.hidden ? 0.42 : 1) * (dimmed ? 0.55 : 1);
    drawCreatureMark(ctx, layout, entry, creature, now, alphaMul);

    const centre = toPixel(layout, creature.x, creature.y);
    const radius = (0.7 + entry.size * 0.13) * layout.cell;
    if (selected) {
      drawSelectionRing(
        ctx,
        layout,
        centre.px,
        centre.py,
        radius,
        selection.debug && focus ? `${focus.instructions}i ${focus.fuel}f` : null,
      );
    }
    const flash = flashes.get(creature.id);
    if (flash) {
      drawFlash(ctx, layout, centre.px, centre.py, radius, flash, now);
    }
  }

  drawVignette(ctx, cssWidth, cssHeight, screen);
}
