// Drawing the tank: a dim, slow, luminous aquarium — not a diagram of one.
//
// This file is the whole of the art direction described in `docs/look.md`;
// read that first. The two things it marks load-bearing are the sight
// circle and the reaction line — everything else here (the water, the
// light, the kelp's sway, the motes) is atmosphere and could be deleted
// without changing what a visitor can learn from the tank, only how it
// feels to watch.
//
// # The one thing that makes this file possible
//
// The renderer is outside the determinism rule. Nothing the simulation does
// depends on a single pixel this file draws, so this is the one place in
// the whole page allowed to call `Math.sin`, read `performance.now()`, or
// seed its own randomness — every swaying frond and drifting mote comes out
// of that freedom, and none of it is allowed to feed back into a decision.
//
// # What is reef-space and what is screen-space
//
// The water's gradient, the light bands, the motes and the vignette are
// drawn in plain canvas pixels (`cssWidth` by `cssHeight`) and never touch
// `layout` — they are the tank's glass, not its contents, so they hold
// still while a visitor pans or zooms the camera around inside it. Every
// creature, every patch of food, every kelp bed, and the two load-bearing
// overlays are drawn through `layout.ts`'s `toPixel`, which is the reef's
// own coordinate system and moves exactly as the camera does.
//
// # What a non-selected creature's reaction line is approximating
//
// `contract.cove`'s `Observation` is bounded and only ever handed out for
// the one creature `tank_focus` is watching — the snapshot has no `nearby`
// for anybody else. So the reaction line and the sight circle for every
// *other* creature are this file's own approximation, built from the full
// snapshot rather than from a belief: the nearest creature of a hunting role
// within a per-role sight radius mirroring `sight_range` in
// `crates/simulation/src/world.rs`. It can point at a different creature
// than the one actually driving that decision when several are clustered,
// which is a cost worth paying — the alternative is either no line at all
// for the fourteen creatures nobody has clicked, or hiding the one thing
// `docs/look.md` calls the reason this was worth rebuilding.

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

// --- The water: a gradient, light bands, motes, a vignette. All of it
// screen-space and all of it cached across resizes rather than rebuilt
// every frame — `docs/look.md`'s own performance note. ---

interface ScreenCache {
  width: number;
  height: number;
  water: CanvasGradient;
  vignette: CanvasGradient;
  band: CanvasGradient;
}

let screenCache: ScreenCache | null = null;

function ensureScreenCache(
  ctx: CanvasRenderingContext2D,
  width: number,
  height: number,
): ScreenCache {
  if (
    screenCache &&
    screenCache.width === width &&
    screenCache.height === height
  ) {
    return screenCache;
  }
  const water = ctx.createLinearGradient(0, 0, 0, height);
  water.addColorStop(0, "#0a2b39");
  water.addColorStop(1, "#03101c");

  const vignette = ctx.createRadialGradient(
    width / 2,
    height / 2,
    Math.min(width, height) * 0.32,
    width / 2,
    height / 2,
    Math.hypot(width, height) * 0.62,
  );
  vignette.addColorStop(0, "rgba(0, 0, 0, 0)");
  vignette.addColorStop(1, "rgba(0, 0, 12, 0.55)");

  const diag = Math.hypot(width, height);
  const band = ctx.createLinearGradient(-diag * 0.09, 0, diag * 0.09, 0);
  band.addColorStop(0, "rgba(210, 240, 255, 0)");
  band.addColorStop(0.5, "rgba(210, 240, 255, 1)");
  band.addColorStop(1, "rgba(210, 240, 255, 0)");

  screenCache = { width, height, water, vignette, band };
  return screenCache;
}

function drawWater(
  ctx: CanvasRenderingContext2D,
  width: number,
  height: number,
  cache: ScreenCache,
): void {
  ctx.fillStyle = cache.water;
  ctx.fillRect(0, 0, width, height);
}

const LIGHT_BANDS = 3;

