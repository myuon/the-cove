//! Named observations a species can be asked to decide against.
//!
//! Every scenario is a fixed `(SelfView, Observation)` pair, built once and
//! read many times. They exist so a test can name what question it is asking
//! ("what does a cornered creature do?") rather than construct the same
//! fields inline at every call site, and so that a report can walk the same
//! five cases a test does and mean the same thing by each name.
//!
//! Each scenario carries its own `SelfView.id`, distinct from every other
//! scenario's, so a tape line names which scenario produced it without a
//! caller having to thread the name through separately.
//!
//! `shyScavenger`'s own sight (16.0) and the reef's reach (`3.0`, mirrored
//! here as a literal since this crate does not depend on `simulation`, which
//! is the one place `REACH` is a named constant) are what every scenario
//! below is built at, because `fixtures/report.txt` is rendered against this
//! one species.

use crate::contract::{ActionResult, Bed, Morsel, Observation, Point, Role, SelfView, Sighting};

/// The reef every scenario is set on. Its size only matters where a
/// behaviour reasons about the far corner (`instinct.inside`, `instinct.wander`).
fn reef() -> Point {
    Point::new(100.0, 75.0)
}

/// `shyScavenger`'s sight, matching `Observation.sight` for the role this
/// crate's fixtures are rendered against.
const SIGHT: f64 = 16.0;
/// The reef's own reach, matching `simulation::world::REACH`.
const REACH: f64 = 3.0;

/// Nothing around, nothing nearby, no food, no shelter.
///
/// The degenerate observation. `nearby`, `food` and `kelp` are genuinely
/// empty arrays, so a species that indexes into one assuming at least one
/// element, rather than folding or filtering it, fails only here.
pub fn empty() -> (SelfView, Observation) {
    let view = SelfView {
        id: 1,
        species: 1,
        role: Role::Scavenger,
        at: Point::new(50.0, 40.0),
        facing: Point::new(1.0, 0.0),
        speed: 0.0,
        energy: 20,
        age: 10,
        hidden: false,
        last: ActionResult::Spawned,
    };
    let world = Observation {
        tick: 1,
        reef: reef(),
        sight: SIGHT,
        reach: REACH,
        here: 0.0,
        sheltered: false,
        nearby: Vec::new(),
        food: Vec::new(),
        kelp: Vec::new(),
    };
    (view, world)
}

/// Food in reach right where this creature is floating.
///
/// Eating what is underfoot is the earlier branch in `creature.decide` — it
/// is checked before a patch is ever picked to swim to — so this is the
/// scenario that would catch a species which swam toward `richest` instead of
/// eating the food it was already sitting in.
pub fn grazing() -> (SelfView, Observation) {
    let view = SelfView {
        id: 2,
        species: 1,
        role: Role::Scavenger,
        at: Point::new(10.0, 10.0),
        facing: Point::new(0.0, 1.0),
        speed: 0.3,
        energy: 15,
        age: 5,
        hidden: false,
        last: ActionResult::Spawned,
    };
    let world = Observation {
        tick: 2,
        reef: reef(),
        sight: SIGHT,
        reach: REACH,
        here: 5.0,
        sheltered: false,
        nearby: Vec::new(),
        food: vec![Morsel {
            at: Point::new(10.0, 10.0),
            amount: 5.0,
            radius: 3.0,
            away: 0.0,
        }],
        kelp: Vec::new(),
    };
    (view, world)
}

/// A hunter close by, no kelp in sight, nowhere sheltered to stand.
///
/// The case `lastResort` in `shyScavenger/creature.cove` is written for:
/// with no cover in sight there is nothing to swim to, so it asks to hide
/// where it is floating. Open water is not cover and the reef refuses that
/// (see `tests/refusing.rs`), which is the one place `SelfView.last` changes
/// what this species decides next.
pub fn cornered() -> (SelfView, Observation) {
    let view = SelfView {
        id: 3,
        species: 1,
        role: Role::Scavenger,
        at: Point::new(4.0, 4.0),
        facing: Point::new(1.0, 0.0),
        speed: 0.2,
        energy: 20,
        age: 3,
        hidden: false,
        last: ActionResult::Spawned,
    };
    let world = Observation {
        tick: 3,
        reef: reef(),
        sight: SIGHT,
        reach: REACH,
        here: 0.0,
        sheltered: false,
        nearby: vec![Sighting {
            id: 99,
            species: 2,
            role: Role::Hunter,
            at: Point::new(4.0, 1.0),
            away: 3.0,
            facing: Point::new(0.0, 1.0),
            hidden: false,
        }],
        food: Vec::new(),
        kelp: Vec::new(),
    };
    (view, world)
}

