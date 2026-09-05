//! The Rust side of `catalog/contract/contract.cove`, field for field.
//!
//! Every type here mirrors one the contract declares, and the mirroring is
//! not a convenience: `Vm::invoke` checks an argument against the signature
//! the checker resolved before the first instruction, following a declared
//! struct into its fields, in the order the declaration lists them. The
//! lowering spends the checker's answer and reads a field by index, so a
//! struct built with one field missing would have the machine read past the
//! end of another, and a struct built with the right fields in the wrong
//! order would answer the wrong one with no sign of it. That is refused
//! rather than tolerated, which is why the order of [`SelfView::to_cove`]'s
//! list is load-bearing and is written next to the declaration it copies.
//!
//! Nothing downstream of [`Decision::of`] holds a [`Value`]. The simulation
//! acts on these types.
//!
//! # The reef is continuous
//!
//! A place is two [`f64`]s and not two cells, and every arithmetic operation
//! on one is `+ - * /` or [`f64::sqrt`] — the same rule `contract.cove`
//! states for the Cove side of this boundary, and for the same reason: IEEE
//! 754 specifies those exactly and every conforming machine agrees, so a
//! shared replay link's bet that the same seed makes the same world on
//! somebody else's computer is a bet those operations, and only those, can
//! win.

use cove_runtime::value::Value;

/// The module the contract is compiled as, and therefore the prefix every
/// declared type name carries across the boundary.
const CONTRACT: &str = "contract";

/// A place in the reef, and also a direction from one place to another.
///
/// One type for both, mirroring `contract.cove`'s own choice: a direction is
/// what the difference of two places is, and a second Rust struct with the
/// same two fields would only make every conversion between them a place
/// this port could disagree with itself.
#[derive(Clone, Copy, Debug, PartialEq)]
pub struct Point {
    pub x: f64,
    pub y: f64,
}

impl Point {
    pub const ZERO: Point = Point { x: 0.0, y: 0.0 };

    pub fn new(x: f64, y: f64) -> Point {
        Point { x, y }
    }

    /// The two added.
    pub fn plus(self, other: Point) -> Point {
        Point {
            x: self.x + other.x,
            y: self.y + other.y,
        }
    }

    /// The direction from `other` to here.
    pub fn minus(self, other: Point) -> Point {
        Point {
            x: self.x - other.x,
            y: self.y - other.y,
        }
    }

    /// This direction, `by` times as long.
    pub fn scaled(self, by: f64) -> Point {
        Point {
            x: self.x * by,
            y: self.y * by,
        }
    }

    /// How far `other` is from here, squared.
    pub fn squared_to(self, other: Point) -> f64 {
        let dx = self.x - other.x;
        let dy = self.y - other.y;
        dx * dx + dy * dy
    }

    /// This point's distance from the origin, squared.
    pub fn squared_length(self) -> f64 {
        self.x * self.x + self.y * self.y
    }

    /// How far `other` is from here, for real — the one place in the host
    /// that is allowed to take a square root of a distance and hand it to a
    /// creature, per `contract.cove`'s rule.
    pub fn distance_to(self, other: Point) -> f64 {
        self.squared_to(other).sqrt()
    }

    /// This direction, one unit long, or `None` when it is too short to have
    /// a meaningful direction at all.
    ///
    /// The host's own sqrt, and the only place in this module that takes
    /// one: everything a creature is shown is either an already-square-rooted
    /// distance or a vector a creature never has to normalise itself, because
    /// the language it is written in has no square root to normalise one
    /// with.
    pub fn normalize(self) -> Option<Point> {
        let length = self.squared_length().sqrt();
        if length > 1e-9 {
            Some(Point {
                x: self.x / length,
                y: self.y / length,
            })
        } else {
            None
        }
    }

    fn to_cove(self) -> Value {
        Value::structure(
            format!("{CONTRACT}.Point"),
            vec![("x", Value::float(self.x)), ("y", Value::float(self.y))],
        )
    }

    fn of(value: &Value) -> Result<Point, String> {
        Ok(Point {
            x: float(field(value, "x")?)?,
            y: float(field(value, "y")?)?,
        })
    }
}

/// What a creature does for a living.
#[derive(Clone, Copy, Debug, PartialEq, Eq, PartialOrd, Ord, Hash)]
pub enum Role {
    Grazer,
    Ambusher,
    Hunter,
    Scavenger,
    Cooperator,
    Wildcard,
}

