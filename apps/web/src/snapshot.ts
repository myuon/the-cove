// The shape `tank_snapshot()` answers, and nothing this page invents.
//
// Every field here is read straight off the JSON the wasm module writes by
// hand in `crates/tank-wasm/src/lib.rs`. This file adds no field and renames
// none — a mismatch here is a mismatch the compiler will not catch, because
// `JSON.parse` returns `any` and every cast below trusts that this type is
// still what the module writes.
//
// The reef is continuous now: a place is two floats and not two cells, a
// creature carries a `facing` (a unit vector) and a `speed` rather than
// snapping between cells, and cover is a handful of kelp beds rather than a
// formula over coordinates — see `crates/tank-wasm/src/lib.rs`'s `snapshot`
// and `catalog/contract/contract.cove`'s doc for why. There is no more
// `Heading`, no `around` (the four cells a creature could step onto — there
// are no cells), and no `scent` (a gridded creature's sense of upwind; a
// continuous one just sees the morsel itself). What replaced them is real
// positions and real distances, `away` in reef units rather than a cell
// count.

/** One entry from the compiled-in catalog, as the tank draws it. */
export interface CatalogEntry {
  readonly id: string;
  readonly name: string;
  /** `contract.cove`'s `Role`, lower-cased: `grazer`, `hunter`, `scavenger`,
   * `wildcard`, and the two this catalog does not yet use, `ambusher` and
   * `cooperator`. */
  readonly role: string;
  readonly colour: string;
  readonly shape: "round" | "wedge" | "ring" | "spiral";
  readonly size: number;
}

/** One creature, as the world holds it after the last tick resolved. */
export interface CreatureSnapshot {
  readonly id: number;
  /** Indexes `Snapshot.catalog`. */
  readonly species: number;
  readonly x: number;
  readonly y: number;
  /** Which way it is pointing, a unit vector — not an angle: the reef has no
   * trigonometry, and neither does this field. */
  readonly facingX: number;
  readonly facingY: number;
  /** How fast it is actually moving, in reef units per tick. */
  readonly speed: number;
  readonly energy: number;
  readonly age: number;
  readonly hidden: boolean;
  /** What it asked for this tick: `toward`, `away`, `eat`, `hunt-7`, `hide`,
   * `rest`. Never a compass direction — a continuous swim has no cardinal
   * heading, only a place it is trying to reach or leave. */
  readonly intent: string;
  /** Why it asked, e.g. `fleeing_threat`, `seeking_food`, `hunting`. */
  readonly reason: string;
  /** What the world did with the intent, e.g. `swam`, `hunted-3`, `refused`. */
  readonly result: string;
}

/** A patch of food, drifting rather than sitting in a cell. */
export interface Morsel {
  readonly x: number;
  readonly y: number;
  /** How much is left in it, up to the world's own maximum. */
  readonly amount: number;
  readonly radius: number;
}

/** A bed of kelp. Fixed for the life of a world; only the sway a visitor sees
 * is the renderer's, never the reef's. */
export interface Bed {
  readonly x: number;
  readonly y: number;
  readonly radius: number;
}

/** Why an invocation never reached a `Decision` at all. */
export interface FocusFailure {
  readonly kind:
    | "fuel"
    | "deadline"
    | "cancelled"
    | "callDepth"
    | "hostCalls"
    | "concurrency"
    | "fault"
    | "malformed";
  readonly message: string;
  readonly at: string | null;
}

/** What the focused creature was told about itself. */
export interface FocusSelf {
  readonly energy: number;
  readonly age: number;
  readonly hidden: boolean;
  readonly role: string;
  /** What the world did with *last* tick's intent — the only thing a
   * creature carries from one tick to the next. */
  readonly memory: string;
  readonly facingX: number;
  readonly facingY: number;
  readonly speed: number;
}

/** A patch of food, as the focused creature could see it — `Morsel` plus how
 * far off it is, for real: the host has already taken the square root. */
export interface FocusMorsel extends Morsel {
  readonly away: number;
}

/** A bed of kelp, as the focused creature could see it. */
export interface FocusBed extends Bed {
  readonly away: number;
}

/** Another creature, as the focused one could see it. Nearest first, at most
 * four of them — `contract.cove`'s `Observation.nearby`. */
export interface FocusSighting {
  readonly id: number;
  readonly species: number;
  readonly role: string;
  readonly x: number;
  readonly y: number;
  readonly away: number;
  readonly facingX: number;
  readonly facingY: number;
  readonly hidden: boolean;
}

/** The whole of what the focused creature could have reasoned from. */
export interface FocusObservation {
  readonly reef: { readonly x: number; readonly y: number };
  /** How far this creature can see. Everything below was inside it. */
  readonly sight: number;
  /** How far this creature's lunge — or its bite — reaches. */
  readonly reach: number;
  /** How much food is in reach of this creature right now, at all: the sum
   * of every morsel it is standing inside, not just the nearest one. */
  readonly here: number;
  readonly sheltered: boolean;
  readonly food: readonly FocusMorsel[];
  readonly kelp: readonly FocusBed[];
  readonly nearby: readonly FocusSighting[];
}

/** Everything about one invocation, for the creature a visitor is watching.
 * `null` on the snapshot whenever nobody is focused. */
export interface FocusSnapshot {
  readonly id: number;
  /** Indexes `Snapshot.catalog`. */
  readonly species: number;
  readonly tick: number;
  readonly intent: string;
  readonly reason: string;
  readonly result: string;
  readonly refusal: string | null;
  readonly instructions: number;
  readonly fuel: number;
  readonly failure: FocusFailure | null;
  readonly self: FocusSelf;
  readonly observation: FocusObservation;
  /** The runtime's own record of this one call, in order. */
  readonly trace: readonly string[];
}

/** The tank as `tank_snapshot()` answers it, once per tick. */
export interface Snapshot {
  readonly tick: number;
  /** The far corner of the reef, in reef units. The near corner is the
   * origin. */
  readonly reef: { readonly x: number; readonly y: number };
  readonly hash: number;
  readonly births: number;
  readonly deaths: number;
  readonly refusals: number;
  /** The energy every species is clamped to. The world's own constant, sent
   * rather than mirrored: a rule held in a second language is a rule that
   * drifts, and this project has already had that happen once. */
  readonly maxEnergy: number;
  /** How many ticks a slot stays empty after the creature in it dies. */
  readonly respawnDelay: number;
  /** How many slots this world holds, fixed for its life — not the same as
   * `creatures.length`, which dips while a slot is empty between a death and
   * its respawn. */
  readonly cast: number;
  readonly instructions: number;
  readonly fuel: number;
  readonly decisions: number;
  readonly failedFuel: number;
  readonly failedFault: number;
  readonly coveMicros: number;
  readonly catalog: readonly CatalogEntry[];
  readonly food: readonly Morsel[];
  readonly kelp: readonly Bed[];
  readonly creatures: readonly CreatureSnapshot[];
  /** What `tank_focus()` last watched, or `null` if nobody is watched or the
   * watched creature did not act this tick (it is gone). */
  readonly focus: FocusSnapshot | null;
}
