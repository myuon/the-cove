//! A world is a pure function of its seed and the decisions its creatures
//! make, and a creature is a pure function of what it is shown. Nothing here
//! reads a clock or any other ambient state, so two runs of the same seed
//! must produce the same sequence of state hashes — if they did not, this
//! crate would not be simulating anything, it would be recording one.

use std::path::{Path, PathBuf};

use simulation::{decision_limits, hash, new_world, tick, Roster};

fn workspace_root() -> PathBuf {
    Path::new(env!("CARGO_MANIFEST_DIR")).join("..").join("..")
}

fn catalog_dir() -> PathBuf {
    workspace_root().join(simulation::CATALOG)
}

const WIDTH: f64 = simulation::world::REEF_WIDTH;
const HEIGHT: f64 = simulation::world::REEF_HEIGHT;
const TICKS: i64 = 300;

fn run_hashes(seed: i64, roster: &Roster, catalog: &Path) -> Vec<i64> {
    let limits = decision_limits();
    let mut world = new_world(seed, WIDTH, HEIGHT, roster);
    let mut hashes = Vec::with_capacity(TICKS as usize);
    simulation::catalog::serve_all(catalog, roster, |sessions| {
        for _ in 0..TICKS {
            world = tick(&world, roster, sessions, &limits);
            hashes.push(hash(&world));
        }
    })
    .expect("serve_all");
    hashes
}

// Two independently constructed worlds from the same seed, run in the same
// process: if this test were absent, a bug that leaked state between runs
// (a generator not reset, a session holding on to something from an earlier
// world) could hide behind "well, it only happens on the second run of the
// process" and never get caught.
#[test]
fn the_same_seed_run_twice_produces_the_same_sequence_of_state_hashes_over_300_ticks() {
    let catalog = catalog_dir();
    let roster = Roster::load_default(&catalog).expect("catalog loads");

    let first = run_hashes(1234, &roster, &catalog);
    let second = run_hashes(1234, &roster, &catalog);

    assert_eq!(
        first, second,
        "the same seed produced two different histories, so the world is not deterministic"
    );
}