impl Role {
    /// The case name the contract declares.
    pub fn case(self) -> &'static str {
        match self {
            Role::Grazer => "Grazer",
            Role::Ambusher => "Ambusher",
            Role::Hunter => "Hunter",
            Role::Scavenger => "Scavenger",
            Role::Cooperator => "Cooperator",
            Role::Wildcard => "Wildcard",
        }
    }

    /// Whether a creature in this role hunts other creatures.
    ///
    /// The same answer `Role.hunts` gives in Cove. Two copies of one rule is
    /// one copy too many, and this one exists because the world resolves a
    /// hunt and the world is written here; the test
    /// `both_sides_agree_about_who_hunts` is what keeps them the same rule.
    pub fn hunts(self) -> bool {
        matches!(self, Role::Ambusher | Role::Hunter)
    }

    /// Whether a hunter will chase a creature in this role.
    pub fn is_prey(self) -> bool {
        matches!(
            self,
            Role::Grazer | Role::Scavenger | Role::Cooperator | Role::Wildcard
        )
    }

    fn to_cove(self) -> Value {
        Value::enumeration(format!("{CONTRACT}.Role"), self.case(), [])
    }
}

/// What the world did with an intent.
#[derive(Clone, Debug, PartialEq)]
pub enum ActionResult {
    Spawned,
    /// It moved, this far.
    Swam(f64),
    /// It ate this much.
    Ate(f64),
    Hunted(i64),
    Missed(i64),
    Hid,
    Rested,
    Refused(String),
}

impl ActionResult {
    fn to_cove(&self) -> Value {
        let name = format!("{CONTRACT}.ActionResult");
        match self {
            ActionResult::Spawned => Value::enumeration(name, "Spawned", []),
            ActionResult::Swam(distance) => {
                Value::enumeration(name, "Swam", [Value::float(*distance)])
            }
            ActionResult::Ate(amount) => Value::enumeration(name, "Ate", [Value::float(*amount)]),
            ActionResult::Hunted(n) => Value::enumeration(name, "Hunted", [Value::int(*n)]),
            ActionResult::Missed(n) => Value::enumeration(name, "Missed", [Value::int(*n)]),
            ActionResult::Hid => Value::enumeration(name, "Hid", []),
            ActionResult::Rested => Value::enumeration(name, "Rested", []),
            ActionResult::Refused(why) => {
                Value::enumeration(name, "Refused", [Value::string(why.as_str())])
            }
        }
    }

    /// Why the world refused this intent, for a result that is a refusal.
    ///
    /// The mirror of `ActionResult.refusal`. It is the whole of what a visitor
    /// can be told about an intent the world declined: a refusal without its
    /// sentence is a word with no reason attached to it.
    pub fn refusal(&self) -> Option<&str> {
        match self {
            ActionResult::Refused(why) => Some(why.as_str()),
            _ => None,
        }
    }

    /// The word this result is written with, matching `ActionResult.name`.
    pub fn name(&self) -> String {
        match self {
            ActionResult::Spawned => "spawned".to_string(),
            ActionResult::Swam(_) => "swam".to_string(),
            ActionResult::Ate(_) => "ate".to_string(),
            ActionResult::Hunted(n) => format!("hunted-{n}"),
            ActionResult::Missed(n) => format!("missed-{n}"),
            ActionResult::Hid => "hid".to_string(),
            ActionResult::Rested => "rested".to_string(),
            ActionResult::Refused(_) => "refused".to_string(),
        }
    }
}

/// What a creature is told about itself.
#[derive(Clone, Debug, PartialEq)]
pub struct SelfView {
    pub id: i64,
    pub species: i64,
    pub role: Role,
    pub at: Point,
    pub facing: Point,
    pub speed: f64,
    pub energy: i64,
    pub age: i64,
    pub hidden: bool,
    pub last: ActionResult,
}

impl SelfView {
    /// This view as the struct value `contract.SelfView` names.
    ///
    /// Ten fields, in the order the declaration lists them. Adding one to
    /// the contract without adding it here is refused at the boundary rather
    /// than read past.
    pub fn to_cove(&self) -> Value {
        Value::structure(
            format!("{CONTRACT}.SelfView"),
            vec![
                ("id", Value::int(self.id)),
                ("species", Value::int(self.species)),
                ("role", self.role.to_cove()),
                ("at", self.at.to_cove()),
                ("facing", self.facing.to_cove()),
                ("speed", Value::float(self.speed)),
                ("energy", Value::int(self.energy)),
                ("age", Value::int(self.age)),
                ("hidden", Value::bool(self.hidden)),
                ("last", self.last.to_cove()),
            ],
        )
    }
}

