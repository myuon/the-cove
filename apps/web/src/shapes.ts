// Drawing one creature.
//
// A tank told apart by hue alone is a tank a colour-blind visitor cannot
// read, so every species carries a shape as well as a colour
// (`species.toml`'s `visual.shape`), and this is the one place all four are
// drawn. `heading` only affects `wedge` — the shape that has a "front" to
// point somewhere — and is derived straight from what the creature is doing
// this tick rather than remembered, so a creature that is not currently
// moving or facing anything in particular just keeps its default heading.

export type Shape = "round" | "wedge" | "ring" | "spiral";

/** The four headings a `moved-*` or `move-*` string can name, as radians. */
const HEADING_ANGLE: Readonly<Record<string, number>> = {
  north: -Math.PI / 2,
  east: 0,
  south: Math.PI / 2,
  west: Math.PI,
};

/**
 * The heading named by a `moved-north`, `blocked-east`, or `move-west`
 * style string, or `null` if `text` does not end in one of the four
 * directions (`eat`, `hunt-7`, `hide`, `rest`, `hid`, `rested`, ...).
 */
export function headingAngleOf(text: string): number | null {
  for (const [name, angle] of Object.entries(HEADING_ANGLE)) {
    if (text.endsWith(name)) {
      return angle;
    }
  }
  return null;
}

/**
 * One creature's radius in pixels, from its catalog `size` and the cell it
 * is drawn in. `size` in the catalog runs 3 to 4 across today's four
 * species; the formula is deliberately gentle about that so a fifth species
 * with a size outside that range still draws as a plausible fraction of a
 * cell rather than overflowing it.
 */
export function radiusOf(cellPixels: number, size: number): number {
  return cellPixels * (0.16 + size * 0.045);
}

/** Draws one creature's shape, filled with `colour`, at `(cx, cy)`. */
export function drawShape(
  ctx: CanvasRenderingContext2D,
  shape: Shape,
  cx: number,
  cy: number,
  radius: number,
  colour: string,
  heading: number,
  outlineOnly: boolean,
): void {
  ctx.save();
  ctx.fillStyle = colour;
  ctx.strokeStyle = colour;
  switch (shape) {
    case "round":
      drawRound(ctx, cx, cy, radius, outlineOnly);
      break;
    case "wedge":
      drawWedge(ctx, cx, cy, radius, heading, outlineOnly);
      break;
    case "ring":
      drawRing(ctx, cx, cy, radius);
      break;
    case "spiral":
      drawSpiral(ctx, cx, cy, radius);
      break;
  }
  ctx.restore();
}

function drawRound(
  ctx: CanvasRenderingContext2D,
  cx: number,
  cy: number,
  r: number,
  outlineOnly: boolean,
): void {
  ctx.beginPath();
  ctx.arc(cx, cy, r, 0, Math.PI * 2);
  if (outlineOnly) {
    ctx.lineWidth = Math.max(1, r * 0.25);
    ctx.stroke();
  } else {
    ctx.fill();
  }
}

function drawWedge(
  ctx: CanvasRenderingContext2D,
  cx: number,
  cy: number,
  r: number,
  heading: number,
  outlineOnly: boolean,
): void {
  // An isosceles triangle, nose at `heading`, base behind it — a shape
  // `round` and `ring` do not have: one end of it is recognisably the front.
  const nose = { x: cx + Math.cos(heading) * r, y: cy + Math.sin(heading) * r };
  const back = heading + Math.PI;
  const spread = (Math.PI * 2) / 3;
  const left = {
    x: cx + Math.cos(back - spread / 2) * r,
    y: cy + Math.sin(back - spread / 2) * r,
  };
  const right = {
    x: cx + Math.cos(back + spread / 2) * r,
    y: cy + Math.sin(back + spread / 2) * r,
  };
  ctx.beginPath();
  ctx.moveTo(nose.x, nose.y);
  ctx.lineTo(left.x, left.y);
  ctx.lineTo(right.x, right.y);
  ctx.closePath();
  if (outlineOnly) {
    ctx.lineWidth = Math.max(1, r * 0.25);
    ctx.stroke();
  } else {
    ctx.fill();
  }
}

function drawRing(
  ctx: CanvasRenderingContext2D,
  cx: number,
  cy: number,
  r: number,
): void {
  // A stroked circle rather than a filled one: the hole in the middle is
  // what makes it a ring instead of a smaller round.
  ctx.lineWidth = Math.max(1, r * 0.65);
  ctx.beginPath();
  ctx.arc(cx, cy, r * 0.62, 0, Math.PI * 2);
  ctx.stroke();
}

function drawSpiral(
  ctx: CanvasRenderingContext2D,
  cx: number,
  cy: number,
  r: number,
): void {
  // An Archimedean spiral, radius proportional to angle, two and a quarter
  // turns drawn as short segments. The only one of the four shapes with no
  // straight edge and no symmetry axis, so it cannot be mistaken for a
  // squashed round or ring at a glance.
  const turns = 2.25;
  const steps = 24;
  ctx.lineWidth = Math.max(1, r * 0.22);
  ctx.lineCap = "round";
  ctx.beginPath();
  for (let i = 0; i <= steps; i += 1) {
    const t = i / steps;
    const angle = t * turns * Math.PI * 2;
    const radius = t * r;
    const x = cx + Math.cos(angle) * radius;
    const y = cy + Math.sin(angle) * radius;
    if (i === 0) {
      ctx.moveTo(x, y);
    } else {
      ctx.lineTo(x, y);
    }
  }
  ctx.stroke();
}
