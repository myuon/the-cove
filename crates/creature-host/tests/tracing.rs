//! What one invocation writes to its tape, and what it does not.
//!
//! `species.rs`'s `Tape` is bounded per invocation and reset at the start of
//! every `decide` call, so what is checked here is both what a normal tick
//! writes down and that a second tick does not inherit the first's.

use std::path::{Path, PathBuf};

use creature_host::{scenario, Species};

fn workspace_root() -> PathBuf {
    Path::new(env!("CARGO_MANIFEST_DIR")).join("..").join("..")
}

fn catalog_dir() -> PathBuf {
    workspace_root().join(creature_host::CATALOG)
}

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

// Four events and no more, in a fixed order: the entry, the exit, whatever
// the collector reported, and the end of the run. Each one is tagged with
// the creature and tick that were asked, not some other pair — `Tape::begin`
// stamps every event with what it was called with, so a mismatch here would
// mean the tape is stamping the wrong invocation's events.
#[test]
fn one_ordinary_decision_writes_exactly_four_tape_lines_in_order() {
    let species = Species::load(&catalog_dir(), "shyScavenger").expect("shyScavenger loads");
    let lowering = species.lower().expect("lowers");
    let (view, world) = scenario::grazing();
    let outcome = species.serve(&lowering, |session| session.decide_unbounded(&view, &world));

    let lines: Vec<&str> = outcome.events.iter().map(|e| e.line.as_str()).collect();
    assert_eq!(
        lines,
        vec![
            "enter creature.decide",
            "exit creature.decide",
            "HeapSummary",
            "ended Success",
        ]
    );
    for recorded in &outcome.events {
        assert_eq!(recorded.creature, view.id);
        assert_eq!(recorded.tick, world.tick);
    }
}

// `Session::decide` calls `tape.begin` on entry and `tape.take` on exit, so
// the tape is reset per invocation and not merely per session. If either
// call were dropped, a second invocation's events would carry the first's
// alongside its own — four lines would become eight — or would still name
// the first invocation's creature and tick.
#[test]
fn a_second_decision_does_not_carry_the_firsts_events() {
    let species = Species::load(&catalog_dir(), "shyScavenger").expect("shyScavenger loads");
    let lowering = species.lower().expect("lowers");
    species.serve(&lowering, |session| {
        let (grazing_view, grazing_world) = scenario::grazing();
        let first = session.decide_unbounded(&grazing_view, &grazing_world);
        assert_eq!(first.events.len(), 4);

        let (cornered_view, cornered_world) = scenario::cornered();
        let second = session.decide_unbounded(&cornered_view, &cornered_world);
        assert_eq!(
            second.events.len(),
            4,
            "the second tick's tape grew instead of resetting"
        );
        for recorded in &second.events {
            assert_eq!(recorded.creature, cornered_view.id);
            assert_eq!(recorded.tick, cornered_world.tick);
            assert_ne!(
                recorded.creature, grazing_view.id,
                "the second tick's tape still names the first creature"
            );
            assert_ne!(
                recorded.tick, grazing_world.tick,
                "the second tick's tape still names the first tick"
            );
        }
    });
}

// `Tape::DEFAULT_CAP` is 64 and one tick produces four events; an ordinary
// decision is nowhere near the cap, so nothing should ever be counted as
// dropped.
#[test]
fn nothing_is_dropped_from_an_ordinary_decision() {
    let species = Species::load(&catalog_dir(), "shyScavenger").expect("shyScavenger loads");
    let lowering = species.lower().expect("lowers");
    let (view, world) = scenario::crowded();
    let outcome = species.serve(&lowering, |session| session.decide_unbounded(&view, &world));
    assert_eq!(outcome.dropped, 0);
}

// A failing invocation still writes both an entry and an exit — the runtime
// writes both on every path, not only a successful one — and its last line
// names the failure rather than `Success`.
#[test]
fn a_faulting_invocation_still_writes_an_enter_and_an_exit() {
    let species = broken("faulting");
    let lowering = species.lower().expect("faulting lowers");
    let (view, world) = scenario::empty();
    let outcome = species.serve(&lowering, |session| session.decide_unbounded(&view, &world));

    let lines: Vec<&str> = outcome.events.iter().map(|e| e.line.as_str()).collect();
    assert!(lines.contains(&"enter creature.decide"));
    assert!(lines.contains(&"exit creature.decide"));
    let last = lines
        .last()
        .expect("a faulting decision still writes a tape");
    assert!(last.starts_with("ended"));
    assert_ne!(*last, "ended Success");
}