/// Another creature, as this one can see it.
#[derive(Clone, Copy, Debug, PartialEq)]
pub struct Sighting {
    pub id: i64,
    pub species: i64,
    pub role: Role,
    pub at: Point,
    pub away: f64,
    pub facing: Point,
    pub hidden: bool,
}

impl Sighting {
    fn to_cove(self) -> Value {
        Value::structure(
            format!("{CONTRACT}.Sighting"),
            vec![
                ("id", Value::int(self.id)),
                ("species", Value::int(self.species)),
                ("role", self.role.to_cove()),
                ("at", self.at.to_cove()),
                ("away", Value::float(self.away)),
                ("facing", self.facing.to_cove()),
                ("hidden", Value::bool(self.hidden)),
            ],
        )
    }
}

/// Something to eat, as this creature can see it.
#[derive(Clone, Copy, Debug, PartialEq)]
pub struct Morsel {
    pub at: Point,
    pub amount: f64,
    pub radius: f64,
    pub away: f64,
}

impl Morsel {
    fn to_cove(self) -> Value {
        Value::structure(
            format!("{CONTRACT}.Morsel"),
            vec![
                ("at", self.at.to_cove()),
                ("amount", Value::float(self.amount)),
                ("radius", Value::float(self.radius)),
                ("away", Value::float(self.away)),
            ],
        )
    }
}

/// A bed of kelp, as this creature can see it.
#[derive(Clone, Copy, Debug, PartialEq)]
pub struct Bed {
    pub at: Point,
    pub radius: f64,
    pub away: f64,
}

impl Bed {
    fn to_cove(self) -> Value {
        Value::structure(
            format!("{CONTRACT}.Bed"),
            vec![
                ("at", self.at.to_cove()),
                ("radius", Value::float(self.radius)),
                ("away", Value::float(self.away)),
            ],
        )
    }
}

/// Everything a creature is told about the reef this tick.
#[derive(Clone, Debug, PartialEq)]
pub struct Observation {
    pub tick: i64,
    /// The far corner of the reef. The near one is the origin.
    pub reef: Point,
    pub sight: f64,
    pub reach: f64,
    pub here: f64,
    pub sheltered: bool,
    pub nearby: Vec<Sighting>,
    pub food: Vec<Morsel>,
    pub kelp: Vec<Bed>,
}

impl Observation {
    /// This observation as the struct value `contract.Observation` names.
    pub fn to_cove(&self) -> Value {
        Value::structure(
            format!("{CONTRACT}.Observation"),
            vec![
                ("tick", Value::int(self.tick)),
                ("reef", self.reef.to_cove()),
                ("sight", Value::float(self.sight)),
                ("reach", Value::float(self.reach)),
                ("here", Value::float(self.here)),
                ("sheltered", Value::bool(self.sheltered)),
                (
                    "nearby",
                    Value::array(self.nearby.iter().copied().map(Sighting::to_cove)),
                ),
                (
                    "food",
                    Value::array(self.food.iter().copied().map(Morsel::to_cove)),
                ),
                (
                    "kelp",
                    Value::array(self.kelp.iter().copied().map(Bed::to_cove)),
                ),
            ],
        )
    }
}

/// Where a creature is going and how hard it is trying.
#[derive(Clone, Copy, Debug, PartialEq)]
pub struct Aim {
    pub at: Point,
    pub effort: f64,
}

impl Aim {
    fn of(value: &Value) -> Result<Aim, String> {
        Ok(Aim {
            at: Point::of(field(value, "at")?)?,
            effort: float(field(value, "effort")?)?,
        })
    }
}

/// The one thing a behaviour asks the reef for this tick.
#[derive(Clone, Copy, Debug, PartialEq)]
pub enum Intent {
    Toward(Aim),
    Away(Aim),
    Eat,
    Hunt(i64),
    Hide,
    Rest,
}

