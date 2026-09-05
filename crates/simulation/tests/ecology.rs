//! What a world is still doing after six hundred ticks.
//!
//! A cast is refilled, so nothing here can go extinct and the interesting
//! question is not survival. It is whether anything happens: a reef where
//! nobody is hunted and nobody hides is a reef whose four species all look
//! like one species, and the exit criterion of this slice is a visitor who
//! can tell three behaviours apart.
//!
//! This is what `cargo run -p simulation --bin sweep` measures across four
//! grid sizes and six seeds. The assertions below are the floor of what it
//! measured, not the numbers it measured: a change that makes the reef busier
//! should not fail a test, and a change that empties it should.

use std::path::{Path, PathBuf};

use simulation::catalog::serve_all;
use simulation::world::{decisions, new_world, resolve, CAST_MAX, CAST_MIN};
use simulation::{census, decision_limits, Roster};

fn catalog_dir() -> PathBuf {
    Path::new(env!("CARGO_MANIFEST_DIR"))
        .join("..")
        .join("..")
        .join(simulation::CATALOG)
}

/// The reef a world is presented on. Sixteen by twelve was chosen by running
/// `sweep`: it is the smallest that is not cramped and the largest at which a
/// grazer still meets a hunter often enough for a visitor to see one flee.
const WIDTH: i64 = 16;
const HEIGHT: i64 = 12;
const TICKS: i64 = 600;
const SEEDS: [i64; 6] = [1, 7, 42, 101, 2024, 31337];

// The brief asks for eight to fourteen creatures and at least three
// ecological roles, and those are the same requirement: a visitor is meant to
// tell creatures apart and follow one. Without this the cast could drift to
// whatever the arithmetic in `cast_for` happened to produce.
#[test]
fn every_world_is_cast_with_between_eight_and_fourteen_creatures() {
    let catalog = catalog_dir();
    let roster = Roster::load_default(&catalog).expect("catalog loads");
    for seed in SEEDS {
        let world = new_world(seed, WIDTH, HEIGHT, &roster);
        let cast = world.cast.len() as i64;
        assert!(
            (CAST_MIN..=CAST_MAX).contains(&cast),
            "seed {seed} cast {cast} creatures"
        );
        assert_eq!(world.creatures.len() as i64, cast);
        let mut roles: Vec<_> = world
            .cast
            .iter()
            .map(|at| roster.defs[*at].role)
            .collect::<Vec<_>>();
        roles.sort();
        roles.dedup();
        assert!(
            roles.len() >= 3,
            "seed {seed} shows only {} roles: {roles:?}",
            roles.len()
        );
    }
}

// A slot is empty for `RESPAWN_DELAY` ticks and then it is not. Without this
// a respawn that silently stopped happening would read as a world that had
// simply got quieter, and the tank would empty over a long enough visit.
#[test]
fn a_cast_that_loses_creatures_gets_them_back() {
    let catalog = catalog_dir();
    let roster = Roster::load_default(&catalog).expect("catalog loads");
    let limits = decision_limits();
    serve_all(&catalog, &roster, |sessions| {
        for seed in SEEDS {
            let mut world = new_world(seed, WIDTH, HEIGHT, &roster);
            let cast = world.cast.len();
            let mut lowest = cast;
            for _ in 0..TICKS {
                world = simulation::tick(&world, &roster, sessions, &limits);
                lowest = lowest.min(world.creatures.len());
                assert!(
                    world.creatures.len() <= cast,
                    "seed {seed} tick {}: {} creatures in a cast of {cast}",
                    world.tick,
                    world.creatures.len()
                );
            }
            assert_eq!(
                world.creatures.len() + world.pending.len(),
                cast,
                "seed {seed}: the cast lost a slot rather than emptying one"
            );
            assert!(
                world.deaths > 0,
                "seed {seed}: nothing died in six hundred ticks, so nothing was \
                 refilled and this test proved nothing"
            );
            assert!(
                lowest < cast,
                "seed {seed}: the cast was never short, so no respawn was observed"
            );
        }
    })
    .expect("the roster serves");
}

// The reef has to be worth watching. Every one of these happened in every
// seed the sweep measured; the floors are deliberately far below what it
// found, so this fails when something stops happening at all rather than
// when it happens less.
#[test]
fn every_kind_of_thing_still_happens_over_six_hundred_ticks() {
    let catalog = catalog_dir();
    let roster = Roster::load_default(&catalog).expect("catalog loads");
    let limits = decision_limits();
    serve_all(&catalog, &roster, |sessions| {
        let mut hunts = 0i64;
        let mut hides = 0i64;
        let mut ate = 0i64;
        let mut fled = 0i64;
        let mut refused = 0i64;
        for seed in SEEDS {
            let mut world = new_world(seed, WIDTH, HEIGHT, &roster);
            for _ in 0..TICKS {
                let (asks, _) = decisions(&world, &roster, sessions, &limits);
                for ask in &asks {
                    if ask.decision.reason.name() == "fleeing_threat" {
                        fled += 1;
                    }
                }
                let turn = resolve(&world, &asks, &roster);
                for outcome in &turn.outcomes {
                    let name = outcome.result.name();
                    if name.starts_with("hunted-") {
                        hunts += 1;
                    } else if name == "hid" {
                        hides += 1;
                    } else if name.starts_with("ate-") {
                        ate += 1;
                    } else if name == "refused" {
                        refused += 1;
                    }
                }
                world = turn.world;
            }
        }
        assert!(hunts > 50, "only {hunts} hunts landed across every seed");
        assert!(hides > 200, "only {hides} creatures hid across every seed");
        assert!(ate > 2_000, "only {ate} meals across every seed");
        assert!(fled > 100, "only {fled} creatures fled across every seed");
        // A refusal is a species being wrong about the world, and a handful is
        // healthy. Thousands would mean a species is wrong every tick, which
        // is a behaviour bug wearing a working world's clothes.
        assert!(
            refused < 200,
            "{refused} refusals: some species is wrong about the world every tick"
        );
    })
    .expect("the roster serves");
}

// Nothing may hold more slots than a reef this size would give it, which is
// the one thing `capacity` still decides now that turnover is a refill rather
// than a birth.
#[test]
fn no_species_takes_more_of_the_cast_than_the_reef_holds() {
    let catalog = catalog_dir();
    let roster = Roster::load_default(&catalog).expect("catalog loads");
    for seed in SEEDS {
        let world = new_world(seed, WIDTH, HEIGHT, &roster);
        let count = census(&world, roster.len());
        for (species, alive) in count.per_species.iter().enumerate() {
            let ceiling = roster.capacity(species, WIDTH * HEIGHT).max(1);
            assert!(
                *alive <= ceiling,
                "seed {seed}: {} takes {alive} slots of a possible {ceiling}",
                roster.defs[species].id
            );
        }
    }
}
