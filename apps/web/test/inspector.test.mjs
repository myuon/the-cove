// Verifies the pure functions Slice 2's inspector is built from: the
// plain-language sentence builder (`sentence.ts`), the Cove-source line
// highlighter (`highlight.ts`), the camera's easing (`camera.ts`), the
// zoomed layout it eases towards (`layout.ts`'s `zoomedLayout`), and the
// click-to-creature hit test (`pick.ts`).
//
// The `focus` fixtures below are not invented: each one is a real block a
// running tank produced (`tank_focus` + `tank_snapshot` against
// `target/wasm32-unknown-unknown/checked/tank_wasm.wasm`, seed and tick
// noted in each comment), trimmed to the fields these tests read and
// rounded to a few decimal places for legibility — the reef is continuous,
// so the real numbers run to sixteen digits, and rounding a `4.481683...`
// to `4.48` changes no band or word this file checks. That is what lets
// this file stand in for having driven the module by hand for every reason
// the catalog's four species can give one — the reasons this suite could
// not produce organically (`refusal` needed an extra targeted search,
// `failure` never happened at all across several thousand creature-ticks)
// are called out where they appear.
//
//   $ npm run build && npm test

import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import {
  buildSentence,
  band,
  foodWord,
  reactionTarget,
  reasonWord,
  memoryWord,
} from "../dist/sentence.js";
import { highlightedLines, reasonToken } from "../dist/highlight.js";
import { easeCamera } from "../dist/camera.js";
import { computeLayout, zoomedLayout, toPixel } from "../dist/layout.js";
import { pickCreature } from "../dist/pick.js";

const here = dirname(fileURLToPath(import.meta.url));
const catalogRoot = join(here, "..", "..", "..", "catalog");

const CATALOG = [
  { id: "reefGrazer", name: "Reef Grazer", role: "grazer", size: 3 },
  { id: "kelpHunter", name: "Kelp Hunter", role: "hunter", size: 4 },
  { id: "shyScavenger", name: "Shy Scavenger", role: "scavenger", size: 3 },
  { id: "hermitCrab", name: "Hermit Crab", role: "wildcard", size: 3 },
];

// A `Selection` per `renderer.ts` needs a `colour`/`shape` too, but nothing
// under test reads them — `buildSentence` only reads `name`/`role`.

function focus(overrides) {
  return {
    id: 1,
    species: 0,
    tick: 0,
    intent: "rest",
    reason: "waiting",
    result: "rested",
    refusal: null,
    instructions: 100,
    fuel: 100,
    failure: null,
    self: {
      energy: 20,
      age: 5,
      hidden: false,
      role: "grazer",
      memory: "rested",
      facingX: 1,
      facingY: 0,
      speed: 0,
    },
    observation: {
      reef: { x: 100, y: 75 },
      sight: 14,
      reach: 3,
      here: 0,
      sheltered: false,
      food: [],
      kelp: [],
      nearby: [],
    },
    trace: ["enter creature.decide", "exit creature.decide", "HeapSummary", "ended Success"],
    ...overrides,
  };
}

// --- band / foodWord: the qualitative vocabulary every reason shares. ---

test("band names the same four distances everywhere it is used", () => {
  assert.equal(band(0), "right beside it");
  assert.equal(band(3.99), "right beside it");
  assert.equal(band(4), "a length or two away");
  assert.equal(band(8.99), "a length or two away");
  assert.equal(band(9), "across the water");
  assert.equal(band(15.99), "across the water");
  assert.equal(band(16), "at the edge of sight");
  assert.equal(band(50), "at the edge of sight");
});

test("foodWord reads no food and a lot of food at the ends of the scale", () => {
  assert.equal(foodWord(0), "no");
  assert.equal(foodWord(-1), "no"); // never produced, still not a crash
  assert.equal(foodWord(0.5), "a little");
  assert.equal(foodWord(2), "some");
  assert.equal(foodWord(5), "plenty of");
  assert.equal(foodWord(20), "a lot of");
});

// --- buildSentence: one real example per reason x intent the brief tables,
// captured from a running tank (seed 1, `100x75`) rather than invented. ---

