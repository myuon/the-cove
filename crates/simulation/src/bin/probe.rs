//! One world, tick by tick, for finding out why a species is not in it.
//!
//! A tuning instrument like `sweep`, and the finer one: `sweep` says which
//! species died and this says when, and what the survivors were doing while
//! it happened. Every column here has been the answer to a different wrong
//! guess at least once.
//!
//! ```console
//! $ cargo run --profile checked -p simulation --bin probe
//! ```

use std::collections::BTreeMap;
use std::path::{Path, PathBuf};

use creature_host::Cell;
use simulation::catalog::{serve_all, Roster};
use simulation::world::{census, decisions, new_world, resolve};

fn catalog_dir() -> PathBuf {
    Path::new(env!("CARGO_MANIFEST_DIR"))
        .join("..")
        .join("..")
        .join("catalog")
}

const SEED: i64 = 7;
const WIDTH: i64 = 24;
const HEIGHT: i64 = 16;
const TICKS: i64 = 200;
/// The species this run is about. Its every decision is counted.
const WATCHED: &str = "hermitCrab";

fn main() {
    let catalog = catalog_dir();
    let roster = Roster::load_default(&catalog).expect("the catalog loads");
    let watched = roster
        .defs
        .iter()
        .position(|d| d.id == WATCHED)
        .expect("the watched species is in the roster");
    let limits = simulation::decision_limits();

    serve_all(&catalog, &roster, |sessions| {
        let mut world = new_world(SEED, WIDTH, HEIGHT, &roster);
        let mut reasons: BTreeMap<String, i64> = BTreeMap::new();
        let mut results: BTreeMap<String, i64> = BTreeMap::new();
        println!(
            "{:>5}{:>8}{:>8}{:>10}{:>10}",
            "tick", "alive", WATCHED, "energy", "food"
        );
        for step in 0..TICKS {
            let watching: Vec<Cell> = world
                .creatures
                .iter()
                .filter(|c| c.species == watched)
                .map(|c| c.at)
                .collect();
            let (asks, _) = decisions(&world, &roster, sessions, &limits);
            for ask in &asks {
                let creature = world.creatures.iter().find(|c| c.id == ask.id);
                if creature.is_some_and(|c| c.species == watched) {
                    *reasons
                        .entry(ask.decision.reason.name().to_string())
                        .or_default() += 1;
                }
            }
            let turn = resolve(&world, &asks, &roster);
            for outcome in &turn.outcomes {
                if outcome.species == watched {
                    *results.entry(outcome.result.name()).or_default() += 1;
                }
            }
            world = turn.world;
            if step % 20 == 0 {
                let seen = census(&world, roster.len());
                let energy: i64 = world
                    .creatures
                    .iter()
                    .filter(|c| c.species == watched)
                    .map(|c| c.energy)
                    .sum();
                let count = seen.per_species[watched];
                println!(
                    "{:>5}{:>8}{:>8}{:>10}{:>10}",
                    world.tick,
                    seen.alive,
                    count,
                    if count > 0 { energy / count } else { 0 },
                    seen.food,
                );
                let _ = watching;
            }
        }
        println!("\nwhat it asked for");
        for (reason, count) in &reasons {
            println!("  {reason:>16} {count:>7}");
        }
        println!("\nwhat the world did");
        for (result, count) in &results {
            println!("  {result:>16} {count:>7}");
        }
    })
    .expect("the roster serves");
}
