//! What `shyScavenger.decide` actually answers, and what one tick costs.
//!
//! `species.rs` and `scenario.rs` are exercised together here: every named
//! scenario is run once against the catalog's one species, and the answer is
//! pinned down as a literal so a change in behaviour shows up as a diff
//! rather than as a silent pass. Every line below was produced by running
//! the scenario and reading what it answered, not guessed from the source.

use std::path::{Path, PathBuf};

use creature_host::{scenario, Limits, Species};

/// `CATALOG` names a path relative to the workspace root, but a test
/// binary's working directory is its own crate's manifest directory
/// (`crates/creature-host`), not the root — confirmed empirically, since
/// nothing else in this crate says so. Every test file that touches the
/// catalog computes the root the same way.
fn workspace_root() -> PathBuf {
    Path::new(env!("CARGO_MANIFEST_DIR")).join("..").join("..")
}

fn catalog_dir() -> PathBuf {
    workspace_root().join(creature_host::CATALOG)
}

fn shy_scavenger() -> Species {
    Species::load(&catalog_dir(), "shyScavenger").expect("shyScavenger loads")
}

/// A scenario builder, named alongside the line its decision is expected to
/// render as.
type Case = (
    &'static str,
    fn() -> (creature_host::SelfView, creature_host::Observation),
    &'static str,
);

// If the species failed to load, or the checker had something to say about
// it, nothing past this point would be testing the species this crate ships.
#[test]
fn the_shy_scavenger_loads_with_no_notices_and_lowers() {
    let species = shy_scavenger();
    assert!(
        species.notices().is_empty(),
        "unexpected notices: {:?}",
        species.notices()
    );
    species.lower().expect("creature.decide lowers");
}

// A change to the species' logic, or to a scenario's data, that changed what
// the scavenger decides would otherwise pass silently.
#[test]
fn every_named_scenario_decides_what_it_is_expected_to() {
    let species = shy_scavenger();
    let lowering = species.lower().expect("lowers");
    species.serve(&lowering, |session| {
        let cases: [Case; 4] = [
            // Nothing around it and nothing pressing: it waits.
            ("empty", scenario::empty, "rest because=waiting"),
            // Food underfoot beats walking to more food elsewhere.
            ("grazing", scenario::grazing, "eat because=feeding"),
            // No shelter in sight and no open cell to step to: `lastResort`
            // hides where it stands, tagged with why it fled in the first
            // place rather than with `Sheltering`.
            (
                "cornered",
                scenario::cornered,
                "hide because=fleeing_threat",
            ),
            // Every patch occupied leaves nowhere to step away to, so the
            // crowd branch falls back to resting.
            ("crowded", scenario::crowded, "rest because=crowded"),
        ];
        for (name, build, expected) in cases {
            let (view, world) = build();
            let outcome = session.decide_unbounded(&view, &world);
            let decision = outcome
                .decision()
                .unwrap_or_else(|| panic!("{name} did not decide: {:?}", outcome.answer));
            assert_eq!(decision.line(), expected, "scenario {name}");
        }
    });
}

// `adversarial` feeds `decide` values no well-behaved world produces. The
// only thing being tested is that an answer comes back at all — a crash or a
// fuel exhaustion here would mean pathological input can stop a creature
// that a bound was never meant to catch.
#[test]
fn a_pathological_observation_still_gets_an_answer() {
    let species = shy_scavenger();
    let lowering = species.lower().expect("lowers");
    species.serve(&lowering, |session| {
        let (view, world) = scenario::adversarial();
        let outcome = session.decide_unbounded(&view, &world);
        assert!(
            outcome.decision().is_some(),
            "adversarial did not decide: {:?}",
            outcome.answer
        );
    });
}

// The instruction count `grazing` costs is what a change to the species, the
// instincts, or the lowering would move. Pinned as a literal so that change
// shows up as a diff instead of silently drifting.
#[test]
fn grazing_costs_exactly_fifty_six_instructions() {
    let species = shy_scavenger();
    let lowering = species.lower().expect("lowers");
    species.serve(&lowering, |session| {
        let (view, world) = scenario::grazing();
        let outcome = session.decide_unbounded(&view, &world);
        assert_eq!(outcome.instructions, 56);
    });
}

// Fuel and instructions are the same number for a decision that finished, and
// that is worth an assertion because this crate believed otherwise for an
// afternoon. A `Meter` taken off a `Budget` before handing it to
// `invoke_within` reads zero for ever -- `HostRegistry::begin_run` calls
// `Budget::restart` and builds the meter afresh -- and a column of zeros looks
// exactly like a runtime that charges in blocks of 1024. It does not. The
// stride decides when the charge is compared against the limit, not what the
// charge is.
#[test]
fn a_decision_that_finished_is_charged_exactly_what_it_executed() {
    let species = shy_scavenger();
    let lowering = species.lower().expect("the entry lowers");
    species.serve(&lowering, |session| {
        for (name, view, world) in scenario::all() {
            let outcome = session.decide(
                &view,
                &world,
                Limits {
                    fuel: Some(1_000_000),
                    ..Limits::default()
                },
            );
            assert_eq!(
                outcome.fuel, outcome.instructions,
                "{name} was charged {} for {} instructions",
                outcome.fuel, outcome.instructions
            );
        }
    });
}
