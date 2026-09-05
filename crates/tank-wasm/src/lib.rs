//! The tank, as one WebAssembly module a browser can drive.
//!
//! Everything here is the same simulation `crates/simulation` runs natively,
//! compiled for `wasm32-unknown-unknown` with the Cove runtime inside it. The
//! browser holds no logic: it asks for a tick and draws what it is given.
//!
//! # What crossing to wasm costs, and what it does not
//!
//! Not the language. `cove-runtime` compiles for `wasm32-unknown-unknown` as
//! it stands, and this module links it directly rather than going through
//! Cove's own playground ABI, which always compiles a source string and runs
//! a hardcoded entry with no arguments. Three things are conditions rather
//! than costs:
//!
//! - **The catalog is compiled in.** `wasm32-unknown-unknown` has no
//!   filesystem, so the Cove source and the metadata arrive by `include_str!`
//!   and [`creature_host::Species::from_units`] rather than off a disk that is
//!   not there. That also means the module *is* the catalog version: a
//!   different catalog is a different module, which is what a replay wanted
//!   anyway.
//! - **The host must supply `cove.cove_now_millis() -> f64`.** It is not
//!   optional and not defaulted; a module instantiated without it fails to
//!   instantiate, loudly. Nothing here reads it — no deadline is ever set,
//!   because a deadline reads a wall clock and no replay can reproduce one —
//!   but `cove-runtime` imports it unconditionally.
//! - **No Cove task may be spawned.** `wasm32` refuses `spawn` outright. It
//!   costs nothing, because a creature is a pure function of its two
//!   arguments.
//!
//! # The ABI
//!
//! Seven `extern "C"` functions and no binding generator, which is the choice
//! `crates/cove-wasm` made in the cove repository for the reason it gives
//! there: a generator would be the largest dependency in the tree. A caller
//! writes nothing into the module; it asks for a tank and reads
//! length-prefixed UTF-8 JSON back out.
//!
//! A blob is a little-endian `u32` length followed by that many bytes. The
//! caller reads it and hands the pointer back to [`tank_free`].
//!
//! # One tank per module
//!
//! Held in a `thread_local`, because there is one page and one tank on it.
//! Sessions borrow habitats and lowerings that are leaked once at open, which
//! is not a leak in the sense that matters: they live exactly as long as the
//! module does, and a tank re-opened on a new seed reuses them rather than
//! leaking again — the compiled species is the expensive thing and reopening
//! is the cheap thing, which is what compile-once/invoke-many buys.

use std::cell::RefCell;
use std::path::PathBuf;

use creature_host::{Failure, Habitat, Limits, Lowering, Session, Species, Stopped};
use simulation::catalog::{Roster, SpeciesDef};
use simulation::world::{decisions, new_world, resolve, Ask, CreatureOutcome, World};

/// The contract every species is compiled against, and the moves any of them
/// could make. One copy, shared by every species in the catalog, exactly as
/// on disk.
const CONTRACT: &str = include_str!("../../../catalog/contract/contract.cove");
const INSTINCT: &str = include_str!("../../../catalog/instinct/instinct.cove");

/// The catalog: an id, its metadata, and its behaviour.
///
/// Written out rather than globbed because `include_str!` needs a literal.
/// Adding a species to the catalog means adding a line here, and the test
/// `the_embedded_catalog_matches_the_one_on_disk` is what says so when
/// somebody forgets.
const CATALOG: &[(&str, &str, &str)] = &[
    (
        "reefGrazer",
        include_str!("../../../catalog/species/reefGrazer/species.toml"),
        include_str!("../../../catalog/species/reefGrazer/creature.cove"),
    ),
    (
        "kelpHunter",
        include_str!("../../../catalog/species/kelpHunter/species.toml"),
        include_str!("../../../catalog/species/kelpHunter/creature.cove"),
    ),
    (
        "shyScavenger",
        include_str!("../../../catalog/species/shyScavenger/species.toml"),
        include_str!("../../../catalog/species/shyScavenger/creature.cove"),
    ),
    (
        "hermitCrab",
        include_str!("../../../catalog/species/hermitCrab/species.toml"),
        include_str!("../../../catalog/species/hermitCrab/creature.cove"),
    ),
];

