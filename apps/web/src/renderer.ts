// Drawing the tank, back to front: floor, food, cover, creatures.
//
// Everything here reads a snapshot and draws it; nothing here decides
// anything about the world. The one thing the snapshot does not carry is
// cover — `cove.isCover` computes it the same way the tank does, from
// coordinates alone — and it is drawn between food and creatures so a
// creature standing in it is drawn on top of the reason it is there.

import { isCover } from "./cover.js";
import { cellCentre, type Layout } from "./layout.js";
import { drawShape, headingAngleOf, radiusOf } from "./shapes.js";
import type { CatalogEntry, FocusSnapshot, Snapshot } from "./snapshot.js";
import type { DrawnCreature, Departed } from "./interpolate.js";

/** A departed creature, plus the real time its death marker started fading. */
export interface DepartedMarker extends Departed {
  readonly startedAt: number;
}

/** How long a just-ate/just-hunted/just-spawned halo stays visible. */
export const FLASH_MS = 450;
/** How long a death marker lingers at the cell a creature was last seen in. */
export const DEPARTED_MS = 700;

/** One event this tick worth flashing, and when it started. */
export interface Flash {
  readonly kind: "ate" | "hunted" | "spawned";
  readonly startedAt: number;
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

const FLOOR = "#0e2f38";
const GRID_LINE = "rgba(255, 255, 255, 0.04)";
const COVER = "rgba(96, 200, 236, 0.16)";
const COVER_EDGE = "rgba(150, 226, 250, 0.55)";
const COVER_FROND = "rgba(150, 226, 250, 0.40)";

/** The reef floor's food levels, `0` (nothing) to `4` (dense), as a colour. */
export function foodColour(level: number): string | null {
  if (level <= 0) {
    return null;
  }
  // Darker and greener as it thickens, so "dense" and "sparse" read as depth
  // rather than as four arbitrary hues.
  const steps = [
    "rgba(90, 140, 70, 0.35)",
    "rgba(80, 150, 60, 0.55)",
    "rgba(65, 140, 50, 0.75)",
    "rgba(45, 120, 40, 0.92)",
  ];
  return steps[Math.min(level, steps.length) - 1] ?? null;
}

/** Draws one whole frame. `now` is `performance.now()`, for flash timing. */
export function render(
  ctx: CanvasRenderingContext2D,
  cssWidth: number,
  cssHeight: number,
  layout: Layout,
  snapshot: Snapshot,
  creatures: readonly DrawnCreature[],
  departed: readonly DepartedMarker[],
  flashes: ReadonlyMap<number, Flash>,
  now: number,
  selection: Selection,
): void {
  ctx.clearRect(0, 0, cssWidth, cssHeight);
  drawFloor(ctx, layout, snapshot.width, snapshot.height);
  drawFood(ctx, layout, snapshot.width, snapshot.food);
  drawCover(ctx, layout, snapshot.width, snapshot.height);
  drawDeparted(ctx, layout, departed, now);
  for (const creature of creatures) {
    const selected = creature.id === selection.id;
    drawCreature(
      ctx,
      layout,
      snapshot.catalog,
      creature,
      flashes.get(creature.id),
      now,
      // Dimmed whenever somebody else is selected, not whenever nobody is:
      // with no selection at all, every creature reads at full weight, the
      // way the tank always has.
      selection.id !== null && !selected,
      selected,
      selected && selection.debug && selection.focus
        ? `${selection.focus.instructions}i ${selection.focus.fuel}f`
        : null,
    );
  }
}

function drawFloor(
  ctx: CanvasRenderingContext2D,
  layout: Layout,
  width: number,
  height: number,
): void {
  ctx.fillStyle = FLOOR;
  ctx.fillRect(
    layout.offsetX,
    layout.offsetY,
    width * layout.cell,
    height * layout.cell,
  );
  ctx.strokeStyle = GRID_LINE;
  ctx.lineWidth = 1;
  for (let x = 0; x <= width; x += 1) {
    const px = layout.offsetX + x * layout.cell;
    ctx.beginPath();
    ctx.moveTo(px, layout.offsetY);
    ctx.lineTo(px, layout.offsetY + height * layout.cell);
    ctx.stroke();
  }
  for (let y = 0; y <= height; y += 1) {
    const py = layout.offsetY + y * layout.cell;
    ctx.beginPath();
    ctx.moveTo(layout.offsetX, py);
    ctx.lineTo(layout.offsetX + width * layout.cell, py);
    ctx.stroke();
  }
}

function drawFood(
  ctx: CanvasRenderingContext2D,
  layout: Layout,
  width: number,
  food: readonly number[],
): void {
  for (let i = 0; i < food.length; i += 1) {
    const colour = foodColour(food[i] ?? 0);
    if (!colour) {
      continue;
    }
    const x = i % width;
    const y = Math.floor(i / width);
    ctx.fillStyle = colour;
    ctx.fillRect(
      layout.offsetX + x * layout.cell,
      layout.offsetY + y * layout.cell,
      layout.cell,
      layout.cell,
    );
  }
}

function drawCover(
  ctx: CanvasRenderingContext2D,
  layout: Layout,
  width: number,
  height: number,
): void {
  const line = Math.max(1, layout.cell * 0.05);
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      if (!isCover(x, y)) {
        continue;
      }
      const px = layout.offsetX + x * layout.cell;
      const py = layout.offsetY + y * layout.cell;
      ctx.fillStyle = COVER;
      ctx.fillRect(px, py, layout.cell, layout.cell);

      // Kelp, as three diagonals rather than a wash of colour. Food is drawn
      // underneath as a green level and a fourth shade of green is a fourth
      // food level to anybody reading quickly, so cover is told apart by
      // having a texture at all — which also survives being looked at by
      // somebody who cannot tell the greens apart. It is the one thing on the
      // reef a visitor has to read to understand why a hunter stopped.
      ctx.save();
      ctx.beginPath();
      ctx.rect(px, py, layout.cell, layout.cell);
      ctx.clip();
      ctx.strokeStyle = COVER_FROND;
      ctx.lineWidth = line;
      for (let step = -1; step <= 1; step += 1) {
        const shift = (step * layout.cell) / 2.4;
        ctx.beginPath();
        ctx.moveTo(px + shift, py + layout.cell);
        ctx.lineTo(px + shift + layout.cell, py);
        ctx.stroke();
      }
      ctx.restore();

      ctx.strokeStyle = COVER_EDGE;
      ctx.lineWidth = line;
      ctx.strokeRect(
        px + line / 2,
        py + line / 2,
        layout.cell - line,
        layout.cell - line,
      );
    }
  }
}

