//! Regenerates the two golden hash fixtures.
//!
//! Run with `cargo run --profile checked -p simulation --bin regen_hashes`
//! from anywhere in the workspace. `tests/golden.rs` computes the same
//! twenty hashes in-process and compares them against what this binary last
//! wrote; when they disagree, that test's failure message says to run this.
//!
//! The second fixture, `fixtures/browser-hashes.txt`, is the same idea across
//! a boundary rather than across a change: `apps/web/check.mjs` runs the
//! WebAssembly build over the same seed and reef and compares its hashes
//! against what this wrote natively. That is the claim a shared replay link
//! stands on — a seed means the same world in a browser as it does here — and
//! it is not a claim either side can make alone.

use std::path::{Path, PathBuf};

use simulation::{decision_limits, hash, new_world, tick, Roster};

/// A binary's `CARGO_MANIFEST_DIR` is its own crate's directory
/// (`crates/simulation`); the workspace root is one level above that again.
fn workspace_root() -> PathBuf {
    Path::new(env!("CARGO_MANIFEST_DIR")).join("..").join("..")
}

/// The fixed seed and reef `tests/golden.rs` pins its expectation to.
pub const SEED: i64 = 2024;
pub const WIDTH: f64 = simulation::world::REEF_WIDTH;
pub const HEIGHT: f64 = simulation::world::REEF_HEIGHT;
pub const TICKS: i64 = 20;

/// The world the browser check runs, which is the world the page presents.
pub const BROWSER_SEED: i64 = 7;
pub const BROWSER_WIDTH: f64 = simulation::world::REEF_WIDTH;
pub const BROWSER_HEIGHT: f64 = simulation::world::REEF_HEIGHT;
pub const BROWSER_TICKS: i64 = 60;

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

    let mut world = new_world(BROWSER_SEED, BROWSER_WIDTH, BROWSER_HEIGHT, &roster);
    let mut lines = Vec::with_capacity(BROWSER_TICKS as usize);
    simulation::catalog::serve_all(&catalog, &roster, |sessions| {
        for _ in 0..BROWSER_TICKS {
            world = tick(&world, &roster, sessions, &limits);
            lines.push(hash(&world).to_string());
        }
    })
    .expect("serve_all");
    let text = format!(
        "# seed {BROWSER_SEED}, {BROWSER_WIDTH}x{BROWSER_HEIGHT}, {BROWSER_TICKS} ticks, \
computed natively; `node apps/web/check.mjs` recomputes these in WebAssembly\n{}\n",
        lines.join("\n")
    );
    let out = workspace.join("fixtures/browser-hashes.txt");
    std::fs::write(&out, text).unwrap_or_else(|e| panic!("cannot write {}: {e}", out.display()));
    eprintln!("wrote {}", out.display());
}
