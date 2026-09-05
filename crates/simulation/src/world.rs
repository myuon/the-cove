//! The world: the only thing in this crate that changes anything.
//!
//! A faithful port of `examples/life/world/world.cove` in `myuon/cove`,
//! adapted to this repository's contract (`catalog/contract/contract.cove`)
//! and its four-species catalog. The shape is the same as the reference in
//! every place the contract did not force a change: a tick is deciding (a
//! `map` — every creature is shown a bounded, immutable observation of a
//! world none of them have changed yet, so no answer can depend on another)
//! followed by resolving (a loop, in creature-id order, because two
//! creatures wanting the same cell need an order to lose in, and id order is
//! the one order a world reconstructed from a seed always has).
//!
//! # Population turnover, and why it is not reproduction
//!
//! What is **not** ported from the reference is how a population sustains
//! itself. The reference grows one: a full creature divides its energy with a
//! new one of the same species, capped per species. That was ported first and
//! it worked — tuned until all four species survived six hundred ticks across
//! six seeds, it settled at sixty to seventy-eight creatures on a
//! twenty-four by sixteen reef. It is a better ecology and a worse tank, and
//! nobody follows one creature out of seventy.
//!
//! So a world is a **cast**: eight to fourteen creatures chosen from the
//! catalog by the seed, and that number does not drift. A death empties a
//! slot and [`RESPAWN_DELAY`] ticks later the slot is filled again with the
//! same species. Everything that kills is kept — a creature still starves,
//! is still hunted, and its death is still a gap somebody watching will see —
//! and what is dropped is growth, which V0 does not want, and heredity, which
//! it never had.
//!
//! The tuning that went into the ecology is not wasted and is not gone:
//! `capacity` still decides how many slots a species may take, and
//! `cargo run -p simulation --bin sweep` is the instrument every number in
//! the catalog was chosen with. What it looks for now is not survival, which
//! a refilled cast guarantees, but whether anything happens.
//!
//! # Where this necessarily disagrees with the reference
//!
//! `examples/life/world/world.cove`'s own `SelfView` carries five fields:
//! `id`, `species`, `at`, `energy`, `hidden`. This repository's
//! `contract.cove` declares eight: it adds `role`, `age`, and `last`. `role`
//! and `age` are cheap — a lookup into the catalog and `tick - born` — but
//! `last` is not: it is the [`creature_host::ActionResult`] a creature's
//! *own* previous tick came to, and the reference world never had to keep
//! one because its `SelfView` never asked. So [`Creature`] carries a `last`
//! field the reference's `Creature` struct does not, seeded to
//! `ActionResult::Spawned` for a creature that has not acted and overwritten
//! every tick with whatever [`resolve`] decided. Everything else in
//! [`Creature`] and [`World`] is exactly the reference's shape.

use std::collections::HashMap;

use cove_runtime::Limits;
use creature_host::{
    ActionResult, Cell, Decision, Failure, Heading, Intent, Observation, Patch, Reason, Role,
    Session, Sighting, Stopped,
};

use crate::catalog::Roster;
use crate::generator::roll;

/// What living costs, whatever a creature does with the tick.
pub const UPKEEP: i64 = 1;
/// The most energy a creature carries.
pub const MAX_ENERGY: i64 = 44;
/// How often a hunt within reach succeeds, in draws out of a hundred.
pub const STRIKE: i64 = 70;
/// What a dead creature leaves behind in the cell it died in.
pub const CARCASS: i64 = 3;

/// How many ticks a slot stays empty after the creature in it dies.
///
/// Long enough that a death reads as a death. A slot refilled on the next
/// tick is a substitution nobody notices, and the one thing this world has to
/// make legible is what happened and why.
pub const RESPAWN_DELAY: i64 = 12;
/// The most food one cell can hold.
pub const MAX_FOOD: i64 = 4;

/// How far a creature in this role can see, in steps.
///
/// `contract.cove`'s own values: a hunter's is the long one, everything else
/// is bounded the same. This is not mirrored in `creature-host`'s Rust
/// contract (only `Role::hunts` and `Role::is_prey` are), so it is
/// reimplemented here rather than duplicated by copy-paste of a constant
/// that already exists in a language the host does not evaluate.
pub fn sight_range(role: Role) -> i64 {
    match role {
        Role::Hunter => 3,
        _ => 2,
    }
}

