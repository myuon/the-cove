// Verifies the pure functions the loop and renderer are built from, without
// a browser: layout arithmetic, tick-accumulation, and cross-tick creature
// interpolation. Run after `npm run build`, since it imports the compiled
// output in `dist/`, not the TypeScript source.
//
//   $ npm run build && npm test

import test from "node:test";
import assert from "node:assert/strict";

import { computeLayout, cellCentre } from "../dist/layout.js";
import { isCover } from "../dist/cover.js";
import { advance, alphaOf } from "../dist/loop.js";
import { interpolateCreatures, departedCreatures } from "../dist/interpolate.js";
import { RollingAverage, DecisionRate } from "../dist/panel.js";
import { headingAngleOf, radiusOf } from "../dist/shapes.js";

test("computeLayout fits a wide grid into a tall canvas without stretching", () => {
  const layout = computeLayout(1000, 400, 16, 12, 0);
  // 1000/16 = 62.5, 400/12 = 33.3 -- the shorter side wins.
  assert.equal(layout.cell, 33);
  assert.ok(layout.offsetY >= 0 && layout.offsetY < layout.cell);
  assert.equal(layout.offsetX, (1000 - 33 * 16) / 2);
});

test("computeLayout centres a grid smaller than its margin-adjusted canvas", () => {
  const layout = computeLayout(100, 100, 16, 12, 10);
  assert.equal(layout.cell, 5);
  assert.equal(layout.offsetX, 10);
  assert.equal(layout.offsetY, 20);
});

test("cellCentre sits in the middle of a cell, not its corner", () => {
  const layout = { cell: 10, offsetX: 0, offsetY: 0 };
  assert.deepEqual(cellCentre(layout, 0, 0), { px: 5, py: 5 });
  assert.deepEqual(cellCentre(layout, 2, 3), { px: 25, py: 35 });
});

test("isCover matches the tank's own rule and is not just true everywhere", () => {
  assert.equal(isCover(0, 0), true); // (0*3+0*5) % 7 === 0
  assert.equal(isCover(1, 0), false); // 3 % 7 !== 0
  assert.equal(isCover(4, 1), false); // 17 % 7 !== 0
  assert.equal(isCover(7, 0), true); // 21 % 7 === 0
  let coverCount = 0;
  for (let y = 0; y < 12; y += 1) {
    for (let x = 0; x < 16; x += 1) {
      if (isCover(x, y)) coverCount += 1;
    }
  }
  assert.ok(coverCount > 0 && coverCount < 16 * 12, `${coverCount} cover cells`);
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

test("headingAngleOf reads the trailing direction word or answers null", () => {
  assert.equal(headingAngleOf("moved-north"), -Math.PI / 2);
  assert.equal(headingAngleOf("blocked-east"), 0);
  assert.equal(headingAngleOf("move-west"), Math.PI);
  assert.equal(headingAngleOf("eat"), null);
  assert.equal(headingAngleOf("hunt-7"), null);
});

test("radiusOf grows with catalog size but stays a fraction of the cell", () => {
  const small = radiusOf(40, 3);
  const large = radiusOf(40, 4);
  assert.ok(small < large);
  assert.ok(large < 40 / 2);
});