test("fleeing_threat + away: seed 1 tick 14 id 1, a grazer bolting from a hunter a length or two off", () => {
  const f = focus({
    reason: "fleeing_threat",
    intent: "away",
    result: "swam",
    observation: {
      ...focus().observation,
      here: 16.35,
      nearby: [
        { id: 6, species: 2, role: "scavenger", x: 2.04, y: 3.92, away: 1.4, facingX: -0.8, facingY: 0.6, hidden: false },
        { id: 9, species: 3, role: "wildcard", x: 0, y: 6.02, away: 2.97, facingX: -0.79, facingY: 0.61, hidden: false },
        { id: 2, species: 1, role: "hunter", x: 5.05, y: 4.75, away: 4.48, facingX: -1, facingY: 0, hidden: false },
        { id: 3, species: 2, role: "scavenger", x: 5.3, y: 1.6, away: 4.71, facingX: 0.36, facingY: -0.93, hidden: false },
      ],
    },
  });
  const s = buildSentence(f, CATALOG);
  assert.equal(s.headline, "Bolted because a hunter was a length or two away.");
  assert.equal(s.note, null);
  assert.deepEqual(reactionTarget(f), { x: 5.05, y: 4.75 });
});

test("fleeing_threat + toward or hide falls back honestly: this catalog never pairs them", () => {
  // `reefGrazer.cove` and `shyScavenger.cove` only ever answer
  // `Reason.FleeingThreat` with `Intent.Away` — heading for cover is
  // `sheltering`, not this. Guards the table against a species that changes
  // without this file changing with it.
  const f = focus({ reason: "fleeing_threat", intent: "hide", result: "hid" });
  const s = buildSentence(f, CATALOG);
  assert.equal(s.headline, "hide, reasoning fleeing threat.");
});

test("sheltering + hide: seed 1 tick 1 id 8, already standing in the kelp", () => {
  const f = focus({
    reason: "sheltering",
    intent: "hide",
    result: "hid",
    observation: {
      ...focus().observation,
      here: 11.38,
      sheltered: true,
      nearby: [
        { id: 2, species: 1, role: "hunter", x: 6.5, y: 5.12, away: 0.65, facingX: -0.7, facingY: -0.72, hidden: false },
      ],
    },
  });
  const s = buildSentence(f, CATALOG);
  assert.equal(s.headline, "Hid in the kelp.");
  assert.equal(s.note, null);
  // Still worth a line to draw for the selection: what it hid *from*.
  assert.deepEqual(reactionTarget(f), { x: 6.5, y: 5.12 });
});

test("sheltering + toward: seed 1 tick 12 id 3, heading for a bed with a hunter right beside it", () => {
  const f = focus({
    reason: "sheltering",
    intent: "toward",
    result: "swam",
    observation: {
      ...focus().observation,
      here: 26.59,
      nearby: [
        { id: 2, species: 1, role: "hunter", x: 5.71, y: 4.79, away: 1.69, facingX: -0.96, facingY: -0.28, hidden: false },
      ],
      kelp: [
        { x: 8.53, y: 8.65, radius: 6.05, away: 6.44 },
        { x: 9.31, y: 8.51, radius: 6.06, away: 6.79 },
      ],
    },
  });
  const s = buildSentence(f, CATALOG);
  assert.equal(s.headline, "Made for the kelp with a hunter right beside it.");
  assert.deepEqual(reactionTarget(f), { x: 8.53, y: 8.65 });
});

test("feeding + eat: seed 1 tick 1 id 1, standing over a rich patch", () => {
  const f = focus({
    reason: "feeding",
    intent: "eat",
    result: "ate",
    observation: { ...focus().observation, here: 13.59 },
  });
  const s = buildSentence(f, CATALOG);
  assert.equal(s.headline, "Ate here, where a lot of food was growing.");
  assert.equal(s.note, null);
});

test("seeking_food + toward: seed 1 tick 6 id 1, off towards the fullest mouthful in sight", () => {
  const f = focus({
    reason: "seeking_food",
    intent: "toward",
    result: "swam",
    observation: {
      ...focus().observation,
      food: [
        { x: 2.58, y: 4.67, amount: 0.09, radius: 2.5, away: 1.71 },
        { x: 4.17, y: 3.56, amount: 0.9, radius: 2.5, away: 1.77 },
        { x: 2.53, y: 4.53, amount: 1.39, radius: 2.5, away: 1.81 }, // fullest
      ],
    },
  });
  const s = buildSentence(f, CATALOG);
  assert.equal(s.headline, "Swam toward some food, right beside it.");
  assert.deepEqual(reactionTarget(f), { x: 2.53, y: 4.53 });
});