function drawLightBands(
  ctx: CanvasRenderingContext2D,
  width: number,
  height: number,
  now: number,
  cache: ScreenCache,
): void {
  const diag = Math.hypot(width, height);
  ctx.save();
  ctx.beginPath();
  ctx.rect(0, 0, width, height);
  ctx.clip();
  for (let i = 0; i < LIGHT_BANDS; i += 1) {
    const period = 26000 + i * 8000;
    const phase = ((now / period + i / LIGHT_BANDS) % 1) - 0.5;
    ctx.save();
    ctx.translate(width / 2, height / 2);
    ctx.rotate(-0.4 + i * 0.11);
    ctx.translate(phase * diag * 2.2, 0);
    ctx.globalAlpha = 0.26 - i * 0.05;
    ctx.fillStyle = cache.band;
    ctx.fillRect(-diag * 0.09, -diag, diag * 0.18, diag * 2);
    ctx.restore();
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

interface MoteDef {
  readonly fx: number;
  readonly fy: number;
  readonly phase: number;
  readonly fadePeriod: number;
  readonly risePeriod: number;
  readonly swayPx: number;
  readonly swayPeriod: number;
  readonly sizePx: number;
}

const MOTE_COUNT = 60;
const MOTES: readonly MoteDef[] = (() => {
  const draw = mulberry32(0x5eed_0905);
  const motes: MoteDef[] = [];
  for (let i = 0; i < MOTE_COUNT; i += 1) {
    motes.push({
      fx: draw(),
      fy: draw(),
      phase: draw() * Math.PI * 2,
      fadePeriod: 9000 + draw() * 9000,
      risePeriod: 45000 + draw() * 45000,
      swayPx: 6 + draw() * 14,
      swayPeriod: 6000 + draw() * 6000,
      sizePx: 0.6 + draw() * 1.5,
    });
  }
  return motes;
})();

function drawMotes(
  ctx: CanvasRenderingContext2D,
  width: number,
  height: number,
  now: number,
): void {
  ctx.save();
  ctx.fillStyle = "#dff6ff";
  for (const mote of MOTES) {
    const rise = (now / mote.risePeriod) % 1;
    const y = height * (1 - ((mote.fy + rise) % 1));
    const sway = Math.sin(now / mote.swayPeriod + mote.phase) * mote.swayPx;
    const x = mote.fx * width + sway;
    const alpha =
      0.12 + 0.16 * (0.5 + 0.5 * Math.sin(now / mote.fadePeriod + mote.phase));
    ctx.globalAlpha = alpha;
    ctx.beginPath();
    ctx.arc(x, y, mote.sizePx, 0, Math.PI * 2);
    ctx.fill();
  }
  ctx.restore();
}

// --- Kelp: not circles. A clump of fronds rooted along a bed's lower edge,
// swaying out of phase on a slow sine. Drawn twice — once behind everything
// (`drawKelpBack`) and once, only over a hidden creature, in front of it
// (`drawKelpFrondsOver`) — so a creature standing in the weed reads as
// inside it rather than merely tagged `hidden`. ---

const KELP_COLOUR = "70, 196, 176";

interface Frond {
  readonly rootX: number;
  readonly rootY: number;
  readonly height: number;
  readonly phase: number;
  readonly period: number;
  readonly bend: number;
  readonly alpha: number;
  readonly width: number;
}

// Kelp never moves once seeded (`crates/simulation/src/world.rs`: "Seeded
// once, and never moves"), so a bed's fronds are cached by its own position
// rather than rebuilt every frame — the one allocation this file would
// otherwise repeat sixty times a second for no reason, since the shape is
// the same fronds every time regardless of `now`. Keyed by position and not
// invalidated across "New world": at five beds a session, the worst case is
// a few dozen stale entries after a long run of reopening the tank, which
// costs nothing worth a reset hook this file does not otherwise need.
const frondCache = new Map<string, Frond[]>();

function frondsOf(bed: Bed): Frond[] {
  const key = `${bed.x},${bed.y},${bed.radius}`;
  const cached = frondCache.get(key);
  if (cached) {
    return cached;
  }
  const count = 13 + Math.floor(hash2(bed.x, bed.y) * 7);
  const fronds: Frond[] = [];
  for (let i = 0; i < count; i += 1) {
    const h = hash2(bed.x + i * 17.13, bed.y - i * 9.71);
    // Jittered rather than evenly spaced: a row of fronds at equal intervals
    // reads as a fence, and the point of a bed is that it is a thicket.
    const spread =
      (count > 1 ? (i / (count - 1)) * 2 - 1 : 0) +
      (hash2(bed.y + i * 3.7, bed.x - i * 5.3) - 0.5) * 0.35;
    const rootX = bed.x + spread * bed.radius * 0.82;
    const drop = bed.radius * bed.radius - (spread * bed.radius * 0.82) ** 2;
    const rootY = bed.y + Math.sqrt(Math.max(0, drop)) * 0.92;
    fronds.push({
      rootX,
      rootY,
      height: bed.radius * (0.4 + h * 0.45),
      phase: h * Math.PI * 2,
      period: 6500 + h * 5500,
      bend: 0.18 + hash2(bed.x * 3 + i, bed.y * 5 - i) * 0.3,
      alpha: 0.26 + h * 0.3,
      width: 0.7 + h * 0.5,
    });
  }
  frondCache.set(key, fronds);
  return fronds;
}

function drawFrond(
  ctx: CanvasRenderingContext2D,
  layout: Layout,
  bed: Bed,
  frond: Frond,
  now: number,
  alphaMul: number,
): void {
  const sway = Math.sin(now / frond.period + frond.phase);
  const root = toPixel(layout, frond.rootX, frond.rootY);
  const tip = toPixel(
    layout,
    frond.rootX + frond.bend * bed.radius * sway,
    frond.rootY - frond.height,
  );
  const mid = toPixel(
    layout,
    frond.rootX + frond.bend * bed.radius * sway * 0.45,
    frond.rootY - frond.height * 0.5,
  );
  ctx.save();
  ctx.globalAlpha = frond.alpha * alphaMul;
  ctx.strokeStyle = `rgba(${KELP_COLOUR}, 1)`;
  ctx.lineWidth = Math.max(1, layout.cell * frond.width * 0.09);
  ctx.lineCap = "round";
  ctx.beginPath();
  ctx.moveTo(root.px, root.py);
  ctx.quadraticCurveTo(mid.px, mid.py, tip.px, tip.py);
  ctx.stroke();
  ctx.restore();
}

function drawKelpBack(
  ctx: CanvasRenderingContext2D,
  layout: Layout,
  kelp: readonly Bed[],
  now: number,
): void {
  for (const bed of kelp) {
    // A soft wash under the fronds so the bed reads as one thing even where
    // its fronds are sparse — kelp is the one load-bearing shape on the
    // reef, and a visitor has to be able to find it at a glance.
    const centre = toPixel(layout, bed.x, bed.y);
    ctx.save();
    const wash = ctx.createRadialGradient(
      centre.px,
      centre.py,
      bed.radius * layout.cell * 0.15,
      centre.px,
      centre.py,
      bed.radius * layout.cell,
    );
    wash.addColorStop(0, `rgba(${KELP_COLOUR}, 0.30)`);
    wash.addColorStop(0.7, `rgba(${KELP_COLOUR}, 0.10)`);
    wash.addColorStop(1, `rgba(${KELP_COLOUR}, 0)`);
    ctx.fillStyle = wash;
    ctx.beginPath();
    ctx.arc(centre.px, centre.py, bed.radius * layout.cell, 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();
    for (const frond of frondsOf(bed)) {
      drawFrond(ctx, layout, bed, frond, now, 1);
    }
  }
}

function drawKelpFrondsOver(
  ctx: CanvasRenderingContext2D,
  layout: Layout,
  bed: Bed,
  atX: number,
  now: number,
): void {
  const fronds = frondsOf(bed)
    .slice()
    .sort((a, b) => Math.abs(a.rootX - atX) - Math.abs(b.rootX - atX))
    .slice(0, 2);
  for (const frond of fronds) {
    drawFrond(ctx, layout, bed, frond, now, 1.6);
  }
}

// --- Food: soft blobs built from a few layered, translucent circles rather
// than a fresh radial gradient every frame — cheap, and the effect reads
// the same. A carcass gets a warmer palette and, for a short while after it
// lands, a bloom instead of a fade-in. ---

function foodPulse(index: number, now: number): number {
  const phase = hash2(index * 12.9898, index * 78.233) * Math.PI * 2;
  const period = 4200 + hash2(index * 3.1, index * 7.7) * 3200;
  return 0.85 + 0.15 * Math.sin(now / period + phase);
}

function drawFood(
  ctx: CanvasRenderingContext2D,
  layout: Layout,
  food: readonly Morsel[],
  carcasses: ReadonlyMap<number, number>,
  now: number,
): void {
  for (let index = 0; index < food.length; index += 1) {
    const morsel = food[index];
    if (!morsel || morsel.amount <= 0) {
      continue;
    }
    const centre = toPixel(layout, morsel.x, morsel.y);
    const pulse = foodPulse(index, now);
    const fullness = Math.min(1, morsel.amount / 4);
    const bornAt = carcasses.get(index);
    const bloomAge = bornAt === undefined ? Infinity : now - bornAt;
    const blooming = bloomAge >= 0 && bloomAge < CARCASS_BLOOM_MS;
    const outer = blooming
      ? "223, 110, 90"
      : "150, 214, 150";
    const inner = blooming ? "255, 176, 96" : "224, 208, 96";

    ctx.save();
    // Dimmer and smaller than it looks like it should be on paper. Food is
    // everywhere and creatures are few, so anything the food does at full
    // strength it does thirty times at once and wins the picture.
    // One gradient rather than three stacked discs. The discs drew visible
    // edges where they met, so every mouthful read as a ring — a target rather
    // than a smudge of something growing. And dimmer and smaller than it looks
    // like it should be on paper: food is everywhere and creatures are few, so
    // anything the food does at full strength it does thirty times at once and
    // wins the picture.
    const r = morsel.radius * layout.cell * (0.5 + fullness * 0.4);
    const core = (0.2 + fullness * 0.22) * pulse;
    const glow = ctx.createRadialGradient(
      centre.px,
      centre.py,
      0,
      centre.px,
      centre.py,
      r,
    );
    glow.addColorStop(0, `rgba(${inner}, ${core})`);
    glow.addColorStop(0.45, `rgba(${outer}, ${core * 0.42})`);
    glow.addColorStop(1, `rgba(${outer}, 0)`);
    ctx.fillStyle = glow;
    ctx.beginPath();
    ctx.arc(centre.px, centre.py, r, 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();

    if (blooming) {
      const t = bloomAge / CARCASS_BLOOM_MS;
      ctx.save();
      ctx.globalAlpha = (1 - t) * 0.6;
      ctx.strokeStyle = "rgba(255, 140, 110, 1)";
      ctx.lineWidth = Math.max(1, layout.cell * 0.08);
      ctx.beginPath();
      ctx.arc(centre.px, centre.py, r * (0.4 + t * 1.4), 0, Math.PI * 2);
      ctx.stroke();
      ctx.restore();
    }
  }
}

// --- Trails: a short fading path behind each creature. ---

function drawTrails(
  ctx: CanvasRenderingContext2D,
  layout: Layout,
  trails: ReadonlyMap<number, readonly TrailPoint[]>,
  catalog: readonly CatalogEntry[],
  creatures: readonly DrawnCreature[],
  now: number,
): void {
  const speciesOf = new Map(creatures.map((c) => [c.id, c.species]));
  for (const [id, points] of trails) {
    const entry = catalog[speciesOf.get(id) ?? -1];
    if (!entry || points.length < 2) {
      continue;
    }
    ctx.save();
    ctx.strokeStyle = entry.colour;
    ctx.lineCap = "round";
    ctx.lineWidth = Math.max(1, layout.cell * 0.05);
    for (let i = 0; i < points.length - 1; i += 1) {
      const a = points[i];
      const b = points[i + 1];
      if (!a || !b) {
        continue;
      }
      const age = now - a.t;
      const life = 1 - age / TRAIL_MS;
      if (life <= 0) {
        continue;
      }
      const pa = toPixel(layout, a.x, a.y);
      const pb = toPixel(layout, b.x, b.y);
      ctx.globalAlpha = life * 0.28;
      ctx.beginPath();
      ctx.moveTo(pa.px, pa.py);
      ctx.lineTo(pb.px, pb.py);
      ctx.stroke();
    }
    ctx.restore();
  }
}

// --- The sight circle and the reaction line — the two load-bearing pieces.
// ---

/** Mirrors `sight_range` in `crates/simulation/src/world.rs`, in reef units.
 * Used only to draw an approximate ring on a creature nobody has clicked —
 * see the module comment for why this cannot be exact. */
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

function drawSightCircle(
  ctx: CanvasRenderingContext2D,
  layout: Layout,
  px: number,
  py: number,
  sightUnits: number,
  selected: boolean,
): void {
  ctx.save();
  ctx.globalAlpha = selected ? 0.32 : 0.05;
  ctx.strokeStyle = selected ? "#eaffff" : "#bfe9ff";
  ctx.lineWidth = Math.max(0.6, layout.cell * (selected ? 0.035 : 0.02));
  ctx.beginPath();
  ctx.arc(px, py, sightUnits * layout.cell, 0, Math.PI * 2);
  ctx.stroke();
  ctx.restore();
}

const REASON_LINE_COLOUR: Readonly<Record<string, string>> = {
  fleeing_threat: "255, 138, 101",
  hunting: "212, 85, 60",
  sheltering: `${KELP_COLOUR}`,
  seeking_food: "180, 224, 150",
  crowded: "196, 180, 224",
};

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
  const colour = REASON_LINE_COLOUR[reason] ?? "255, 255, 255";
  const from = toPixel(layout, fromX, fromY);
  const to = toPixel(layout, toX, toY);
  ctx.save();
  ctx.globalAlpha = selected ? 0.55 : 0.28;
  ctx.strokeStyle = `rgba(${colour}, 1)`;
  ctx.lineWidth = Math.max(0.6, layout.cell * (selected ? 0.05 : 0.03));
  ctx.beginPath();
  ctx.moveTo(from.px, from.py);
  ctx.lineTo(to.px, to.py);
  ctx.stroke();
  ctx.restore();
}

/** The approximate target a non-selected creature's `fleeing_threat` or
 * `hunting` line points to — see the module comment. `null` for every other
 * reason, matching `docs/look.md`'s "only when the reason is
 * `fleeing_threat` or `hunting`". */
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

// --- One creature: a body and a tail, oriented along `facing`, undulating
// with `speed`. The single biggest "alive" signal on the reef, and the one
// thing the grid version never had — everything there moved one cell per
// tick, so a fleeing creature was animated exactly like a browsing one. ---

interface Silhouette {
  readonly lengthMul: number;
  readonly widthMul: number;
  readonly tailMul: number;
  readonly forked: boolean;
  readonly shell: boolean;
}

const SILHOUETTES: Readonly<Record<string, Silhouette>> = {
  round: { lengthMul: 1.0, widthMul: 1.0, tailMul: 1.05, forked: false, shell: false },
  wedge: { lengthMul: 1.55, widthMul: 0.72, tailMul: 1.35, forked: true, shell: false },
  ring: { lengthMul: 0.82, widthMul: 0.82, tailMul: 1.6, forked: false, shell: false },
  spiral: { lengthMul: 0.85, widthMul: 1.2, tailMul: 0.65, forked: false, shell: true },
};

/** A cruise speed no catalog species swims faster than today
 * (`kelpHunter.cove`'s `cruise = 1.45`), used only to turn `speed` into a
 * fraction for the tail's amplitude and frequency — a creature at the edge
 * of what anything on this reef can do should thrash, not merely sway a
 * little harder than one ambling along at a third of it. */
const CRUISE_REFERENCE = 1.45;

/// One caudal fin, filled.
///
/// It was a stroked curve, which drew a line, which made every creature that
/// was not the hunter read as a lollipop: a disc with a pin behind it. A tail
/// is a shape. Filling it is the whole difference between a token on a board
/// and something swimming.
function drawTailFin(
  ctx: CanvasRenderingContext2D,
  baseX: number,
  baseY: number,
  angle: number,
  length: number,
  sway: number,
  finHalf: number,
  forked: boolean,
): void {
  const dx = Math.cos(angle);
  const dy = Math.sin(angle);
  const px = -dy;
  const py = dx;
  const tipX = baseX - dx * length + px * sway;
  const tipY = baseY - dy * length + py * sway;
  const midX = baseX - dx * length * 0.5 + px * sway * 0.45;
  const midY = baseY - dy * length * 0.5 + py * sway * 0.45;
  const upX = tipX + px * finHalf;
  const upY = tipY + py * finHalf;
  const downX = tipX - px * finHalf;
  const downY = tipY - py * finHalf;
  // A forked tail notches towards the body; a rounded one bulges away from
  // it. That one difference is most of what tells a hunter from a grazer at a
  // glance, before any colour is read.
  const notchX = forked ? tipX + dx * finHalf * 0.8 : tipX - dx * finHalf * 0.35;
  const notchY = forked ? tipY + dy * finHalf * 0.8 : tipY - dy * finHalf * 0.35;

  ctx.beginPath();
  ctx.moveTo(baseX, baseY);
  ctx.quadraticCurveTo(midX + px * finHalf * 0.2, midY + py * finHalf * 0.2, upX, upY);
  ctx.quadraticCurveTo(notchX, notchY, downX, downY);
  ctx.quadraticCurveTo(midX - px * finHalf * 0.2, midY - py * finHalf * 0.2, baseX, baseY);
  ctx.closePath();
  ctx.fill();
}

/// One body, filled and tapered: a nose at the front and a waist at the tail.
///
/// An ellipse has no front. A creature drawn as one is a creature whose
/// direction a visitor has to infer from its tail, and inferring is exactly
/// what this whole rebuild is trying to stop them having to do.
function drawBody(
  ctx: CanvasRenderingContext2D,
  cx: number,
  cy: number,
  angle: number,
  length: number,
  width: number,
  bend: number,
): void {
  const dx = Math.cos(angle);
  const dy = Math.sin(angle);
  const px = -dy;
  const py = dx;
  const noseX = cx + dx * length * 0.5;
  const noseY = cy + dy * length * 0.5;
  const waistX = cx - dx * length * 0.5 + px * bend;
  const waistY = cy - dy * length * 0.5 + py * bend;
  // The widest point sits forward of centre, which is where it sits on a
  // fish and why a fish looks like it is going somewhere.
  const shoulderX = cx + dx * length * 0.12;
  const shoulderY = cy + dy * length * 0.12;
  const half = width * 0.5;

  ctx.beginPath();
  ctx.moveTo(noseX, noseY);
  ctx.quadraticCurveTo(shoulderX + px * half, shoulderY + py * half, waistX, waistY);
  ctx.quadraticCurveTo(shoulderX - px * half, shoulderY - py * half, noseX, noseY);
  ctx.closePath();
  ctx.fill();
}

function drawCreatureBody(
  ctx: CanvasRenderingContext2D,
  layout: Layout,
  entry: CatalogEntry,
  creature: DrawnCreature,
  now: number,
  alphaMul: number,
): void {
  const centre = toPixel(layout, creature.x, creature.y);
  const angle = Math.atan2(creature.facingY, creature.facingX);
  const silhouette = SILHOUETTES[entry.shape] ?? SILHOUETTES["round"]!;
  // The subject of the picture, and sized to say so. It was 0.42 + size*0.09,
  // which on this reef drew a grazer nine pixels across against a mouthful of
  // food thirty-two -- so the food read as the animals and the animals read as
  // punctuation. A reef is a picture of its creatures.
  const baseRadius = (0.8 + entry.size * 0.14) * layout.cell;
  const bodyLength = baseRadius * 2 * silhouette.lengthMul;
  const bodyWidth = baseRadius * 2 * silhouette.widthMul;
  const tailLength = baseRadius * 2 * silhouette.tailMul;

  const speedFrac = Math.min(1, Math.max(0, creature.speed / CRUISE_REFERENCE));
  const freqPerMs = (0.55 + speedFrac * 2.1) / 1000;
  // A tail thrashes; it does not detach. The first pass swung a full body's
  // width and the fin read as a second creature keeping station behind the
  // first.
  const amplitude = bodyWidth * (0.1 + speedFrac * 0.5);
  const phase = (creature.id * 2.399963) % (Math.PI * 2);
  const sway = Math.sin(now * freqPerMs * Math.PI * 2 + phase) * amplitude;

  ctx.save();
  ctx.globalAlpha = alphaMul;

  // The glow: a soft radial halo in the creature's own colour, which is
  // where "luminous" comes from and what makes it read against dark water.
  for (const [mul, glowAlpha] of [
    [2.4, 0.05],
    [1.7, 0.09],
  ] as const) {
    ctx.globalAlpha = alphaMul * glowAlpha;
    ctx.fillStyle = entry.colour;
    ctx.beginPath();
    ctx.arc(centre.px, centre.py, baseRadius * mul, 0, Math.PI * 2);
    ctx.fill();
  }

  // The tail, behind the body so its base disappears under it.
  const tailBase = {
    x: centre.px - Math.cos(angle) * bodyLength * 0.34,
    y: centre.py - Math.sin(angle) * bodyLength * 0.34,
  };
  ctx.globalAlpha = alphaMul * 0.9;
  ctx.fillStyle = entry.colour;
  drawTailFin(
    ctx,
    tailBase.x,
    tailBase.y,
    angle,
    tailLength * 0.8,
    sway,
    bodyWidth * 0.42,
    silhouette.forked,
  );

  // The body itself, tapered and bending a little with the tail.
  ctx.globalAlpha = alphaMul;
  ctx.fillStyle = entry.colour;
  drawBody(
    ctx,
    centre.px,
    centre.py,
    angle,
    bodyLength,
    bodyWidth,
    sway * 0.22,
  );

  // An eye. Two pixels of dark near the nose, and the difference between a
  // shape moving and an animal looking where it is going.
  const eyeX = centre.px + Math.cos(angle) * bodyLength * 0.28 - Math.sin(angle) * bodyWidth * 0.16;
  const eyeY = centre.py + Math.sin(angle) * bodyLength * 0.28 + Math.cos(angle) * bodyWidth * 0.16;
  ctx.globalAlpha = alphaMul * 0.75;
  ctx.fillStyle = "rgba(6, 18, 24, 1)";
  ctx.beginPath();
  ctx.arc(eyeX, eyeY, Math.max(0.8, baseRadius * 0.13), 0, Math.PI * 2);
  ctx.fill();

  if (silhouette.shell) {
    // The hermit crab's shell: an arc over the body rather than a second
    // filled shape, so it reads as riding on the crab and not as a second
    // creature.
    ctx.globalAlpha = alphaMul * 0.9;
    ctx.strokeStyle = "rgba(40, 28, 8, 0.55)";
    ctx.lineWidth = Math.max(1, baseRadius * 0.22);
    ctx.beginPath();
    ctx.ellipse(
      centre.px,
      centre.py,
      bodyLength * 0.38,
      bodyWidth * 0.42,
      angle,
      Math.PI * 1.15,
      Math.PI * 1.85,
    );
    ctx.stroke();
  }
  ctx.restore();
}

function drawSelectionRing(
  ctx: CanvasRenderingContext2D,
  layout: Layout,
  px: number,
  py: number,
  radius: number,
  debugText: string | null,
): void {
  ctx.save();
  ctx.strokeStyle = "#ffe27a";
  ctx.lineWidth = Math.max(1.5, layout.cell * 0.07);
  ctx.beginPath();
  ctx.arc(px, py, radius + layout.cell * 0.22, 0, Math.PI * 2);
  ctx.stroke();
  if (debugText) {
    ctx.font = `${Math.max(9, Math.round(layout.cell * 0.3))}px monospace`;
    ctx.textAlign = "center";
    ctx.textBaseline = "bottom";
    ctx.fillStyle = "#ffe27a";
    ctx.fillText(debugText, px, py - radius - layout.cell * 0.28);
  }
  ctx.restore();
}

function drawFlash(
  ctx: CanvasRenderingContext2D,
  layout: Layout,
  px: number,
  py: number,
  radius: number,
  flash: Flash,
  now: number,
): void {
  const age = now - flash.startedAt;
  if (age < 0 || age > FLASH_MS) {
    return;
  }
  const t = age / FLASH_MS;
  ctx.save();
  ctx.globalAlpha = 1 - t;
  ctx.strokeStyle = flash.kind === "hunted" ? "#ff5a4d" : "#fff2b0";
  ctx.lineWidth = Math.max(1, layout.cell * 0.06);
  ctx.beginPath();
  ctx.arc(px, py, radius + layout.cell * 0.18 * t + radius * 0.3, 0, Math.PI * 2);
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
    const life = 1 - age / DEPARTED_MS;
    const { px, py } = toPixel(layout, gone.x, gone.y);
    const r = layout.cell * (0.5 + (1 - life) * 1.1);
    ctx.save();
    ctx.globalAlpha = life * 0.7;
    ctx.strokeStyle = "#1a1410";
    ctx.lineWidth = Math.max(1, layout.cell * 0.08);
    ctx.beginPath();
    ctx.arc(px, py, r, 0, Math.PI * 2);
    ctx.stroke();
    ctx.restore();
  }
}

/** Draws one whole frame. `now` is `performance.now()`, for every animated
 * or flashing thing here. */
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

  drawWater(ctx, cssWidth, cssHeight, screen);
  drawLightBands(ctx, cssWidth, cssHeight, now, screen);
  drawKelpBack(ctx, layout, snapshot.kelp, now);
  drawFood(ctx, layout, snapshot.food, carcasses, now);
  drawTrails(ctx, layout, trails, snapshot.catalog, creatures, now);
  drawDeparted(ctx, layout, departed, now);

  const focus =
    selection.focus && selection.focus.id === selection.id
      ? selection.focus
      : null;

  for (const creature of creatures) {
    const selected = creature.id === selection.id;
    const centre = toPixel(layout, creature.x, creature.y);
    const sight = selected && focus ? focus.observation.sight : approxSight(
      snapshot.catalog[creature.species]?.role,
    );
    drawSightCircle(ctx, layout, centre.px, centre.py, sight, selected);
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
    const alphaMul = (creature.hidden ? 0.4 : 1) * (dimmed ? 0.35 : 1);
    drawCreatureBody(ctx, layout, entry, creature, now, alphaMul);

    const centre = toPixel(layout, creature.x, creature.y);
    const radius = (0.8 + entry.size * 0.14) * layout.cell;
    if (selected) {
      const debugText =
        selection.debug && focus
          ? `${focus.instructions}i ${focus.fuel}f`
          : null;
      drawSelectionRing(ctx, layout, centre.px, centre.py, radius, debugText);
    }
    const flash = flashes.get(creature.id);
    if (flash) {
      drawFlash(ctx, layout, centre.px, centre.py, radius, flash, now);
    }
  }

  // Kelp fronds that pass in front of a hidden creature, so it reads as
  // standing *in* the weed rather than merely marked as hidden.
  for (const creature of creatures) {
    if (!creature.hidden) {
      continue;
    }
    const bed = snapshot.kelp.find(
      (candidate) =>
        Math.hypot(candidate.x - creature.x, candidate.y - creature.y) <=
        candidate.radius,
    );
    if (bed) {
      drawKelpFrondsOver(ctx, layout, bed, creature.x, now);
    }
  }

  drawMotes(ctx, cssWidth, cssHeight, now);
  drawVignette(ctx, cssWidth, cssHeight, screen);
}
