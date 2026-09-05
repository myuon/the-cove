// Verifies the pure functions the loop and renderer are built from, without
// a browser: layout arithmetic, tick-accumulation, and cross-tick creature
// interpolation. Run after `npm run build`, since it imports the compiled
// output in `dist/`, not the TypeScript source.
//
//   $ npm run build && npm test

import test from "node:test";
import assert from "node:assert/strict";

import { computeLayout, toPixel, zoomedLayout } from "../dist/layout.js";
import { advance, alphaOf } from "../dist/loop.js";
import { interpolateCreatures, departedCreatures } from "../dist/interpolate.js";
import { RollingAverage, DecisionRate } from "../dist/panel.js";
import { radiusOf } from "../dist/shapes.js";

test("computeLayout fits a wide reef into a tall canvas without stretching", () => {
  const layout = computeLayout(1000, 400, 100, 75, 0);
  // 1000/100 = 10, 400/75 = 5.33 -- the shorter side wins.
  assert.ok(Math.abs(layout.cell - 400 / 75) < 1e-9);
  assert.ok(layout.offsetY >= 0 && layout.offsetY < layout.cell);
  assert.ok(Math.abs(layout.offsetX - (1000 - layout.cell * 100) / 2) < 1e-9);
});

test("computeLayout centres a reef smaller than its margin-adjusted canvas", () => {
  const layout = computeLayout(220, 220, 100, 75, 10);
  assert.ok(Math.abs(layout.cell - 2) < 1e-9);
  assert.equal(layout.offsetX, 10);
  assert.ok(Math.abs(layout.offsetY - (220 - 2 * 75) / 2) < 1e-9);
});

test("computeLayout never rounds its scale to a whole pixel", () => {
  // The reef is continuous now: a scale that is not an integer number of
  // pixels per unit must not be floored away, or every position on the
  // reef quantises to the same handful of pixel columns.
  const layout = computeLayout(333, 333, 100, 75, 0);
  assert.ok(layout.cell > 3 && layout.cell < 4.5);
  assert.notEqual(layout.cell, Math.floor(layout.cell));
});

test("toPixel maps a reef position straight through the scale and offset, with no cell-centring", () => {
  const layout = { cell: 10, offsetX: 0, offsetY: 0 };
  assert.deepEqual(toPixel(layout, 0, 0), { px: 0, py: 0 });
  assert.deepEqual(toPixel(layout, 2.5, 3.25), { px: 25, py: 32.5 });
});

test("zoomedLayout at zoom 1 centred on the reef reproduces the base layout", () => {
  const base = computeLayout(800, 600, 100, 75, 16);
  const zoomed = zoomedLayout(base, 800, 600, 1, 50, 37.5);
  assert.ok(Math.abs(zoomed.cell - base.cell) < 1e-9);
  assert.ok(Math.abs(zoomed.offsetX - base.offsetX) < 1e-9);
  assert.ok(Math.abs(zoomed.offsetY - base.offsetY) < 1e-9);
});

test("advance turns elapsed time into whole ticks and keeps the remainder", () => {
  const a = advance(0, 250, 100);
  assert.equal(a.ticks, 2);
  assert.equal(a.remainder, 50);

  const b = advance(a.remainder, 40, 100);
  assert.equal(b.ticks, 0);
  assert.equal(b.remainder, 90);
});

test("advance caps ticks after a long stall and drops the backlog", () => {
  const a = advance(0, 100_000, 16, 12);
  assert.equal(a.ticks, 12);
  assert.equal(a.remainder, 0);
});

test("advance never accumulates negative elapsed time", () => {
  const a = advance(5, -50, 100);
  assert.equal(a.ticks, 0);
  assert.equal(a.remainder, 5);
});

test("alphaOf is 0 at the start of a tick interval and 1 at its end", () => {
  assert.equal(alphaOf(0, 100), 0);
  assert.equal(alphaOf(50, 100), 0.5);
  assert.equal(alphaOf(100, 100), 1);
  assert.equal(alphaOf(150, 100), 1); // clamped
});

function creature(id, x, y, extra = {}) {
  return {
    id,
    species: 0,
    x,
    y,
    facingX: 1,
    facingY: 0,
    speed: 0,
    energy: 10,
    age: 1,
    hidden: false,
    intent: "rest",
    reason: "waiting",
    result: "rested",
    ...extra,
  };
}

