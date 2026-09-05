//! A creature is a pure function of its two arguments, and a session is the
//! one backend every tick of a run is served by. Both of those are claims
//! this file checks rather than takes on faith.

use std::path::{Path, PathBuf};

use creature_host::{scenario, Species};

fn workspace_root() -> PathBuf {
    Path::new(env!("CARGO_MANIFEST_DIR")).join("..").join("..")
}

fn catalog_dir() -> PathBuf {
    workspace_root().join(creature_host::CATALOG)
}

fn shy_scavenger() -> Species {
    Species::load(&catalog_dir(), "shyScavenger").expect("shyScavenger loads")
}

// `crowded` is the heaviest of the named scenarios and so fills the heap in
// the fewest invocations: measured directly, `Session::heap_words()` climbs
// on every call up to the 34,000th or so and is flat at 4,194,286 from there
// on for at least the next 16,000. Fifty thousand invocations puts both the
// three-quarter mark (37,500) and the end comfortably past that climb, so a
// heap that were actually growing without bound — a leak — would show up as
// a difference here, and a heap that simply had not collected yet would not
// be mistaken for one.
//
// If this ever starts failing because the sample points disagree, the first
// thing to check is whether a change moved where the climb ends, not whether
// the collector broke.
#[test]
fn ten_thousand_ticks_of_one_creature_cost_and_answer_the_same_every_time() {
    let species = shy_scavenger();
    let lowering = species.lower().expect("lowers");
    species.serve(&lowering, |session| {
        let (view, world) = scenario::crowded();
        const TOTAL: u64 = 50_000;
        const THREE_QUARTERS: u64 = 37_500;

        let first = session.decide_unbounded(&view, &world);
        let mut sampled_heap = None;
        for i in 2..=TOTAL {
            let outcome = session.decide_unbounded(&view, &world);
            assert_eq!(outcome.answer, first.answer, "answer drifted at call {i}");
            assert_eq!(
                outcome.instructions, first.instructions,
                "instruction count drifted at call {i}"
            );
            if i == THREE_QUARTERS {
                sampled_heap = Some(session.heap_words());
            }
        }
        let three_quarters_heap = sampled_heap.expect("sampled at the three-quarter mark");
        let final_heap = session.heap_words();
        assert_eq!(
            three_quarters_heap, final_heap,
            "heap grew between the three-quarter mark and the end: {three_quarters_heap} -> {final_heap}"
        );
    });
}

// Two sessions built from the same lowering are what a replay is: asked the
// same thing, they must cost and answer the same, or a recorded run could
// not be trusted to mean anything played back a second time.
#[test]
fn two_sessions_over_the_same_lowering_answer_and_cost_alike() {
    let species = shy_scavenger();
    let lowering = species.lower().expect("lowers");
    let (view, world) = scenario::cornered();

    let first = species.serve(&lowering, |session| session.decide_unbounded(&view, &world));
    let second = species.serve(&lowering, |session| session.decide_unbounded(&view, &world));

    assert_eq!(first.answer, second.answer);
    assert_eq!(first.instructions, second.instructions);
}
