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

use cove_runtime::value::Value;

/// The module the contract is compiled as, and therefore the prefix every
/// declared type name carries across the boundary.
const CONTRACT: &str = "contract";

/// A place in the grid, and also a step from one place to another.
#[derive(Clone, Copy, Debug, PartialEq, Eq, PartialOrd, Ord, Hash)]
pub struct Cell {
    pub x: i64,
    pub y: i64,
}

impl Cell {
    fn to_cove(self) -> Value {
        Value::structure(
            format!("{CONTRACT}.Cell"),
            vec![("x", Value::int(self.x)), ("y", Value::int(self.y))],
        )
    }
}

/// The four directions a step may take.
#[derive(Clone, Copy, Debug, PartialEq, Eq, PartialOrd, Ord, Hash)]
pub enum Heading {
    North,
    East,
    South,
    West,
}

impl Heading {
    /// The case name the contract declares, which is what crosses.
    pub fn case(self) -> &'static str {
        match self {
            Heading::North => "North",
            Heading::East => "East",
            Heading::South => "South",
            Heading::West => "West",
        }
    }

    /// The word a report writes this heading with, matching `Heading.name`.
    pub fn name(self) -> &'static str {
        match self {
            Heading::North => "north",
            Heading::East => "east",
            Heading::South => "south",
            Heading::West => "west",
        }
    }

    fn to_cove(self) -> Value {
        Value::enumeration(format!("{CONTRACT}.Heading"), self.case(), [])
    }

    fn of(value: &Value) -> Result<Heading, String> {
        match case(value)? {
            "North" => Ok(Heading::North),
            "East" => Ok(Heading::East),
            "South" => Ok(Heading::South),
            "West" => Ok(Heading::West),
            other => Err(format!("`{other}` is not a heading")),
        }
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
#[derive(Clone, Debug, PartialEq, Eq)]
pub enum ActionResult {
    Spawned,
    Moved(Heading),
    Blocked(Heading),
    Ate(i64),
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
            ActionResult::Moved(h) => Value::enumeration(name, "Moved", [h.to_cove()]),
            ActionResult::Blocked(h) => Value::enumeration(name, "Blocked", [h.to_cove()]),
            ActionResult::Ate(n) => Value::enumeration(name, "Ate", [Value::int(*n)]),
            ActionResult::Hunted(n) => Value::enumeration(name, "Hunted", [Value::int(*n)]),
            ActionResult::Missed(n) => Value::enumeration(name, "Missed", [Value::int(*n)]),
            ActionResult::Hid => Value::enumeration(name, "Hid", []),
            ActionResult::Rested => Value::enumeration(name, "Rested", []),
            ActionResult::Refused(why) => {
                Value::enumeration(name, "Refused", [Value::string(why.as_str())])
            }
        }
    }

    /// The word this result is written with, matching `ActionResult.name`.
    pub fn name(&self) -> String {
        match self {
            ActionResult::Spawned => "spawned".to_string(),
            ActionResult::Moved(h) => format!("moved-{}", h.name()),
            ActionResult::Blocked(h) => format!("blocked-{}", h.name()),
            ActionResult::Ate(n) => format!("ate-{n}"),
            ActionResult::Hunted(n) => format!("hunted-{n}"),
            ActionResult::Missed(n) => format!("missed-{n}"),
            ActionResult::Hid => "hid".to_string(),
            ActionResult::Rested => "rested".to_string(),
            ActionResult::Refused(_) => "refused".to_string(),
        }
    }
}

/// What a creature is told about itself.
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct SelfView {
    pub id: i64,
    pub species: i64,
    pub role: Role,
    pub at: Cell,
    pub energy: i64,
    pub age: i64,
    pub hidden: bool,
    pub last: ActionResult,
}

impl SelfView {
    /// This view as the struct value `contract.SelfView` names.
    ///
    /// Eight fields, in the order the declaration lists them. Adding one to
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
                ("energy", Value::int(self.energy)),
                ("age", Value::int(self.age)),
                ("hidden", Value::bool(self.hidden)),
                ("last", self.last.to_cove()),
            ],
        )
    }
}

/// Another creature, as this one can see it.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub struct Sighting {
    pub id: i64,
    pub species: i64,
    pub role: Role,
    pub at: Cell,
    pub away: i64,
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
                ("away", Value::int(self.away)),
                ("hidden", Value::bool(self.hidden)),
            ],
        )
    }
}

/// One of the four cells a creature could step onto.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub struct Patch {
    pub heading: Heading,
    pub at: Cell,
    pub food: i64,
    pub shelter: bool,
    pub outside: bool,
    pub occupied: bool,
}

impl Patch {
    fn to_cove(self) -> Value {
        Value::structure(
            format!("{CONTRACT}.Patch"),
            vec![
                ("heading", self.heading.to_cove()),
                ("at", self.at.to_cove()),
                ("food", Value::int(self.food)),
                ("shelter", Value::bool(self.shelter)),
                ("outside", Value::bool(self.outside)),
                ("occupied", Value::bool(self.occupied)),
            ],
        )
    }
}

/// Everything a creature is told about the world this tick.
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct Observation {
    pub tick: i64,
    pub here: i64,
    pub shelter: bool,
    pub around: Vec<Patch>,
    pub nearby: Vec<Sighting>,
    pub scent: Option<Heading>,
}

impl Observation {
    /// This observation as the struct value `contract.Observation` names.
    pub fn to_cove(&self) -> Value {
        Value::structure(
            format!("{CONTRACT}.Observation"),
            vec![
                ("tick", Value::int(self.tick)),
                ("here", Value::int(self.here)),
                ("shelter", Value::bool(self.shelter)),
                (
                    "around",
                    Value::array(self.around.iter().copied().map(Patch::to_cove)),
                ),
                (
                    "nearby",
                    Value::array(self.nearby.iter().copied().map(Sighting::to_cove)),
                ),
                (
                    "scent",
                    match self.scent {
                        Some(heading) => Value::some(heading.to_cove()),
                        None => Value::none(),
                    },
                ),
            ],
        )
    }
}

/// The one thing a behaviour asks the world for this tick.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum Intent {
    Move(Heading),
    Eat,
    Hunt(i64),
    Hide,
    Rest,
}

impl Intent {
    /// The word this intent is written with, matching `Intent.name`.
    pub fn name(self) -> String {
        match self {
            Intent::Move(h) => format!("move-{}", h.name()),
            Intent::Eat => "eat".to_string(),
            Intent::Hunt(id) => format!("hunt-{id}"),
            Intent::Hide => "hide".to_string(),
            Intent::Rest => "rest".to_string(),
        }
    }

    fn of(value: &Value) -> Result<Intent, String> {
        let payload = value.payload().unwrap_or(&[]);
        match case(value)? {
            "Move" => Ok(Intent::Move(Heading::of(one(payload, "Move")?)?)),
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
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
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