test("hunting + hunt, caught: seed 1 tick 16 id 2, a kelp hunter lunges and connects", () => {
  const f = focus({
    reason: "hunting",
    intent: "hunt-6",
    result: "hunted-6",
    observation: {
      ...focus().observation,
      nearby: [{ id: 6, species: 2, role: "scavenger", x: 1.77, y: 5.75, away: 2.8, facingX: 0.08, facingY: 1, hidden: false }],
    },
  });
  const s = buildSentence(f, CATALOG);
  assert.equal(s.headline, "Lunged at the Shy Scavenger, right beside it, and caught it.");
  assert.equal(s.note, null);
  assert.deepEqual(reactionTarget(f), { x: 1.77, y: 5.75 });
});

test("hunting + hunt, missed: seed 1 tick 1 id 2, the same lunge, this time it does not connect", () => {
  const f = focus({
    reason: "hunting",
    intent: "hunt-11",
    result: "missed-11",
    observation: {
      ...focus().observation,
      nearby: [{ id: 11, species: 2, role: "scavenger", x: 6.13, y: 5.25, away: 0.39, facingX: -0.72, facingY: -0.69, hidden: false }],
    },
  });
  const s = buildSentence(f, CATALOG);
  assert.equal(s.headline, "Lunged at the Shy Scavenger, right beside it, and missed.");
});

test("hunting + hunt, refused: seed 1 tick 78 id 22, the target slipped out of reach before the strike landed", () => {
  const f = focus({
    reason: "hunting",
    intent: "hunt-24",
    result: "refused",
    refusal: "no creature 24 is within reach of creature 22",
    observation: {
      ...focus().observation,
      nearby: [{ id: 24, species: 2, role: "scavenger", x: 2.64, y: 3.52, away: 2.77, facingX: -0.97, facingY: 0.26, hidden: false }],
    },
  });
  const s = buildSentence(f, CATALOG);
  assert.equal(s.headline, "Lunged at the Shy Scavenger, right beside it.");
  assert.equal(s.note, "The world refused: no creature 24 is within reach of creature 22.");
});

test("hunting + hunt, name falls back to role for an unmet species", () => {
  const f = focus({
    reason: "hunting",
    intent: "hunt-6",
    result: "hunted-6",
    observation: {
      ...focus().observation,
      nearby: [{ id: 6, species: 2, role: "scavenger", x: 1.77, y: 5.75, away: 2.8, facingX: 0.08, facingY: 1, hidden: false }],
    },
  });
  const s = buildSentence(f, CATALOG, new Set([0, 1])); // species 2 not yet met
  assert.equal(s.headline, "Lunged at the scavenger, right beside it, and caught it.");
});

test("hunting + toward: seed 1 tick 15 id 2, closing on prey it cannot yet reach", () => {
  const f = focus({
    reason: "hunting",
    intent: "toward",
    result: "swam",
    observation: {
      ...focus().observation,
      nearby: [
        { id: 7, species: 3, role: "wildcard", x: 5.15, y: 5.17, away: 0.49, facingX: -0.97, facingY: -0.26, hidden: false }, // not prey
        { id: 5, species: 1, role: "hunter", x: 6.27, y: 5.89, away: 1.78, facingX: -0.71, facingY: -0.71, hidden: false }, // not prey
        { id: 6, species: 2, role: "scavenger", x: 1.69, y: 4.8, away: 3.2, facingX: -0.37, facingY: 0.93, hidden: false }, // nearest catchable prey
        { id: 3, species: 2, role: "scavenger", x: 6.05, y: 1.02, away: 3.9, facingX: 0.79, facingY: -0.61, hidden: false },
      ],
    },
  });
  const s = buildSentence(f, CATALOG);
  assert.equal(s.headline, "Closed on the Shy Scavenger, right beside it.");
  assert.deepEqual(reactionTarget(f), { x: 1.69, y: 4.8 });
});

test("hunting + toward skips prey hidden in kelp: a hunter will not follow it there", () => {
  const f = focus({
    reason: "hunting",
    intent: "toward",
    result: "swam",
    observation: {
      ...focus().observation,
      nearby: [
        { id: 6, species: 2, role: "scavenger", x: 1, y: 1, away: 1, facingX: 0, facingY: 1, hidden: true },
        { id: 7, species: 0, role: "grazer", x: 9, y: 9, away: 12, facingX: 0, facingY: 1, hidden: false },
      ],
    },
  });
  const s = buildSentence(f, CATALOG);
  assert.equal(s.headline, "Closed on the Reef Grazer, across the water.");
  assert.deepEqual(reactionTarget(f), { x: 9, y: 9 });
});

