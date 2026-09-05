//! `fixtures/hashes.txt` is committed, and this is what keeps it honest: the
//! same twenty hashes, computed again in-process from the same seed, have to
//! match what is on disk line for line. A mismatch means the fixture is
//! stale, not that the test is wrong — the failure message says what to run.

use std::path::{Path, PathBuf};

use simulation::{decision_limits, hash, new_world, tick, Roster};

fn workspace_root() -> PathBuf {
    Path::new(env!("CARGO_MANIFEST_DIR")).join("..").join("..")
}

fn catalog_dir() -> PathBuf {
    workspace_root().join(simulation::CATALOG)
}

// The values here are exactly what `cargo run --profile checked -p
// simulation --bin regen_hashes` last wrote to
// `crates/simulation/fixtures/hashes.txt`. If this fails, that is the
// command to regenerate it and commit the result — after checking the diff
// is one you meant to make.
#[test]
fn the_first_twenty_hashes_of_a_fixed_seed_match_the_committed_fixture() {
    let catalog = catalog_dir();
    let roster = Roster::load_default(&catalog).expect("catalog loads");
    let limits = decision_limits();

    let mut world = new_world(
        simulation_bin_constants::SEED,
        simulation_bin_constants::WIDTH,
        simulation_bin_constants::HEIGHT,
        &roster,
    );
    let mut computed = Vec::with_capacity(simulation_bin_constants::TICKS as usize);
    simulation::catalog::serve_all(&catalog, &roster, |sessions| {
        for _ in 0..simulation_bin_constants::TICKS {
            world = tick(&world, &roster, sessions, &limits);
            computed.push(hash(&world).to_string());
        }
    })
    .expect("serve_all");

    let fixture_path = workspace_root().join("crates/simulation/fixtures/hashes.txt");
    let committed = std::fs::read_to_string(&fixture_path)
        .unwrap_or_else(|e| panic!("cannot read {}: {e}", fixture_path.display()));
    let expected: Vec<&str> = committed.lines().collect();

    assert_eq!(
        computed,
        expected,
        "the computed hashes disagree with {}; if this is expected, run \
         `cargo run --profile checked -p simulation --bin regen_hashes` and \
         commit the result",
        fixture_path.display()
    );
}

/// The same constants `src/bin/regen_hashes.rs` wrote the fixture from.
/// Duplicated rather than imported — a `src/bin` is its own crate and a
/// test cannot name it — and kept in one small module so a change to one
/// has an obvious twin to update.
mod simulation_bin_constants {
    pub const SEED: i64 = 2024;
    pub const WIDTH: f64 = simulation::world::REEF_WIDTH;
    pub const HEIGHT: f64 = simulation::world::REEF_HEIGHT;
    pub const TICKS: i64 = 20;
}
