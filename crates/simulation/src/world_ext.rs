//! Small, additional public entry points into [`crate::world`] that exist for
//! a caller outside this crate — a renderer wanting to show one creature's
//! state, or a test checking what a creature can see — rather than for the
//! tick loop itself.

use creature_host::{Observation, SelfView};

use crate::catalog::Roster;
use crate::world::{creature_named, look, self_view, World};

/// The observation the world would build for creature `id` this tick, if it
/// is alive.
///
/// A thin, named wrapper over the same `look` the decide phase calls, so a
/// caller that wants to show or assert on what one creature can see does not
/// have to reconstruct a session and a decision just to get there.
pub fn observe(world: &World, id: i64, roster: &Roster) -> Option<Observation> {
    let creature = creature_named(world, id)?;
    Some(look(world, creature, roster))
}

/// What the world would tell creature `id` about itself this tick, if it is
/// alive.
pub fn view_of(world: &World, id: i64, roster: &Roster) -> Option<SelfView> {
    let creature = creature_named(world, id)?;
    Some(self_view(world, creature, roster))
}
