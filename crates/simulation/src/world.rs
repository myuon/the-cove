//! The world: the only thing in this crate that changes anything.
//!
//! A port of `examples/life/world/world.cove` in `myuon/cove`, continuous
//! rather than gridded: a place is two `Point` fields and not two cells, a
//! creature turns and accelerates rather than snapping between them, and
//! cover is a handful of kelp beds rather than a formula over coordinates.
//! The shape is otherwise the reference's: a tick is deciding (a `map` —
//! every creature is shown a bounded, immutable observation of a reef none
//! of them have changed yet, so no answer can depend on another) followed by
//! resolving (a loop, in creature-id order, because two creatures naming the
//! same prey need an order to lose in, and id order is the one order a world
//! reconstructed from a seed always has).
//!
//! # The arithmetic rule
//!
//! `catalog/contract/contract.cove` states it and this module obeys it: the
//! arithmetic of this world is `+ - * /`, `sqrt`, and comparison, and a
//! direction is a vector and never an angle. Where a float is needed from the
//! seeded generator — which only ever draws integers — it is an integer draw
//! divided by its bound, never a trigonometric function of one.
//!
//! # Population turnover, and why it is not reproduction
//!
//! A world is a **cast**: eight to fourteen creatures chosen from the
//! catalog by the seed, and that number does not drift. A death empties a
//! slot and [`RESPAWN_DELAY`] ticks later the slot is filled again with the
//! same species, at a fresh seeded position. Nobody follows one creature out
//! of seventy, so growth is not ported from the reference; what is kept is
//! everything that kills.

use cove_runtime::Limits;
use creature_host::{
    ActionResult, Aim, Decision, Failure, Intent, Observation, Point, Reason, Role, Session,
    Sighting, Stopped,
};

use crate::catalog::Roster;
use crate::generator::roll;

/// What living costs, whatever a creature does with the tick.
pub const UPKEEP: i64 = 1;
/// The most energy a creature carries.
pub const MAX_ENERGY: i64 = 44;
/// How often a hunt within reach succeeds, in draws out of a hundred.
pub const STRIKE: i64 = 70;
/// What a dead creature leaves behind, as a fresh morsel at its position.
pub const CARCASS: f64 = 3.0;
/// The radius of the morsel a carcass leaves.
pub const CARCASS_RADIUS: f64 = 2.5;
/// How far a lunge reaches, and how far an eat may reach — the same number
/// `Observation.reach` tells every creature, because a species holding its
/// own copy is a species that can disagree with the reef about it.
pub const REACH: f64 = 4.5;
/// The most food one mouthful takes, whatever is left in the morsel.
pub const BITE: f64 = 1.0;
/// The most amount a single morsel holds.
pub const MAX_MORSEL: f64 = 4.0;
/// How many morsels the reef seeds at creation, and holds at minimum for the
/// whole of a run — carcasses only ever add to this.
pub const MORSELS: usize = 34;

/// The reef somebody is shown.
///
/// Sixty by forty-five and not a hundred by seventy-five. The larger reef was
/// measured and it was empty: a hunter sees twenty-two units and a hundred by
/// seventy-five is seven and a half thousand square units, so two creatures
/// almost never met -- **two successful hunts in six hundred ticks**, against
/// a hundred and ninety deaths, almost all of them starvation. A reef is not
/// interesting in proportion to its area. It is interesting in proportion to
/// how often something happens on it.
pub const REEF_WIDTH: f64 = 60.0;
pub const REEF_HEIGHT: f64 = 45.0;

/// What every mouthful loses each tick.
///
/// Food goes off. Without this the reef fills up for ever: a carcass is a new
/// morsel and nothing removed one, so two hundred deaths left two hundred
/// permanent patches and the total food on a six-hundred-tick reef reached
/// four hundred against a living stock of a hundred. That is a leak wearing an
/// ecology's clothes.
const DECAY: f64 = 0.02;
/// How many kelp beds the reef seeds at creation. They never move.
pub const BEDS: usize = 5;
/// How many ticks a slot stays empty after the creature in it dies.
///
/// Long enough that a death reads as a death. A slot refilled on the next
/// tick is a substitution nobody notices, and the one thing this world has to
/// make legible is what happened and why.
pub const RESPAWN_DELAY: i64 = 12;
/// Energy per reef unit swum, before rounding to the whole energy a creature
/// actually spends.
pub const MOVE_COST: f64 = 0.55;
/// The most a creature's speed may change in one tick, whichever way.
pub const ACCEL: f64 = 0.35;

