//! The executable contract between The Cove and a creature written in Cove.
//!
//! One function crosses it:
//!
//! ```cove
//! export fn decide(view: SelfView, observation: Observation) -> Decision
//! ```
//!
//! The world hands a creature a bounded, immutable view of itself and of what
//! it can see, and the creature answers exactly one intent and the reason for
//! it. Nothing else passes. A creature cannot name the world, so it cannot
//! read the parts of it that it is not being shown and cannot write any part
//! of it at all; what it is handed are values, and Cove copies a value into a
//! call, so there is nothing to reach back through.
//!
//! This is enforced by three things and not by a runtime check. The module
//! boundary decides what a species may name. The copy rule decides that what
//! it names is a copy. And the registry a session runs against is granted no
//! capability at all, so a species that somehow named a host module would be
//! refused at the boundary rather than served.
//!
//! # What one tick costs, and what bounds it
//!
//! A species is compiled and lowered once and invoked once per creature per
//! tick. Each invocation carries its own [`cove_runtime::Limits`], installed
//! as the call is entered and left holding what that call spent, so a creature
//! that loops spends its own fuel and stops, and the next creature is asked
//! with a full budget on the same backend. One broken creature costs one tick.
//!
//! Three of the runtime's limits are deliberately not used. `deadline` reads a
//! wall clock, which no replay can reproduce. `max_host_calls` bounds effects,
//! and a decision has none. `max_tasks` bounds concurrency, and a creature has
//! no way to spawn: it is a pure function of its two arguments, which is what
//! makes a species a function rather than a process.
//!
//! # What a replay is
//!
//! A recorded world is only reproducible against the same everything, and the
//! parts this crate owns are [`Species::source_hash`] — a hash of the contract,
//! the shared instincts, and the species' own source, because all three decide
//! what `decide` answers — and the Cove commit pinned in the workspace
//! manifest. The runtime offers no version or content hash of its own, so the
//! project that shipped the source is what identifies it.

pub mod clock;
pub mod contract;
pub mod report;
pub mod resolve;
pub mod scenario;
pub mod species;

pub use clock::Stopwatch;
pub use contract::{
    ActionResult, Aim, Bed, Decision, Intent, Morsel, Observation, Point, Reason, Role, SelfView,
    Sighting,
};
pub use resolve::{admissible, Verdict};
pub use species::{
    Failure, Habitat, LoadCost, Lowering, Outcome, Recorded, Session, Species, Tape,
};

/// Where the catalog is, relative to the workspace root.
pub const CATALOG: &str = "catalog";

/// The version of the contract every species in the catalog is compiled
/// against.
///
/// It is written here rather than derived, because it names a decision and not
/// a file: a change to `contract.cove` that adds a field changes what every
/// species must be recompiled against, and a change that only rewords a doc
/// comment does not. [`Species::source_hash`] is the derived half, and the two
/// answer different questions — this one says whether a recorded world can
/// still be read, and the hash says whether it will run the same.
pub const SCHEMA_VERSION: u32 = 2;

/// What identifies a recorded run.
///
/// Every field of it has to match for a replay to mean anything, which is why
/// they are one struct rather than four arguments that a caller could get out
/// of order.
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct Identity {
    /// What the world was seeded from.
    pub seed: u64,
    /// The commit of `myuon/cove` this was built against.
    pub cove: &'static str,
    /// Which backend ran it. Fuel is not portable between the linear-memory
    /// VM and the tree-walking oracle — they charge differently and can
    /// disagree on outcome under the same limit — so a replay identity that
    /// did not name one would not identify anything.
    pub backend: &'static str,
    /// The contract version, [`SCHEMA_VERSION`].
    pub schema: u32,
    /// The species that were in it, and the hash of the source each was
    /// compiled from.
    pub species: Vec<(String, String)>,
}

/// The commit of `myuon/cove` this crate is built against.
///
/// It is the same string the workspace manifest pins, written twice on
/// purpose: a manifest is a build input and a replay identity is a record, and
/// `pinned_cove_matches_the_manifest` is the test that keeps the two the same.
pub const COVE_COMMIT: &str = "1c6bdc064f92b67bfe04fd2e8506dbd27b635d97";

/// The backend every recorded world is run on.
pub const BACKEND: &str = "vm";

pub use cove_runtime::{Limits, Stopped};
