// The shape `tank_snapshot()` answers, and nothing this page invents.
//
// Every field here is read straight off the JSON the wasm module writes by
// hand in `crates/tank-wasm/src/lib.rs`. This file adds no field and renames
// none — a mismatch here is a mismatch the compiler will not catch, because
// `JSON.parse` returns `any` and every cast below trusts that this type is
// still what the module writes.

/** One entry from the compiled-in catalog, as the tank draws it. */
export interface CatalogEntry {
  readonly id: string;
  readonly name: string;
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
  readonly energy: number;
  readonly age: number;
  readonly hidden: boolean;
  /** What it asked for this tick, e.g. `move-north`, `hunt-7`, `eat`. */
  readonly intent: string;
  /** Why it asked, e.g. `fleeing_threat`, `seeking_food`, `hunting`. */
  readonly reason: string;
  /** What the world did with the intent, e.g. `hunted-3`, `blocked-east`. */
  readonly result: string;
}

/** One of the four compass directions a heading or a patch can name. */
export type Heading = "north" | "east" | "south" | "west";

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
}

/** One of the four cells the focused creature could step onto. */
export interface FocusPatch {
  readonly heading: Heading;
  readonly x: number;
  readonly y: number;
  readonly food: number;
  readonly shelter: boolean;
  readonly outside: boolean;
  readonly occupied: boolean;
}

/** Another creature, as the focused one could see it. Nearest first. */
export interface FocusSighting {
  readonly id: number;
  readonly species: number;
  readonly role: string;
  readonly x: number;
  readonly y: number;
  readonly away: number;
  readonly hidden: boolean;
}

/** The whole of what the focused creature could have reasoned from. */
export interface FocusObservation {
  readonly here: number;
  readonly shelter: boolean;
  readonly scent: Heading | null;
  readonly around: readonly FocusPatch[];
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
  readonly width: number;
  readonly height: number;
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
  readonly cast: number;
  readonly instructions: number;
  readonly fuel: number;
  readonly decisions: number;
  readonly failedFuel: number;
  readonly failedFault: number;
  readonly coveMicros: number;
  readonly catalog: readonly CatalogEntry[];
  /** `width * height` integers, `0..4`, row-major. */
  readonly food: readonly number[];
  readonly creatures: readonly CreatureSnapshot[];
  /** What `tank_focus()` last watched, or `null` if nobody is watched or the
   * watched creature did not act this tick (it is gone). */
  readonly focus: FocusSnapshot | null;
}
