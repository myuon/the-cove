//! Determinism only means something if two different seeds can tell two
//! different worlds apart. Without this test,
//! `determinism.rs` would pass just as well for a world that always
//! answered the same hash regardless of what it was seeded with.

use std::path::{Path, PathBuf};

use simulation::{decision_limits, hash, new_world, tick, Roster};

fn workspace_root() -> PathBuf {
    Path::new(env!("CARGO_MANIFEST_DIR")).join("..").join("..")
}

fn catalog_dir() -> PathBuf {
    workspace_root().join(simulation::CATALOG)
}

const WIDTH: i64 = 24;
const HEIGHT: i64 = 16;
const TICKS: i64 = 100;

// Two different seeds, run to the same tick: if their hashes still agreed,
// either the seed is not reaching the world (a bug) or the hash is not
// sensitive to the world (a different bug) -- either way `determinism.rs`
// would be proving nothing.
#[test]
fn different_seeds_produce_different_state_hashes() {
    let catalog = catalog_dir();
    let roster = Roster::load_default(&catalog).expect("catalog loads");
    let limits = decision_limits();

    let mut world_a = new_world(1, WIDTH, HEIGHT, &roster);
    let mut world_b = new_world(2, WIDTH, HEIGHT, &roster);

    simulation::catalog::serve_all(&catalog, &roster, |sessions| {
        for _ in 0..TICKS {
            world_a = tick(&world_a, &roster, sessions, &limits);
        }
    })
    .expect("serve_all for seed 1");
    simulation::catalog::serve_all(&catalog, &roster, |sessions| {
        for _ in 0..TICKS {
            world_b = tick(&world_b, &roster, sessions, &limits);
        }
    })
    .expect("serve_all for seed 2");

    assert_ne!(
        hash(&world_a),
        hash(&world_b),
        "two different seeds produced the same hash after {TICKS} ticks"
    );
}
