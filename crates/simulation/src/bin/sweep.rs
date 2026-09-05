//! What a world does over six hundred ticks, at several sizes and seeds.
//!
//! A tuning instrument, not a test. `tests/ecology.rs` asserts what this
//! measures; this is how the numbers it asserts were arrived at, and it is
//! committed so that the next person to change a trait can rerun it rather
//! than guess. Every figure in the catalog was chosen by running this.
//!
//! What it is looking for is not survival — a cast is refilled, so nothing
//! can go extinct — but whether anything *happens*. A reef where nobody is
//! ever hunted and nobody ever hides is a reef with three species that all
//! look like the same species.
//!
//! ```console
//! $ cargo run --profile checked -p simulation --bin sweep
//! ```

use std::collections::BTreeMap;
use std::path::{Path, PathBuf};

use simulation::catalog::{serve_all, Roster};
use simulation::world::{decisions, new_world, resolve};

fn catalog_dir() -> PathBuf {
    Path::new(env!("CARGO_MANIFEST_DIR"))
        .join("..")
        .join("..")
        .join("catalog")
}

const SIZES: &[(i64, i64)] = &[(14, 10), (16, 12), (20, 14), (24, 16)];
const SEEDS: &[i64] = &[1, 7, 42, 101, 2024, 31337];
const TICKS: i64 = 600;

fn main() {
    let catalog = catalog_dir();
    let roster = Roster::load_default(&catalog).expect("the catalog loads");
    let limits = simulation::decision_limits();

    serve_all(&catalog, &roster, |sessions| {
        for (width, height) in SIZES {
            println!("\n=== {width}x{height} ({} cells) ===", width * height);
            println!(
                "{:>7}{:>6}{:>18}{:>8}{:>8}{:>8}{:>10}",
                "seed", "cast", "composition", "deaths", "hunts", "hides", "refusals"
            );
            let mut reasons: BTreeMap<String, i64> = BTreeMap::new();
            for seed in SEEDS {
                let mut world = new_world(*seed, *width, *height, &roster);
                let composition: Vec<String> = (0..roster.len())
                    .map(|at| world.cast.iter().filter(|s| **s == at).count().to_string())
                    .collect();
                let cast = world.cast.len();
                let (mut hunts, mut hides) = (0i64, 0i64);
                for _ in 0..TICKS {
                    let (asks, _) = decisions(&world, &roster, sessions, &limits);
                    for ask in &asks {
                        *reasons
                            .entry(ask.decision.reason.name().to_string())
                            .or_default() += 1;
                    }
                    let turn = resolve(&world, &asks, &roster);
                    for outcome in &turn.outcomes {
                        match outcome.result.name().as_str() {
                            name if name.starts_with("hunted-") => hunts += 1,
                            "hid" => hides += 1,
                            _ => {}
                        }
                    }
                    world = turn.world;
                }
                println!(
                    "{:>7}{:>6}{:>18}{:>8}{:>8}{:>8}{:>10}",
                    seed,
                    cast,
                    composition.join("/"),
                    world.deaths,
                    hunts,
                    hides,
                    world.refusals,
                );
            }
            let total: i64 = reasons.values().sum();
            let mix: Vec<String> = reasons
                .iter()
                .map(|(name, count)| format!("{name} {}%", count * 100 / total.max(1)))
                .collect();
            println!("  why: {}", mix.join(", "));
        }
        println!(
            "\ncatalog order: {}",
            roster
                .defs
                .iter()
                .map(|d| d.id.as_str())
                .collect::<Vec<_>>()
                .join("/")
        );
    })
    .expect("the roster serves");
}
