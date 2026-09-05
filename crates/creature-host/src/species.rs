//! Loading one species, and invoking it as many times as the world runs.
//!
//! A species is compiled and lowered once, when the simulation starts, and
//! invoked once per creature per tick for as long as the world lives. That is
//! the shape the whole of this crate exists to hold: [`Species`] is what
//! outlives a run, [`Lowering`] is what one entry lowers to, and [`Session`]
//! is the one backend every invocation of a run is served by.
//!
//! Nothing here grants a capability. `decide` takes an observation and
//! answers a decision, so it reaches no host module, and the registry it runs
//! against is granted nothing at all. A creature program has no clock, no
//! files, no network, and no randomness — not because it is refused them, but
//! because it was never handed anything to ask with.

use std::collections::BTreeMap;
use std::path::{Path, PathBuf};
use std::sync::{Arc, Mutex};
use std::time::Duration;

use crate::clock::Stopwatch;

use cove_diag::{render, SourceMap, Span};
use cove_runtime::budget::{Budget, Limits, Stopped};
use cove_runtime::trace::{RunOutcome, TraceEvent, TraceSink};
use cove_runtime::value::Value;
use cove_runtime::{Grants, HostRegistry, Runtime, RuntimeError, Vm};
use cove_sema::package::{Module, Package, Unit};
use cove_sema::resolve::Program;
use cove_sema::{Compiler, Config, HostSchemas};

use crate::contract::{Decision, Observation, SelfView};

/// The module a species' own source is compiled as.
///
/// Every species is `creature`, whatever its catalog identifier is. The host
/// invokes `creature.decide` and does not learn a name per species: a species
/// is a directory of Cove source and a row of metadata, not a Rust symbol.
pub const CREATURE: &str = "creature";

/// The entry every species declares.
pub const DECIDE: &str = "decide";

/// What loading a species cost.
#[derive(Clone, Copy, Debug, Default)]
pub struct LoadCost {
    pub read: Duration,
    pub parse: Duration,
    pub check: Duration,
    pub files: usize,
    pub modules: usize,
}

/// One species, parsed and checked once.
///
/// This is the artefact the simulation holds for the life of the process. It
/// carries no host, no budget, and no backend: those belong to a run, and a
/// species outlives every run made from it.
pub struct Species {
    id: String,
    sources: Arc<SourceMap>,
    program: Arc<Program>,
    source_hash: String,
    cost: LoadCost,
}

impl Species {
    /// Loads, parses, and checks the species `id` out of the catalog at
    /// `catalog`.
    ///
    /// Three directories become three modules, and which directory becomes
    /// which module is decided here rather than derived from a path. The
    /// contract and the shared instincts are the same source for every
    /// species and keep their own names; the species' own directory becomes
    /// [`CREATURE`], whatever it is called on disk. That is what lets the
    /// host invoke one entry name for all twelve species of the catalog
    /// without a table mapping identifiers to module names.
    pub fn load(catalog: &Path, id: &str) -> Result<Species, String> {
        Species::compose(
            id,
            &catalog.join("contract"),
            &catalog.join("instinct"),
            &catalog.join("species").join(id),
        )
    }

    /// The same, over three directories a caller names.
    ///
    /// [`Species::load`] is this with the catalog's own layout filled in. This
    /// one is here for the fixtures that are not catalog entries and must not
    /// become them: a creature that loops for ever, one that divides by zero,
    /// one that answers something that is not a decision. They are compiled
    /// against the shipped contract and the shipped instincts, because a
    /// fixture compiled against a copy of the contract would stop testing the
    /// contract the moment the copy drifted.
    pub fn compose(
        id: &str,
        contract: &Path,
        instinct: &Path,
        creature: &Path,
    ) -> Result<Species, String> {
        let started = Stopwatch::start();
        let layout = [
            (contract, "contract"),
            (instinct, "instinct"),
            (creature, CREATURE),
        ];
        let mut files: Vec<(String, PathBuf, String)> = Vec::new();
        for (dir, module) in layout {
            read_module(dir, module, &mut files)?;
        }
        Species::from_units(id, files, started.elapsed())
    }

