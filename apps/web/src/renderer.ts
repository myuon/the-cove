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
  const spacing = 38;
  const diag = Math.hypot(width, height);
  ctx.save();
  ctx.beginPath();
  ctx.rect(0, 0, width, height);
  ctx.clip();
  ctx.translate(width / 2, height / 2);
  ctx.rotate(-0.52);
  ctx.lineWidth = 1;
  const drift = ((now / 90) % spacing) - spacing;
  const LEVELS = 4;
  const lanes: number[][] = [[], [], [], []];
  for (let x = -diag + drift; x < diag; x += spacing) {
    const swell = 0.5 + 0.5 * Math.sin(x * 0.004 + now / 5200);
    lanes[Math.min(LEVELS - 1, Math.floor(swell * LEVELS))]!.push(x);
  }
  for (let level = 0; level < LEVELS; level += 1) {
    const swell = (level + 0.5) / LEVELS;
    ctx.strokeStyle = `rgba(${LINE}, ${0.008 + swell * 0.022})`;
    ctx.beginPath();
    for (const x of lanes[level]!) {
      ctx.moveTo(x, -diag);
      ctx.lineTo(x, diag);
    }
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
const LATTICE_STEP = 2.05;

/** A hex colour as `r, g, b`, cached, because the catalog hands out `#rrggbb`
 * and the field mixes colours by the hundred every frame. */
const rgbCache = new Map<string, [number, number, number]>();

function rgbOf(hex: string): [number, number, number] {
  const found = rgbCache.get(hex);
  if (found) {
    return found;
  }
  const n = parseInt(hex.replace("#", ""), 16);
  const rgb: [number, number, number] = [(n >> 16) & 255, (n >> 8) & 255, n & 255];
  rgbCache.set(hex, rgb);
  return rgb;
}

/// The field, painted to its own canvas and reused.
///
/// It is redrawn on its own clock rather than every frame. The weave drifts
/// over tens of seconds and the whorls follow creatures that move three times
/// a second, so twenty repaints a second is already more than anything in it
/// changes at — and a repaint is nine hundred segments over the whole canvas,
/// which is the most expensive thing the renderer does by a wide margin.
///
/// The cached image is thrown away when the camera moves, because the field
/// is drawn in reef space and a pan is a different picture.
interface FieldCache {
  readonly canvas: HTMLCanvasElement;
  width: number;
  height: number;
  cell: number;
  offsetX: number;
  offsetY: number;
  paintedAt: number;
}

let fieldCache: FieldCache | null = null;

/** How long a painted field may be reused. */
const FIELD_REPAINT_MS = 55;

function drawField(
  ctx: CanvasRenderingContext2D,
  layout: Layout,
  reef: { readonly x: number; readonly y: number },
  creatures: readonly DrawnCreature[],
  catalog: readonly CatalogEntry[],
  sights: readonly number[],
  now: number,
  width: number,
  height: number,
): void {
  if (
    !fieldCache ||
    fieldCache.width !== width ||
    fieldCache.height !== height
  ) {
    const canvas = document.createElement("canvas");
    canvas.width = Math.max(1, Math.round(width));
    canvas.height = Math.max(1, Math.round(height));
    fieldCache = {
      canvas,
      width,
      height,
      cell: NaN,
      offsetX: NaN,
      offsetY: NaN,
      paintedAt: -Infinity,
    };
  }
  const cache = fieldCache;
  const moved =
    cache.cell !== layout.cell ||
    cache.offsetX !== layout.offsetX ||
    cache.offsetY !== layout.offsetY;
  if (moved || now - cache.paintedAt >= FIELD_REPAINT_MS) {
    const into = cache.canvas.getContext("2d");
    if (into) {
      into.clearRect(0, 0, cache.canvas.width, cache.canvas.height);
      paintField(into, layout, reef, creatures, catalog, sights, now);
    }
    cache.cell = layout.cell;
    cache.offsetX = layout.offsetX;
    cache.offsetY = layout.offsetY;
    cache.paintedAt = now;
  }
  ctx.drawImage(cache.canvas, 0, 0, width, height);
}

/**
 * The field: a lattice of short strokes that leans around what is being
 * perceived, in the colour of whatever is perceiving it.
 *
 * This is the piece. Quiet water is a faint, even weave all leaning the same
 * slowly-turning way. Wherever a creature can see, the strokes swing to lie
 * *around* it — perpendicular to the direction away from it, so they close
 * into a whorl rather than bursting out of it — brighten, lengthen, and take
 * that creature's own colour. Two creatures watching the same water make a
 * two-coloured interference where their whorls meet.
 *
 * It is the same information as a circle drawn at `sight` units, and it is a
 * far better drawing of it: a circle is a boundary somebody has to be told the
 * meaning of, and this is the water visibly behaving differently inside one.
 *
 * A triangular lattice rather than a square one. A square grid of dots reads
 * as graph paper — the eye finds the rows and columns immediately and then
 * stops looking. Offsetting every other row by half a step gives no axis to
 * lock onto, which is why every hand-drawn field in the world is laid out that
 * way.
 */
function paintField(
  ctx: CanvasRenderingContext2D,
  layout: Layout,
  reef: { readonly x: number; readonly y: number },
  creatures: readonly DrawnCreature[],
  catalog: readonly CatalogEntry[],
  sights: readonly number[],
  now: number,
): void {
  // Batched, and the batching is not an optimisation to be embarrassed about
  // -- it is the difference between this drawing existing and not. A stroke
  // per lattice point is nine hundred `beginPath`/`stroke` pairs and nine
  // hundred colour strings per frame, and it measured **twelve frames a
  // second**. Grouping by a quantised colour and alpha collapses that to about
  // twenty strokes, and nothing about the picture changes: six levels of alpha
  // is more than an eye resolves in a stroke this thin.
  const drift = now / 23000;
  const unit = layout.cell * LATTICE_STEP;
  const base = unit * 0.3;
  const ALPHA_LEVELS = 6;

  // One bucket per (species, alpha level), plus one for water nobody is
  // watching, which is most of it.
  const buckets = new Map<number, number[]>();
  const push = (key: number, x1: number, y1: number, x2: number, y2: number) => {
    let into = buckets.get(key);
    if (!into) {
      into = [];
      buckets.set(key, into);
    }
    into.push(x1, y1, x2, y2);
  };

  const cx = creatures.map((c) => c.x);
  const cy = creatures.map((c) => c.y);

  let row = 0;
  for (let gy = LATTICE_STEP * 0.5; gy < reef.y; gy += LATTICE_STEP * 0.866) {
    row += 1;
    const offset = row % 2 === 0 ? LATTICE_STEP * 0.5 : 0;
    for (let gx = offset + LATTICE_STEP * 0.5; gx < reef.x; gx += LATTICE_STEP) {
      let lift = 0;
      let aroundX = 0;
      let aroundY = 0;
      let loudest = -1;
      let loudestWeight = 0;
      for (let i = 0; i < creatures.length; i += 1) {
        const sight = sights[i]!;
        const dx = gx - cx[i]!;
        const dy = gy - cy[i]!;
        const square = dx * dx + dy * dy;
        if (square >= sight * sight || square < 1e-9) {
          continue;
        }
        const distance = Math.sqrt(square);
        const near = 1 - distance / sight;
        const weight = near * near;
        lift += weight;
        // Perpendicular to the direction away: a whorl, not a burst.
        aroundX += (-dy / distance) * weight;
        aroundY += (dx / distance) * weight;
        if (weight > loudestWeight) {
          loudestWeight = weight;
          loudest = i;
        }
      }

      const idleAngle =
        Math.sin(gx * 0.062 + drift) * 1.5 +
        Math.cos(gy * 0.079 - drift * 0.7) * 1.2 +
        Math.sin((gx + gy) * 0.031 + drift * 1.4) * 0.8;
      const pull = lift > 1 ? 1 : lift;
      const dirX = aroundX * pull + Math.cos(idleAngle) * (1 - pull);
      const dirY = aroundY * pull + Math.sin(idleAngle) * (1 - pull);
      const length = Math.sqrt(dirX * dirX + dirY * dirY);
      const ux = length > 1e-6 ? dirX / length : 1;
      const uy = length > 1e-6 ? dirY / length : 0;

      const strength = lift > 1 ? 1 : lift;
      const half = base * (0.72 + strength * 0.7);
      const px0 = layout.offsetX + gx * layout.cell;
      const py0 = layout.offsetY + gy * layout.cell;
      const level = Math.min(
        ALPHA_LEVELS - 1,
        Math.round(strength * (ALPHA_LEVELS - 1)),
      );
      const key = loudest < 0 || level === 0 ? -1 : loudest * ALPHA_LEVELS + level;
      push(key, px0 - ux * half, py0 - uy * half, px0 + ux * half, py0 + uy * half);
    }
  }

  // Butt caps, not round. A round cap on a stroke this short is two extra
  // arcs per segment and there are hundreds of them; nothing about the weave
  // reads differently without them.
  ctx.lineCap = "butt";
  for (const [key, points] of buckets) {
    let colour: string;
    let alpha: number;
    let width: number;
    if (key < 0) {
      colour = LINE;
      alpha = 0.19;
      width = Math.max(0.7, layout.cell * 0.024);
    } else {
      const species = Math.floor(key / ALPHA_LEVELS);
      const level = key % ALPHA_LEVELS;
      const strength = level / (ALPHA_LEVELS - 1);
      const hex = catalog[creatures[species]?.species ?? 0]?.colour;
      const [r, g, b] = hex ? rgbOf(hex) : [168, 226, 255];
      colour = `${r}, ${g}, ${b}`;
      alpha = 0.19 + strength * 0.55;
      width = Math.max(0.7, layout.cell * (0.024 + strength * 0.026));
    }
    ctx.strokeStyle = `rgba(${colour}, ${alpha})`;
    ctx.lineWidth = width;
    ctx.beginPath();
    for (let i = 0; i < points.length; i += 4) {
      ctx.moveTo(points[i]!, points[i + 1]!);
      ctx.lineTo(points[i + 2]!, points[i + 3]!);
    }
    ctx.stroke();
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

    // A bed is drawn as a *hole* in the field rather than as another bright
    // thing on top of it. The field is the loudest surface on the reef, so the
    // way to make cover unmistakable is to take the field away: a dark mass,
    // and the blades read against it instead of competing with the water. It
    // also happens to be true — a thicket is where the light stops.
    const shade = ctx.createRadialGradient(
      centre.px,
      centre.py,
      r * 0.1,
      centre.px,
      centre.py,
      r,
    );
    shade.addColorStop(0, "rgba(2, 10, 14, 0.9)");
    shade.addColorStop(0.7, "rgba(2, 10, 14, 0.72)");
    shade.addColorStop(1, "rgba(2, 10, 14, 0)");
    ctx.save();
    ctx.fillStyle = shade;
    ctx.beginPath();
    ctx.arc(centre.px, centre.py, r, 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();

    // The blades: exactly spaced, each swaying on its own phase, clipped to
    // the bed. Even spacing is what makes it read as a grown thing rather than
    // as scattered marks; the phase offset is what stops it reading as a comb.
    ctx.save();
    ctx.beginPath();
    ctx.arc(centre.px, centre.py, r, 0, Math.PI * 2);
    ctx.clip();
    const spacing = Math.max(3.4, layout.cell * 0.45);
    ctx.lineWidth = Math.max(0.8, layout.cell * 0.035);
    ctx.lineCap = "round";
    // Three alpha buckets rather than one stroke per blade. Five beds of fifty
    // blades was five hundred strokes a frame and it was most of why the reef
    // ran at fifteen.
    const LEVELS = 3;
    const lanes: number[][] = [[], [], []];
    for (let x = centre.px - r; x <= centre.px + r; x += spacing) {
      const seed = hash2(bed.x + x, bed.y);
      const height = r * (0.75 + seed * 0.55);
      const period = 5200 + seed * 4200;
      const lean = Math.sin(now / period + seed * 8) * r * 0.2;
      const rootY = centre.py + r;
      const lane = lanes[Math.min(LEVELS - 1, Math.floor(seed * LEVELS))]!;
      lane.push(x, rootY, x + lean * 0.4, rootY - height * 0.55, x + lean, rootY - height);
    }
    for (let level = 0; level < LEVELS; level += 1) {
      const seed = (level + 0.5) / LEVELS;
      ctx.strokeStyle = `rgba(${KELP}, ${0.2 + seed * 0.28})`;
      ctx.beginPath();
      for (let i = 0; i < lanes[level]!.length; i += 6) {
        const lane = lanes[level]!;
        ctx.moveTo(lane[i]!, lane[i + 1]!);
        ctx.quadraticCurveTo(lane[i + 2]!, lane[i + 3]!, lane[i + 4]!, lane[i + 5]!);
      }
      ctx.stroke();
    }
    ctx.restore();

    // The bed's own outline, dashed, so a visitor can see where cover ends
    // without the blades having to reach the rim.
    ctx.save();
    ctx.setLineDash([layout.cell * 0.3, layout.cell * 0.45]);
    ctx.strokeStyle = `rgba(${KELP}, 0.3)`;
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
    ctx.strokeStyle = `rgba(${colour}, ${0.08 + fullness * 0.17})`;
    ctx.lineWidth = Math.max(0.7, layout.cell * 0.03);
    ctx.beginPath();
    for (let i = 0; i < spokes; i += 1) {
      const a = (i / spokes) * Math.PI + index * 0.31 + now / 26000;
      const arm = r * breath;
      ctx.moveTo(centre.px - Math.cos(a) * arm, centre.py - Math.sin(a) * arm);
      ctx.lineTo(centre.px + Math.cos(a) * arm, centre.py + Math.sin(a) * arm);
    }
    ctx.stroke();

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

// --- One creature: a body built by repeating one shape down a spine. ---
//
// A single primitive is a token, not an animal. A body is a *series* of them:
// four to seven of the same polygon strung along the facing axis, each a
// little smaller or larger than the last, some of them turned a few degrees
// further round than the one in front, and the whole chain carrying a wave
// that travels from head to tail.
//
// That is the shape a segmented sea creature actually has, and it is also an
// ordinary generative move — one rule, repeated, varying — so it stays in the
// same register as the field it swims in rather than becoming an illustration
// pasted on top of one. And the wave is free motion: its speed and amplitude
// follow the creature's own, so a fleeing animal visibly thrashes and a
// resting one barely stirs, which is the signal the geometric marks lost.

type Primitive = "circle" | "triangle" | "diamond" | "hex";

interface Anatomy {
  /** Which polygon the body is made of. */
  readonly of: Primitive;
  /** How many of them. */
  readonly segments: number;
  /** How far apart, as a fraction of the head's radius. */
  readonly gap: number;
  /** The radius of each segment, head first, as fractions of the head's. */
  readonly profile: readonly number[];
  /** Degrees each segment is turned past the one in front. */
  readonly twist: number;
  /** How far the tail swings, as a fraction of the head's radius. */
  readonly sway: number;
  /** How many strokes fan out of the last segment. */
  readonly fin: number;
}

const ANATOMY: Readonly<Record<string, Anatomy>> = {
  // The grazer: round and blunt, a chain of circles that tapers gently. It is
  // the shape everything else is read against, so it is the plainest.
  round: {
    of: "circle",
    segments: 5,
    gap: 0.68,
    profile: [0.95, 1, 0.82, 0.58, 0.32],
    twist: 0,
    sway: 0.55,
    fin: 3,
  },
  // The hunter: long, narrow, and the only body made of a shape with a point.
  // Seven segments so the wave down it is visible as a wave.
  wedge: {
    of: "triangle",
    segments: 7,
    gap: 0.6,
    profile: [0.66, 0.95, 1, 0.82, 0.62, 0.42, 0.26],
    twist: 0,
    sway: 0.85,
    fin: 4,
  },
  // The scavenger: a short stack of diamonds, each turned a little further,
  // so the body reads as something crystalline drifting rather than swimming.
  ring: {
    of: "diamond",
    segments: 4,
    gap: 0.6,
    profile: [0.85, 1, 0.72, 0.44],
    twist: 22,
    sway: 0.45,
    fin: 2,
  },
  // The crab: three hexagons, largest at the front, barely swaying. A shell
  // with something under it.
  spiral: {
    of: "hex",
    segments: 3,
    gap: 0.56,
    profile: [1, 0.72, 0.45],
    twist: 14,
    sway: 0.22,
    fin: 2,
  },
};

const CRUISE_REFERENCE_SPEED = 1.6;

/// One primitive appended to whatever path is open, for building a union.
function subPath(
  ctx: CanvasRenderingContext2D,
  of: Primitive,
  cx: number,
  cy: number,
  r: number,
  angle: number,
): void {
  if (of === "circle") {
    ctx.moveTo(cx + r, cy);
    ctx.arc(cx, cy, r, 0, Math.PI * 2);
    return;
  }
  const sides = of === "triangle" ? 3 : of === "diamond" ? 4 : 6;
  for (let i = 0; i < sides; i += 1) {
    const a = angle + (i / sides) * Math.PI * 2;
    const x = cx + Math.cos(a) * r;
    const y = cy + Math.sin(a) * r;
    if (i === 0) {
      ctx.moveTo(x, y);
    } else {
      ctx.lineTo(x, y);
    }
  }
  ctx.closePath();
}

function primitivePath(
  ctx: CanvasRenderingContext2D,
  of: Primitive,
  cx: number,
  cy: number,
  r: number,
  angle: number,
): void {
  ctx.beginPath();
  if (of === "circle") {
    ctx.arc(cx, cy, r, 0, Math.PI * 2);
    return;
  }
  const sides = of === "triangle" ? 3 : of === "diamond" ? 4 : 6;
  for (let i = 0; i < sides; i += 1) {
    const a = angle + (i / sides) * Math.PI * 2;
    const x = cx + Math.cos(a) * r;
    const y = cy + Math.sin(a) * r;
    if (i === 0) {
      ctx.moveTo(x, y);
    } else {
      ctx.lineTo(x, y);
    }
  }
  ctx.closePath();
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
  const body = ANATOMY[entry.shape] ?? ANATOMY["round"]!;
  const head = (0.62 + entry.size * 0.12) * layout.cell;
  const speedFrac = Math.min(
    1,
    Math.max(0, creature.speed / CRUISE_REFERENCE_SPEED),
  );

  // The wave travels head to tail: one phase for the animal, and each segment
  // reads it a little later than the one in front.
  const beat = (0.5 + speedFrac * 2.4) / 1000;
  const phase = now * beat * Math.PI * 2 + creature.id * 2.399963;
  const amplitude = head * body.sway * (0.18 + speedFrac * 0.95);

  const dx = Math.cos(angle);
  const dy = Math.sin(angle);
  const nx = -dy;
  const ny = dx;

  const nodes: { x: number; y: number; r: number; a: number }[] = [];
  let along = 0;
  for (let i = 0; i < body.segments; i += 1) {
    const scale = body.profile[i] ?? 0.3;
    const r = head * scale;
    if (i > 0) {
      along += head * body.gap * ((body.profile[i - 1] ?? 1) + scale) * 0.5;
    }
    // Amplitude grows down the body: a head barely moves and a tail whips.
    const swing =
      Math.sin(phase - i * 0.85) * amplitude * (i / (body.segments - 1 || 1));
    nodes.push({
      x: centre.px - dx * along + nx * swing,
      y: centre.py - dy * along + ny * swing,
      r,
      a: angle + (body.twist * i * Math.PI) / 180,
    });
  }

  ctx.save();
  ctx.lineJoin = "round";

  // A halo around the head only, so a creature has weight without the whole
  // body glowing into a smear.
  ctx.globalAlpha = alphaMul * (0.09 + speedFrac * 0.15);
  ctx.strokeStyle = entry.colour;
  ctx.lineWidth = Math.max(1, layout.cell * 0.13);
  primitivePath(ctx, body.of, centre.px, centre.py, head * 1.45, angle);
  ctx.stroke();

  // The body as one path with every segment in it, filled once. Canvas fills
  // the *union* of the subpaths, so overlapping circles become a single
  // silhouette with no seams where they meet — which is the whole reason the
  // segments overlap this hard. A row of separately-filled shapes is a
  // caterpillar; their union is a body.
  ctx.globalAlpha = alphaMul * 0.3;
  ctx.fillStyle = entry.colour;
  ctx.beginPath();
  for (const node of nodes) {
    subPath(ctx, body.of, node.x, node.y, node.r, node.a);
  }
  ctx.fill();

  // Then every segment's own outline over the top, faintly. The internal arcs
  // are not a mistake to be cleaned up: they are what says this animal is
  // built out of one shape repeated, which is the register the rest of the
  // reef is drawn in.
  ctx.globalAlpha = alphaMul * 0.38;
  ctx.strokeStyle = entry.colour;
  ctx.lineWidth = Math.max(0.7, layout.cell * 0.025);
  ctx.beginPath();
  for (const node of nodes) {
    subPath(ctx, body.of, node.x, node.y, node.r, node.a);
  }
  ctx.stroke();

  // The head, brighter, so a body has a front.
  const headNode = nodes[0]!;
  ctx.globalAlpha = alphaMul * 0.95;
  ctx.lineWidth = Math.max(0.9, layout.cell * 0.045);
  primitivePath(ctx, body.of, headNode.x, headNode.y, headNode.r, headNode.a);
  ctx.stroke();

  // The fin: strokes fanning off the last segment, swinging with the wave.
  const tail = nodes[nodes.length - 1]!;
  const previous = nodes[nodes.length - 2] ?? tail;
  const backAngle = Math.atan2(tail.y - previous.y, tail.x - previous.x);
  ctx.globalAlpha = alphaMul * 0.8;
  ctx.strokeStyle = entry.colour;
  ctx.lineWidth = Math.max(0.9, layout.cell * 0.04);
  ctx.lineCap = "round";
  const spread = 0.55;
  ctx.beginPath();
  for (let i = 0; i < body.fin; i += 1) {
    const t = body.fin === 1 ? 0 : (i / (body.fin - 1)) * 2 - 1;
    const a = backAngle + t * spread;
    const reach = head * (1.35 + Math.abs(t) * 0.55);
    ctx.moveTo(tail.x, tail.y);
    ctx.lineTo(tail.x + Math.cos(a) * reach, tail.y + Math.sin(a) * reach);
  }
  ctx.stroke();

  // An eye, on the head, offset to one side. Two pixels of dark and the
  // difference between a shape moving and an animal looking where it goes.
  ctx.globalAlpha = alphaMul * 0.8;
  ctx.fillStyle = "rgba(4, 12, 18, 1)";
  ctx.beginPath();
  ctx.arc(
    centre.px + dx * head * 0.36 + nx * head * 0.3,
    centre.py + dy * head * 0.36 + ny * head * 0.3,
    Math.max(0.9, head * 0.15),
    0,
    Math.PI * 2,
  );
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
  drawField(
    ctx,
    layout,
    snapshot.reef,
    creatures,
    snapshot.catalog,
    sights,
    now,
    cssWidth,
    cssHeight,
  );
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