/// One open tank.
struct Tank {
    roster: Roster,
    sessions: Vec<Session<'static>>,
    world: World,
    /// What every creature asked for and what the world did, from the tick
    /// just resolved. Empty before the first one.
    last: Vec<CreatureOutcome>,
    /// Every invocation of the tick just resolved, kept whole.
    ///
    /// For every creature and not only the watched one, because a visitor
    /// clicks a creature *after* seeing it do something. Something kept only
    /// for the selection is something nobody can ever ask about at the moment
    /// they want to.
    asked: Vec<Ask>,
    /// Which creature the page is inspecting, if any.
    focus: Option<i64>,
    limits: Limits,
    /// What the last tick spent, as `decisions` reported it.
    cost: simulation::world::DecisionCost,
}

thread_local! {
    static TANK: RefCell<Option<Tank>> = const { RefCell::new(None) };
    static ERROR: RefCell<String> = const { RefCell::new(String::new()) };
}

/// Compiles the catalog once and keeps it for the life of the module.
///
/// The sessions are `'static` because the habitats and lowerings they borrow
/// are leaked, and they are leaked because a tank lives as long as the page
/// does. Doing it once and holding it is the whole point: compiling is worth
/// about a hundred and sixty-eight invocations, and a tank makes twelve every
/// tick.
fn open_catalog() -> Result<(Roster, Vec<Session<'static>>), String> {
    let mut defs = Vec::new();
    let mut species = Vec::new();
    for (id, metadata, behaviour) in CATALOG {
        defs.push(SpeciesDef::parse(metadata, id)?);
        let units = vec![
            (
                "contract".to_string(),
                PathBuf::from("catalog/contract/contract.cove"),
                CONTRACT.to_string(),
            ),
            (
                "instinct".to_string(),
                PathBuf::from("catalog/instinct/instinct.cove"),
                INSTINCT.to_string(),
            ),
            (
                creature_host::species::CREATURE.to_string(),
                PathBuf::from(format!("catalog/species/{id}/creature.cove")),
                behaviour.to_string(),
            ),
        ];
        species.push(Species::from_units(id, units, std::time::Duration::ZERO)?);
    }

    let lowerings: &'static [Lowering] = Box::leak(
        species
            .iter()
            .map(Species::lower)
            .collect::<Result<Vec<_>, _>>()?
            .into_boxed_slice(),
    );
    let habitats: &'static [Habitat] = Box::leak(
        species
            .iter()
            .map(Species::habitat)
            .collect::<Vec<_>>()
            .into_boxed_slice(),
    );
    let sessions = habitats
        .iter()
        .zip(lowerings.iter())
        .map(|(habitat, lowering)| habitat.session(lowering))
        .collect();
    Ok((Roster::of(defs), sessions))
}

fn fail(message: impl Into<String>) -> i32 {
    ERROR.with(|slot| *slot.borrow_mut() = message.into());
    -1
}

/// Opens a tank on `seed`, a reef `width` by `height`.
///
/// Answers `0`, or `-1` with [`tank_error`] holding why. Re-opening replaces
/// whatever was there and reuses the compiled catalog.
///
/// # Safety
///
/// None required of the caller: this takes no pointers.
#[no_mangle]
pub extern "C" fn tank_open(seed: u32, width: u32, height: u32) -> i32 {
    let (roster, sessions) = match open_catalog() {
        Ok(ready) => ready,
        Err(why) => return fail(why),
    };
    let world = new_world(
        i64::from(seed),
        i64::from(width),
        i64::from(height),
        &roster,
    );
    TANK.with(|slot| {
        *slot.borrow_mut() = Some(Tank {
            roster,
            sessions,
            world,
            last: Vec::new(),
            asked: Vec::new(),
            focus: None,
            limits: simulation::decision_limits(),
            cost: simulation::world::DecisionCost::default(),
        });
    });
    0
}

/// Advances the tank one fixed step. Answers `0`, or `-1` when no tank is
/// open.
///
/// # Safety
///
/// None required of the caller.
#[no_mangle]
pub extern "C" fn tank_tick() -> i32 {
    TANK.with(|slot| {
        let mut held = slot.borrow_mut();
        let Some(tank) = held.as_mut() else {
            return fail("no tank is open");
        };
        let (asks, cost) = decisions(&tank.world, &tank.roster, &mut tank.sessions, &tank.limits);
        let turn = resolve(&tank.world, &asks, &tank.roster);
        tank.cost = cost;
        tank.asked = asks;
        tank.world = turn.world;
        tank.last = turn.outcomes;
        0
    })
}