/// Whether this role can smell food it cannot see. Scavenger only.
pub fn smells(role: Role) -> bool {
    matches!(role, Role::Scavenger)
}

/// How many sightings an observation carries, at most.
pub const SIGHT_LIMIT: usize = 4;

/// Every heading, in the order a tie is broken in: north, east, south, west.
pub const HEADINGS: [Heading; 4] = [Heading::North, Heading::East, Heading::South, Heading::West];

/// How many cells grow by one each tick.
pub fn sprouts(cells: i64) -> i64 {
    cells / 16
}

/// What a hunter gains from prey worth `victim_energy` at the tick's start,
/// up to a limit no meal goes past.
pub fn bounty(victim_energy: i64) -> i64 {
    (victim_energy / 2).min(18)
}

/// Whether this cell is a thicket: a place to hide, and a place no hunt
/// reaches into.
///
/// Derived from the coordinates rather than stored, because cover never
/// moves. `rem_euclid` and not `%`: every call this world makes is on a cell
/// already known to be inside the grid, so `x` and `y` are never negative in
/// practice, but `%` in Rust keeps the sign of its left operand where Cove's
/// does not, and a formula that silently disagreed with the reference off
/// the grid would be a landmine left for the next caller.
pub fn is_shelter(at: Cell) -> bool {
    (at.x * 3 + at.y * 5).rem_euclid(7) == 0
}

/// One creature, as the world keeps it.
#[derive(Clone, Debug)]
pub struct Creature {
    pub id: i64,
    /// The index into the catalog this creature was spawned from —
    /// [`crate::catalog::SPECIES_IDS`] names what each index is.
    pub species: usize,
    pub at: Cell,
    pub energy: i64,
    pub hidden: bool,
    pub born: i64,
    /// What the world did with this creature's intent last tick. Not in the
    /// reference `Creature` — see the module doc.
    pub last: ActionResult,
}

/// Everything there is, at one tick.
#[derive(Clone, Debug)]
pub struct World {
    pub tick: i64,
    /// The generator the next draw comes from. Chance is the world's, not a
    /// creature's: a behaviour is handed no generator and cannot draw.
    pub seed: i64,
    pub width: i64,
    pub height: i64,
    pub food: Vec<i64>,
    /// Always sorted by `id`.
    pub creatures: Vec<Creature>,
    /// The species of every slot this world holds, fixed for its life.
    ///
    /// A world *is* its cast. Eight to fourteen creatures, chosen from the
    /// catalog by the seed, and that number does not drift: a death empties a
    /// slot and [`RESPAWN_DELAY`] ticks later the slot is filled again with
    /// the same species. So a visitor who has learnt to tell four creatures
    /// apart is still watching four creatures a minute later.
    ///
    /// This is where V0 parts company with the reference it is ported from,
    /// which grows a population instead: a full creature divides its energy
    /// with a new one, capped per species. That is a better ecology and a
    /// worse tank. Tuned until all four species survived six hundred ticks it
    /// settled at sixty to seventy-eight creatures on a twenty-four by sixteen
    /// reef, and nobody can follow one creature out of seventy. The brief asks
    /// for eight to fourteen and for a visitor who can tell three behaviours
    /// apart, and those are the same requirement.
    ///
    /// What is kept from the ecology is everything that kills: a creature
    /// still starves, is still hunted, and its death is still a gap somebody
    /// watching will see. What is dropped is heredity, which V0 never had, and
    /// growth, which V0 does not want.
    pub cast: Vec<usize>,
    /// The slots waiting to be refilled: a species, and the tick it is due.
    pub pending: Vec<(usize, i64)>,
    pub next_id: i64,
    pub births: i64,
    pub deaths: i64,
    pub refusals: i64,
}

/// One creature's intent for this tick.
#[derive(Clone, Copy, Debug)]
pub struct Ask {
    pub id: i64,
    pub decision: Decision,
}