test("crowded + away: seed 1 tick 3 id 9, a wildcard stepping away from a grazer right beside it", () => {
  const f = focus({
    reason: "crowded",
    intent: "away",
    result: "swam",
    observation: {
      ...focus().observation,
      nearby: [{ id: 1, species: 0, role: "grazer", x: 4.16, y: 5.33, away: 0.42, facingX: -0.7, facingY: -0.72, hidden: false }],
    },
  });
  const s = buildSentence(f, CATALOG);
  assert.equal(s.headline, "Stepped away from the Reef Grazer, right beside it.");
  assert.deepEqual(reactionTarget(f), { x: 4.16, y: 5.33 });
});

test("crowded + rest falls back honestly: a continuous swim is never boxed in on every side at once", () => {
  const f = focus({ reason: "crowded", intent: "rest", result: "rested" });
  const s = buildSentence(f, CATALOG);
  assert.equal(s.headline, "rest, reasoning crowded.");
});

test("exploring + toward: seed 1 tick 10 id 2, wandering with nothing worth reacting to", () => {
  const f = focus({ reason: "exploring", intent: "toward", result: "swam" });
  const s = buildSentence(f, CATALOG);
  assert.equal(s.headline, "Wandered, with nothing in sight.");
});

test("waiting + rest: seed 1 tick 4 id 5, nothing to eat, nothing to run from", () => {
  const f = focus({ reason: "waiting", intent: "rest", result: "rested" });
  const s = buildSentence(f, CATALOG);
  assert.equal(s.headline, "Waited: nothing to eat and nothing to run from.");
});

test("a refusal is reported without touching the headline: seed 1 tick 2 id 5", () => {
  // `shyScavenger.cove` believed there was food in reach when it decided
  // (`observation.here` was the state at the *start* of the tick); by the
  // time the intent resolved the reef disagreed. The headline still says
  // what it meant to do — the note says what actually happened.
  const f = focus({
    reason: "feeding",
    intent: "eat",
    result: "refused",
    refusal: "there is nothing within reach to eat at 6.3,5.9",
    observation: { ...focus().observation, here: 0.97 },
  });
  const s = buildSentence(f, CATALOG);
  assert.equal(s.headline, "Ate here, where a little food was growing.");
  assert.equal(s.note, "The world refused: there is nothing within reach to eat at 6.3,5.9.");
});

// --- failure: never once produced across several thousand creature-ticks
// (`DECISION_FUEL_LIMIT` is far above what this catalog's programs cost, no
// deadline is ever set, and nothing spawns or recurses deep enough to hit
// the other budgets), so these three are synthetic rather than captured —
// but they are exactly what `crates/tank-wasm/src/lib.rs`'s `focus()` would
// write for each `Failure` case, and "a failure outranks everything" is the
// one rule here with no organic example to lean on instead. ---

test("a failure outranks the reason the world stood in for", () => {
  const f = focus({
    reason: "waiting", // Intent::Rest / Reason::Waiting, decisions()'s stand-in
    intent: "rest",
    result: "rested",
    failure: { kind: "fuel", message: "the fuel budget ran out", at: null },
  });
  const s = buildSentence(f, CATALOG);
  assert.equal(
    s.headline,
    "Its program ran out of fuel before it decided, so the world let it rest.",
  );
  assert.equal(s.note, null);
});

test("a fault names where it broke, when the runtime knows", () => {
  const f = focus({
    failure: { kind: "fault", message: "division by zero", at: "creature.decide:12" },
  });
  const s = buildSentence(f, CATALOG);
  assert.equal(
    s.headline,
    "Its program broke — division by zero at creature.decide:12 — so the world let it rest.",
  );
});

test("a fault with no known location still reads as a sentence", () => {
  const f = focus({ failure: { kind: "fault", message: "stack overflow", at: null } });
  const s = buildSentence(f, CATALOG);
  assert.equal(
    s.headline,
    "Its program broke — stack overflow — so the world let it rest.",
  );
});

test("a malformed answer is reported without inventing what it was", () => {
  const f = focus({ failure: { kind: "malformed", message: "not a Decision", at: null } });
  const s = buildSentence(f, CATALOG);
  assert.equal(
    s.headline,
    "Its program answered something the world could not read, so the world let it rest.",
  );
});

