//! `fixtures/report.txt` is committed, and this is what keeps it honest: the
//! same report, rendered again in-process, has to be byte-for-byte what is
//! on disk. A mismatch means the fixture is stale, not that the test is
//! wrong — the failure message says what to run.

use std::path::{Path, PathBuf};

use creature_host::{report, scenario, Species};

fn workspace_root() -> PathBuf {
    Path::new(env!("CARGO_MANIFEST_DIR")).join("..").join("..")
}

// If this fails, `cargo run -p creature-host --bin capture` regenerates
// `fixtures/report.txt` from the species and scenarios as they are now; run
// it and commit the result.
#[test]
fn the_committed_report_matches_what_the_species_answers_today() {
    let workspace = workspace_root();
    let catalog = workspace.join(creature_host::CATALOG);
    let species = Species::load(&catalog, "shyScavenger").expect("shyScavenger loads");
    let lowering = species.lower().expect("lowers");

    let cases: Vec<(&str, creature_host::SelfView, creature_host::Observation)> = [
        ("empty", scenario::empty()),
        ("grazing", scenario::grazing()),
        ("cornered", scenario::cornered()),
        ("crowded", scenario::crowded()),
        ("adversarial", scenario::adversarial()),
    ]
    .into_iter()
    .map(|(name, (view, world))| (name, view, world))
    .collect();

    let rendered = report::report(&species, &lowering, &cases);
    let committed_path = workspace.join("fixtures").join("report.txt");
    let committed = std::fs::read_to_string(&committed_path)
        .unwrap_or_else(|e| panic!("cannot read {}: {e}", committed_path.display()));

    assert_eq!(
        rendered, committed,
        "fixtures/report.txt is stale — run `cargo run -p creature-host --bin capture` and commit the result"
    );
}