    /// The same again, over source a caller already holds.
    ///
    /// Each unit is a module name, the path it should report diagnostics
    /// against, and its text. Nothing here touches a filesystem, which is the
    /// point: `wasm32-unknown-unknown` has no filesystem, and the catalog a
    /// browser runs is one compiled into the module by `include_str!` rather
    /// than one read off a disk that is not there.
    ///
    /// `read` is what finding the source cost, for a caller that measured it;
    /// pass `Duration::ZERO` for source that was already in hand.
    pub fn from_units(
        id: &str,
        mut files: Vec<(String, PathBuf, String)>,
        read: Duration,
    ) -> Result<Species, String> {
        let mut cost = LoadCost {
            read,
            ..LoadCost::default()
        };
        files.sort();
        cost.files = files.len();
        let root = files
            .first()
            .and_then(|(_, path, _)| path.parent().map(Path::to_path_buf))
            .unwrap_or_else(|| PathBuf::from("."));

        // The hash is of the source that was loaded, in the order it was
        // loaded, and of nothing else. It is what a replay identity needs and
        // the runtime has no way to answer: `cove-runtime` exposes no content
        // hash, so the project that shipped the source computes one over the
        // source it shipped.
        let source_hash = hash(&files);

        let started = Stopwatch::start();
        let mut sources = SourceMap::new();
        let mut modules: BTreeMap<String, Module> = BTreeMap::new();
        for (name, path, text) in files {
            let file = sources.add(path.clone(), &text);
            let ast = cove_syntax::parse_file(&sources, file)
                .map_err(|items| report(&sources, &items))?;
            modules
                .entry(name.clone())
                .or_insert_with(|| Module {
                    name: name.clone(),
                    dir: path.parent().unwrap_or(&root).to_path_buf(),
                    units: Vec::new(),
                })
                .units
                .push(Unit { file, path, ast });
        }
        cost.parse = started.elapsed();
        cost.modules = modules.len();

        let package = Package {
            root,
            config: Config::default(),
            modules,
        };
        let started = Stopwatch::start();
        let program = Compiler::new()
            .compile(&package)
            .map_err(|items| report(&sources, &items))?;
        cost.check = started.elapsed();

        Ok(Species {
            id: id.to_string(),
            sources: Arc::new(sources),
            program: Arc::new(program),
            source_hash,
            cost,
        })
    }

    /// The catalog identifier this species was loaded under.
    pub fn id(&self) -> &str {
        &self.id
    }

    /// A hash of every source file this species was compiled from.
    ///
    /// Part of a replay identity. It changes when the contract changes, when
    /// the shared instincts change, and when this species changes, because
    /// all three decide what `decide` answers.
    pub fn source_hash(&self) -> &str {
        &self.source_hash
    }

    /// What loading this species cost.
    pub fn cost(&self) -> LoadCost {
        self.cost
    }

    /// Whatever the checker accepted but doubted, rendered.
    ///
    /// Expected to be empty. A species names no host module, so there is no
    /// schema for the checker to be silent about; a notice here means the
    /// contract asked for something the language declined to prove.
    pub fn notices(&self) -> Vec<String> {
        self.program
            .notices
            .iter()
            .map(|item| render(&self.sources, item))
            .collect()
    }

    /// Lowers `creature.decide` to the executable IR.
    ///
    /// Once per species, held for the life of the process.
    pub fn lower(&self) -> Result<Lowering, String> {
        let started = Stopwatch::start();
        let schemas = HostSchemas::new();
        let program =
            cove_ir::lower_entry(&self.program, &self.sources, &schemas, CREATURE, DECIDE)
                .map_err(|items| {
                    format!(
                        "`{CREATURE}.{DECIDE}` does not lower: {}",
                        report(&self.sources, &items)
                    )
                })?;
        Ok(Lowering {
            functions: program.functions.len(),
            ir: Arc::new(program),
            lower: started.elapsed(),
        })
    }