/// Four sightings, the most an observation ever carries, all close enough to
/// crowd.
///
/// `nearby` is bounded to four, so this is the observation at its fullest,
/// and every sighting is within `crowding()` — the crowd branch of
/// `creature.decide` has somewhere to swim away from.
pub fn crowded() -> (SelfView, Observation) {
    let view = SelfView {
        id: 4,
        species: 1,
        role: Role::Scavenger,
        at: Point::new(50.0, 37.0),
        facing: Point::new(1.0, 0.0),
        speed: 0.4,
        energy: 25,
        age: 1,
        hidden: false,
        last: ActionResult::Spawned,
    };
    let sighting = |id: i64, away: f64| Sighting {
        id,
        species: 0,
        role: Role::Grazer,
        at: Point::new(50.0 + away, 37.0),
        away,
        facing: Point::new(-1.0, 0.0),
        hidden: false,
    };
    let world = Observation {
        tick: 4,
        reef: reef(),
        sight: SIGHT,
        reach: REACH,
        here: 0.0,
        sheltered: false,
        nearby: vec![
            sighting(10, 1.5),
            sighting(11, 2.0),
            sighting(12, 2.5),
            sighting(13, 3.0),
        ],
        food: Vec::new(),
        kelp: Vec::new(),
    };
    (view, world)
}

/// Values a well-behaved reef would never produce.
///
/// `away: f64::MAX` on a sighting, negative identities, negative energy and
/// `here`, `tick: i64::MAX`, and a reef corner that is itself `f64::MAX`.
/// Nothing here is a value the simulation would ever hand a creature; the
/// point is only that `decide` answers something and the invocation neither
/// faults nor loops, not which answer it gives.
pub fn adversarial() -> (SelfView, Observation) {
    let view = SelfView {
        id: 5,
        species: 1,
        role: Role::Scavenger,
        at: Point::new(f64::MAX, f64::MAX),
        facing: Point::new(0.0, 0.0),
        speed: f64::MAX,
        energy: -100,
        age: 0,
        hidden: false,
        last: ActionResult::Spawned,
    };
    let world = Observation {
        tick: i64::MAX,
        reef: Point::new(f64::MAX, f64::MAX),
        sight: SIGHT,
        reach: REACH,
        here: -50.0,
        sheltered: true,
        nearby: vec![Sighting {
            id: -42,
            species: -3,
            role: Role::Hunter,
            at: Point::new(0.0, -1.0),
            away: f64::MAX,
            facing: Point::new(f64::NAN, f64::NAN),
            hidden: false,
        }],
        food: vec![Morsel {
            at: Point::new(-1.0, -1.0),
            amount: f64::MAX,
            radius: -1.0,
            away: f64::NAN,
        }],
        kelp: vec![Bed {
            at: Point::new(-1.0, -1.0),
            radius: -1.0,
            away: f64::NAN,
        }],
    };
    (view, world)
}

/// Every scenario, named, in a stable order.
///
/// What `report.rs`, `capture.rs`, and `tests/report.rs` walk over, so that a
/// scenario added here shows up in all three without being wired into each
/// separately.
pub fn all() -> Vec<(&'static str, SelfView, Observation)> {
    let (view, world) = empty();
    let empty = ("empty", view, world);
    let (view, world) = grazing();
    let grazing = ("grazing", view, world);
    let (view, world) = cornered();
    let cornered = ("cornered", view, world);
    let (view, world) = crowded();
    let crowded = ("crowded", view, world);
    let (view, world) = adversarial();
    let adversarial = ("adversarial", view, world);
    vec![empty, grazing, cornered, crowded, adversarial]
}