test("interpolateCreatures moves a surviving id smoothly between two ticks", () => {
  const prev = { creatures: [creature(1, 2, 2)] };
  const curr = { creatures: [creature(1, 3, 2)] };
  const half = interpolateCreatures(prev, curr, 0.5);
  assert.equal(half.length, 1);
  assert.equal(half[0].x, 2.5);
  assert.equal(half[0].y, 2);
});

test("interpolateCreatures draws a first-ever snapshot at rest", () => {
  const curr = { creatures: [creature(1, 4, 4)] };
  const drawn = interpolateCreatures(null, curr, 0.9);
  assert.deepEqual(drawn, [creature(1, 4, 4)]);
});

test("interpolateCreatures snaps a newly spawned id to its own position", () => {
  const prev = { creatures: [creature(1, 0, 0)] };
  const curr = { creatures: [creature(1, 0, 0), creature(2, 5, 5)] };
  const drawn = interpolateCreatures(prev, curr, 0.1);
  const born = drawn.find((c) => c.id === 2);
  assert.equal(born.x, 5);
  assert.equal(born.y, 5);
});

test("interpolateCreatures clamps alpha outside [0, 1]", () => {
  const prev = { creatures: [creature(1, 0, 0)] };
  const curr = { creatures: [creature(1, 10, 0)] };
  assert.equal(interpolateCreatures(prev, curr, 5)[0].x, 10);
  assert.equal(interpolateCreatures(prev, curr, -5)[0].x, 0);
});

test("interpolateCreatures eases a turning facing rather than snapping it", () => {
  const prev = { creatures: [creature(1, 0, 0, { facingX: 1, facingY: 0 })] };
  const curr = { creatures: [creature(1, 0, 0, { facingX: 0, facingY: 1 })] };
  const half = interpolateCreatures(prev, curr, 0.5)[0];
  // Halfway between due east and due south, re-normalised to a unit vector.
  assert.ok(Math.abs(half.facingX - Math.SQRT1_2) < 1e-9);
  assert.ok(Math.abs(half.facingY - Math.SQRT1_2) < 1e-9);
  const length = Math.hypot(half.facingX, half.facingY);
  assert.ok(Math.abs(length - 1) < 1e-9);
});

test("interpolateCreatures falls back to the current facing on a near-total reversal", () => {
  const prev = { creatures: [creature(1, 0, 0, { facingX: 1, facingY: 0 })] };
  const curr = { creatures: [creature(1, 0, 0, { facingX: -1, facingY: 0 })] };
  const half = interpolateCreatures(prev, curr, 0.5)[0];
  assert.equal(half.facingX, -1);
  assert.equal(half.facingY, 0);
});

test("interpolateCreatures eases speed the same way it eases position", () => {
  const prev = { creatures: [creature(1, 0, 0, { speed: 0 })] };
  const curr = { creatures: [creature(1, 0, 0, { speed: 1.4 })] };
  assert.ok(Math.abs(interpolateCreatures(prev, curr, 0.5)[0].speed - 0.7) < 1e-9);
});

test("departedCreatures reports an id that vanished, at its last position", () => {
  const prev = { creatures: [creature(1, 1, 1), creature(2, 9, 9)] };
  const curr = { creatures: [creature(1, 1, 1)] };
  const gone = departedCreatures(prev, curr);
  assert.deepEqual(gone, [{ id: 2, species: 0, x: 9, y: 9 }]);
});

test("departedCreatures is empty with no earlier snapshot to compare against", () => {
  const curr = { creatures: [creature(1, 0, 0)] };
  assert.deepEqual(departedCreatures(null, curr), []);
});

test("RollingAverage averages and forgets past its window", () => {
  const avg = new RollingAverage(3);
  assert.equal(avg.value(), 0);
  avg.push(10);
  avg.push(20);
  assert.equal(avg.value(), 15);
  avg.push(30);
  avg.push(60); // pushes 10 out of the window
  assert.equal(avg.value(), (20 + 30 + 60) / 3);
});

test("DecisionRate divides smoothed decisions by smoothed milliseconds", () => {
  const rate = new DecisionRate(4);
  rate.push(10, 100);
  rate.push(10, 100);
  assert.equal(rate.perSecond(), 100); // 10 decisions / 0.1s
  rate.reset();
  assert.equal(rate.perSecond(), 0);
});

test("radiusOf grows with catalog size but stays a fraction of the swatch", () => {
  const small = radiusOf(40, 3);
  const large = radiusOf(40, 4);
  assert.ok(small < large);
  assert.ok(large < 40 / 2);
});