    /// The place this species runs in: one runtime, one tape, and no backend
    /// yet.
    ///
    /// A [`Habitat`] owns everything a session needs except the lowered
    /// program, and owns it rather than borrowing it, so a caller may hold a
    /// `Vec` of habitats and then build a `Vec` of sessions that borrow from
    /// it. That is what a world of several species needs and what
    /// [`Species::serve`] cannot give it: `serve` builds the runtime inside
    /// itself, so four species would be four nested closures and the innermost
    /// one would be the whole simulation.
    pub fn habitat(&self) -> Habitat {
        let tape = Arc::new(Tape::new(Tape::DEFAULT_CAP));
        let mut hosts = HostRegistry::new(Grants::new(Vec::<String>::new()));
        hosts.set_trace(Arc::clone(&tape) as Arc<dyn TraceSink>);
        // Two sinks and not one, because there are two. The registry's is
        // where the Host API boundary reports; the runtime's is where the
        // entry and the end of the run report. A decision reaches no host, so
        // the registry's should stay silent for ever — which is exactly why it
        // is installed: a species that somehow reached a host module would
        // show up on the tape rather than nowhere.
        let runtime = Runtime::new(
            Arc::clone(&self.program),
            Arc::clone(&self.sources),
            Arc::new(hosts),
        )
        .with_trace(Arc::clone(&tape) as Arc<dyn TraceSink>);
        Habitat {
            runtime,
            sources: Arc::clone(&self.sources),
            tape,
        }
    }

    /// Builds one backend and hands it to `body`.
    ///
    /// Every invocation `body` makes is served by that one `Vm`, which is what
    /// compile-once/invoke-many means here. This is the shape one species
    /// wants; [`Species::habitat`] is the shape a world of several wants.
    /// Either way nothing Cove-shaped may leave a session: a `Value` is
    /// `Rc`-based and is not `Send`.
    pub fn serve<T>(&self, lowering: &Lowering, body: impl FnOnce(&mut Session<'_>) -> T) -> T {
        let habitat = self.habitat();
        let mut session = habitat.session(lowering);
        body(&mut session)
    }
}

/// Where one species runs: its runtime, and the tape its invocations write to.
///
/// It exists so that the runtime and the backend can be two locals rather than
/// one closure. A `Vm` borrows a `Runtime`, so a `Vec<Habitat>` built first and
/// a `Vec<Session>` built from it second is an ordinary borrow and not a
/// self-referential structure.
pub struct Habitat {
    runtime: Runtime,
    sources: Arc<SourceMap>,
    tape: Arc<Tape>,
}

impl Habitat {
    /// One backend over `lowering`, ready to be invoked as many times as the
    /// world has ticks.
    pub fn session<'a>(&'a self, lowering: &'a Lowering) -> Session<'a> {
        Session {
            vm: Vm::new(&self.runtime, self.runtime.hosts(), &lowering.ir),
            hosts: self.runtime.hosts(),
            sources: Arc::clone(&self.sources),
            tape: Arc::clone(&self.tape),
        }
    }
}

/// One entry, lowered.
pub struct Lowering {
    ir: Arc<cove_ir::Program>,
    /// How many functions the entry reached.
    pub functions: usize,
    /// What lowering cost, verification included.
    pub lower: Duration,
}

/// One backend, ready to decide as many ticks as the world has.
pub struct Session<'a> {
    vm: Vm<'a>,
    hosts: &'a HostRegistry,
    sources: Arc<SourceMap>,
    tape: Arc<Tape>,
}

