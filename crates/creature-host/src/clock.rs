//! Measuring how long something took, on a target that may have no clock.
//!
//! `std::time::Instant::now()` does not fail on `wasm32-unknown-unknown`; it
//! **panics**, and it panics inside whatever was innocently timing itself.
//! The first symptom here was `Species::from_units` aborting the whole module
//! at load, which reads as a compiler problem and is a stopwatch problem.
//!
//! So a duration is not measured where there is nothing to measure it with.
//! Every reading a browser takes is [`Duration::ZERO`], and that is the honest
//! answer rather than a fallback: nothing in this project may branch on a
//! wall-clock reading, because a deadline reads a wall clock and no replay can
//! reproduce one. Timings are reported and never acted on, so a zero costs a
//! report a number and costs a run nothing.
//!
//! Cove's own runtime solves this differently — `cove-runtime`'s `wallclock`
//! imports `cove.cove_now_millis` from the host, and a module that is not
//! given it fails to instantiate. That is the right answer for a runtime whose
//! budgets include a deadline. This project sets no deadline, so it does not
//! need a clock and does not ask the page for a second one.

use std::time::Duration;
#[cfg(not(target_arch = "wasm32"))]
use std::time::Instant;

/// A clock reading, where there is a clock to read.
#[derive(Clone, Copy, Debug)]
pub struct Stopwatch {
    #[cfg(not(target_arch = "wasm32"))]
    started: Instant,
}

impl Stopwatch {
    /// Starts one.
    pub fn start() -> Stopwatch {
        Stopwatch {
            #[cfg(not(target_arch = "wasm32"))]
            started: Instant::now(),
        }
    }

    /// How long since it started, or [`Duration::ZERO`] where nothing was
    /// counting.
    pub fn elapsed(&self) -> Duration {
        #[cfg(not(target_arch = "wasm32"))]
        {
            self.started.elapsed()
        }
        #[cfg(target_arch = "wasm32")]
        {
            Duration::ZERO
        }
    }
}

impl Default for Stopwatch {
    fn default() -> Self {
        Stopwatch::start()
    }
}
