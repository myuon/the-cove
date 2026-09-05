// Verifies the pure functions Slice 2's inspector is built from: the
// plain-language sentence builder (`sentence.ts`), the Cove-source line
// highlighter (`highlight.ts`), the camera's easing (`camera.ts`), the
// zoomed layout it eases towards (`layout.ts`'s `zoomedLayout`), and the
// click-to-creature hit test (`pick.ts`).
//
// The `focus` fixtures below are not invented: each one is a real block a
// running tank produced (`tank_focus` + `tank_snapshot` against
// `target/wasm32-unknown-unknown/checked/tank_wasm.wasm`, seed and tick
// noted in each comment), trimmed to the fields these tests read. That is
// what lets this file stand in for having driven the module by hand for
// every reason the catalog's four species can give one — the reasons this
// suite could not produce organically (`refusal` needed an extra targeted
// search, `failure` never happened at all across several thousand
// creature-ticks) are called out where they appear.
//
//   $ npm run build && npm test

import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { buildSentence, reasonWord, memoryWord } from "../dist/sentence.js";
import { highlightedLines, reasonToken } from "../dist/highlight.js";
import { easeCamera } from "../dist/camera.js";
import { computeLayout, zoomedLayout, cellCentre } from "../dist/layout.js";
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
    self: { energy: 20, age: 5, hidden: false, role: "grazer", memory: "rested" },
    observation: {
      here: 0,
      shelter: false,
      scent: null,
      around: [
        { heading: "north", x: 0, y: 0, food: 0, shelter: false, outside: false, occupied: false },
        { heading: "east", x: 0, y: 0, food: 0, shelter: false, outside: false, occupied: false },
        { heading: "south", x: 0, y: 0, food: 0, shelter: false, outside: false, occupied: false },
        { heading: "west", x: 0, y: 0, food: 0, shelter: false, outside: false, occupied: false },
      ],
      nearby: [],
    },
    trace: ["enter creature.decide", "exit creature.decide", "HeapSummary", "ended Success"],
    ...overrides,
  };
}

// --- buildSentence: one real example per reason x intent the brief tables. ---

test("fleeing_threat + move: seed 7, a grazer running from a hunter one step off", () => {
  // tick 122, id 12 — real `focus.observation.nearby[0]` was a hunter, away 1.
  const f = focus({
    reason: "fleeing_threat",
    intent: "move-east",
    result: "moved-east",
    observation: {
      here: 4,
      shelter: false,
      scent: null,
      around: focus().observation.around,
      nearby: [{ id: 19, species: 1, role: "hunter", x: 11, y: 2, away: 1, hidden: false }],
    },
  });
  const s = buildSentence(f, CATALOG);
  assert.equal(s.headline, "Ran east because a hunter was 1 step away.");
  assert.equal(s.note, null);
});

test("fleeing_threat + hide, refused: a scavenger hiding where there is no shelter", () => {
  // seed 8, tick 421, id 51 — the world refused the hide ("no shelter at
  // 15,1"); this is also the one organic `refusal` this suite ever turned up.
  const f = focus({
    reason: "fleeing_threat",
    intent: "hide",
    result: "refused",
    refusal: "there is no shelter at 15,1",
    observation: {
      here: 2,
      shelter: false,
      scent: "west",
      around: focus().observation.around,
      nearby: [
        { id: 4, species: 3, role: "wildcard", x: 15, y: 0, away: 1, hidden: false },
        { id: 29, species: 1, role: "hunter", x: 14, y: 1, away: 1, hidden: false },
      ],
    },
  });
  const s = buildSentence(f, CATALOG);
  assert.equal(s.headline, "Hid in the kelp because a hunter was 1 step away.");
  assert.equal(s.note, "The world refused: there is no shelter at 15,1.");
});

