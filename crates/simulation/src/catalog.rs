//! Reading `species.toml`, and building the four sessions a world of four
//! species runs against.

use std::path::Path;

use creature_host::{Habitat, Lowering, Role, Session, Species};
use serde::Deserialize;

/// The catalog entries this simulation drives, in the order they become
/// species index `0..4`.
///
/// Any order is as good as any other — nothing here depends on it — but it
/// has to be fixed and it has to be the order [`Roster::load`] is called
/// with, because `World::species` is this position and nothing names it back
/// to a string after that.
pub const SPECIES_IDS: [&str; 4] = ["reefGrazer", "kelpHunter", "shyScavenger", "hermitCrab"];

/// What `species.toml` costs a creature of this species, and what it does
/// for a living.
///
/// Parsed straight from the catalog file rather than hand-transcribed,
/// because a number copied by hand is a number that can drift from the file
/// that is supposedly the source of it.
#[derive(Clone, Debug)]
pub struct SpeciesDef {
    pub id: String,
    pub name: String,
    pub role: Role,
    /// What a creature of this species starts with.
    pub starting_energy: i64,
    /// Top speed, in reef units per tick.
    pub cruise: f64,
    /// How much of the way to a new direction this species turns in one
    /// tick, `0..1`.
    ///
    /// A hunter is fast and turns badly; a crab is slow and turns on the
    /// spot. That asymmetry is what makes a chase watchable, so it is a
    /// per-species number and not a reef-wide constant.
    pub agility: f64,
    /// What one unit of food is worth to this species.
    pub forage: i64,
    /// A divisor: the most slots a reef of `cells` square units gives this
    /// species is `cells / capacity`, which is how a cast is weighted towards
    /// the creatures a reef holds most of.
    pub capacity: i64,
    /// How the tank draws one.
    pub visual: VisualDef,
}

/// How a species is drawn.
///
/// A shape as well as a colour, because a tank told apart by hue alone is a
/// tank a colour-blind visitor cannot read, and the acceptance criteria say
/// every species must be visually distinguishable.
#[derive(Clone, Debug)]
pub struct VisualDef {
    pub colour: String,
    pub shape: String,
    pub size: i64,
}

#[derive(Deserialize)]
struct RawFile {
    id: String,
    name: String,
    role: String,
    traits: RawTraits,
    visual: RawVisual,
}

#[derive(Deserialize)]
struct RawVisual {
    colour: String,
    shape: String,
    size: i64,
}

#[derive(Deserialize)]
struct RawTraits {
    #[serde(rename = "startingEnergy")]
    starting_energy: i64,
    cruise: f64,
    agility: f64,
    forage: i64,
    capacity: i64,
}

impl SpeciesDef {
    /// Reads `catalog_dir/species/<id>/species.toml`.
    pub fn load(catalog_dir: &Path, id: &str) -> Result<SpeciesDef, String> {
        let path = catalog_dir.join("species").join(id).join("species.toml");
        let text = std::fs::read_to_string(&path)
            .map_err(|e| format!("cannot read {}: {e}", path.display()))?;
        SpeciesDef::parse(&text, &path.display().to_string())
    }

    /// The same, over text a caller already holds.
    ///
    /// `named` is what a parse failure is reported against. It exists for the
    /// browser, which has no filesystem to read a catalog off and carries one
    /// compiled into the module by `include_str!` instead.
    pub fn parse(text: &str, named: &str) -> Result<SpeciesDef, String> {
        let raw: RawFile =
            toml::from_str(text).map_err(|e| format!("cannot parse {named}: {e}"))?;
        Ok(SpeciesDef {
            id: raw.id,
            name: raw.name,
            role: role_of(&raw.role)?,
            starting_energy: raw.traits.starting_energy,
            cruise: raw.traits.cruise,
            agility: raw.traits.agility,
            forage: raw.traits.forage,
            capacity: raw.traits.capacity,
            visual: VisualDef {
                colour: raw.visual.colour,
                shape: raw.visual.shape,
                size: raw.visual.size,
            },
        })
    }
}

fn role_of(name: &str) -> Result<Role, String> {
    match name {
        "Grazer" => Ok(Role::Grazer),
        "Ambusher" => Ok(Role::Ambusher),
        "Hunter" => Ok(Role::Hunter),
        "Scavenger" => Ok(Role::Scavenger),
        "Cooperator" => Ok(Role::Cooperator),
        "Wildcard" => Ok(Role::Wildcard),
        other => Err(format!("`{other}` is not a role `contract.cove` declares")),
    }
}

/// Every species this world's catalog draws creatures from, in the order
/// their catalog index names.
pub struct Roster {
    pub defs: Vec<SpeciesDef>,
}

impl Roster {
    /// Loads `species.toml` for every id in `ids`, in order.
    pub fn load(catalog_dir: &Path, ids: &[&str]) -> Result<Roster, String> {
        let defs = ids
            .iter()
            .map(|id| SpeciesDef::load(catalog_dir, id))
            .collect::<Result<Vec<_>, _>>()?;
        Ok(Roster { defs })
    }

    /// The default four-species catalog: [`SPECIES_IDS`].
    pub fn load_default(catalog_dir: &Path) -> Result<Roster, String> {
        Roster::load(catalog_dir, &SPECIES_IDS)
    }

    /// A roster over definitions a caller already holds, in the order their
    /// catalog index names.
    pub fn of(defs: Vec<SpeciesDef>) -> Roster {
        Roster { defs }
    }

    /// How many species this roster holds.
    pub fn len(&self) -> usize {
        self.defs.len()
    }

    pub fn is_empty(&self) -> bool {
        self.defs.is_empty()
    }

    /// The most creatures of this species index the world holds at once,
    /// over a reef of `cells` square units.
    pub fn capacity(&self, species: usize, cells: i64) -> i64 {
        cells / self.defs[species].capacity
    }
}

/// Loads, lowers, and serves every species in `roster`, and hands the
/// sessions to `body`.
///
/// Four separate locals — `species`, `lowerings`, `habitats`, `sessions` —
/// built in that order and held alive for exactly as long as `body` runs.
/// None of them borrows itself: a `Vm` borrows a `Runtime`
/// ([`creature_host::Habitat`] owns one) and a lowered program
/// ([`creature_host::Lowering`]), so building the four as an ordinary chain
/// of locals is enough, and `body` runs where every one of them is still in
/// scope. [`creature_host::Species::serve`] is this shape for one species;
/// this is what a world of several needs and what nesting `serve` four deep
/// would not give cleanly — the innermost closure would be the whole
/// simulation.
pub fn serve_all<T>(
    catalog_dir: &Path,
    roster: &Roster,
    body: impl FnOnce(&mut [Session<'_>]) -> T,
) -> Result<T, String> {
    let species: Vec<Species> = roster
        .defs
        .iter()
        .map(|def| Species::load(catalog_dir, &def.id))
        .collect::<Result<_, _>>()?;
    let lowerings: Vec<Lowering> = species
        .iter()
        .map(Species::lower)
        .collect::<Result<_, _>>()?;
    let habitats: Vec<Habitat> = species.iter().map(Species::habitat).collect();
    let mut sessions: Vec<Session<'_>> = habitats
        .iter()
        .zip(lowerings.iter())
        .map(|(habitat, lowering)| habitat.session(lowering))
        .collect();
    Ok(body(&mut sessions))
}