test("a budget this catalog never hits still gets an honest sentence", () => {
  const f = focus({
    failure: { kind: "callDepth", message: "the callDepth budget ran out", at: null },
  });
  const s = buildSentence(f, CATALOG);
  assert.match(s.headline, /the callDepth budget ran out/);
});

test("a reason paired with an intent this catalog never gives it falls back honestly", () => {
  // Guards the table, not the catalog: reachable only if a species changes
  // without this file changing with it.
  const f = focus({ reason: "feeding", intent: "hide", result: "hid" });
  const s = buildSentence(f, CATALOG);
  assert.equal(s.headline, "hide, reasoning feeding.");
});

// --- reactionTarget: null wherever there is nothing at a distance worth a
// line, even when the headline still has plenty to say. ---

test("reactionTarget is null for feeding: the mouthful is right where it is", () => {
  const f = focus({ reason: "feeding", intent: "eat", result: "ate" });
  assert.equal(reactionTarget(f), null);
});

test("reactionTarget is null for exploring and waiting: nothing is being reacted to", () => {
  assert.equal(reactionTarget(focus({ reason: "exploring", intent: "toward" })), null);
  assert.equal(reactionTarget(focus({ reason: "waiting", intent: "rest" })), null);
});

// --- reasonWord / memoryWord: layer two's words. ---

test("reasonWord covers every reason the catalog names", () => {
  for (const reason of [
    "fleeing_threat",
    "seeking_food",
    "feeding",
    "sheltering",
    "hunting",
    "crowded",
    "exploring",
    "waiting",
  ]) {
    assert.notEqual(reasonWord(reason), reason);
  }
});

test("memoryWord reads every ActionResult shape SelfView.last can carry", () => {
  assert.equal(memoryWord("spawned"), "It only just arrived.");
  assert.equal(memoryWord("swam"), "It swam, last tick.");
  assert.match(memoryWord("ate"), /ate/);
  assert.match(memoryWord("hunted-7"), /caught something/);
  assert.match(memoryWord("missed-7"), /missed/);
  assert.equal(memoryWord("hid"), "It hid, last tick.");
  assert.equal(memoryWord("rested"), "It rested, last tick.");
  assert.match(memoryWord("refused"), /refused/);
});

// --- highlight.ts, against the real catalog on disk. ---

function readCatalogSource(species) {
  return readFileSync(
    join(catalogRoot, "species", species, "creature.cove"),
    "utf8",
  );
}

test("reasonToken reverses Reason.name() back to the PascalCase variant", () => {
  assert.equal(reasonToken("fleeing_threat"), "FleeingThreat");
  assert.equal(reasonToken("seeking_food"), "SeekingFood");
  assert.equal(reasonToken("feeding"), "Feeding");
  assert.equal(reasonToken("sheltering"), "Sheltering");
  assert.equal(reasonToken("hunting"), "Hunting");
  assert.equal(reasonToken("crowded"), "Crowded");
  assert.equal(reasonToken("exploring"), "Exploring");
  assert.equal(reasonToken("waiting"), "Waiting");
});

test("highlightedLines finds all three branches a reef grazer flees a threat from", () => {
  const source = readCatalogSource("reefGrazer");
  assert.deepEqual(highlightedLines(source, "fleeing_threat"), [46, 72, 74]);
});

test("highlightedLines finds a single-branch reason too", () => {
  const source = readCatalogSource("reefGrazer");
  assert.deepEqual(highlightedLines(source, "feeding"), [41]);
  assert.deepEqual(highlightedLines(source, "seeking_food"), [53]);
  assert.deepEqual(highlightedLines(source, "exploring"), [57]);
});

test("highlightedLines finds all of a shy scavenger's ways into shelter", () => {
  const source = readCatalogSource("shyScavenger");
  assert.deepEqual(highlightedLines(source, "sheltering"), [76, 79, 95]);
});

test("highlightedLines finds both of a hermit crab's feeding branches", () => {
  const source = readCatalogSource("hermitCrab");
  assert.deepEqual(highlightedLines(source, "feeding"), [36, 48]);
});

test("highlightedLines answers no lines for a reason a species never gives", () => {
  // The hermit crab's source has no `Reason.Hunting` in it at all.
  const source = readCatalogSource("hermitCrab");
  assert.deepEqual(highlightedLines(source, "hunting"), []);
});

