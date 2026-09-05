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

/** The tank as `tank_snapshot()` answers it, once per tick. */
export interface Snapshot {
  readonly tick: number;
  readonly width: number;
  readonly height: number;
  readonly hash: number;
  readonly births: number;
  readonly deaths: number;
  readonly refusals: number;
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
}