impl Intent {
    /// The word this intent is written with, matching `Intent.name`.
    pub fn name(self) -> String {
        match self {
            Intent::Toward(_) => "toward".to_string(),
            Intent::Away(_) => "away".to_string(),
            Intent::Eat => "eat".to_string(),
            Intent::Hunt(id) => format!("hunt-{id}"),
            Intent::Hide => "hide".to_string(),
            Intent::Rest => "rest".to_string(),
        }
    }

    fn of(value: &Value) -> Result<Intent, String> {
        let payload = value.payload().unwrap_or(&[]);
        match case(value)? {
            "Toward" => Ok(Intent::Toward(Aim::of(one(payload, "Toward")?)?)),
            "Away" => Ok(Intent::Away(Aim::of(one(payload, "Away")?)?)),
            "Eat" => Ok(Intent::Eat),
            "Hunt" => Ok(Intent::Hunt(int(one(payload, "Hunt")?)?)),
            "Hide" => Ok(Intent::Hide),
            "Rest" => Ok(Intent::Rest),
            other => Err(format!("`{other}` is not an intent")),
        }
    }
}

/// Why a behaviour asked for what it asked for.
#[derive(Clone, Copy, Debug, PartialEq, Eq, PartialOrd, Ord, Hash)]
pub enum Reason {
    FleeingThreat,
    SeekingFood,
    Feeding,
    Sheltering,
    Hunting,
    Crowded,
    Exploring,
    Waiting,
}

impl Reason {
    /// The stable identifier this reason is written with, matching
    /// `Reason.name`. The interface turns it into a sentence; this is not
    /// that sentence.
    pub fn name(self) -> &'static str {
        match self {
            Reason::FleeingThreat => "fleeing_threat",
            Reason::SeekingFood => "seeking_food",
            Reason::Feeding => "feeding",
            Reason::Sheltering => "sheltering",
            Reason::Hunting => "hunting",
            Reason::Crowded => "crowded",
            Reason::Exploring => "exploring",
            Reason::Waiting => "waiting",
        }
    }

    fn of(value: &Value) -> Result<Reason, String> {
        match case(value)? {
            "FleeingThreat" => Ok(Reason::FleeingThreat),
            "SeekingFood" => Ok(Reason::SeekingFood),
            "Feeding" => Ok(Reason::Feeding),
            "Sheltering" => Ok(Reason::Sheltering),
            "Hunting" => Ok(Reason::Hunting),
            "Crowded" => Ok(Reason::Crowded),
            "Exploring" => Ok(Reason::Exploring),
            "Waiting" => Ok(Reason::Waiting),
            other => Err(format!("`{other}` is not a reason")),
        }
    }
}

/// What one creature answered one tick with.
#[derive(Clone, Copy, Debug, PartialEq)]
pub struct Decision {
    pub intent: Intent,
    pub reason: Reason,
}

impl Decision {
    /// Reads a decision out of what an invocation answered.
    ///
    /// This is the only place a `Value` becomes something the simulation
    /// acts on, and it is where an answer that is not a decision this host
    /// understands is turned into an error rather than into a guess. A
    /// creature whose answer does not read here is refused its tick; it does
    /// not stop the world.
    pub fn of(value: &Value) -> Result<Decision, String> {
        Ok(Decision {
            intent: Intent::of(field(value, "intent")?)?,
            reason: Reason::of(field(value, "reason")?)?,
        })
    }

    /// This decision, written the way a report writes one, matching
    /// `Decision.line`.
    pub fn line(&self) -> String {
        format!("{} because={}", self.intent.name(), self.reason.name())
    }
}

fn field<'v>(value: &'v Value, name: &str) -> Result<&'v Value, String> {
    value
        .field(name)
        .ok_or_else(|| format!("no `{name}` in {}", value.type_name()))
}

fn case(value: &Value) -> Result<&str, String> {
    value
        .case()
        .ok_or_else(|| format!("{} is not an enum case", value.type_name()))
}

fn one<'v>(payload: &'v [Value], case: &str) -> Result<&'v Value, String> {
    payload
        .first()
        .ok_or_else(|| format!("`{case}` carries nothing"))
}

fn int(value: &Value) -> Result<i64, String> {
    value
        .as_int()
        .ok_or_else(|| format!("{} is not an Int", value.type_name()))
}

fn float(value: &Value) -> Result<f64, String> {
    value
        .as_float()
        .ok_or_else(|| format!("{} is not a Float", value.type_name()))
}