impl Session<'_> {
    /// Asks one creature what it does this tick, within `limits`.
    ///
    /// The budget is this invocation's and no other's: it is installed as the
    /// call is entered and left behind holding what the call spent, so one
    /// creature that loops cannot spend the fuel of the creature asked after
    /// it. A creature that runs out, faults, or answers something that is not
    /// a decision loses its tick; the session goes on serving.
    pub fn decide(&mut self, view: &SelfView, world: &Observation, limits: Limits) -> Outcome {
        self.tape.begin(view.id, world.tick);
        let before = self.vm.instructions();
        let answered = self.vm.invoke_within(
            Budget::new(limits),
            CREATURE,
            DECIDE,
            vec![view.to_cove(), world.to_cove()],
        );
        let instructions = self.vm.instructions() - before;
        // Read from the registry, and not from a `Meter` taken off the budget
        // before it was handed over. `HostRegistry::begin_run` calls
        // `Budget::restart`, which builds the meter afresh, so a meter taken
        // beforehand is a meter of nothing and reads zero for ever -- including
        // for an invocation the same budget stopped. `Budget::meter()` is
        // public and this is not written down anywhere, which cost an
        // afternoon and a test that asserted the wrong thing.
        let fuel = self
            .hosts
            .with_budget(|budget| budget.fuel_spent())
            .unwrap_or(0);
        let (events, dropped) = self.tape.take();
        let answer = match answered {
            Ok(value) => Decision::of(&value).map_err(Failure::Malformed),
            Err(error) => Err(self.failure(error)),
        };
        Outcome {
            answer,
            instructions,
            fuel,
            events,
            dropped,
        }
    }

    /// What this creature's answer was, without a budget.
    ///
    /// For a fixture that is measuring what a decision costs rather than
    /// bounding it. A world run does not use this: every tick of every
    /// creature is bounded.
    pub fn decide_unbounded(&mut self, view: &SelfView, world: &Observation) -> Outcome {
        self.decide(view, world, Limits::default())
    }

    /// How many instructions every invocation on this session has executed
    /// between them.
    pub fn instructions(&self) -> u64 {
        self.vm.instructions()
    }

    /// How many words the heap holds right now.
    ///
    /// What must stay flat across a long run, once a collection has run at
    /// all. Before the first one this only climbs, because the heap is a bump
    /// pointer and nothing has yet been swept back into the free list; a world
    /// that has not collected yet has not said anything about whether it
    /// leaks.
    ///
    /// `Runtime::heap_stats()` is the richer answer and is not the one to ask
    /// here: it is filled in by the tree-walking interpreter and left untouched
    /// by the linear-memory backend, which is the backend this runs on.
    pub fn heap_words(&self) -> u64 {
        self.vm.heap_words()
    }

    /// How many words this session has allocated in total.
    ///
    /// Cumulative, and rising for as long as the world turns. That is not a
    /// leak and is not evidence of one; [`Session::heap_words`] is.
    pub fn allocated_words(&self) -> u64 {
        self.vm.allocated_words()
    }

    /// Turns a stopped invocation into what the simulation records.
    fn failure(&self, error: RuntimeError) -> Failure {
        match error.outcome {
            RunOutcome::Fuel => Failure::Stopped(Stopped::Fuel),
            RunOutcome::Deadline => Failure::Stopped(Stopped::Deadline),
            RunOutcome::Cancelled => Failure::Stopped(Stopped::Cancelled),
            _ => Failure::Faulted {
                message: error.message,
                at: error.span.map(|span| self.locate(span)),
            },
        }
    }

    /// Where a span is, as a report writes it.
    fn locate(&self, span: Span) -> String {
        let file = self.sources.get(span.file);
        let (line, column) = file.line_col(span.start);
        let name = file
            .path
            .file_name()
            .map(|n| n.to_string_lossy().into_owned())
            .unwrap_or_else(|| file.path.display().to_string());
        format!("{name}:{line}:{column}")
    }
}

