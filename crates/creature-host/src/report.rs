//! A deterministic, plain-text rendering of what one species does.
//!
//! `report` is the one function both `src/bin/capture.rs` and
//! `tests/report.rs` call: the binary writes what it renders to
//! `fixtures/report.txt`, and the test renders the same thing again and
//! diffs it against what is committed. Neither reaches for a serialisation
//! crate — the format is meant to be read by a person deciding whether a
//! diff matters, not parsed back.
//!
//! Nothing in here reads a clock. A report that carried a duration could
//! never be compared against a committed file byte for byte, because the
//! same run costs a different number of microseconds every time it is made
//! and the same number of instructions every time regardless.

use crate::contract::{Observation, SelfView};
use crate::resolve::{admissible, Verdict};
use crate::species::{Lowering, Species};
use crate::{BACKEND, COVE_COMMIT, SCHEMA_VERSION};
use cove_runtime::Limits;

/// Renders `species`, over every scenario in `cases`, as the text this
/// crate's replay identity is checked against.
///
/// `cases` is `(name, view, world)` rather than a `Fn` that looks the
/// scenario up, because the report and its caller should agree on the exact
/// list and order without either reaching into `scenario.rs` a second time.
/// The bound every case in the report is decided under.
///
/// Generous, and fixed. It is here so the report says what a tick was allowed
/// as well as what it cost -- a report whose runs were unbounded could not
/// print a fuel figure at all, because nothing would have been metering.
const BUDGET: u64 = 1_000_000;

pub fn report(
    species: &Species,
    lowering: &Lowering,
    cases: &[(&str, SelfView, Observation)],
) -> String {
    let mut out = String::new();
    out.push_str(&format!("cove commit: {COVE_COMMIT}\n"));
    out.push_str(&format!("backend: {BACKEND}\n"));
    out.push_str(&format!("schema version: {SCHEMA_VERSION}\n"));
    out.push_str(&format!("species: {}\n", species.id()));
    out.push_str(&format!("source hash: {}\n", species.source_hash()));
    out.push_str(&format!("fuel limit: {BUDGET}\n"));
    out.push_str(
        "note: fuel and instructions agree, and are printed separately because\n\
         they are measured differently -- instructions is a session counter's\n\
         difference and needs no budget, fuel is what the budget was charged.\n\
         What the 1024-instruction safepoint stride decides is when the charge\n\
         is compared against the limit, not what it is: a run stops at the\n\
         first safepoint at or past its limit, so a bound overshoots by less\n\
         than a stride and a completed run is charged exactly.\n",
    );

    species.serve(lowering, |session| {
        for (name, view, world) in cases {
            let outcome = session.decide(
                view,
                world,
                Limits {
                    fuel: Some(BUDGET),
                    ..Limits::default()
                },
            );
            out.push_str(&format!("\n[{name}]\n"));
            match outcome.decision() {
                Some(decision) => {
                    out.push_str(&format!("  decision: {}\n", decision.line()));
                    out.push_str(&format!("  instructions: {}\n", outcome.instructions));
                    out.push_str(&format!("  fuel: {}\n", outcome.fuel));
                    let verdict = admissible(view, world, decision);
                    match verdict {
                        Verdict::Allowed(intent) => {
                            out.push_str(&format!("  verdict: allowed {}\n", intent.name()))
                        }
                        Verdict::Refused(why) => {
                            out.push_str(&format!("  verdict: refused: {why}\n"))
                        }
                    }
                }
                None => {
                    out.push_str(&format!("  answer: {:?}\n", outcome.answer));
                    out.push_str(&format!("  instructions: {}\n", outcome.instructions));
                    out.push_str(&format!("  fuel: {}\n", outcome.fuel));
                    out.push_str("  verdict: n/a\n");
                }
            }
            out.push_str("  tape:\n");
            for recorded in &outcome.events {
                out.push_str(&format!("    {}\n", recorded.line));
            }
        }
    });

    out
}