/// What one creature's intent came to.
#[derive(Clone, Debug)]
pub struct CreatureOutcome {
    pub id: i64,
    pub species: usize,
    pub decision: Decision,
    pub result: ActionResult,
}

/// The world after a tick, and what every intent came to in it.
#[derive(Clone, Debug)]
pub struct Turn {
    pub world: World,
    pub outcomes: Vec<CreatureOutcome>,
}

/// Which cell of the grid this is.
pub fn cell_index(world: &World, at: Cell) -> i64 {
    at.y * world.width + at.x
}

/// Whether this cell is on the grid at all.
pub fn inside(world: &World, at: Cell) -> bool {
    at.x >= 0 && at.y >= 0 && at.x < world.width && at.y < world.height
}

/// How much food this cell holds. `0` off the grid.
pub fn food_at(world: &World, at: Cell) -> i64 {
    if !inside(world, at) {
        return 0;
    }
    world.food[cell_index(world, at) as usize]
}

/// The distance between two cells, in steps (Manhattan distance) — the same
/// answer `contract.stepsBetween` gives.
pub fn steps_between(a: Cell, b: Cell) -> i64 {
    (a.x - b.x).abs() + (a.y - b.y).abs()
}

/// The cell one step from `at` in this heading.
fn step_from(at: Cell, heading: Heading) -> Cell {
    let (dx, dy) = match heading {
        Heading::North => (0, -1),
        Heading::East => (1, 0),
        Heading::South => (0, 1),
        Heading::West => (-1, 0),
    };
    Cell {
        x: at.x + dx,
        y: at.y + dy,
    }
}

/// Whether a creature stood in this cell when the tick began.
fn stands_here(world: &World, at: Cell) -> bool {
    world.creatures.iter().any(|c| c.at == at)
}

/// Whether one of the creatures this one can see stands in this cell.
fn stands_on(seen: &[Sighting], at: Cell) -> bool {
    seen.iter().any(|s| s.at == at)
}

/// The world a seed describes, before anything has happened in it.
///
/// Founders are interleaved rather than grouped, and how many of each there
/// are is read off `capacity` rather than chosen. See [`founders`] for both,
/// and for the even split that was tried first and killed the hunters.
pub fn new_world(seed: i64, width: i64, height: i64, roster: &Roster) -> World {
    let mut generator = seed;
    let cells = width * height;
    let mut food = Vec::with_capacity(cells.max(0) as usize);
    for _ in 0..cells {
        let drawn = roll(generator, MAX_FOOD + 1);
        generator = drawn.seed;
        food.push(drawn.value);
    }
    let (cast, after_cast) = cast_for(roster, cells, generator);
    generator = after_cast;
    let mut creatures: Vec<Creature> = Vec::new();
    let mut next_id = 1i64;
    for species in &cast {
        let drawn = roll(generator, cells);
        generator = drawn.seed;
        let placed = first_free(drawn.value, width, height, &creatures);
        creatures.push(Creature {
            id: next_id,
            species: *species,
            at: placed,
            energy: roster.defs[*species].starting_energy,
            hidden: false,
            born: 0,
            last: ActionResult::Spawned,
        });
        next_id += 1;
    }
    World {
        tick: 0,
        seed: generator,
        width,
        height,
        food,
        creatures,
        cast,
        pending: Vec::new(),
        next_id,
        births: 0,
        deaths: 0,
        refusals: 0,
    }
}

/// The smallest and largest cast a world is assembled with.
///
/// The brief's numbers, and they are a legibility budget rather than an
/// ecological one: a visitor is meant to tell creatures apart and follow one,
/// and nobody follows one creature out of seventy.
pub const CAST_MIN: i64 = 8;
pub const CAST_MAX: i64 = 14;