/// Everything one invocation produced.
#[derive(Clone, Debug)]
pub struct Outcome {
    /// What the creature decided, or why it did not.
    pub answer: Result<Decision, Failure>,
    /// How many instructions this invocation executed, exactly.
    ///
    /// This is what a tick costs and what the measurements report. It is a
    /// difference of `Vm::instructions()`, which counts every instruction the
    /// session has ever run.
    pub instructions: u64,
    /// What this invocation was charged against its budget.
    ///
    /// The same number as [`Outcome::instructions`] for a decision that ran to
    /// its end, and both are here because they are measured differently: this
    /// one is what the budget was charged and needs a budget installed to mean
    /// anything, and that one is a difference of a session counter that runs
    /// whether a budget exists or not.
    ///
    /// What `cove_runtime::SAFEPOINT_STRIDE` decides is when the charge is
    /// compared against the limit and not what the charge is. A run is stopped
    /// at the first safepoint at or past its limit, so a bound overshoots by
    /// less than one stride -- 50,176 for a limit of 50,000 -- and a run that
    /// finished is charged exactly what it executed.
    ///
    /// It is read back through the registry rather than through a
    /// `cove_runtime::Meter` taken off the `Budget` beforehand. That was the
    /// first thing this crate did and it reads zero for ever: `begin_run`
    /// calls `Budget::restart`, which builds the meter afresh, so the meter a
    /// caller kept is a meter of nothing.
    pub fuel: u64,
    /// The runtime events this invocation produced, tagged with the creature
    /// and tick they belong to.
    pub events: Vec<Recorded>,
    /// How many events were dropped because the tape was full.
    pub dropped: u64,
}

impl Outcome {
    /// The decision, for an invocation that produced one.
    pub fn decision(&self) -> Option<Decision> {
        self.answer.as_ref().ok().copied()
    }

    /// Whether this invocation ran out of fuel.
    pub fn out_of_fuel(&self) -> bool {
        matches!(self.answer, Err(Failure::Stopped(Stopped::Fuel)))
    }
}

/// Why an invocation produced no decision.
#[derive(Clone, Debug, PartialEq, Eq)]
pub enum Failure {
    /// A limit the host imposed stopped it. Carries no source location: the
    /// runtime knows which limit, not which line.
    Stopped(Stopped),
    /// The creature's own code broke an invariant, at `at` when the runtime
    /// knew where.
    Faulted { message: String, at: Option<String> },
    /// It answered something that is not a decision this host understands.
    Malformed(String),
}

/// One runtime event, tagged with what it happened for.
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct Recorded {
    pub creature: i64,
    pub tick: i64,
    /// The event, rendered without a duration in it.
    ///
    /// A trace a replay compares cannot carry a wall-clock measurement: the
    /// same invocation of the same program spends the same fuel every time
    /// and takes a different number of microseconds every time. What is kept
    /// is what the machine did; what is dropped is how long it took.
    pub line: String,
}

/// A bounded trace, one invocation at a time.
///
/// The runtime's own sink has no size bound and no correlation identifier —
/// events carry a task id and nothing else — and neither belongs to it. The
/// bound the world wants is per creature per tick, which is a fact about a
/// simulation, and the identifier is a creature, which the runtime has never
/// heard of. Both are here, where they are known.
pub struct Tape {
    inner: Mutex<TapeState>,
}

struct TapeState {
    at: Option<(i64, i64)>,
    events: Vec<Recorded>,
    dropped: u64,
    cap: usize,
}

impl Tape {
    /// How many events one invocation may record before the rest are counted
    /// rather than kept.
    ///
    /// A decision reaches no host and spawns no task, so it produces a handful
    /// of events: the entry, its exit, whatever the collector did, and the end
    /// of the run. The cap is well above that, and it is here so that a
    /// creature which somehow produces events without end costs the world a
    /// counter rather than its memory.
    pub const DEFAULT_CAP: usize = 64;

    fn new(cap: usize) -> Tape {
        Tape {
            inner: Mutex::new(TapeState {
                at: None,
                events: Vec::new(),
                dropped: 0,
                cap,
            }),
        }
    }

    /// Starts collecting for one creature's tick, discarding anything left.
    fn begin(&self, creature: i64, tick: i64) {
        let mut state = self.inner.lock().expect("the tape is not poisoned");
        state.at = Some((creature, tick));
        state.events.clear();
        state.dropped = 0;
    }

