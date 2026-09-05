//! Regenerates `fixtures/report.txt`.
//!
//! Run with `cargo run -p creature-host --bin capture` from anywhere in the
//! workspace. `tests/report.rs` renders the same report in-process and
//! compares it against what this binary last wrote; when they disagree, that
//! test's failure message says to run this.

use std::path::{Path, PathBuf};

use creature_host::{report, scenario, Species};

/// A binary's `CARGO_MANIFEST_DIR` is its own crate's directory
/// (`crates/creature-host`), same as a test's — the workspace root is one
/// level above that again.
fn workspace_root() -> PathBuf {
    Path::new(env!("CARGO_MANIFEST_DIR")).join("..").join("..")
}

fn main() {
    let workspace = workspace_root();
    let catalog = workspace.join(creature_host::CATALOG);
    let species = Species::load(&catalog, "shyScavenger").expect("shyScavenger loads");
    let lowering = species.lower().expect("creature.decide lowers");

    let cases = [
        ("empty", scenario::empty()),
        ("grazing", scenario::grazing()),
        ("cornered", scenario::cornered()),
        ("crowded", scenario::crowded()),
        ("adversarial", scenario::adversarial()),
    ];
    let cases: Vec<(&str, creature_host::SelfView, creature_host::Observation)> = cases
        .into_iter()
        .map(|(name, (view, world))| (name, view, world))
        .collect();

    let text = report::report(&species, &lowering, &cases);
    let out = workspace.join("fixtures").join("report.txt");
    std::fs::write(&out, text).unwrap_or_else(|e| panic!("cannot write {}: {e}", out.display()));
    eprintln!("wrote {}", out.display());
}