// --- camera.ts: easing towards a target, never past it, never negative time. ---

test("easeCamera does not move before any time has passed", () => {
  const current = { x: 0, y: 0, zoom: 1 };
  const target = { x: 10, y: 10, zoom: 2 };
  assert.deepEqual(easeCamera(current, target, 0, 200), current);
});

test("easeCamera closes exactly half the distance after one half-life", () => {
  const current = { x: 0, y: 0, zoom: 1 };
  const target = { x: 10, y: 0, zoom: 3 };
  const eased = easeCamera(current, target, 200, 200);
  assert.ok(Math.abs(eased.x - 5) < 1e-9);
  assert.ok(Math.abs(eased.zoom - 2) < 1e-9);
});

test("easeCamera approaches but never overshoots its target", () => {
  let camera = { x: 0, y: 0, zoom: 1 };
  const target = { x: 10, y: -4, zoom: 2 };
  for (let i = 0; i < 300; i += 1) {
    camera = easeCamera(camera, target, 16, 200);
  }
  assert.ok(camera.x > 9.9 && camera.x <= 10);
  assert.ok(camera.y < -3.9 && camera.y >= -4);
  assert.ok(camera.zoom > 1.98 && camera.zoom <= 2);
});

test("easeCamera clamps a negative elapsed time to zero rather than running backwards", () => {
  const current = { x: 5, y: 5, zoom: 1.5 };
  const target = { x: 0, y: 0, zoom: 1 };
  assert.deepEqual(easeCamera(current, target, -100, 200), current);
});

// --- layout.ts's zoomedLayout: the camera's idea of "where to look" turned
// into the same `{cell, offsetX, offsetY}` every drawing function reads. ---

test("zoomedLayout at zoom 1 centred on the reef reproduces the base layout", () => {
  const base = computeLayout(800, 600, 100, 75, 16);
  const zoomed = zoomedLayout(base, 800, 600, 1, 50, 37.5);
  assert.ok(Math.abs(zoomed.cell - base.cell) < 1e-9);
  assert.ok(Math.abs(zoomed.offsetX - base.offsetX) < 1e-9);
  assert.ok(Math.abs(zoomed.offsetY - base.offsetY) < 1e-9);
});

test("zoomedLayout centres the camera's own point on the canvas centre", () => {
  const base = computeLayout(800, 600, 100, 75, 16);
  const zoomed = zoomedLayout(base, 800, 600, 2, 30, 40);
  const centre = toPixel(zoomed, 30, 40);
  assert.ok(Math.abs(centre.px - 400) < 1e-9);
  assert.ok(Math.abs(centre.py - 300) < 1e-9);
  assert.equal(zoomed.cell, base.cell * 2);
});

// --- pick.ts: turning a click into a creature id, or into nobody. ---

test("pickCreature finds the creature whose drawn radius covers the click", () => {
  const layout = { cell: 20, offsetX: 0, offsetY: 0 };
  const creatures = [
    { id: 1, species: 0, x: 2, y: 2 },
    { id: 2, species: 1, x: 5, y: 5 },
  ];
  const catalog = [{ size: 3 }, { size: 4 }];
  const centre = toPixel(layout, 2, 2);
  assert.equal(pickCreature(centre.px, centre.py, layout, creatures, catalog), 1);
});

test("pickCreature answers null for a click on open water", () => {
  const layout = { cell: 20, offsetX: 0, offsetY: 0 };
  const creatures = [{ id: 1, species: 0, x: 2, y: 2 }];
  const catalog = [{ size: 3 }];
  assert.equal(pickCreature(500, 500, layout, creatures, catalog), null);
});

test("pickCreature prefers the nearer of two overlapping hit targets", () => {
  const layout = { cell: 40, offsetX: 0, offsetY: 0 };
  const creatures = [
    { id: 1, species: 0, x: 2, y: 2 },
    { id: 2, species: 0, x: 2.2, y: 2 },
  ];
  const catalog = [{ size: 4 }];
  const centre = toPixel(layout, 2.2, 2);
  assert.equal(pickCreature(centre.px, centre.py, layout, creatures, catalog), 2);
});