    /// Takes what was collected, and stops collecting.
    fn take(&self) -> (Vec<Recorded>, u64) {
        let mut state = self.inner.lock().expect("the tape is not poisoned");
        state.at = None;
        (std::mem::take(&mut state.events), state.dropped)
    }
}

impl TraceSink for Tape {
    fn record(&self, event: TraceEvent) {
        let mut state = self.inner.lock().expect("the tape is not poisoned");
        let Some((creature, tick)) = state.at else {
            return;
        };
        if state.events.len() >= state.cap {
            state.dropped += 1;
            return;
        }
        let line = describe(&event);
        state.events.push(Recorded {
            creature,
            tick,
            line,
        });
    }
}

/// One event, written without anything a clock decided.
fn describe(event: &TraceEvent) -> String {
    match event {
        TraceEvent::EntryEnter { module, function } => format!("enter {module}.{function}"),
        TraceEvent::EntryExit {
            module, function, ..
        } => format!("exit {module}.{function}"),
        TraceEvent::RunEnded { outcome, message } => match message {
            Some(why) => format!("ended {outcome:?}: {why}"),
            None => format!("ended {outcome:?}"),
        },
        other => {
            // Everything else is the collector and the host boundary. A
            // decision reaches neither, so this arm is what would tell us if
            // one ever did.
            let written = format!("{other:?}");
            match written.split_once(' ') {
                Some((head, _)) => head.to_string(),
                None => written,
            }
        }
    }
}

/// Every `.cove` file directly under `dir`, as one module.
///
/// Not recursive. A species is one directory of source; a species that grew
/// subdirectories would be a species with modules of its own, and deciding
/// what to call them is a decision the catalog has not had to make.
fn read_module(
    dir: &Path,
    module: &str,
    into: &mut Vec<(String, PathBuf, String)>,
) -> Result<(), String> {
    let entries =
        std::fs::read_dir(dir).map_err(|e| format!("cannot read `{}`: {e}", dir.display()))?;
    let mut found = false;
    for entry in entries {
        let entry = entry.map_err(|e| format!("cannot read `{}`: {e}", dir.display()))?;
        let path = entry.path();
        if path.extension().and_then(|e| e.to_str()) == Some("cove") {
            let text = std::fs::read_to_string(&path)
                .map_err(|e| format!("cannot read `{}`: {e}", path.display()))?;
            into.push((module.to_string(), path, text));
            found = true;
        }
    }
    if !found {
        return Err(format!("`{}` holds no Cove source", dir.display()));
    }
    Ok(())
}

/// A hash of the loaded source, module name and path included.
///
/// FNV-1a over the bytes, rendered as sixteen hex digits. It identifies a
/// build of a catalog entry for a replay; it is not a signature and nothing
/// here is defending against a source file chosen to collide with another.
fn hash(files: &[(String, PathBuf, String)]) -> String {
    let mut state: u64 = 0xcbf2_9ce4_8422_2325;
    let mut eat = |bytes: &[u8]| {
        for byte in bytes {
            state ^= u64::from(*byte);
            state = state.wrapping_mul(0x0000_0100_0000_01b3);
        }
    };
    for (module, path, text) in files {
        eat(module.as_bytes());
        eat(path
            .file_name()
            .map(|n| n.to_string_lossy().into_owned())
            .unwrap_or_default()
            .as_bytes());
        eat(text.as_bytes());
    }
    format!("{state:016x}")
}

/// Diagnostics, rendered the way `cove check` renders them.
fn report(sources: &SourceMap, items: &[cove_diag::Diagnostic]) -> String {
    items.iter().map(|item| render(sources, item)).collect()
}

/// What every value this crate hands to Cove is, for a caller that wants to
/// see one without a session.
pub fn as_values(view: &SelfView, world: &Observation) -> Vec<Value> {
    vec![view.to_cove(), world.to_cove()]
}
