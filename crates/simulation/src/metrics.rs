//! What one tick cost, in a shape a caller can read.

use std::time::Duration;

use creature_host::Stopwatch;

use cove_runtime::Limits;
use creature_host::{ActionResult, Session};

use crate::catalog::Roster;
use crate::world::{advance, DecisionCost, Turn, World};

/// What one tick cost: wall-clock time, time spent inside Cove, total
/// instructions and fuel, how many decisions were made, how many the world
/// refused, and how many invocations failed outright (fuel exhaustion and a
/// fault, counted separately, because they are different failures with
/// different causes).
///
/// `tick_time` and [`TickMetrics::decisions_per_second`] read a wall clock
/// and must stay out of anything a golden test compares byte for byte: the
/// same tick spends the same fuel and the same instructions every time it is
/// run and a different number of microseconds every time.
#[derive(Clone, Copy, Debug, Default)]
pub struct TickMetrics {
    pub tick_time: Duration,
    pub cove_time: Duration,
    pub instructions: u64,
    pub fuel: u64,
    pub decisions: u64,
    /// How many of this tick's decisions the world refused (an
    /// `ActionResult::Refused`, not a `Blocked` — the reference's own
    /// `refusals` counter only counts that case, and this mirrors it).
    pub refused: u64,
    /// Invocations this tick that ran out of fuel.
    pub failed_fuel: u64,
    /// Invocations this tick that faulted.
    pub failed_fault: u64,
}

impl TickMetrics {
    /// Decisions made per second of wall-clock tick time. `0.0` for a tick
    /// timed at zero, rather than dividing by it.
    pub fn decisions_per_second(&self) -> f64 {
        let seconds = self.tick_time.as_secs_f64();
        if seconds <= 0.0 {
            0.0
        } else {
            self.decisions as f64 / seconds
        }
    }

    fn from_cost(tick_time: Duration, cost: DecisionCost, refused: u64) -> TickMetrics {
        TickMetrics {
            tick_time,
            cove_time: cost.cove_time,
            instructions: cost.instructions,
            fuel: cost.fuel,
            decisions: cost.decisions,
            refused,
            failed_fuel: cost.failed_fuel,
            failed_fault: cost.failed_fault,
        }
    }
}

/// [`crate::world::advance`], timed and reported as [`TickMetrics`].
pub fn advance_metered(
    world: &World,
    roster: &Roster,
    sessions: &mut [Session<'_>],
    limits: &Limits,
) -> (Turn, TickMetrics) {
    let started = Stopwatch::start();
    let (turn, cost) = advance(world, roster, sessions, limits);
    let tick_time = started.elapsed();
    let refused = turn
        .outcomes
        .iter()
        .filter(|outcome| matches!(outcome.result, ActionResult::Refused(_)))
        .count() as u64;
    (turn, TickMetrics::from_cost(tick_time, cost, refused))
}