// A follow camera that centres on its creature shows the water outside the
// reef whenever that creature is near an edge, which reads as a bug rather
// than as a camera doing what it was told. Without this the left edge of
// the canvas is empty every time somebody follows a fish along the west
// wall.
test("clampCamera keeps the view inside the reef", async () => {
  const { clampCamera } = await import("../dist/camera.js");
  // A 100x75 reef, a 640x480 view, base cell 4 at zoom 2: the view is 80
  // units wide and 60 tall, so the centre may range over 40..60 and 30..45.
  const at = (x, y) => clampCamera({ x, y, zoom: 2 }, 100, 75, 640, 480, 4);
  assert.deepEqual(at(50, 37.5), { x: 50, y: 37.5, zoom: 2 });
  assert.deepEqual(at(0, 0), { x: 40, y: 30, zoom: 2 });
  assert.deepEqual(at(99, 74), { x: 60, y: 45, zoom: 2 });
});

// Zoomed all the way out there is nothing to choose: the reef is narrower
// than the view on both axes and belongs in the middle of it.
test("clampCamera centres a reef smaller than the view", async () => {
  const { clampCamera } = await import("../dist/camera.js");
  assert.deepEqual(clampCamera({ x: 0, y: 0, zoom: 1 }, 100, 75, 4000, 4000, 4), {
    x: 50,
    y: 37.5,
    zoom: 1,
  });
});

// Interpolating between two snapshots is smooth inside a tick and corners at
// every tick boundary, which the eye reads as a flick. `easeDrawn` is the
// low-pass that rounds it off. Without these, the half-life could quietly
// become frame-rate dependent — the commonest way an easing like this goes
// wrong, and one that only shows on a machine that is not the one it was
// written on.
test("easeDrawn covers half the distance in one half-life", async () => {
  const { easeDrawn } = await import("../dist/interpolate.js");
  const at = (x) => ({
    id: 1, species: 0, x, y: 0, facingX: 1, facingY: 0,
    speed: 0, energy: 10, age: 1, hidden: false,
    intent: "", reason: "", result: "",
  });
  const held = new Map();
  easeDrawn(held, [at(0)], 16, 100);
  const [after] = easeDrawn(held, [at(10)], 100, 100);
  assert.ok(Math.abs(after.x - 5) < 1e-9, `moved to ${after.x}`);
});

test("easeDrawn eases at the same rate whatever the frame rate", async () => {
  const { easeDrawn } = await import("../dist/interpolate.js");
  const at = (x) => ({
    id: 1, species: 0, x, y: 0, facingX: 1, facingY: 0,
    speed: 0, energy: 10, age: 1, hidden: false,
    intent: "", reason: "", result: "",
  });
  const slow = new Map();
  easeDrawn(slow, [at(0)], 16, 200);
  const [slowAfter] = easeDrawn(slow, [at(100)], 200, 200);

  const fast = new Map();
  easeDrawn(fast, [at(0)], 16, 200);
  let fastAfter;
  for (let i = 0; i < 10; i += 1) {
    [fastAfter] = easeDrawn(fast, [at(100)], 20, 200);
  }
  assert.ok(
    Math.abs(slowAfter.x - fastAfter.x) < 0.5,
    `one 200ms step reached ${slowAfter.x}, ten 20ms steps reached ${fastAfter.x}`,
  );
});

// A creature that has just spawned has nowhere to ease from. Easing it in from
// wherever the map last had that id would drag a ghost across the reef every
// time a slot refilled.
test("easeDrawn puts a new creature where it actually is", async () => {
  const { easeDrawn } = await import("../dist/interpolate.js");
  const fresh = {
    id: 7, species: 0, x: 40, y: 30, facingX: 0, facingY: 1,
    speed: 1, energy: 10, age: 0, hidden: false,
    intent: "", reason: "", result: "",
  };
  const [placed] = easeDrawn(new Map(), [fresh], 16, 130);
  assert.equal(placed.x, 40);
  assert.equal(placed.y, 30);
});

// And a creature that has died stops being held, or the map grows for the
// lifetime of the page.
test("easeDrawn forgets creatures that are gone", async () => {
  const { easeDrawn } = await import("../dist/interpolate.js");
  const one = {
    id: 3, species: 0, x: 1, y: 1, facingX: 1, facingY: 0,
    speed: 0, energy: 5, age: 1, hidden: false,
    intent: "", reason: "", result: "",
  };
  const held = new Map();
  easeDrawn(held, [one], 16, 130);
  assert.equal(held.size, 1);
  easeDrawn(held, [], 16, 130);
  assert.equal(held.size, 0);
});