/// Watches creature `id`, or watches nobody when `id` is negative or names no
/// living creature.
///
/// The snapshot then carries a `focus` block: what that creature was shown,
/// what its invocation cost, what the runtime wrote about it, and why it
/// failed if it did. It is one call rather than a field of the snapshot
/// because the answer is large and thirteen copies of it are thirteen copies
/// nobody asked for.
///
/// The id is an `i32` and not the `i64` a creature carries, because a wasm
/// `i64` is a `BigInt` in JavaScript and a page should not have to think about
/// that to click on a fish. A world would have to refill a slot two billion
/// times to reach the difference.
///
/// # Safety
///
/// None required of the caller.
#[no_mangle]
pub extern "C" fn tank_focus(id: i32) -> i32 {
    let id = i64::from(id);
    TANK.with(|slot| {
        let mut held = slot.borrow_mut();
        let Some(tank) = held.as_mut() else {
            return fail("no tank is open");
        };
        tank.focus = if id >= 0 && tank.world.creatures.iter().any(|c| c.id == id) {
            Some(id)
        } else {
            None
        };
        0
    })
}

/// The Cove source species `at` decides with, as a length-prefixed UTF-8 blob.
///
/// The whole file, because the answer to "why did it do that" is a function
/// somebody can read and the comment above that function is half of the
/// answer. It is a separate call from the snapshot for the obvious reason: it
/// is the same text every tick.
///
/// # Safety
///
/// As [`tank_snapshot`].
#[no_mangle]
pub extern "C" fn tank_source(at: usize) -> *mut u8 {
    let text = CATALOG
        .get(at)
        .map(|(_, _, behaviour)| (*behaviour).to_string())
        .unwrap_or_default();
    into_blob(text)
}

/// The tank as it stands, as a length-prefixed UTF-8 JSON blob.
///
/// The caller reads the little-endian `u32` at the pointer, then that many
/// bytes after it, then hands the pointer back to [`tank_free`].
///
/// # Safety
///
/// The returned pointer is owned by the caller and must be released with
/// [`tank_free`] and the length that was read from it.
#[no_mangle]
pub extern "C" fn tank_snapshot() -> *mut u8 {
    let json = TANK.with(|slot| match slot.borrow().as_ref() {
        Some(tank) => snapshot(tank),
        None => "null".to_string(),
    });
    into_blob(json)
}

/// Why the last call answered `-1`, as a length-prefixed UTF-8 blob.
///
/// # Safety
///
/// As [`tank_snapshot`].
#[no_mangle]
pub extern "C" fn tank_error() -> *mut u8 {
    into_blob(ERROR.with(|slot| slot.borrow().clone()))
}

/// Reserves `len` bytes for the caller to write into.
///
/// # Safety
///
/// The returned pointer is valid for `len` bytes and must be released with
/// [`tank_free`] and the same length.
#[no_mangle]
pub extern "C" fn tank_alloc(len: usize) -> *mut u8 {
    let mut buffer = Vec::<u8>::with_capacity(len);
    let ptr = buffer.as_mut_ptr();
    std::mem::forget(buffer);
    ptr
}

/// Releases what [`tank_alloc`], [`tank_snapshot`] or [`tank_error`] returned.
///
/// # Safety
///
/// `ptr` must be one of those pointers and `len` must be the length it was
/// created with — for a blob, the four length bytes plus the length they
/// name.
#[no_mangle]
pub unsafe extern "C" fn tank_free(ptr: *mut u8, len: usize) {
    if ptr.is_null() {
        return;
    }
    drop(Vec::from_raw_parts(ptr, len, len));
}

/// A string as four little-endian length bytes followed by its own.
fn into_blob(text: String) -> *mut u8 {
    let bytes = text.into_bytes();
    let mut blob = Vec::with_capacity(bytes.len() + 4);
    blob.extend_from_slice(&(bytes.len() as u32).to_le_bytes());
    blob.extend_from_slice(&bytes);
    let ptr = blob.as_mut_ptr();
    std::mem::forget(blob);
    ptr
}

