//! Whether the reef will carry out what a creature asked for.
//!
//! A decision the checker admits is not yet a decision the reef will do. The
//! type system holds a species to answering *a* decision — `decide` returns
//! `Decision`, so a species cannot answer something else, and the
//! invalid-decision case a host has to worry about is not a malformed value
//! but a well-formed one naming something that is not there. A creature can
//! ask to hunt a creature it cannot see, hunt one too far off or hidden in
//! kelp, eat where nothing is in reach, or hide in open water, and every one
//! of those is a sentence the language is happy with.
//!
//! So the refusal is here, and it is deliberately the whole of it: this module
//! decides admissibility and nothing else. It does not move anything, spend
//! anything, or kill anything — that is the tick loop, and the tick loop is
//! `simulation::world`. What it produces is the [`ActionResult`] the creature
//! is told about on its next tick, which is how a creature finds out it was
//! wrong.
//!
//! A refused decision costs its creature that tick and costs the reef
//! nothing. It is never an error and it never stops a run: the brief's rule is
//! that an invalid decision degrades to `Rest`, and [`Verdict::result`] is
//! where that degrading is written down once.
//!
//! There is no `Blocked` any more. A swim is never refused: `Toward` and
//! `Away` always resolve, clamped inside the reef rather than declined at its
//! edge, because a continuous world has no cell for something else to stand
//! in.

use crate::contract::{ActionResult, Decision, Intent, Observation, SelfView};

/// What the reef makes of one decision.
#[derive(Clone, Debug, PartialEq)]
pub enum Verdict {
    /// The reef will carry this out.
    Allowed(Intent),
    /// It will not, and this is the sentence recorded against the creature.
    Refused(String),
}

impl Verdict {
    /// What the creature is told on its next tick.
    ///
    /// A refusal degrades to a rest that already happened: the creature spent
    /// its tick and nothing moved. The result says which, so a species that
    /// reads `SelfView.last` can stop asking for the same impossible thing.
    ///
    /// The `Allowed` arms here are placeholders rather than what actually
    /// happened — an admissible swim's real distance and an admissible hunt's
    /// real outcome are decided by resolving the tick, which this module does
    /// not do. Nothing reads these placeholders except a test asking whether
    /// a *refusal* round-trips correctly.
    pub fn result(&self) -> ActionResult {
        match self {
            Verdict::Allowed(Intent::Toward(_)) => ActionResult::Swam(0.0),
            Verdict::Allowed(Intent::Away(_)) => ActionResult::Swam(0.0),
            Verdict::Allowed(Intent::Eat) => ActionResult::Ate(0.0),
            Verdict::Allowed(Intent::Hunt(id)) => ActionResult::Hunted(*id),
            Verdict::Allowed(Intent::Hide) => ActionResult::Hid,
            Verdict::Allowed(Intent::Rest) => ActionResult::Rested,
            Verdict::Refused(why) => ActionResult::Refused(why.clone()),
        }
    }

    /// Whether the reef will carry this out.
    pub fn allowed(&self) -> bool {
        matches!(self, Verdict::Allowed(_))
    }
}

/// Whether the reef will carry out `decision`, given what the creature was
/// shown.
///
/// Every rule here is decided against the *observation the creature was
/// given* and not against the reef, which is what makes a refusal something a
/// species can reason about. A creature is refused for asking about something
/// it was not shown, never for being wrong about something it could not have
/// known.
pub fn admissible(view: &SelfView, world: &Observation, decision: Decision) -> Verdict {
    match decision.intent {
        Intent::Toward(_) | Intent::Away(_) => Verdict::Allowed(decision.intent),
        Intent::Eat => {
            if world.here > 0.0 {
                Verdict::Allowed(decision.intent)
            } else {
                Verdict::Refused("there is nothing here to eat".to_string())
            }
        }
        Intent::Hunt(id) => match world.nearby.iter().find(|seen| seen.id == id) {
            None => Verdict::Refused(format!("no creature {id} is in sight")),
            Some(seen) if seen.away > world.reach => Verdict::Refused(format!(
                "creature {id} is {:.2} away, past a reach of {:.2}",
                seen.away, world.reach
            )),
            Some(seen) if seen.hidden => Verdict::Refused(format!(
                "creature {id} is hidden in kelp, and no lunge reaches into it"
            )),
            Some(_) if !view.role.hunts() => {
                Verdict::Refused(format!("a {} does not hunt", view.role.case()))
            }
            Some(seen) if !seen.role.is_prey() => {
                Verdict::Refused(format!("a {} is not prey", seen.role.case()))
            }
            Some(_) => Verdict::Allowed(decision.intent),
        },
        Intent::Hide => {
            if world.sheltered {
                Verdict::Allowed(decision.intent)
            } else {
                Verdict::Refused("there is no cover here".to_string())
            }
        }
        Intent::Rest => Verdict::Allowed(decision.intent),
    }
}