/// The smallest and largest radius a seeded kelp bed carries.
const BED_RADIUS_MIN: f64 = 6.0;
const BED_RADIUS_MAX: f64 = 9.0;
/// How far apart two kelp beds' centres are kept, so "spread out" is a
/// property of the reef and not a coincidence of the draw.
const BED_MIN_GAP: f64 = 22.0;
/// The radius every seeded or regrown morsel carries.
///
/// Fixed rather than drawn, because what varies between morsels is meant to
/// be how much is in one and where it is, not its size — a reef of
/// differently sized patches is a reef where "the fullest one" and "the
/// nearest one" stop being comparisons a visitor can make by eye.
const MORSEL_RADIUS: f64 = 2.5;
/// How far a creature is kept from the reef's edge and from another creature
/// when it is scattered onto the reef, spawning or respawning.
const SPAWN_MARGIN: f64 = 4.0;
const SPAWN_MIN_GAP: f64 = 5.0;

/// How many of the reef's morsels the generator names for growth each tick,
/// and how much a named one gains, up to [`MAX_MORSEL`].
///
/// Chosen — like every number here — by running `cargo run -p simulation
/// --bin sweep` until the reef stayed patchy: never uniformly full, never
/// bare. See that binary's own doc for what it is looking for.
const REGROWTH_PICKS: usize = 4;
const REGROWTH_AMOUNT: f64 = 0.3;
/// What an emptied morsel restarts at once it has drifted to a fresh spot.
const RESPAWN_MORSEL_AMOUNT: f64 = 0.9;

/// How far a creature in this role can see.
///
/// The hunter's is the long one, and it is what makes a hunter a hunter: prey
/// swims away from what it can see, so a hunter that saw no further than its
/// prey could only ever find one by swimming into it.
///
/// This lives here and only here, for the same reason `REACH` is told to a
/// creature rather than guessed at by one: two statements of one rule in two
/// languages disagree the first time either changes, and nothing catches it
/// until a visitor does.
pub fn sight_range(role: Role) -> f64 {
    match role {
        Role::Grazer => 14.0,
        Role::Ambusher => 14.0,
        Role::Hunter => 22.0,
        Role::Scavenger => 16.0,
        Role::Cooperator => 14.0,
        Role::Wildcard => 7.0,
    }
}

/// How many sightings, morsels, and kelp beds an observation carries, at
/// most — matching `contract.cove`'s own doc for `Observation`.
pub const NEARBY_LIMIT: usize = 4;
pub const FOOD_LIMIT: usize = 3;
pub const KELP_LIMIT: usize = 2;

/// What a hunter gains from prey worth `victim_energy` at the tick's start,
/// up to a limit no meal goes past.
pub fn bounty(victim_energy: i64) -> i64 {
    (victim_energy / 2).min(18)
}

/// Something to eat, as the reef keeps it — drifting, not gridded.
#[derive(Clone, Copy, Debug, PartialEq)]
pub struct Morsel {
    pub at: Point,
    pub amount: f64,
    pub radius: f64,
}

/// A bed of kelp. Seeded once, and never moves.
#[derive(Clone, Copy, Debug, PartialEq)]
pub struct Bed {
    pub at: Point,
    pub radius: f64,
}

/// One creature, as the world keeps it.
#[derive(Clone, Debug)]
pub struct Creature {
    pub id: i64,
    /// The index into the catalog this creature was spawned from —
    /// [`crate::catalog::SPECIES_IDS`] names what each index is.
    pub species: usize,
    pub at: Point,
    /// Where it is pointing, one unit long.
    pub facing: Point,
    /// How fast it is actually moving.
    pub speed: f64,
    pub energy: i64,
    pub born: i64,
    /// Whether it is inside kelp, where nothing sees it and no hunt reaches.
    pub hidden: bool,
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
    /// The far corner of the reef. The near one is the origin.
    pub reef: Point,
    pub food: Vec<Morsel>,
    pub kelp: Vec<Bed>,
    /// Always sorted by `id`.
    pub creatures: Vec<Creature>,
    /// The species of every slot this world holds, fixed for its life.
    pub cast: Vec<usize>,
    /// The slots waiting to be refilled: a species, and the tick it is due.
    pub pending: Vec<(usize, i64)>,
    pub next_id: i64,
    pub births: i64,
    pub deaths: i64,
    pub refusals: i64,
}