test("fleeing_threat + rest: cornered, with a hunter beside it and nowhere to go", () => {
  // seed 8, tick 202, id 24 — `view.last` was already a refused hide, so
  // `lastResort` answered `Rest` instead of asking the same thing twice.
  const f = focus({
    reason: "fleeing_threat",
    intent: "rest",
    result: "rested",
    observation: {
      here: 2,
      shelter: true,
      scent: null,
      around: focus().observation.around,
      nearby: [{ id: 27, species: 1, role: "hunter", x: 13, y: 0, away: 1, hidden: false }],
    },
  });
  const s = buildSentence(f, CATALOG);
  assert.equal(
    s.headline,
    "Had nowhere to go: a hunter 1 step away and every way out blocked.",
  );
});

test("sheltering + hide: a scavenger already standing in the kelp", () => {
  // seed 7, tick 12, id 3.
  const f = focus({ reason: "sheltering", intent: "hide", result: "hid" });
  const s = buildSentence(f, CATALOG);
  assert.equal(s.headline, "Hid in the kelp.");
  assert.equal(s.note, null);
});

test("sheltering + move: heading for a thicket it can see, a hunter two off", () => {
  // seed 8, tick 5, id 3.
  const f = focus({
    reason: "sheltering",
    intent: "move-west",
    result: "moved-west",
    observation: {
      here: 3,
      shelter: false,
      scent: "west",
      around: focus().observation.around,
      nearby: [{ id: 2, species: 1, role: "hunter", x: 8, y: 3, away: 2, hidden: false }],
    },
  });
  const s = buildSentence(f, CATALOG);
  assert.equal(s.headline, "Made for the kelp with a hunter 2 steps away.");
});

test("feeding + eat: standing on a well-grown patch", () => {
  // seed 7, tick 4, id 5 — `here: 2`.
  const f = focus({
    reason: "feeding",
    intent: "eat",
    result: "ate-1",
    observation: { ...focus().observation, here: 2 },
  });
  const s = buildSentence(f, CATALOG);
  assert.equal(s.headline, "Ate here, where some food was growing.");
});

test("seeking_food + move, scent set: a scavenger smelling a carcass", () => {
  // seed 7, tick 0, id 3 — scent and intent both point north.
  const f = focus({
    reason: "seeking_food",
    intent: "move-north",
    result: "moved-north",
    observation: { ...focus().observation, scent: "north" },
  });
  const s = buildSentence(f, CATALOG);
  assert.equal(s.headline, "Followed the smell of food to the north.");
});

test("seeking_food + move, no scent: a grazer walking to the richest patch it can see", () => {
  // seed 7, tick 0, id 1 — richest of the four visible patches was west, at 2.
  const f = focus({
    reason: "seeking_food",
    intent: "move-west",
    result: "moved-west",
    observation: {
      here: 0,
      shelter: false,
      scent: null,
      around: [
        { heading: "north", x: 3, y: 4, food: 1, shelter: false, outside: false, occupied: false },
        { heading: "east", x: 4, y: 5, food: 1, shelter: false, outside: false, occupied: false },
        { heading: "south", x: 3, y: 6, food: 1, shelter: false, outside: false, occupied: false },
        { heading: "west", x: 2, y: 5, food: 2, shelter: false, outside: false, occupied: false },
      ],
      nearby: [],
    },
  });
  const s = buildSentence(f, CATALOG);
  assert.equal(s.headline, "Moved west towards some food.");
});

test("hunting + hunt, caught: a kelp hunter lunges and connects", () => {
  // seed 7, tick 127, id 19 -> hunted-10, a shy scavenger one step off.
  const f = focus({
    reason: "hunting",
    intent: "hunt-10",
    result: "hunted-10",
    observation: {
      ...focus().observation,
      nearby: [{ id: 10, species: 2, role: "scavenger", x: 13, y: 1, away: 1, hidden: false }],
    },
  });
  const s = buildSentence(f, CATALOG);
  assert.equal(s.headline, "Lunged at the Shy Scavenger one step away, and caught it.");
  assert.equal(s.note, null);
});

test("hunting + hunt, missed: the same lunge, this time it does not connect", () => {
  // seed 7, tick 337, id 31 -> missed-36, a reef grazer one step off.
  const f = focus({
    reason: "hunting",
    intent: "hunt-36",
    result: "missed-36",
    observation: {
      ...focus().observation,
      nearby: [{ id: 36, species: 0, role: "grazer", x: 2, y: 0, away: 1, hidden: false }],
    },
  });
  const s = buildSentence(f, CATALOG);
  assert.equal(s.headline, "Lunged at the Reef Grazer one step away, and missed.");
});