/// The species of every slot in a new world, and the generator that is left.
///
/// Every species in the roster appears at least once, so a four-species
/// catalog gives four roles and a visitor is shown the whole of what this
/// world can do. The rest of the slots are drawn weighted towards the species
/// the reef holds most of -- `capacity` is a divisor, so a smaller one means a
/// commoner creature -- and no species takes more slots than a reef this size
/// would hold of it.
///
/// The result is interleaved by species rather than grouped, and that is
/// load-bearing rather than tidy: ids are handed out in slot order and id
/// order breaks every conflict in a tick, so a world whose grazers all had
/// lower ids than its hunters would be a world where being a grazer was an
/// advantage nobody wrote down.
fn cast_for(roster: &Roster, cells: i64, seed: i64) -> (Vec<usize>, i64) {
    let mut generator = seed;
    if roster.is_empty() {
        return (Vec::new(), generator);
    }
    let drawn = roll(generator, CAST_MAX - CAST_MIN + 1);
    generator = drawn.seed;
    let wanted = (CAST_MIN + drawn.value).max(roster.len() as i64);

    let ceiling: Vec<i64> = roster
        .defs
        .iter()
        .map(|def| (cells / def.capacity.max(1)).max(1))
        .collect();
    let mut taken: Vec<i64> = vec![1; roster.len()];

    // A ticket per unit of room the reef has for a species, so the draw is
    // weighted by how common the species is meant to be without anybody
    // writing a second table of weights.
    let mut tickets: Vec<usize> = Vec::new();
    for (index, room) in ceiling.iter().enumerate() {
        for _ in 0..*room {
            tickets.push(index);
        }
    }
    while taken.iter().sum::<i64>() < wanted && !tickets.is_empty() {
        let pick = roll(generator, tickets.len() as i64);
        generator = pick.seed;
        let index = tickets[pick.value as usize];
        if taken[index] < ceiling[index] {
            taken[index] += 1;
        } else {
            tickets.retain(|t| *t != index);
        }
    }

    let mut order = Vec::new();
    while taken.iter().any(|left| *left > 0) {
        for (index, left) in taken.iter_mut().enumerate() {
            if *left > 0 {
                *left -= 1;
                order.push(index);
            }
        }
    }
    (order, generator)
}

/// The first free cell at or after `start`, scanning the grid in order.
fn first_free(start: i64, width: i64, height: i64, taken: &[Creature]) -> Cell {
    let cells = width * height;
    if cells <= 0 {
        return Cell { x: 0, y: 0 };
    }
    for step in 0..cells {
        let index = (start + step) % cells;
        let at = Cell {
            x: index % width,
            y: index / width,
        };
        if !taken.iter().any(|c| c.at == at) {
            return at;
        }
    }
    Cell { x: 0, y: 0 }
}

