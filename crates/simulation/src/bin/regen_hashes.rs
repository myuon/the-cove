//! Regenerates `crates/simulation/fixtures/hashes.txt`.
//!
//! Run with `cargo run --profile checked -p simulation --bin regen_hashes`
//! from anywhere in the workspace. `tests/golden.rs` computes the same
//! twenty hashes in-process and compares them against what this binary last
//! wrote; when they disagree, that test's failure message says to run this.

use std::path::{Path, PathBuf};

use simulation::{decision_limits, hash, new_world, tick, Roster};

/// A binary's `CARGO_MANIFEST_DIR` is its own crate's directory
/// (`crates/simulation`); the workspace root is one level above that again.
fn workspace_root() -> PathBuf {
    Path::new(env!("CARGO_MANIFEST_DIR")).join("..").join("..")
}

/// The fixed seed and grid `tests/golden.rs` pins its expectation to.
pub const SEED: i64 = 2024;
pub const WIDTH: i64 = 12;
pub const HEIGHT: i64 = 8;
pub const TICKS: i64 = 20;

fn main() {
    let workspace = workspace_root();
    let catalog = workspace.join(simulation::CATALOG);
    let roster = Roster::load_default(&catalog).expect("catalog loads");
    let limits = decision_limits();

    let mut world = new_world(SEED, WIDTH, HEIGHT, &roster);
    let mut lines = Vec::with_capacity(TICKS as usize);
    simulation::catalog::serve_all(&catalog, &roster, |sessions| {
        for _ in 0..TICKS {
            world = tick(&world, &roster, sessions, &limits);
            lines.push(hash(&world).to_string());
        }
    })
    .expect("serve_all");

    let text = lines.join("\n") + "\n";
    let out = workspace.join("crates/simulation/fixtures/hashes.txt");
    std::fs::write(&out, text).unwrap_or_else(|e| panic!("cannot write {}: {e}", out.display()));
    eprintln!("wrote {}", out.display());
}