function drawDeparted(
  ctx: CanvasRenderingContext2D,
  layout: Layout,
  departed: readonly DepartedMarker[],
  now: number,
): void {
  for (const gone of departed) {
    const age = now - gone.startedAt;
    // A marker past `DEPARTED_MS` is stale and the caller should have
    // dropped it, but drawing nothing for one is cheaper than trusting that
    // it always did.
    if (age < 0 || age > DEPARTED_MS) {
      continue;
    }
    const life = 1 - age / DEPARTED_MS;
    const { px, py } = cellCentre(layout, gone.x, gone.y);
    // Grows and fades: a ripple settling where a creature was, rather than
    // a mark that stays put and simply dims.
    const r = layout.cell * (0.2 + (1 - life) * 0.5);
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

function drawCreature(
  ctx: CanvasRenderingContext2D,
  layout: Layout,
  catalog: readonly CatalogEntry[],
  creature: DrawnCreature,
  flash: Flash | undefined,
  now: number,
  dimmed: boolean,
  selected: boolean,
  debugText: string | null,
): void {
  const entry = catalog[creature.species];
  if (!entry) {
    return;
  }
  const { px, py } = cellCentre(layout, creature.x, creature.y);
  const radius = radiusOf(layout.cell, entry.size);
  const heading =
    headingAngleOf(creature.result) ?? headingAngleOf(creature.intent) ?? 0;

  ctx.save();
  // A hidden creature reads as hidden: faint and outline-only, rather than
  // gone — the point of cover is that a visitor can still see who is using
  // it, only a hunter cannot. Dimming for a selection stacks on top of that
  // rather than replacing it, so a hidden creature that is not the one
  // selected reads as both at once.
  ctx.globalAlpha = (creature.hidden ? 0.4 : 1) * (dimmed ? 0.35 : 1);
  drawShape(
    ctx,
    entry.shape,
    px,
    py,
    radius,
    entry.colour,
    heading,
    creature.hidden,
  );
  ctx.restore();

  if (selected) {
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

  if (flash) {
    const age = now - flash.startedAt;
    if (age >= 0 && age <= FLASH_MS) {
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
  }
}