/// One creature's intent for this tick, and everything about how it got
/// there.
#[derive(Clone, Debug)]
pub struct Ask {
    pub id: i64,
    pub decision: Decision,
    pub asked: Asked,
}

/// What one invocation was given, what it cost, and what it wrote.
#[derive(Clone, Debug)]
pub struct Asked {
    pub view: creature_host::SelfView,
    pub observation: Observation,
    pub instructions: u64,
    pub fuel: u64,
    pub failure: Option<Failure>,
    pub trace: Vec<String>,
}

impl Ask {
    /// An intent nobody was asked for.
    ///
    /// `resolve` takes its intents rather than fetching them so that a test
    /// can hand the world something no species would produce. Such an intent
    /// has no invocation behind it, so it has nothing to inspect, and this is
    /// what says so rather than an [`Asked`] full of plausible zeroes.
    pub fn of(id: i64, decision: Decision) -> Ask {
        Ask {
            id,
            decision,
            asked: Asked {
                view: creature_host::SelfView {
                    id,
                    species: 0,
                    role: creature_host::Role::Grazer,
                    at: Point::ZERO,
                    facing: Point::new(1.0, 0.0),
                    speed: 0.0,
                    energy: 0,
                    age: 0,
                    hidden: false,
                    last: ActionResult::Spawned,
                },
                observation: Observation {
                    tick: 0,
                    reef: Point::ZERO,
                    sight: 0.0,
                    reach: REACH,
                    here: 0.0,
                    sheltered: false,
                    nearby: Vec::new(),
                    food: Vec::new(),
                    kelp: Vec::new(),
                },
                instructions: 0,
                fuel: 0,
                failure: None,
                trace: Vec::new(),
            },
        }
    }
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

/// A float drawn uniformly from `[0, 1)`, and the generator to draw from
/// next.
///
/// The generator only ever produces integers. Per the arithmetic rule this
/// module obeys, the one way to turn one into a float is to divide an integer
/// draw by its bound, which is exactly what this does — never a trigonometric
/// function of one.
///
/// The bound is 32768 and that number is not a taste. `roll` answers
/// `advanced / 65536 % bound` where `advanced` is under 2^31, so the value it
/// has to give is under 32768 *before* the remainder is taken — and a bound
/// above that is a remainder that never wraps, which means a draw that never
/// reaches past 32768 however large the bound is written.
///
/// This was a million, and every "uniform" draw on the reef came out under
/// 0.0328. Creatures, kelp and food were all laid down in the top-left
/// thirtieth of the water, five kelp beds asked to keep twenty-two units apart
/// piled into a circle nine units across, and every number tuned against it
/// was tuned against a reef three units wide. It looked like a placement bug
/// and it was an arithmetic one, and nothing in the type system was ever going
/// to say so.
fn draw_unit(seed: i64) -> (f64, i64) {
    const PRECISION: i64 = 32_768;
    let drawn = roll(seed, PRECISION);
    (drawn.value as f64 / PRECISION as f64, drawn.seed)
}

/// A float drawn uniformly from `[low, high)`.
fn draw_range(seed: i64, low: f64, high: f64) -> (f64, i64) {
    let (unit, next) = draw_unit(seed);
    (low + unit * (high - low).max(0.0), next)
}

/// A unit-long direction drawn from nothing in particular: two coordinates
/// drawn independently and normalised, never an angle. Falls back to facing
/// along the reef's own x-axis on the one draw in a great many that lands
/// exactly on the origin.
fn draw_direction(seed: i64) -> (Point, i64) {
    let (dx, next) = draw_range(seed, -1.0, 1.0);
    let (dy, next) = draw_range(next, -1.0, 1.0);
    let facing = Point::new(dx, dy)
        .normalize()
        .unwrap_or_else(|| Point::new(1.0, 0.0));
    (facing, next)
}

/// A point in the reef, kept `margin` off every edge, that lands at least
/// `min_gap` from everything in `taken` if thirty draws can find one — and
/// wherever the thirtieth draw landed if they cannot, because the reef is
/// finite and a spawn has to land somewhere.
fn scatter(seed: i64, reef: Point, margin: f64, taken: &[Point], min_gap: f64) -> (Point, i64) {
    const TRIES: u32 = 30;
    let mut generator = seed;
    let mut candidate = Point::new(reef.x * 0.5, reef.y * 0.5);
    let high_x = (reef.x - margin).max(margin);
    let high_y = (reef.y - margin).max(margin);
    for attempt in 0..TRIES {
        let (x, next) = draw_range(generator, margin, high_x);
        generator = next;
        let (y, next) = draw_range(generator, margin, high_y);
        generator = next;
        candidate = Point::new(x, y);
        if attempt == TRIES - 1
            || taken
                .iter()
                .all(|other| candidate.distance_to(*other) >= min_gap)
        {
            break;
        }
    }
    (candidate, generator)
}

/// The reef a seed describes, before anything has happened in it.
pub fn new_world(seed: i64, width: f64, height: f64, roster: &Roster) -> World {
    let reef = Point::new(width, height);
    let mut generator = seed;

    let mut kelp: Vec<Bed> = Vec::with_capacity(BEDS);
    for _ in 0..BEDS {
        let (radius, next) = draw_range(generator, BED_RADIUS_MIN, BED_RADIUS_MAX);
        generator = next;
        let centres: Vec<Point> = kelp.iter().map(|bed| bed.at).collect();
        let (at, next) = scatter(generator, reef, radius + 2.0, &centres, BED_MIN_GAP);
        generator = next;
        kelp.push(Bed { at, radius });
    }

    let mut food: Vec<Morsel> = Vec::with_capacity(MORSELS);
    for _ in 0..MORSELS {
        let (at, next) = scatter(generator, reef, MORSEL_RADIUS, &[], 0.0);
        generator = next;
        let (amount, next) = draw_range(generator, 1.0, MAX_MORSEL);
        generator = next;
        food.push(Morsel {
            at,
            amount,
            radius: MORSEL_RADIUS,
        });
    }

    let cells = (width * height).round() as i64;
    let (cast, after_cast) = cast_for(roster, cells, generator);
    generator = after_cast;

    let mut creatures: Vec<Creature> = Vec::new();
    let mut next_id = 1i64;
    for species in &cast {
        let centres: Vec<Point> = creatures.iter().map(|c| c.at).collect();
        let (at, next) = scatter(generator, reef, SPAWN_MARGIN, &centres, SPAWN_MIN_GAP);
        generator = next;
        let (facing, next) = draw_direction(generator);
        generator = next;
        creatures.push(Creature {
            id: next_id,
            species: *species,
            at,
            facing,
            speed: 0.0,
            energy: roster.defs[*species].starting_energy,
            born: 0,
            hidden: false,
            last: ActionResult::Spawned,
        });
        next_id += 1;
    }

    World {
        tick: 0,
        seed: generator,
        reef,
        food,
        kelp,
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
/// the reef holds most of -- `capacity` is a divisor, so a smaller one means
/// a commoner creature -- and no species takes more slots than a reef this
/// size would hold of it.
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

/// One intent per creature, in creature-id order.
///
/// A `map`: every creature is asked the same question about a reef none of
/// them has changed yet, so the answers cannot depend on each other. Every
/// invocation is bounded by `limits`; a creature whose invocation fails
/// (fuel exhausted or a fault) answers `Intent::Rest` and the failure is
/// counted all the same — one broken creature costs its own tick and nothing
/// else.
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
        let (decision, failure) = match &outcome.answer {
            Ok(decision) => (*decision, None),
            Err(why @ Failure::Stopped(Stopped::Fuel)) => {
                cost.failed_fuel += 1;
                (rest(), Some(why.clone()))
            }
            Err(why) => {
                cost.failed_fault += 1;
                (rest(), Some(why.clone()))
            }
        };
        asks.push(Ask {
            id: creature.id,
            decision,
            asked: Asked {
                view,
                observation,
                instructions: outcome.instructions,
                fuel: outcome.fuel,
                failure,
                trace: outcome.events.into_iter().map(|e| e.line).collect(),
            },
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
        facing: creature.facing,
        speed: creature.speed,
        energy: creature.energy,
        age: world.tick - creature.born,
        hidden: creature.hidden,
        last: creature.last.clone(),
    }
}

/// What one creature is shown this tick.
pub(crate) fn look(world: &World, creature: &Creature, roster: &Roster) -> Observation {
    let sight = sight_range(roster.defs[creature.species].role);
    Observation {
        tick: world.tick,
        reef: world.reef,
        sight,
        reach: REACH,
        here: here(world, creature.at),
        sheltered: sheltered_at(world, creature.at),
        nearby: sightings(world, creature, roster, sight),
        food: food_in_sight(world, creature.at, sight),
        kelp: kelp_in_sight(world, creature.at, sight),
    }
}

/// The total amount of every morsel this point is inside.
fn here(world: &World, at: Point) -> f64 {
    world
        .food
        .iter()
        .filter(|morsel| at.distance_to(morsel.at) <= morsel.radius)
        .map(|morsel| morsel.amount)
        .sum()
}

/// Whether this point is inside any kelp bed.
fn sheltered_at(world: &World, at: Point) -> bool {
    world
        .kelp
        .iter()
        .any(|bed| at.distance_to(bed.at) <= bed.radius)
}

/// The creatures this one can see: within its sight, nearest first, lowest
/// id breaking a tie, at most [`NEARBY_LIMIT`] of them.
///
/// A hidden creature is still counted here — it is visible and uncatchable,
/// and `kelpHunter` relies on that distinction, which is why this does not
/// filter `hidden` out the way the old grid world's own sightings did.
fn sightings(world: &World, creature: &Creature, roster: &Roster, sight: f64) -> Vec<Sighting> {
    let mut visible: Vec<Sighting> = world
        .creatures
        .iter()
        .filter(|other| other.id != creature.id)
        .filter_map(|other| {
            let away = creature.at.distance_to(other.at);
            (away <= sight).then_some(Sighting {
                id: other.id,
                species: other.species as i64,
                role: roster.defs[other.species].role,
                at: other.at,
                away,
                facing: other.facing,
                hidden: other.hidden,
            })
        })
        .collect();
    visible.sort_by(|a, b| a.away.total_cmp(&b.away).then_with(|| a.id.cmp(&b.id)));
    visible.truncate(NEARBY_LIMIT);
    visible
}

/// The morsels holding food within sight, nearest first, breaking a tie by
/// position for a stable order rather than by which one is fullest — the
/// species that wants the fullest one asks `instinct.richest` for it.
fn food_in_sight(world: &World, at: Point, sight: f64) -> Vec<creature_host::Morsel> {
    let mut visible: Vec<creature_host::Morsel> = world
        .food
        .iter()
        .filter(|morsel| morsel.amount > 0.0)
        .filter_map(|morsel| {
            let away = at.distance_to(morsel.at);
            (away <= sight).then_some(creature_host::Morsel {
                at: morsel.at,
                amount: morsel.amount,
                radius: morsel.radius,
                away,
            })
        })
        .collect();
    visible.sort_by(|a, b| {
        a.away
            .total_cmp(&b.away)
            .then_with(|| a.at.x.total_cmp(&b.at.x))
            .then_with(|| a.at.y.total_cmp(&b.at.y))
    });
    visible.truncate(FOOD_LIMIT);
    visible
}

/// The kelp beds within sight, same sort as [`food_in_sight`] — a bed counts
/// as in sight when its centre is, not when its edge is.
fn kelp_in_sight(world: &World, at: Point, sight: f64) -> Vec<creature_host::Bed> {
    let mut visible: Vec<creature_host::Bed> = world
        .kelp
        .iter()
        .filter_map(|bed| {
            let away = at.distance_to(bed.at);
            (away <= sight).then_some(creature_host::Bed {
                at: bed.at,
                radius: bed.radius,
                away,
            })
        })
        .collect();
    visible.sort_by(|a, b| {
        a.away
            .total_cmp(&b.away)
            .then_with(|| a.at.x.total_cmp(&b.at.x))
            .then_with(|| a.at.y.total_cmp(&b.at.y))
    });
    visible.truncate(KELP_LIMIT);
    visible
}

/// The prey a hunt names, if it is there to be reached — read out of the reef
/// as it stood when the tick began, and not out of the creature this hunter
/// is becoming.
///
/// Unlike `resolve::admissible`, this does not check the *hunter's* own
/// role: neither does the reference, which means a species program that
/// somehow emitted `Intent::Hunt` without being a hunting role would still
/// have it carried out here. The checker and `admissible` are what keep a
/// well-behaved species from asking, not this.
fn huntable<'a>(
    world: &'a World,
    hunter_at: Point,
    target: i64,
    hunter_id: i64,
    roster: &Roster,
    hunted: &[i64],
) -> Result<&'a Creature, String> {
    let victim = world
        .creatures
        .iter()
        .find(|c| c.id == target)
        .ok_or_else(|| format!("no creature {target} is within reach of creature {hunter_id}"))?;
    if !roster.defs[victim.species].role.is_prey() {
        return Err(format!("creature {target} is not prey"));
    }
    if victim.hidden {
        return Err(format!(
            "creature {target} is hidden in kelp, and no lunge reaches into it"
        ));
    }
    if hunter_at.distance_to(victim.at) > REACH {
        return Err(format!(
            "no creature {target} is within reach of creature {hunter_id}"
        ));
    }
    if hunted.contains(&victim.id) {
        return Err(format!(
            "creature {target} was taken by an earlier hunter this tick"
        ));
    }
    Ok(victim)
}

/// Carries out `asks`, in creature-id order, and answers the world they
/// leave behind.
pub fn resolve(world: &World, asks: &[Ask], roster: &Roster) -> Turn {
    let mut hunted: Vec<i64> = Vec::new();
    let mut food = world.food.clone();
    let mut after: Vec<Creature> = Vec::new();
    let mut outcomes: Vec<CreatureOutcome> = Vec::with_capacity(world.creatures.len());
    let mut refusals = 0i64;
    let mut generator = world.seed;

    for (position, creature) in world.creatures.iter().enumerate() {
        let (ask_id, ask_decision) = ask_at(asks, position);
        let agility = roster.defs[creature.species].agility;
        let cruise = roster.defs[creature.species].cruise;

        // 1: the direction and effort this tick's intent asks for; anything
        // that is not a swim keeps facing steady and asks for no speed.
        let (desired_raw, effort) = match ask_decision.intent {
            Intent::Toward(Aim { at, effort }) => (at.minus(creature.at), effort),
            Intent::Away(Aim { at, effort }) => (creature.at.minus(at), effort),
            _ => (creature.facing, 0.0),
        };
        // 2: a direction with nothing to it keeps the creature's own facing.
        let desired = desired_raw.normalize().unwrap_or(creature.facing);
        // 3: turn only part of the way there.
        let turned = creature
            .facing
            .plus(desired.minus(creature.facing).scaled(agility));
        let facing = turned.normalize().unwrap_or(desired);
        // 4: accelerate toward the target speed by at most ACCEL.
        let target_speed = cruise * effort.clamp(0.0, 1.0);
        let accelerated = creature.speed + (target_speed - creature.speed).clamp(-ACCEL, ACCEL);
        // 5: move, and clamp inside the reef — zeroing whichever component
        // of the velocity hit a wall, so a creature pressed into a corner
        // comes to a stop rather than vibrating against it.
        let velocity = facing.scaled(accelerated);
        let (mut new_x, mut vx) = (creature.at.x + velocity.x, velocity.x);
        let (mut new_y, mut vy) = (creature.at.y + velocity.y, velocity.y);
        if new_x < 0.0 {
            new_x = 0.0;
            vx = 0.0;
        } else if new_x > world.reef.x {
            new_x = world.reef.x;
            vx = 0.0;
        }
        if new_y < 0.0 {
            new_y = 0.0;
            vy = 0.0;
        } else if new_y > world.reef.y {
            new_y = world.reef.y;
            vy = 0.0;
        }
        let new_at = Point::new(new_x, new_y);
        let distance_swum = (vx * vx + vy * vy).sqrt();

        // 6: upkeep always, plus what the swim itself cost.
        let mut energy = creature.energy - UPKEEP - (distance_swum * MOVE_COST).round() as i64;
        let mut hidden = false;

        // 7: the result -- a swim for a swim, or the intent's own.
        let result = if ask_id != creature.id {
            ActionResult::Refused(format!(
                "this intent names creature {ask_id}, and the reef is asking creature {}",
                creature.id
            ))
        } else {
            match ask_decision.intent {
                Intent::Toward(_) | Intent::Away(_) => ActionResult::Swam(distance_swum),
                Intent::Eat => {
                    let nearest = food
                        .iter()
                        .enumerate()
                        .filter(|(_, morsel)| {
                            morsel.amount > 0.0 && new_at.distance_to(morsel.at) <= morsel.radius
                        })
                        .min_by(|(_, a), (_, b)| {
                            new_at
                                .distance_to(a.at)
                                .total_cmp(&new_at.distance_to(b.at))
                        })
                        .map(|(index, _)| index);
                    match nearest {
                        None => ActionResult::Refused(format!(
                            "there is nothing within reach to eat at {:.1},{:.1}",
                            new_at.x, new_at.y
                        )),
                        Some(index) => {
                            let taken = BITE.min(food[index].amount);
                            food[index].amount -= taken;
                            let forage = roster.defs[creature.species].forage as f64;
                            energy += (taken * forage).round() as i64;
                            ActionResult::Ate(taken)
                        }
                    }
                }
                Intent::Hunt(target) => {
                    match huntable(world, new_at, target, creature.id, roster, &hunted) {
                        Err(why) => ActionResult::Refused(why),
                        Ok(victim) => {
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
                }
                Intent::Hide => {
                    if world
                        .kelp
                        .iter()
                        .any(|bed| new_at.distance_to(bed.at) <= bed.radius)
                    {
                        hidden = true;
                        ActionResult::Hid
                    } else {
                        ActionResult::Refused(format!(
                            "there is no cover at {:.1},{:.1}",
                            new_at.x, new_at.y
                        ))
                    }
                }
                Intent::Rest => ActionResult::Rested,
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
            at: new_at,
            facing,
            speed: distance_swum,
            energy,
            born: creature.born,
            hidden,
            last: result.clone(),
        });
        outcomes.push(CreatureOutcome {
            id: creature.id,
            species: creature.species,
            decision: ask_decision,
            result,
        });
    }

    let taken = hunted;
    let mut deaths = 0i64;
    let mut pending = world.pending.clone();
    for creature in &after {
        if creature.energy < 1 || taken.contains(&creature.id) {
            deaths += 1;
            food.push(Morsel {
                at: creature.at,
                amount: CARCASS,
                radius: CARCASS_RADIUS,
            });
            pending.push((creature.species, world.tick + 1 + RESPAWN_DELAY));
        }
    }
    let mut survivors: Vec<Creature> = after
        .into_iter()
        .filter(|c| c.energy > 0 && !taken.contains(&c.id))
        .collect();
    survivors.sort_by_key(|c| c.id);

    let (food, mut new_seed) = regrow(world.reef, food, generator);

    let due: Vec<usize> = pending
        .iter()
        .filter(|(_, at)| *at <= world.tick + 1)
        .map(|(species, _)| *species)
        .collect();
    pending.retain(|(_, at)| *at > world.tick + 1);
    let mut next_id = world.next_id;
    let mut births = 0i64;
    for species in due {
        let centres: Vec<Point> = survivors.iter().map(|c| c.at).collect();
        let (at, next) = scatter(new_seed, world.reef, SPAWN_MARGIN, &centres, SPAWN_MIN_GAP);
        new_seed = next;
        let (facing, next) = draw_direction(new_seed);
        new_seed = next;
        survivors.push(Creature {
            id: next_id,
            species,
            at,
            facing,
            speed: 0.0,
            energy: roster.defs[species].starting_energy,
            born: world.tick + 1,
            hidden: false,
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
            reef: world.reef,
            food,
            kelp: world.kelp.clone(),
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
fn ask_at(asks: &[Ask], at: usize) -> (i64, Decision) {
    asks.get(at)
        .map(|ask| (ask.id, ask.decision))
        .unwrap_or((0, rest()))
}

/// The reef's food after this tick's eating and carcasses: a few morsels the
/// generator names gain amount, up to [`MAX_MORSEL`], and any morsel sitting
/// at zero drifts to a fresh seeded spot and starts small again — food that
/// drifts in patches rather than food that sits in a cell waiting to refill.
fn regrow(reef: Point, mut food: Vec<Morsel>, seed: i64) -> (Vec<Morsel>, i64) {
    let mut generator = seed;

    // Everything goes off a little, including carcasses. This is what bounds
    // the reef's larder: a morsel that reaches nothing is removed rather than
    // moved, and the stock is topped back up below.
    for morsel in food.iter_mut() {
        morsel.amount -= DECAY;
    }
    food.retain(|morsel| morsel.amount > 0.0);

    if !food.is_empty() {
        for _ in 0..REGROWTH_PICKS {
            let drawn = roll(generator, food.len() as i64);
            generator = drawn.seed;
            let index = drawn.value as usize;
            food[index].amount = (food[index].amount + REGROWTH_AMOUNT).min(MAX_MORSEL);
        }
    }

    // Back up to the reef's own stock, wherever the last one went. A carcass
    // is over and above this and is why the count may sit higher for a while
    // after something dies -- which is the point of a carcass.
    while food.len() < MORSELS {
        let others: Vec<Point> = food.iter().map(|morsel| morsel.at).collect();
        let (at, next) = scatter(generator, reef, MORSEL_RADIUS, &others, 0.0);
        generator = next;
        food.push(Morsel {
            at,
            amount: RESPAWN_MORSEL_AMOUNT,
            radius: MORSEL_RADIUS,
        });
    }

    (food, generator)
}

/// The reef one tick later, and what every creature's intent came to in it.
pub fn advance(
    world: &World,
    roster: &Roster,
    sessions: &mut [Session<'_>],
    limits: &Limits,
) -> (Turn, DecisionCost) {
    let (asks, cost) = decisions(world, roster, sessions, limits);
    (resolve(world, &asks, roster), cost)
}

/// The reef one tick later.
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
/// simulation is not deterministic. Every float goes in as
/// [`f64::to_bits`], which is exact and portable — the same bet the
/// arithmetic rule everywhere else in this module makes, since IEEE 754
/// specifies the bit pattern `+ - * / sqrt` produce and not merely the
/// decimal a formatter might round it to.
pub fn hash(world: &World) -> i64 {
    let base = mix(mix(8191i64, bits(world.reef.x)), bits(world.reef.y));
    let ground = world.food.iter().fold(base, |total, morsel| {
        let total = mix(total, bits(morsel.at.x));
        let total = mix(total, bits(morsel.at.y));
        let total = mix(total, bits(morsel.amount));
        mix(total, bits(morsel.radius))
    });
    let sheltered = world.kelp.iter().fold(ground, |total, bed| {
        let total = mix(total, bits(bed.at.x));
        let total = mix(total, bits(bed.at.y));
        mix(total, bits(bed.radius))
    });
    let living = world.creatures.iter().fold(sheltered, |total, creature| {
        let total = mix(total, creature.id);
        let total = mix(total, creature.species as i64 + 1);
        let total = mix(total, bits(creature.at.x));
        let total = mix(total, bits(creature.at.y));
        let total = mix(total, bits(creature.facing.x));
        let total = mix(total, bits(creature.facing.y));
        let total = mix(total, bits(creature.speed));
        mix(total, creature.energy)
    });
    let waiting = world.pending.iter().fold(living, |total, (species, at)| {
        mix(mix(total, *species as i64 + 1), *at)
    });
    mix(mix(mix(waiting, world.tick), world.births), world.deaths)
}

/// A float's exact bit pattern, reinterpreted as `i64` rather than converted
/// — `to_bits` is what makes this exact, and reinterpreting rather than
/// casting the numeric value is what keeps a negative float from silently
/// losing the bits that hash is supposed to be counting.
fn bits(value: f64) -> i64 {
    value.to_bits() as i64
}

/// One value into a running hash.
///
/// Wrapping arithmetic throughout: `bits` can hand this any pattern of 64
/// bits at all, including ones that read as a huge or negative `i64`, and a
/// hash is not an invariant the checked profile's overflow checks should be
/// catching a violation of. `rem_euclid` keeps the running total in a
/// well-defined nonnegative range for the next fold either way.
fn mix(total: i64, value: i64) -> i64 {
    total
        .wrapping_mul(131)
        .wrapping_add(value)
        .wrapping_add(1)
        .rem_euclid(2_147_483_647)
}

/// What is alive, what it is doing, and what has happened so far.
#[derive(Clone, Debug)]
pub struct Census {
    pub tick: i64,
    pub alive: i64,
    /// Population per catalog index.
    pub per_species: Vec<i64>,
    pub food: f64,
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
        food: world.food.iter().map(|m| m.amount).sum(),
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
pub fn index_by_id(world: &World) -> std::collections::HashMap<i64, usize> {
    world
        .creatures
        .iter()
        .enumerate()
        .map(|(index, creature)| (creature.id, index))
        .collect()
}