test("hunting + move: closing on prey it cannot yet reach", () => {
  // seed 7, tick 5, id 6 -> a reef grazer two steps off.
  const f = focus({
    reason: "hunting",
    intent: "move-south",
    result: "moved-south",
    observation: {
      ...focus().observation,
      nearby: [{ id: 9, species: 0, role: "grazer", x: 3, y: 3, away: 2, hidden: false }],
    },
  });
  const s = buildSentence(f, CATALOG);
  assert.equal(s.headline, "Closed on the Reef Grazer, 2 steps away.");
});

test("hunting + hunt, name falls back to role for an unmet species", () => {
  const f = focus({
    reason: "hunting",
    intent: "hunt-10",
    result: "hunted-10",
    observation: {
      ...focus().observation,
      nearby: [{ id: 10, species: 2, role: "scavenger", x: 13, y: 1, away: 1, hidden: false }],
    },
  });
  const s = buildSentence(f, CATALOG, new Set([0, 1])); // species 2 not yet met
  assert.equal(s.headline, "Lunged at the scavenger one step away, and caught it.");
});

test("crowded + move: a hermit crab stepping away from a scavenger", () => {
  // seed 7, tick 20, id 11.
  const f = focus({
    reason: "crowded",
    intent: "move-north",
    result: "moved-north",
    observation: {
      ...focus().observation,
      nearby: [{ id: 10, species: 2, role: "scavenger", x: 14, y: 6, away: 2, hidden: false }],
    },
  });
  const s = buildSentence(f, CATALOG);
  assert.equal(s.headline, "Stepped away from the Shy Scavenger 2 steps away.");
});

test("crowded + rest: boxed in with nowhere left to step", () => {
  // seed 8, tick 82, id 10 — hemmed in by two hermit crabs, both one step off.
  const f = focus({
    reason: "crowded",
    intent: "rest",
    result: "rested",
    observation: {
      ...focus().observation,
      nearby: [
        { id: 4, species: 3, role: "wildcard", x: 14, y: 0, away: 1, hidden: false },
        { id: 11, species: 3, role: "wildcard", x: 15, y: 1, away: 1, hidden: false },
      ],
    },
  });
  const s = buildSentence(f, CATALOG);
  assert.equal(s.headline, "Boxed in, with the Hermit Crab right beside it.");
});

test("exploring + move: nothing worth reacting to", () => {
  // seed 7, tick 1, id 2.
  const f = focus({ reason: "exploring", intent: "move-west", result: "moved-west" });
  const s = buildSentence(f, CATALOG);
  assert.equal(s.headline, "Wandered west with nothing in sight.");
});

test("waiting + rest: nothing to eat, nothing to run from", () => {
  // seed 7, tick 31, id 2.
  const f = focus({ reason: "waiting", intent: "rest", result: "rested" });
  const s = buildSentence(f, CATALOG);
  assert.equal(s.headline, "Waited: nothing to eat and nothing to run from.");
});

