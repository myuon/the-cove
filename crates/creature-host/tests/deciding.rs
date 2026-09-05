//! What `shyScavenger.decide` actually answers, and what one tick costs.
//!
//! `species.rs` and `scenario.rs` are exercised together here: every named
//! scenario is run once against the catalog's one species, and the answer is
//! pinned down as a literal so a change in behaviour shows up as a diff
//! rather than as a silent pass. Every line below was produced by running
//! the scenario and reading what it answered, not guessed from the source.

use std::path::{Path, PathBuf};

use creature_host::{scenario, Limits, Species};

fn workspace_root() -> PathBuf {
    Path::new(env!("CARGO_MANIFEST_DIR")).join("..").join("..")
}

fn catalog_dir() -> PathBuf {
    workspace_root().join(creature_host::CATALOG)
}

fn shy_scavenger() -> Species {
    Species::load(&catalog_dir(), "shyScavenger").expect("shyScavenger loads")
}

type Case = (
    &'static str,
    fn() -> (creature_host::SelfView, creature_host::Observation),
    &'static str,
);

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
            // Nothing around it, nothing pressing, and energy to spare: it
            // waits rather than spending any swimming for no reason.
            ("empty", scenario::empty, "rest because=waiting"),
            // Food underfoot beats swimming to more food elsewhere.
            ("grazing", scenario::grazing, "eat because=feeding"),
            // No shelter in sight: it hides where it is floating, tagged
            // with `Sheltering` rather than with why it fled.
            ("cornered", scenario::cornered, "hide because=sheltering"),
            // The nearest of the crowd is close enough and there is energy
            // to spare, so it drifts off rather than waiting it out.
            ("crowded", scenario::crowded, "away because=crowded"),
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

// `adversarial` feeds `decide` values no well-behaved reef produces. The
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
fn grazing_costs_a_pinned_number_of_instructions() {
    let species = shy_scavenger();
    let lowering = species.lower().expect("lowers");
    species.serve(&lowering, |session| {
        let (view, world) = scenario::grazing();
        let outcome = session.decide_unbounded(&view, &world);
        assert_eq!(outcome.instructions, 57);
    });
}

// Fuel and instructions are the same number for a decision that finished.
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
