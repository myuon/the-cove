//! One broken creature costs one tick, and only its own -- at the level of a
//! whole world, not just one `Session::decide` call.
//!
//! `looping`'s `decide` spins forever, so it is not a catalog entry; it is
//! the same fixture `crates/creature-host/tests/isolation.rs` stops, reused
//! here rather than copied, so a change to what "broken" means only has one
//! place to change it. This file's claim is one level up from that one: put
//! it *in a world* with other creatures, and the world still ticks, and its
//! failures are counted rather than silently swallowed or allowed to stop
//! the tick for everybody else.

use std::path::{Path, PathBuf};

use simulation::{
    advance, decision_limits, new_world, Habitat, Role, Roster, Session, Species, SpeciesDef,
};

fn workspace_root() -> PathBuf {
    Path::new(env!("CARGO_MANIFEST_DIR")).join("..").join("..")
}

fn catalog_dir() -> PathBuf {
    workspace_root().join(simulation::CATALOG)
}

/// A one-species roster over the `looping` fixture, standing in for a real
/// catalog entry. The numbers are arbitrary and chosen only so the world
/// does not do anything interesting around it: energy enough to last the
/// whole run without starving or dividing.
fn looping_roster() -> Roster {
    Roster {
        defs: vec![SpeciesDef {
            id: "looping".to_string(),
            name: "Looping".to_string(),
            role: Role::Wildcard,
            starting_energy: 40,
            stride: 1,
            forage: 5,
            capacity: 1_000_000,
        }],
    }
}

fn looping_species() -> Species {
    let catalog = catalog_dir();
    let creature = workspace_root()
        .join("crates")
        .join("creature-host")
        .join("tests")
        .join("broken")
        .join("looping");
    Species::compose(
        "looping",
        &catalog.join("contract"),
        &catalog.join("instinct"),
        &creature,
    )
    .expect("looping composes against the shipped contract and instincts")
}

// The world still ticks with a creature that never answers in it, and the
// failure is counted rather than silently dropped -- without this, a broken
// creature could just as easily be hanging the whole tick loop and nothing
// here would know the difference.
#[test]
fn a_world_with_an_always_failing_creature_still_ticks_and_counts_its_failures() {
    let roster = looping_roster();
    let width = 6;
    let height = 6;
    let mut world = new_world(99, width, height, &roster);
    let starting_alive = world.creatures.len();
    assert!(starting_alive > 0, "the world should start with founders");

    let species = looping_species();
    let lowering = species.lower().expect("looping lowers");
    let habitat: Habitat = species.habitat();
    let mut sessions: Vec<Session<'_>> = vec![habitat.session(&lowering)];

    let limits = decision_limits();
    let mut total_failed_fuel = 0u64;
    for expected_tick in 1..=5 {
        let (turn, cost) = advance(&world, &roster, &mut sessions, &limits);
        total_failed_fuel += cost.failed_fuel;
        assert_eq!(
            cost.failed_fuel, starting_alive as u64,
            "every looping creature should exhaust its fuel every tick"
        );
        assert_eq!(cost.failed_fault, 0, "looping fails on fuel, not a fault");
        world = turn.world;
        assert_eq!(
            world.tick, expected_tick,
            "the world must go on advancing even though every creature in it fails"
        );
    }

    assert_eq!(
        total_failed_fuel,
        starting_alive as u64 * 5,
        "five ticks of every creature failing should count five ticks' worth of failures"
    );
    // Nobody starved or moved on their own (a failed decision falls back to
    // `Rest`), so the population is exactly what it started as.
    assert_eq!(world.creatures.len(), starting_alive);
}