/// One intent per creature, in creature-id order.
///
/// A `map`: every creature is asked the same question about a world none of
/// them has changed yet, so the answers cannot depend on each other. Every
/// invocation is bounded by `limits`; a creature whose invocation fails
/// (fuel exhausted or a fault) answers `Intent::Rest` and the failure is
/// counted in `cove_time`/`instructions`/`fuel` all the same — one broken
/// creature costs its own tick and nothing else.
pub fn decisions(
    world: &World,
    roster: &Roster,
    sessions: &mut [Session<'_>],
    limits: &Limits,
) -> (Vec<Ask>, DecisionCost) {
    let mut asks = Vec::with_capacity(world.creatures.len());
    let mut cost = DecisionCost::default();
    for creature in &world.creatures {
        let view = self_view(world, creature, roster);
        let observation = look(world, creature, roster);
        let started = creature_host::Stopwatch::start();
        let outcome = sessions[creature.species].decide(&view, &observation, limits.clone());
        cost.cove_time += started.elapsed();
        cost.instructions += outcome.instructions;
        cost.fuel += outcome.fuel;
        cost.decisions += 1;
        let decision = match outcome.answer {
            Ok(decision) => decision,
            Err(Failure::Stopped(Stopped::Fuel)) => {
                cost.failed_fuel += 1;
                rest()
            }
            Err(_) => {
                cost.failed_fault += 1;
                rest()
            }
        };
        asks.push(Ask {
            id: creature.id,
            decision,
        });
    }
    (asks, cost)
}

fn rest() -> Decision {
    Decision {
        intent: Intent::Rest,
        reason: Reason::Waiting,
    }
}

/// What deciding a tick cost, before resolving it.
///
/// Wall-clock time (`cove_time`) is measured here and nowhere a golden test
/// reaches, for the reason `TickMetrics` gives: the same decision spends the
/// same fuel every time and a different number of microseconds every time.
#[derive(Clone, Copy, Debug, Default)]
pub struct DecisionCost {
    pub cove_time: std::time::Duration,
    pub instructions: u64,
    pub fuel: u64,
    pub decisions: u64,
    pub failed_fuel: u64,
    pub failed_fault: u64,
}

/// What one creature is told about itself.
pub(crate) fn self_view(
    world: &World,
    creature: &Creature,
    roster: &Roster,
) -> creature_host::SelfView {
    creature_host::SelfView {
        id: creature.id,
        species: creature.species as i64,
        role: roster.defs[creature.species].role,
        at: creature.at,
        energy: creature.energy,
        age: world.tick - creature.born,
        hidden: creature.hidden,
        last: creature.last.clone(),
    }
}

/// What one creature is shown this tick.
pub(crate) fn look(world: &World, creature: &Creature, roster: &Roster) -> Observation {
    let seen = sightings(world, creature, roster);
    Observation {
        tick: world.tick,
        here: food_at(world, creature.at),
        shelter: is_shelter(creature.at),
        around: patches(world, creature, &seen),
        nearby: seen,
        scent: scent(world, creature, roster),
    }
}

/// The creatures this one can see: near, not hidden, nearest first.
///
/// Bounded twice over — by `sightRange()` and then by `sightLimit()` — so
/// what a creature is told does not grow with the population.
fn sightings(world: &World, creature: &Creature, roster: &Roster) -> Vec<Sighting> {
    let range = sight_range(roster.defs[creature.species].role);
    let mut visible: Vec<Sighting> = world
        .creatures
        .iter()
        .filter(|other| {
            other.id != creature.id
                && !other.hidden
                && steps_between(other.at, creature.at) <= range
        })
        .map(|other| Sighting {
            id: other.id,
            species: other.species as i64,
            role: roster.defs[other.species].role,
            at: other.at,
            away: steps_between(other.at, creature.at),
            hidden: false,
        })
        .collect();
    visible.sort_by(|a, b| a.away.cmp(&b.away).then_with(|| a.id.cmp(&b.id)));
    visible.truncate(SIGHT_LIMIT);
    visible
}

/// The four cells around a creature, in heading order.
///
/// `occupied` is read out of what this creature can see (`seen`), so a
/// hidden neighbour leaves its cell looking empty. A step into it is still
/// blocked when the tick is resolved, which is the whole of what hiding
/// costs the creature that walks into one.
fn patches(world: &World, creature: &Creature, seen: &[Sighting]) -> Vec<Patch> {
    HEADINGS
        .iter()
        .map(|&heading| {
            let target = step_from(creature.at, heading);
            let outside = !inside(world, target);
            Patch {
                heading,
                at: target,
                food: if outside { 0 } else { food_at(world, target) },
                shelter: !outside && is_shelter(target),
                outside,
                occupied: stands_on(seen, target),
            }
        })
        .collect()
}

/// The way to the most food within range, for a creature that can smell.
///
/// The best cell is the fullest, then the nearest, then the first the grid
/// order reaches — every tie-break here is a rule and not a preference,
/// because two scavengers standing in the same place must smell the same
/// thing.
fn scent(world: &World, creature: &Creature, roster: &Roster) -> Option<Heading> {
    let role = roster.defs[creature.species].role;
    if !smells(role) {
        return None;
    }
    let range = sight_range(role);
    let mut best_at = creature.at;
    let mut best_food = 0i64;
    let mut best_away = 0i64;
    for dy in -range..=range {
        for dx in -range..=range {
            let at = Cell {
                x: creature.at.x + dx,
                y: creature.at.y + dy,
            };
            let away = steps_between(at, creature.at);
            if away > 0 && away <= range && inside(world, at) {
                let level = food_at(world, at);
                if level > best_food || (level == best_food && level > 0 && away < best_away) {
                    best_food = level;
                    best_away = away;
                    best_at = at;
                }
            }
        }
    }
    if best_food < 1 {
        return None;
    }
    for heading in HEADINGS {
        let target = step_from(creature.at, heading);
        if inside(world, target) && steps_between(target, best_at) < best_away {
            return Some(heading);
        }
    }
    None
}

/// Carries out `asks`, in creature-id order, and answers the world they
/// leave behind.
///
/// Takes the asks rather than asking [`decisions`] for them, so a test can
/// hand it intents no species would produce — that is how this module says
/// what it means by isolation: an intent the world will not carry out costs
/// the creature that made it its turn, and the loop goes on to the next
/// creature.
pub fn resolve(world: &World, asks: &[Ask], roster: &Roster) -> Turn {
    let mut claims: Vec<i64> = Vec::new();
    let mut hunted: Vec<i64> = Vec::new();
    let mut changes: Vec<(usize, i64)> = Vec::new();
    let mut after: Vec<Creature> = Vec::new();
    let mut outcomes: Vec<CreatureOutcome> = Vec::with_capacity(world.creatures.len());
    let mut next_id = world.next_id;
    let mut births = 0i64;
    let mut refusals = 0i64;
    let mut generator = world.seed;

    for (position, creature) in world.creatures.iter().enumerate() {
        let ask = ask_at(asks, position);
        let mut energy = creature.energy - UPKEEP;
        let mut standing = creature.at;
        let mut hidden = false;

        let result = if ask.id != creature.id {
            ActionResult::Refused(format!(
                "this intent names creature {}, and the world is asking creature {}",
                ask.id, creature.id
            ))
        } else {
            match ask.decision.intent {
                Intent::Rest => ActionResult::Rested,
                Intent::Move(heading) => {
                    let target = step_from(creature.at, heading);
                    if !inside(world, target) {
                        ActionResult::Refused(format!(
                            "a step {} from {},{} leaves the world",
                            heading.name(),
                            creature.at.x,
                            creature.at.y
                        ))
                    } else if stands_here(world, target)
                        || claims.contains(&cell_index(world, target))
                    {
                        ActionResult::Blocked(heading)
                    } else {
                        standing = target;
                        energy -= roster.defs[creature.species].stride;
                        claims.push(cell_index(world, target));
                        ActionResult::Moved(heading)
                    }
                }
                Intent::Eat => {
                    let level = food_at(world, creature.at);
                    if level < 1 {
                        ActionResult::Refused(format!(
                            "there is nothing to eat at {},{}",
                            creature.at.x, creature.at.y
                        ))
                    } else {
                        changes.push((cell_index(world, creature.at) as usize, -1));
                        energy += roster.defs[creature.species].forage;
                        ActionResult::Ate(1)
                    }
                }
                Intent::Hunt(target_id) => match reachable(world, creature.at, target_id, roster) {
                    Some(victim) => {
                        if is_shelter(victim.at) {
                            ActionResult::Refused(format!(
                                "creature {} is in the thicket at {},{}",
                                victim.id, victim.at.x, victim.at.y
                            ))
                        } else if hunted.contains(&victim.id) {
                            ActionResult::Refused(format!(
                                "creature {} was taken by an earlier hunter this tick",
                                victim.id
                            ))
                        } else {
                            let drawn = roll(generator, 100);
                            generator = drawn.seed;
                            if drawn.value < STRIKE {
                                hunted.push(victim.id);
                                energy += bounty(victim.energy);
                                ActionResult::Hunted(victim.id)
                            } else {
                                ActionResult::Missed(victim.id)
                            }
                        }
                    }
                    None => ActionResult::Refused(format!(
                        "no creature {target_id} is within reach of creature {}",
                        creature.id
                    )),
                },
                Intent::Hide => {
                    if is_shelter(creature.at) {
                        hidden = true;
                        ActionResult::Hid
                    } else {
                        ActionResult::Refused(format!(
                            "there is no shelter at {},{}",
                            creature.at.x, creature.at.y
                        ))
                    }
                }
            }
        };

        if matches!(result, ActionResult::Refused(_)) {
            refusals += 1;
        }

        if energy > MAX_ENERGY {
            energy = MAX_ENERGY;
        }

        after.push(Creature {
            id: creature.id,
            species: creature.species,
            at: standing,
            energy,
            hidden,
            born: creature.born,
            last: result.clone(),
        });
        outcomes.push(CreatureOutcome {
            id: creature.id,
            species: creature.species,
            decision: ask.decision,
            result,
        });
    }

    let taken = hunted;
    let mut deaths = 0i64;
    let mut pending = world.pending.clone();
    for creature in &after {
        if creature.energy < 1 || taken.contains(&creature.id) {
            deaths += 1;
            changes.push((cell_index(world, creature.at) as usize, CARCASS));
            // The slot this creature filled is not lost, it is empty. The
            // cast is what a world is; a death is a gap in it, and the gap
            // closes `RESPAWN_DELAY` ticks later so that a visitor sees the
            // death rather than a substitution.
            pending.push((creature.species, world.tick + 1 + RESPAWN_DELAY));
        }
    }
    let mut survivors: Vec<Creature> = after
        .into_iter()
        .filter(|c| c.energy > 0 && !taken.contains(&c.id))
        .collect();
    survivors.sort_by_key(|c| c.id);

    let (mut new_seed, new_food) = sprout(world, changes, generator);

    // Whatever is due, in the order it fell due, so that two deaths on the
    // same tick refill in the order they happened.
    let due: Vec<usize> = pending
        .iter()
        .filter(|(_, at)| *at <= world.tick + 1)
        .map(|(species, _)| *species)
        .collect();
    pending.retain(|(_, at)| *at > world.tick + 1);
    for species in due {
        let drawn = roll(new_seed, (world.width * world.height).max(1));
        new_seed = drawn.seed;
        let at = first_free(drawn.value, world.width, world.height, &survivors);
        survivors.push(Creature {
            id: next_id,
            species,
            at,
            energy: roster.defs[species].starting_energy,
            hidden: false,
            born: world.tick + 1,
            last: ActionResult::Spawned,
        });
        next_id += 1;
        births += 1;
    }
    survivors.sort_by_key(|c| c.id);

    Turn {
        world: World {
            tick: world.tick + 1,
            seed: new_seed,
            width: world.width,
            height: world.height,
            food: new_food,
            creatures: survivors,
            cast: world.cast.clone(),
            pending,
            next_id,
            births: world.births + births,
            deaths: world.deaths + deaths,
            refusals: world.refusals + refusals,
        },
        outcomes,
    }
}

/// The ask at this position, or one no creature answers to.
///
/// Id `0` belongs to no creature, so a missing ask is refused by the same
/// rule that refuses an ask naming somebody else.
fn ask_at(asks: &[Ask], at: usize) -> Ask {
    asks.get(at).copied().unwrap_or(Ask {
        id: 0,
        decision: rest(),
    })
}

/// The prey a hunt names, if it is alive, adjacent, and huntable — read out
/// of the world as it stood when the tick began, not out of `after`.
///
/// Unlike `resolve::admissible`, this does not check the *hunter's* own
/// role. Neither does the reference (`world.cove`'s `reachable` checks only
/// the victim), which means a species program that somehow emitted
/// `Intent::Hunt` without being a hunting role would still have it carried
/// out here — the checker and `admissible` are what keep a well-behaved
/// species from asking, not this. Ported faithfully rather than tightened,
/// since tightening it would make this module resolve something
/// `admissible` was supposed to have already caught, silently changing what
/// "the world does not use `admissible`" means.
fn reachable<'a>(
    world: &'a World,
    hunter_at: Cell,
    target: i64,
    roster: &Roster,
) -> Option<&'a Creature> {
    let victim = world.creatures.iter().find(|c| c.id == target)?;
    let role = roster.defs[victim.species].role;
    if role.is_prey() && steps_between(victim.at, hunter_at) <= 1 {
        Some(victim)
    } else {
        None
    }
}

