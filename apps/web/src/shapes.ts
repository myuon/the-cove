// Drawing one creature's static silhouette — the legend's swatch, and
// nothing on the moving reef itself.
//
// A tank told apart by hue alone is a tank a colour-blind visitor cannot
// read, so every species carries a shape as well as a colour
// (`species.toml`'s `visual.shape`), and this is where the legend draws a
// small unmoving icon of each one. The tank's own creatures are drawn by
// `renderer.ts`, which gives each one a body and a tail that orients along
// its `facing` and undulates with its `speed` — a fixed icon has neither, so
// it stays here and the live rendering does not call it.
//
// There is no more `headingAngleOf`: the old grid encoded a creature's
// heading in strings like `moved-north`, and a continuous reef never does —
// a creature's `facing` is a unit vector on the snapshot already, and an
// angle is one `Math.atan2` away wherever the live renderer wants one.

export type Shape = "round" | "wedge" | "ring" | "spiral";

/**
 * One legend swatch's radius in pixels, from its catalog `size` and the
 * pixel budget the caller drew it in. `size` in the catalog runs 3 to 4
 * across today's four species; the formula is deliberately gentle about
 * that so a fifth species with a size outside that range still draws as a
 * plausible fraction of the swatch rather than overflowing it.
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