/// The tank as JSON, written by hand.
///
/// No serialisation crate, for the reason this repository gives everywhere
/// else: the shape is small, fixed, and read by one consumer, and a
/// dependency that produced it would be larger than it is. Nothing here reads
/// a clock — a snapshot a replay compares cannot carry a measurement that
/// differs between two runs of the same seed.
fn snapshot(tank: &Tank) -> String {
    let world = &tank.world;
    let mut out = String::with_capacity(4096);
    out.push('{');
    out.push_str(&format!(
        "\"tick\":{},\"width\":{},\"height\":{},\"hash\":{},",
        world.tick,
        world.width,
        world.height,
        simulation::world::hash(world)
    ));
    // The world's own constants, because a page that wrote its own copy of one
    // would be a page holding a rule in a second language. That has already
    // happened once here -- `contract.cove` and the host disagreed about how
    // far a wildcard sees, and nothing could have caught it -- and a full
    // energy bar is exactly the shape of the next one.
    out.push_str(&format!(
        "\"maxEnergy\":{},\"respawnDelay\":{},",
        simulation::world::MAX_ENERGY,
        simulation::world::RESPAWN_DELAY
    ));
    out.push_str(&format!(
        "\"births\":{},\"deaths\":{},\"refusals\":{},\"cast\":{},",
        world.births,
        world.deaths,
        world.refusals,
        world.cast.len()
    ));
    // What the tick cost, split the two ways it can be split. `instructions`
    // and `fuel` are the same for every run of this seed; `coveMicros` is not,
    // and nothing in the simulation reads it.
    out.push_str(&format!(
        "\"instructions\":{},\"fuel\":{},\"decisions\":{},\"failedFuel\":{},\
\"failedFault\":{},\"coveMicros\":{},",
        tank.cost.instructions,
        tank.cost.fuel,
        tank.cost.decisions,
        tank.cost.failed_fuel,
        tank.cost.failed_fault,
        tank.cost.cove_time.as_micros()
    ));

    out.push_str("\"catalog\":[");
    for (at, def) in tank.roster.defs.iter().enumerate() {
        if at > 0 {
            out.push(',');
        }
        out.push_str(&format!(
            "{{\"id\":{},\"name\":{},\"role\":{},\"colour\":{},\"shape\":{},\"size\":{}}}",
            quote(&def.id),
            quote(&def.name),
            quote(&format!("{:?}", def.role).to_lowercase()),
            quote(&def.visual.colour),
            quote(&def.visual.shape),
            def.visual.size
        ));
    }
    out.push_str("],");

    out.push_str("\"food\":[");
    for (at, level) in world.food.iter().enumerate() {
        if at > 0 {
            out.push(',');
        }
        out.push_str(&level.to_string());
    }
    out.push_str("],");

    out.push_str("\"creatures\":[");
    for (at, creature) in world.creatures.iter().enumerate() {
        if at > 0 {
            out.push(',');
        }
        let said = tank.last.iter().find(|o| o.id == creature.id);
        out.push_str(&format!(
            "{{\"id\":{},\"species\":{},\"x\":{},\"y\":{},\"energy\":{},\"age\":{},\"hidden\":{},",
            creature.id,
            creature.species,
            creature.at.x,
            creature.at.y,
            creature.energy,
            world.tick - creature.born,
            creature.hidden
        ));
        out.push_str(&format!(
            "\"intent\":{},\"reason\":{},\"result\":{}}}",
            quote(&said.map(|o| o.decision.intent.name()).unwrap_or_default()),
            quote(said.map(|o| o.decision.reason.name()).unwrap_or("")),
            quote(&creature.last.name())
        ));
    }
    out.push_str("],");

    out.push_str("\"focus\":");
    match tank
        .focus
        .and_then(|id| tank.asked.iter().find(|ask| ask.id == id))
    {
        Some(ask) => out.push_str(&focus(tank, ask)),
        None => out.push_str("null"),
    }
    out.push('}');
    out
}

