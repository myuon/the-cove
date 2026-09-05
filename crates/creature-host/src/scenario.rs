//! Named observations a species can be asked to decide against.
//!
//! Every scenario is a fixed `(SelfView, Observation)` pair, built once and
//! read many times. They exist so a test can name what question it is asking
//! ("what does a cornered creature do?") rather than construct the same
//! sixteen fields inline at every call site, and so that a report can walk
//! the same five cases a test does and mean the same thing by each name.
//!
//! Each scenario carries its own `SelfView.id`, distinct from every other
//! scenario's, so a tape line names which scenario produced it without a
//! caller having to thread the name through separately.

use crate::contract::{ActionResult, Cell, Heading, Observation, Patch, Role, SelfView, Sighting};

/// A patch that cannot be stepped onto: off the edge and, for good measure,
/// standing room for nothing since nothing stands there.
fn closed(heading: Heading) -> Patch {
    Patch {
        heading,
        at: Cell { x: 0, y: 0 },
        food: 0,
        shelter: false,
        outside: true,
        occupied: false,
    }
}

/// An ordinary empty patch: on the grid, nobody on it, nothing growing.
fn open(heading: Heading) -> Patch {
    Patch {
        heading,
        at: Cell { x: 0, y: 0 },
        food: 0,
        shelter: false,
        outside: false,
        occupied: false,
    }
}

/// The four headings a `Patch` array always carries one of, in the tie-break
/// order `contract.headings()` declares.
fn headings() -> [Heading; 4] {
    [Heading::North, Heading::East, Heading::South, Heading::West]
}

/// Nothing around, nothing nearby, no food, no shelter, no scent.
///
/// The degenerate observation. `around` still carries the four patches a
/// world always shows — one per heading — but every one of them is open and
/// empty, and `nearby` is a genuinely empty array. A species that indexes
/// into `nearby` assuming at least one sighting, rather than folding or
/// filtering it, fails only here.
pub fn empty() -> (SelfView, Observation) {
    let view = SelfView {
        id: 1,
        species: 1,
        role: Role::Scavenger,
        at: Cell { x: 5, y: 5 },
        energy: 20,
        age: 10,
        hidden: false,
        last: ActionResult::Spawned,
    };
    let world = Observation {
        tick: 1,
        here: 0,
        shelter: false,
        around: headings().into_iter().map(open).collect(),
        nearby: Vec::new(),
        scent: None,
    };
    (view, world)
}

/// Food in a reachable patch, and food in the cell it stands in.
///
/// Eating what is underfoot is the earlier branch in `creature.decide` — it
/// is checked before a patch is ever picked to walk to — so this is the
/// scenario that would catch a species which moved toward `richest` instead
/// of eating the food it was already standing on.
pub fn grazing() -> (SelfView, Observation) {
    let view = SelfView {
        id: 2,
        species: 1,
        role: Role::Scavenger,
        at: Cell { x: 10, y: 10 },
        energy: 15,
        age: 5,
        hidden: false,
        last: ActionResult::Spawned,
    };
    let mut around: Vec<Patch> = headings().into_iter().map(open).collect();
    around[0].food = 3; // north, reachable and holding food of its own
    let world = Observation {
        tick: 2,
        here: 5,
        shelter: false,
        around,
        nearby: Vec::new(),
        scent: None,
    };
    (view, world)
}

/// A hunter one step away, every patch outside or occupied, no shelter here,
/// no scent.
///
/// There is nowhere to step and no cover: the case `lastResort` in
/// `shyScavenger/creature.cove` is written for. Every patch is closed by
/// making it `outside` or `occupied` in turn, so `open()` on this
/// observation returns nothing at all.
pub fn cornered() -> (SelfView, Observation) {
    let view = SelfView {
        id: 3,
        species: 1,
        role: Role::Scavenger,
        at: Cell { x: 0, y: 0 },
        energy: 20,
        age: 3,
        hidden: false,
        last: ActionResult::Spawned,
    };
    let mut around = vec![
        closed(Heading::North),
        closed(Heading::East),
        closed(Heading::South),
        closed(Heading::West),
    ];
    around[0].outside = true;
    around[1].outside = false;
    around[1].occupied = true;
    around[2].outside = true;
    around[3].outside = false;
    around[3].occupied = true;
    let world = Observation {
        tick: 3,
        here: 0,
        shelter: false,
        around,
        nearby: vec![Sighting {
            id: 99,
            species: 2,
            role: Role::Hunter,
            at: Cell { x: 0, y: -1 },
            away: 1,
            hidden: false,
        }],
        scent: None,
    };
    (view, world)
}

/// Four sightings, all patches occupied, several creatures within two steps.
///
/// `sightLimit()` is four, so this is the observation at its fullest, and
/// every patch is `occupied` so there is nowhere to step away to either —
/// the crowd branch of `creature.decide` has to fall back to resting rather
/// than moving.
pub fn crowded() -> (SelfView, Observation) {
    let view = SelfView {
        id: 4,
        species: 1,
        role: Role::Scavenger,
        at: Cell { x: 2, y: 2 },
        energy: 25,
        age: 1,
        hidden: false,
        last: ActionResult::Spawned,
    };
    let around: Vec<Patch> = headings()
        .into_iter()
        .map(|heading| Patch {
            heading,
            at: Cell { x: 0, y: 0 },
            food: 0,
            shelter: false,
            outside: false,
            occupied: true,
        })
        .collect();
    let sighting = |id: i64, away: i64| Sighting {
        id,
        species: 1,
        role: Role::Grazer,
        at: Cell { x: 0, y: 0 },
        away,
        hidden: false,
    };
    let world = Observation {
        tick: 4,
        here: 0,
        shelter: false,
        around,
        nearby: vec![
            sighting(10, 1),
            sighting(11, 1),
            sighting(12, 2),
            sighting(13, 2),
        ],
        scent: None,
    };
    (view, world)
}

/// Values a well-behaved world would never produce.
///
/// `away: i64::MAX` on a sighting, negative sighting identities, negative
/// energy and `here`, `tick: i64::MAX`, and every patch simultaneously
/// `outside` and `occupied`. Nothing here is a value the simulation would
/// ever hand a creature; the point is only that `decide` answers something
/// and the invocation neither faults nor loops, not which answer it gives.
pub fn adversarial() -> (SelfView, Observation) {
    let view = SelfView {
        id: 5,
        species: 1,
        role: Role::Scavenger,
        at: Cell { x: 0, y: 0 },
        energy: -100,
        age: 0,
        hidden: false,
        last: ActionResult::Spawned,
    };
    let around: Vec<Patch> = headings()
        .into_iter()
        .map(|heading| Patch {
            heading,
            at: Cell { x: 0, y: 0 },
            food: 0,
            shelter: false,
            outside: true,
            occupied: true,
        })
        .collect();
    let world = Observation {
        tick: i64::MAX,
        here: -50,
        shelter: true,
        around,
        nearby: vec![Sighting {
            id: -42,
            species: -3,
            role: Role::Hunter,
            at: Cell { x: 0, y: -1 },
            away: i64::MAX,
            hidden: false,
        }],
        scent: None,
    };
    (view, world)
}

/// Every scenario, named, in a stable order.
///
/// What `report.rs`, `capture.rs`, and `tests/deciding.rs` walk over, so that
/// a scenario added here shows up in all three without being wired into each
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
