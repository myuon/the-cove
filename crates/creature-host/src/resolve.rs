//! Whether the world will carry out what a creature asked for.
//!
//! A decision the checker admits is not yet a decision the world will do. The
//! type system holds a species to answering *a* decision — `decide` returns
//! `Decision`, so a species cannot answer something else, and the
//! invalid-decision case a host has to worry about is not a malformed value
//! but a well-formed one naming something that is not there. A creature can
//! ask to hunt a creature it cannot see, step off the edge of the grid, eat in
//! an empty cell, or hide where there is no cover, and every one of those is a
//! sentence the language is happy with.
//!
//! So the refusal is here, and it is deliberately the whole of it: this module
//! decides admissibility and nothing else. It does not move anything, spend
//! anything, or kill anything — that is the tick loop, and the tick loop is
//! slice 1. What it produces is the [`ActionResult`] the creature is told
//! about on its next tick, which is how a creature finds out it was wrong.
//!
//! A refused decision costs its creature that tick and costs the world
//! nothing. It is never an error and it never stops a run: the brief's rule is
//! that an invalid decision degrades to `Rest`, and [`Verdict::result`] is
//! where that degrading is written down once.

use crate::contract::{ActionResult, Decision, Heading, Intent, Observation, Patch, SelfView};

/// What the world makes of one decision.
#[derive(Clone, Debug, PartialEq, Eq)]
pub enum Verdict {
    /// The world will carry this out.
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
    pub fn result(&self) -> ActionResult {
        match self {
            Verdict::Allowed(Intent::Move(heading)) => ActionResult::Moved(*heading),
            Verdict::Allowed(Intent::Eat) => ActionResult::Ate(0),
            Verdict::Allowed(Intent::Hunt(id)) => ActionResult::Hunted(*id),
            Verdict::Allowed(Intent::Hide) => ActionResult::Hid,
            Verdict::Allowed(Intent::Rest) => ActionResult::Rested,
            Verdict::Refused(why) => ActionResult::Refused(why.clone()),
        }
    }

    /// Whether the world will carry this out.
    pub fn allowed(&self) -> bool {
        matches!(self, Verdict::Allowed(_))
    }
}

/// Whether the world will carry out `decision`, given what the creature was
/// shown.
///
/// Every rule here is decided against the *observation the creature was given*
/// and not against the world, which is what makes a refusal something a
/// species can reason about. A creature is refused for asking about something
/// it was not shown, never for being wrong about something it could not have
/// known.
pub fn admissible(view: &SelfView, world: &Observation, decision: Decision) -> Verdict {
    match decision.intent {
        Intent::Move(heading) => match patch(world, heading) {
            None => Verdict::Refused(format!("nothing lies {}", heading.name())),
            Some(patch) if patch.outside => {
                Verdict::Refused(format!("the world ends {}", heading.name()))
            }
            Some(patch) if patch.occupied => {
                Verdict::Refused(format!("something stands {}", heading.name()))
            }
            Some(_) => Verdict::Allowed(decision.intent),
        },
        Intent::Eat => {
            if world.here > 0 {
                Verdict::Allowed(decision.intent)
            } else {
                Verdict::Refused("there is nothing here to eat".to_string())
            }
        }
        Intent::Hunt(id) => match world.nearby.iter().find(|seen| seen.id == id) {
            None => Verdict::Refused(format!("no creature {id} is in sight")),
            Some(seen) if seen.away > 1 => {
                Verdict::Refused(format!("creature {id} is {} steps away", seen.away))
            }
            Some(seen) if !view.role.hunts() => {
                Verdict::Refused(format!("a {} does not hunt", view.role.case()))
            }
            Some(seen) if !seen.role.is_prey() => {
                Verdict::Refused(format!("a {} is not prey", seen.role.case()))
            }
            Some(_) => Verdict::Allowed(decision.intent),
        },
        Intent::Hide => {
            if world.shelter {
                Verdict::Allowed(decision.intent)
            } else {
                Verdict::Refused("there is no cover here".to_string())
            }
        }
        Intent::Rest => Verdict::Allowed(decision.intent),
    }
}

/// The patch lying in `heading`, if the creature was shown one.
fn patch(world: &Observation, heading: Heading) -> Option<&Patch> {
    world.around.iter().find(|patch| patch.heading == heading)
}