/// Everything about one invocation, for the creature a visitor is watching.
///
/// The observation is the whole of what that creature could have reasoned
/// from, which is what makes an explanation honest rather than plausible: the
/// page may say "because a hunter came within one step" only when a hunter
/// one step away is in this object.
fn focus(tank: &Tank, ask: &Ask) -> String {
    let mut out = String::with_capacity(1024);
    let outcome = tank.last.iter().find(|o| o.id == ask.id);
    let result = outcome.map(|o| o.result.name()).unwrap_or_default();
    // The sentence the world wrote when it declined an intent. It is the
    // whole of the "invalid decision" case a visitor can be shown, and
    // without it a refusal is a word with no reason attached to it.
    let refusal = outcome.and_then(|o| o.result.refusal());
    // Read off the `SelfView` the creature was handed, and not off the world.
    // A creature that died this tick is not in the world any more, and looking
    // for it there gave every dead creature species zero -- so the panel a
    // visitor was watching when their fish starved renamed it to whatever
    // species zero happens to be. The invocation knows what it was.
    let species = ask.asked.view.species.max(0) as usize;
    out.push_str(&format!(
        "{{\"id\":{},\"species\":{},\"tick\":{},",
        ask.id, species, ask.asked.observation.tick
    ));
    out.push_str(&format!(
        "\"intent\":{},\"reason\":{},\"result\":{},\"refusal\":{},",
        quote(&ask.decision.intent.name()),
        quote(ask.decision.reason.name()),
        quote(&result),
        match &refusal {
            Some(why) => quote(why),
            None => "null".to_string(),
        }
    ));
    out.push_str(&format!(
        "\"instructions\":{},\"fuel\":{},",
        ask.asked.instructions, ask.asked.fuel
    ));
    out.push_str("\"failure\":");
    match &ask.asked.failure {
        None => out.push_str("null"),
        Some(Failure::Stopped(stopped)) => {
            let kind = match stopped {
                Stopped::Fuel => "fuel",
                Stopped::Deadline => "deadline",
                Stopped::Cancelled => "cancelled",
                Stopped::CallDepth => "callDepth",
                Stopped::HostCalls => "hostCalls",
                Stopped::Concurrency => "concurrency",
            };
            // A budget stop names which limit and not which line. The runtime
            // knows the first and not the second, and a page that invented an
            // `at` here would be inventing it.
            out.push_str(&format!(
                "{{\"kind\":{},\"message\":{},\"at\":null}}",
                quote(kind),
                quote(&format!("the {kind} budget ran out"))
            ));
        }
        Some(Failure::Faulted { message, at }) => out.push_str(&format!(
            "{{\"kind\":\"fault\",\"message\":{},\"at\":{}}}",
            quote(message),
            match at {
                Some(where_) => quote(where_),
                None => "null".to_string(),
            }
        )),
        Some(Failure::Malformed(why)) => out.push_str(&format!(
            "{{\"kind\":\"malformed\",\"message\":{},\"at\":null}}",
            quote(why)
        )),
    }
    out.push(',');

    let knew = &ask.asked.view;
    out.push_str(&format!(
        "\"self\":{{\"energy\":{},\"age\":{},\"hidden\":{},\"role\":{},\"memory\":{}}},",
        knew.energy,
        knew.age,
        knew.hidden,
        quote(&format!("{:?}", knew.role).to_lowercase()),
        // The only thing a creature carries from one tick to the next, and so
        // the whole of what one in this world remembers.
        quote(&knew.last.name())
    ));

    let seen = &ask.asked.observation;
    out.push_str(&format!(
        "\"observation\":{{\"here\":{},\"shelter\":{},\"scent\":{},",
        seen.here,
        seen.shelter,
        match seen.scent {
            Some(heading) => quote(heading.name()),
            None => "null".to_string(),
        }
    ));
    out.push_str("\"around\":[");
    for (at, patch) in seen.around.iter().enumerate() {
        if at > 0 {
            out.push(',');
        }
        out.push_str(&format!(
            "{{\"heading\":{},\"x\":{},\"y\":{},\"food\":{},\"shelter\":{},\
\"outside\":{},\"occupied\":{}}}",
            quote(patch.heading.name()),
            patch.at.x,
            patch.at.y,
            patch.food,
            patch.shelter,
            patch.outside,
            patch.occupied
        ));
    }
    out.push_str("],\"nearby\":[");
    for (at, sighting) in seen.nearby.iter().enumerate() {
        if at > 0 {
            out.push(',');
        }
        out.push_str(&format!(
            "{{\"id\":{},\"species\":{},\"role\":{},\"x\":{},\"y\":{},\"away\":{},\
\"hidden\":{}}}",
            sighting.id,
            sighting.species,
            quote(&format!("{:?}", sighting.role).to_lowercase()),
            sighting.at.x,
            sighting.at.y,
            sighting.away,
            sighting.hidden
        ));
    }
    out.push_str("]},");

    out.push_str("\"trace\":[");
    for (at, line) in ask.asked.trace.iter().enumerate() {
        if at > 0 {
            out.push(',');
        }
        out.push_str(&quote(line));
    }
    out.push_str("]}");
    out
}

/// One JSON string. Every string this module writes is an identifier or a
/// colour, so escaping a quote and a backslash is the whole of it — but it is
/// done rather than assumed, because the day a species is named `O'Brien` is
/// not the day to find out.
fn quote(text: &str) -> String {
    let mut out = String::with_capacity(text.len() + 2);
    out.push('"');
    for ch in text.chars() {
        match ch {
            '"' => out.push_str("\\\""),
            '\\' => out.push_str("\\\\"),
            '\n' => out.push_str("\\n"),
            c if (c as u32) < 0x20 => out.push_str(&format!("\\u{:04x}", c as u32)),
            c => out.push(c),
        }
    }
    out.push('"');
    out
}