test("a move blocked by somebody who beat it there gets the generic note", () => {
  // seed 7, tick 6, id 7 — asked to move north, something already stood there.
  // `scent` is "west" here (there is a carcass upwind) but the creature's own
  // energy was above the threshold that acts on it (`shyScavenger.cove`'s
  // `full()`), so it moved towards the richest patch it could see instead —
  // north, at food level 3 — and the sentence has to tell those two apart
  // rather than trust `scent` being non-null.
  const f = focus({
    reason: "seeking_food",
    intent: "move-north",
    result: "blocked-north",
    observation: {
      here: 0,
      shelter: false,
      scent: "west",
      around: [
        { heading: "north", x: 2, y: 7, food: 3, shelter: false, outside: false, occupied: false },
        { heading: "east", x: 3, y: 8, food: 0, shelter: true, outside: false, occupied: false },
        { heading: "south", x: 2, y: 9, food: 2, shelter: false, outside: false, occupied: false },
        { heading: "west", x: 1, y: 8, food: 0, shelter: false, outside: false, occupied: false },
      ],
      nearby: [{ id: 1, species: 0, role: "grazer", x: 2, y: 6, away: 2, hidden: false }],
    },
  });
  const s = buildSentence(f, CATALOG);
  assert.equal(s.headline, "Moved north towards plenty of food.");
  assert.equal(s.note, "Something was already there.");
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
  assert.equal(memoryWord("moved-north"), "It moved north, last tick.");
  assert.match(memoryWord("blocked-east"), /found something in the way/);
  assert.match(memoryWord("ate-1"), /ate/);
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

test("highlightedLines finds both branches a reef grazer flees a threat from", () => {
  const source = readCatalogSource("reefGrazer");
  assert.deepEqual(highlightedLines(source, "fleeing_threat"), [36, 47]);
});

test("highlightedLines finds a single-branch reason too", () => {
  const source = readCatalogSource("reefGrazer");
  assert.deepEqual(highlightedLines(source, "feeding"), [42]);
  assert.deepEqual(highlightedLines(source, "seeking_food"), [54]);
  assert.deepEqual(highlightedLines(source, "exploring"), [58]);
});

test("highlightedLines finds both of a shy scavenger's ways into shelter", () => {
  const source = readCatalogSource("shyScavenger");
  assert.deepEqual(highlightedLines(source, "sheltering"), [101, 106]);
});

test("highlightedLines finds both of a hermit crab's feeding branches", () => {
  const source = readCatalogSource("hermitCrab");
  assert.deepEqual(highlightedLines(source, "feeding"), [38, 48]);
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

test("zoomedLayout at zoom 1 centred on the grid reproduces the base layout", () => {
  const base = computeLayout(800, 600, 16, 12, 16);
  const zoomed = zoomedLayout(base, 800, 600, 1, 8, 6);
  assert.ok(Math.abs(zoomed.cell - base.cell) < 1e-9);
  assert.ok(Math.abs(zoomed.offsetX - base.offsetX) < 1e-9);
  assert.ok(Math.abs(zoomed.offsetY - base.offsetY) < 1e-9);
});

test("zoomedLayout centres the camera's point on the canvas centre", () => {
  const base = computeLayout(800, 600, 16, 12, 16);
  const zoomed = zoomedLayout(base, 800, 600, 2, 3, 4);
  const centre = cellCentre(zoomed, 2.5, 3.5); // (3, 4) minus half a cell
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
  const centre = cellCentre(layout, 2, 2);
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
  const centre = cellCentre(layout, 2.2, 2);
  assert.equal(pickCreature(centre.px, centre.py, layout, creatures, catalog), 2);
});

// A follow camera that centres on its creature shows the water outside the
// world whenever that creature is near an edge, which reads as a bug rather
// than as a camera doing what it was told. Without this the left half of the
// canvas is empty every time somebody follows a fish along the west wall.
test("clampCamera keeps the view inside the reef", async () => {
  const { clampCamera } = await import("../dist/camera.js");
  // A 16x12 reef, a 640x480 view, base cell 40 at zoom 2: the view is eight
  // cells wide and six tall, so the centre may range over 4..12 and 3..9.
  const at = (x, y) => clampCamera({ x, y, zoom: 2 }, 16, 12, 640, 480, 40);
  assert.deepEqual(at(8, 6), { x: 8, y: 6, zoom: 2 });
  assert.deepEqual(at(0.5, 0.5), { x: 4, y: 3, zoom: 2 });
  assert.deepEqual(at(15.5, 11.5), { x: 12, y: 9, zoom: 2 });
});

// Zoomed all the way out there is nothing to choose: the reef is narrower
// than the view on both axes and belongs in the middle of it.
test("clampCamera centres a reef smaller than the view", async () => {
  const { clampCamera } = await import("../dist/camera.js");
  assert.deepEqual(clampCamera({ x: 0, y: 0, zoom: 1 }, 16, 12, 4000, 4000, 40), {
    x: 8,
    y: 6,
    zoom: 1,
  });
});
