//! The renderer-independent, deterministic, fixed-step world that drives
//! creature programs written in Cove.
//!
//! This is a port of `examples/life/world/world.cove` in `myuon/cove` (the
//! reference implementation, already tuned so the ecosystem does not
//! collapse) onto this repository's `creature-host` contract and catalog.
//! See [`world`] for the model and what genuinely had to change in the
//! port, [`catalog`] for reading `species.toml` and serving four species at
//! once, and [`generator`] for the one source of chance the whole world
//! draws from.
//!
//! # Bounding a decision
//!
//! Every invocation of `creature.decide` gets [`Limits`] with
//! [`DECISION_FUEL_LIMIT`] as its fuel and nothing else set. Never a
//! `deadline`: it reads a wall clock, and no replay could reproduce one. A
//! creature whose invocation fails — out of fuel, or a fault — answers
//! `Intent::Rest` for that tick, and its failure is counted rather than
//! stopping the world: one broken creature costs one tick, and the world
//! goes on serving the next one.

pub mod catalog;
pub mod generator;
pub mod metrics;
pub mod world;
mod world_ext;

pub use catalog::{Roster, SpeciesDef, SPECIES_IDS};
pub use cove_runtime::Limits;
pub use creature_host::{
    ActionResult, Cell, Decision, Failure, Habitat, Heading, Intent, Lowering, Observation, Patch,
    Reason, Role, SelfView, Session, Sighting, Species, Stopped,
};
pub use generator::{roll, Roll};
pub use metrics::{advance_metered, TickMetrics};
pub use world::{
    advance, bounty, cell_index, census, creature_named, decisions, food_at, hash, index_by_id,
    inside, is_shelter, new_world, resolve, sight_range, smells, sprouts, steps_between, tick, Ask,
    Census, Creature, CreatureOutcome, DecisionCost, Turn, World, CARCASS, HEADINGS, MAX_ENERGY,
    MAX_FOOD, SIGHT_LIMIT, STRIKE, UPKEEP,
};
pub use world_ext::{observe, view_of};

/// Where the catalog is, relative to the workspace root — the same value
/// `creature_host::CATALOG` names, re-exported so a caller needs to import
/// only this crate to find it.
pub const CATALOG: &str = creature_host::CATALOG;

/// The fuel every `creature.decide` invocation this crate makes is bounded
/// by.
///
/// `fixtures/report.txt` in `creature-host` measures a decision at 56 to 310
/// instructions across five scenarios; this is comfortably above that and
/// still cheap for a creature that spins — it stops within a fraction of a
/// second rather than running until a human notices. Chosen rather than
/// derived, the same way the reference's own tuned constants are: there is
/// no rule these numbers follow, only a measurement they have to clear.
pub const DECISION_FUEL_LIMIT: u64 = 20_000;

/// [`Limits`] with [`DECISION_FUEL_LIMIT`] as fuel and nothing else set —
/// never a `deadline`, which reads a wall clock no replay could reproduce.
pub fn decision_limits() -> Limits {
    Limits {
        fuel: Some(DECISION_FUEL_LIMIT),
        ..Limits::default()
    }
}
