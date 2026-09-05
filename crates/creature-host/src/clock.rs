//! Measuring how long something took, on a target that may have no clock.
//!
//! `std::time::Instant::now()` does not fail on `wasm32-unknown-unknown`; it
//! **panics**, and it panics inside whatever was innocently timing itself.
//! The first symptom here was `Species::from_units` aborting the whole module
//! at load, which reads as a compiler problem and is a stopwatch problem.
//!
//! So on wasm a stopwatch reads the clock the page already has to supply.
//! `cove-runtime` imports `cove.cove_now_millis` unconditionally and a module
//! instantiated without it fails to instantiate, so the import is not a new
//! demand on the host: it is the one it was already meeting. A page that
//! answers `performance.now()` gets sub-millisecond readings, which is what a
//! tick needs, and a page that answers `Date.now()` gets whole milliseconds
//! and a report full of zeros. Either is fine, because nothing here branches
//! on the reading.
//!
//! That last sentence is the rule and it is not a detail. A timing is reported
//! and never acted on: no deadline is ever set, because a deadline reads a
//! wall clock and no replay can reproduce one. Two runs of the same seed
//! differ in every number this module produces and agree on every number the
//! simulation produces, which is the whole distinction between what a run
//! costs and what a run is.

use std::time::Duration;
#[cfg(not(target_arch = "wasm32"))]
use std::time::Instant;

// The clock the page supplies, and the one `cove-runtime` already demands.
//
// Declared here as well as there because a Rust module cannot borrow another
// crate's import declaration. It is the same module, the same name and the
// same signature, so it resolves to the same import rather than to a second
// one. A plain comment and not a doc comment: rustdoc does not document an
// extern block and says so as a warning.
#[cfg(target_arch = "wasm32")]
#[link(wasm_import_module = "cove")]
extern "C" {
    fn cove_now_millis() -> f64;
}

/// A clock reading.
#[derive(Clone, Copy, Debug)]
pub struct Stopwatch {
    #[cfg(not(target_arch = "wasm32"))]
    started: Instant,
    #[cfg(target_arch = "wasm32")]
    started: f64,
}

impl Stopwatch {
    /// Starts one.
    pub fn start() -> Stopwatch {
        Stopwatch {
            #[cfg(not(target_arch = "wasm32"))]
            started: Instant::now(),
            #[cfg(target_arch = "wasm32")]
            started: unsafe { cove_now_millis() },
        }
    }

    /// How long since it started.
    pub fn elapsed(&self) -> Duration {
        #[cfg(not(target_arch = "wasm32"))]
        {
            self.started.elapsed()
        }
        #[cfg(target_arch = "wasm32")]
        {
            // A clock that went backwards is a clock, not a catastrophe: the
            // reading is reported and nothing branches on it.
            let since = unsafe { cove_now_millis() } - self.started;
            Duration::from_secs_f64((since / 1000.0).max(0.0))
        }
    }
}

impl Default for Stopwatch {
    fn default() -> Self {
        Stopwatch::start()
    }
}
