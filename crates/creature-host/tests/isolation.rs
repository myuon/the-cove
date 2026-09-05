//! One broken creature costs one tick, and only its own.
//!
//! `looping` and `faulting` are not catalog entries; they are compiled
//! against the shipped contract and instincts precisely so they are exactly
//! as legitimate as one, and exist to be stopped. What each test here checks
//! is that stopping one of them leaves the session able to go on serving —
//! which is the whole of what "the world costs nothing when a creature loops
//! or faults" means at the level of one `Session`.

use std::path::{Path, PathBuf};

use creature_host::{scenario, Failure, Limits, Species, Stopped};

fn workspace_root() -> PathBuf {
    Path::new(env!("CARGO_MANIFEST_DIR")).join("..").join("..")
}

fn catalog_dir() -> PathBuf {
    workspace_root().join(creature_host::CATALOG)
}

/// The `broken/` fixtures are not catalog entries, so they load with
/// `Species::compose` over the shipped contract and instincts and their own,
/// uncatalogued directory — never `Species::load`.
fn broken(name: &str) -> Species {
    let catalog = catalog_dir();
    let creature = Path::new(env!("CARGO_MANIFEST_DIR"))
        .join("tests")
        .join("broken")
        .join(name);
    Species::compose(
        name,
        &catalog.join("contract"),
        &catalog.join("instinct"),
        &creature,
    )
    .unwrap_or_else(|e| panic!("{name} does not compose: {e}"))
}

// `looping`'s `decide` spins on `while spun >= 0` for every input there is —
// it does not merely loop on some inputs, so a second call made *without* a
// fuel bound would hang this test forever rather than demonstrate isolation.
// What is provable with the same session is narrower and just as real: a
// second bounded call is charged its own fresh budget rather than inheriting
// any debt from the first, and stops exactly the same way, at exactly the
// same cost, rather than hanging or answering something corrupted.
#[test]
fn one_creatures_fuel_exhaustion_does_not_poison_the_next_tick() {
    let species = broken("looping");
    let lowering = species.lower().expect("looping lowers");
    species.serve(&lowering, |session| {
        let (view, world) = scenario::empty();
        let limits = || Limits {
            fuel: Some(50_000),
            ..Limits::default()
        };

        let first = session.decide(&view, &world, limits());
        assert_eq!(first.answer, Err(Failure::Stopped(Stopped::Fuel)));
        // Fuel is charged at a safepoint every 1024 instructions, so a run
        // stops at the first safepoint at or past the limit rather than
        // exactly on it: 49 * 1024 = 50176, measured directly.
        assert_eq!(first.instructions, 50_176);

        let second = session.decide(&view, &world, limits());
        assert_eq!(second.answer, Err(Failure::Stopped(Stopped::Fuel)));
        assert_eq!(
            second.instructions, first.instructions,
            "a fresh call should cost exactly what the first one did, not more or less"
        );
    });
}

// Unlike a fault, a fuel stop carries no location at all: `Failure::Stopped`
// wraps `cove_runtime::Stopped`, which names *which* limit was hit and
// nothing about where the run was when it happened. There is no line number
// to ask for here, and that is not an omission this crate could fill in — the
// dependency's own type has nowhere to put one.
#[test]
fn a_fuel_stopped_creature_gets_no_location() {
    let species = broken("looping");
    let lowering = species.lower().expect("looping lowers");
    species.serve(&lowering, |session| {
        let (view, world) = scenario::empty();
        let outcome = session.decide(
            &view,
            &world,
            Limits {
                fuel: Some(50_000),
                ..Limits::default()
            },
        );
        match outcome.answer {
            Err(Failure::Stopped(Stopped::Fuel)) => {
                // Reaching here at all is the assertion: `Stopped::Fuel`
                // carries nothing further to match against, so there is no
                // `at`-shaped field this arm could go on to inspect.
            }
            other => panic!("expected a fuel stop, got {other:?}"),
        }
    });
}

// `faulting` divides by a zero it computes itself, every time it is asked,
// which — unlike `looping` — actually terminates on its own, so calling it
// again on the same session is safe and is exactly the isolation claim: one
// creature's broken invariant costs its own tick and the session serves the
// next ask cleanly, answering the same fault again rather than something
// contaminated by the first.
#[test]
fn a_faulting_creatures_session_serves_again_afterwards() {
    let species = broken("faulting");
    let lowering = species.lower().expect("faulting lowers");
    species.serve(&lowering, |session| {
        let (view, world) = scenario::empty();

        let first = session.decide_unbounded(&view, &world);
        let Err(Failure::Faulted { message, at }) = &first.answer else {
            panic!("expected a fault, got {:?}", first.answer);
        };
        assert!(
            message.contains("division by zero"),
            "message did not mention division by zero: {message}"
        );
        let at = at.as_ref().expect("a fault names where it happened");
        assert!(at.contains("creature.cove"), "location was {at}");
        assert!(
            at.split(':')
                .nth(1)
                .is_some_and(|n| n.parse::<u32>().is_ok()),
            "location did not carry a line number: {at}"
        );

        let second = session.decide_unbounded(&view, &world);
        assert_eq!(
            second.answer, first.answer,
            "the same broken creature should fault the same way twice, not differently"
        );
    });
}

// The claim `looping` cannot make. A behaviour that spins for every input
// leaves nothing to ask afterwards, so the test above can only show that a
// second bounded call is charged afresh. `oneLoops` spins for creature zero
// alone, so the same session, holding the same species, can be asked about
// the creature that follows it -- and answers. That is what "one broken
// creature costs one tick" means in a world, and without this test the phrase
// is not tested anywhere.
#[test]
fn the_creature_after_the_one_that_looped_still_gets_its_tick() {
    let species = broken("oneLoops");
    let lowering = species.lower().expect("oneLoops lowers");
    species.serve(&lowering, |session| {
        let (mut view, world) = scenario::empty();
        let limits = || Limits {
            fuel: Some(50_000),
            ..Limits::default()
        };

        view.id = 0;
        let spent = session.decide(&view, &world, limits());
        assert_eq!(spent.answer, Err(Failure::Stopped(Stopped::Fuel)));

        view.id = 1;
        let served = session.decide(&view, &world, limits());
        let decision = served
            .decision()
            .expect("the next creature of the same species still decides");
        assert_eq!(decision.line(), "rest because=waiting");
        assert!(
            served.instructions < 1_000,
            "the second creature paid for its own tick and not the first's: {}",
            served.instructions
        );
    });
}

// A run the fuel limit stopped reports what it was charged. It reads through
// the registry's installed budget and not through a `Meter` taken off the
// `Budget` beforehand: `HostRegistry::begin_run` calls `Budget::restart`,
// which builds the meter afresh, so a meter taken before the call reads zero
// for ever -- including for the invocation that budget went on to stop. That
// is what this crate did at first, and this assertion is what would have
// caught it.
#[test]
fn a_stopped_creature_reports_the_fuel_it_was_charged() {
    let species = broken("looping");
    let lowering = species.lower().expect("looping lowers");
    species.serve(&lowering, |session| {
        let (view, world) = scenario::empty();
        let outcome = session.decide(
            &view,
            &world,
            Limits {
                fuel: Some(50_000),
                ..Limits::default()
            },
        );
        assert_eq!(outcome.answer, Err(Failure::Stopped(Stopped::Fuel)));
        assert!(
            outcome.fuel >= 50_000,
            "a run stopped for fuel spent at least its limit, and reported {}",
            outcome.fuel
        );
    });
}