/// The grid after this tick's eating, carcasses, and new growth, and the
/// generator the growth was drawn from.
fn sprout(world: &World, mut changes: Vec<(usize, i64)>, seed: i64) -> (i64, Vec<i64>) {
    let mut generator = seed;
    let cells = world.width * world.height;
    for _ in 0..sprouts(cells) {
        let drawn = roll(generator, cells);
        generator = drawn.seed;
        changes.push((drawn.value as usize, 1));
    }
    let mut levels = world.food.clone();
    for (cell, change) in changes {
        levels[cell] += change;
    }
    for level in levels.iter_mut() {
        *level = (*level).clamp(0, MAX_FOOD);
    }
    (generator, levels)
}

/// The world one tick later, and what every creature's intent came to.
///
/// Deciding runs under `limits`, and never with a `deadline` — a wall clock
/// is not reproducible, and no replay could trust a run bounded by one.
pub fn advance(
    world: &World,
    roster: &Roster,
    sessions: &mut [Session<'_>],
    limits: &Limits,
) -> (Turn, DecisionCost) {
    let (asks, cost) = decisions(world, roster, sessions, limits);
    (resolve(world, &asks, roster), cost)
}

/// The world one tick later.
pub fn tick(
    world: &World,
    roster: &Roster,
    sessions: &mut [Session<'_>],
    limits: &Limits,
) -> World {
    advance(world, roster, sessions, limits).0.world
}

/// The state hash: one number that is the whole world.
///
/// Two runs of the same seed and the same number of ticks agree here or the
/// simulation is not deterministic. A `fold` because that is what a hash is:
/// every element, in order, into one accumulator, staying inside `i64` where
/// overflow would be a broken invariant rather than a wrapped result.
pub fn hash(world: &World) -> i64 {
    let ground = world
        .food
        .iter()
        .fold(8191i64, |total, &level| mix(total, level));
    let living = world.creatures.iter().fold(ground, |total, creature| {
        mix(
            mix(
                mix(mix(total, creature.id), creature.species as i64 + 1),
                cell_index(world, creature.at),
            ),
            creature.energy,
        )
    });
    // The empty slots are state. Two runs that agree about every creature and
    // disagree about when a slot refills are two different runs, and a hash
    // that could not tell them apart would call the second one a replay of the
    // first right up until the moment it was not.
    let waiting = world.pending.iter().fold(living, |total, (species, at)| {
        mix(mix(total, *species as i64 + 1), *at)
    });
    mix(mix(mix(waiting, world.tick), world.births), world.deaths)
}

/// One value into a running hash.
fn mix(total: i64, value: i64) -> i64 {
    (total * 131 + value + 1) % 2_147_483_647
}

/// What is alive, what it is standing on, and what has happened so far.
#[derive(Clone, Debug)]
pub struct Census {
    pub tick: i64,
    pub alive: i64,
    /// Population per catalog index.
    pub per_species: Vec<i64>,
    pub food: i64,
    pub energy: i64,
    pub births: i64,
    pub deaths: i64,
    pub refusals: i64,
}

/// The census of this world, over a catalog of `species_count` species.
pub fn census(world: &World, species_count: usize) -> Census {
    let mut per_species = vec![0i64; species_count];
    let mut energy = 0i64;
    for creature in &world.creatures {
        per_species[creature.species] += 1;
        energy += creature.energy;
    }
    Census {
        tick: world.tick,
        alive: world.creatures.len() as i64,
        per_species,
        food: world.food.iter().sum(),
        energy,
        births: world.births,
        deaths: world.deaths,
        refusals: world.refusals,
    }
}

/// A creature with this id, if it is alive — for a test that wants to name
/// one rather than index into `creatures` positionally.
pub fn creature_named(world: &World, id: i64) -> Option<&Creature> {
    world.creatures.iter().find(|c| c.id == id)
}

/// A lookup from id to position, for a caller walking `world.creatures`
/// repeatedly by id rather than scanning it every time.
pub fn index_by_id(world: &World) -> HashMap<i64, usize> {
    world
        .creatures
        .iter()
        .enumerate()
        .map(|(index, creature)| (creature.id, index))
        .collect()
}
