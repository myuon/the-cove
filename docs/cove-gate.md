# The Cove readiness gate, assessed

This is the record issue #1 asks for: every must-have checked against the Cove
implementation, with the file that proves it, and the two things that were not
provable when the assessment was made.

Assessed against `myuon/cove` at `1c6bdc0` (`perf(ir): a clear that frees
nothing is not emitted`). Every `path:line` below is in that repository at that
commit.

## Must

### The Language Reference is authoritative and backed by conformance tests — yes

`crates/cove-runtime/tests/conformance.rs` holds three tables, each entry
naming the heading in `docs/LANGUAGE_REFERENCE.md` it pins: `RULES` (55
entries, each compiled at the reference's stated type, compiled again at a
foreign type to check it is refused, then run and its value compared),
`REJECTIONS` (36 programs the reference does not admit, each against a
diagnostic code), and `TRAPS` (4 programs the checker admits and the runtime
must stop).

Completeness is ratcheted rather than reviewed:
`every_expression_and_pattern_form_appears_in_an_accepted_program` walks the
AST of every accepted program and fails if any `ExprKind` or `PatternKind`
variant appears in none of them. A form cannot be added to the language and
left out of the reference unnoticed.

The link is to AST variants, not to the prose. The `section` strings match the
document's real headings today, but nothing parses the markdown, so a renamed
heading would drift silently. That is a documentation risk, not an
implementation one.

### Checker and interpreter agree on reference/value semantics and exported types — yes

`crates/cove-cli/tests/vm_coverage.rs` runs the whole corpus — `tests/e2e`,
`examples`, `benches` — on both the tree-walking oracle and the linear-memory
VM and compares the answer, both console streams, the run outcome, and the
fake filesystem. Two ratchets: `AGREEING_FLOOR = 117`, which may rise and
never fall, and `KNOWN_DISAGREEMENTS`, compared as a set so that a new
disagreement fails even if the count went up.

`KNOWN_DISAGREEMENTS` is currently **empty**.

### Host-provided nominal schemas are visible to static checking — yes

`Compiler::with_host_schema` / `with_host_schemas`
(`crates/cove-sema/src/compile.rs:167`) feeds an embedder's schema into both
`resolve` and `typeck`. `Checker::host_schema` (`crates/cove-sema/src/typeck.rs:2249`)
is consulted at call sites, field reads, and resource-type checks, so arity,
argument and result types, struct fields, and the capability are all decided
before anything runs.
`crates/cove-runtime/tests/embedding.rs:522` asserts a program checks clean
against nothing but a supplied schema.

One limit worth knowing: the `cove check` CLI cannot be handed a third-party
schema (there is no serialized schema format; cove issue #151). Static checking
of a host module means writing a small Rust driver, which is what
`examples/rules/host/src/bin/check.rs` is.

### A Rust embedder can register typed inputs/outputs and invoke a known exported function — yes

`cove_schema::{ModuleSchema, OperationSchema, TypeSchema, FieldSchema, HostType}`,
`trait HostApi`, and `HostRegistry::register` are all public and used from
outside the cove crates by `examples/rules/host`, an ordinary Cargo crate.

Invocation is `Vm::invoke(module, name, Vec<Value>) -> Result<Value, RuntimeError>`
(`crates/cove-runtime/src/vm/mod.rs:240`), pre-checked by
`crates/cove-runtime/src/invoke.rs:86` against the signature the checker
resolved: wrong arity, a missing field, a field in the wrong order, or a wrong
element type is refused before the first instruction, with a path like
`.tags[1]`.

Values that cross: `Unit`, `Bool`, `Int`, `Float`, `Duration`, `String`,
`Array`, `Vector`, `Map`, `Set`, `Option`, `Result`, declared structs
(`Value::structure`, checked field by field), and declared enums with payloads
(`Value::enumeration`, checked by case and payload type).
`crates/cove-runtime/tests/invoking.rs:286` passes a struct holding an array in
and reads an enum case with a payload out — which is exactly the shape this
project needs, a record in and a variant out.

**This decides the biggest open question in the brief.** `decide` does not need
a Host API module at all. The observation goes in as an argument and the
decision comes back as a result; no capability is asked for, no host module is
reached, and a trace sink watching the boundary sees nothing. The Host API is
for reaching outside the process, and carrying a value is not that.

### Deterministic fuel/instruction budget with structured exhaustion errors — yes, with three conditions

`Limits { fuel: Option<u64>, deadline, max_host_calls, max_call_depth, max_tasks }`
(`crates/cove-runtime/src/budget.rs:44`). Exhaustion is
`enum Stopped { Fuel, Deadline, Cancelled, CallDepth, HostCalls, Concurrency }`
(`budget.rs:69`) — a variant to match on, not a string.
`crates/cove-runtime/tests/responsiveness.rs:1637` reruns a program eight times
under concurrency and asserts identical fuel and identical answer.

A budget belongs to an invocation, not to a session:
`Vm::invoke_within(limits, ...)` installs it as the call is entered and leaves
it holding what that call spent, and its deadline runs from the moment the
invocation starts. One creature cannot spend another creature's fuel.

Three conditions the simulation must hold to, none of them costly:

1. `deadline` is `None`. It reads a wall clock, so it is not replayable.
2. The backend is pinned. Fuel is not portable between the VM and the
   tree-walking oracle; they charge differently and can disagree on outcome
   under the same limit. `cove_runtime_version` in the replay identity has to
   name the backend as well.
3. No `spawn`. ADR 0008 gives a task a real OS thread with no scheduling
   policy, so a program that spawns is not deterministic. Creature programs are
   pure functions of their arguments and do not, and `wasm32` refuses `spawn`
   outright, so this holds itself.

### Panic/runtime errors are isolated to one invocation and include useful spans — yes for the errors this project can produce

`examples/rules/host/tests/embedding.rs:559`
(`a_failed_invocation_leaves_the_session_serving`) fails one request and then
serves the next from the same session. `RuntimeError` carries
`span: Option<Span>` (`crates/cove-runtime/src/error.rs:14`).

Two limits, both acceptable here and both worth writing down:

- A budget stop carries **no span**. "Ran out of fuel" names no line. The trace
  is where a host looks instead.
- A genuine Rust panic — a bug in Cove itself, not in a creature — is
  deliberately not caught: `crates/cove-runtime/src/interp.rs:190` resumes the
  unwind. That is a crash of the simulation, not of a creature. It is the same
  class of event as a panic in the simulation's own code and gets the same
  treatment.

### The host can collect a bounded structured trace linked to invocation and creature ID — the host builds it

`TraceEvent` is a typed enum (`crates/cove-runtime/src/trace.rs:398`) and
`TraceSink` is a public trait (`trace.rs:546`). What the runtime does not ship
is a size bound, a sampling policy, or a correlation-ID field: events carry a
task id and nothing else.

None of that blocks the gate, because the simulation invokes one creature at a
time, synchronously. A sink the host owns, holding the creature id and tick it
is currently collecting for and capping its own event count, is a small amount
of ordinary Rust and it is where the bound belongs — the bound the product
wants is per creature per tick, which is a fact about the simulation and not
about the runtime.

Disabling is clean: `is_recording()` is checked before any value is copied
(`host.rs:876`), and tracing has no path back into the budget, so a traced run
and an untraced run spend the same fuel and answer the same thing.

### The Cove runtime embeds in the selected Rust simulation target — yes, natively and on `wasm32-unknown-unknown`

Natively, `examples/rules/host` is the existence proof, and it is a workspace
member so it cannot rot against the API it demonstrates.

For the browser, `crates/cove-wasm` compiles the whole front end and the VM to
`wasm32-unknown-unknown` and CI runs Cove programs in Node through it
(`.github/workflows/ci.yml`, job `wasm`, running `node web/check.mjs`).
`crates/cove-runtime/src/wallclock.rs` is where the target difference lives:
`Instant` is `std::time::Instant` off wasm and an imported host function on it.

Three things the simulation must do, and one it must not:

- Supply the import `cove.cove_now_millis() -> f64`. It is not optional and not
  defaulted; a module instantiated without it fails to instantiate, loudly.
- Use the VM directly. `cove_runtime::interp::on_cove_stack` spawns an OS
  thread with no `wasm32` guard and would trap; nothing on the `Vm::invoke`
  path reaches it.
- Register in-memory or denied host implementations. `Files::rooted` and the
  real `Http` compile on wasm and are inert there. The simulation grants
  nothing at all, so this is moot.
- Not use `crates/cove-wasm`'s C ABI. It always compiles a source string and
  runs a hardcoded `playground.main` with no arguments. The simulation is its
  own wasm module that links `cove-runtime` and exports its own interface.

### Repeated invocation does not leak unbounded task/runtime state — closed by a new test

This was the one must-have with no evidence behind it when the assessment
started. The mechanism was public — `Runtime::heap_stats()`
(`crates/cove-runtime/src/runtime.rs:110`), `Vm::heap_words()`,
`Vm::allocated_words()` — and the doc comments claimed compile-once/invoke-many
(`crates/cove-runtime/src/interp.rs:959`), but nothing invoked one live backend
repeatedly and asserted it stayed still.

A test in `crates/cove-runtime/tests/invoking.rs` now does. See the follow-up
comment on issue #1 for what it measured.

## Should

| | |
| --- | --- |
| Compiled modules can be cached and instantiated cheaply | Yes. `Compiler::compile` answers a checked `Program`, `cove_ir::lower` answers an `Arc<IR>`, and `Vm::new` over a lowered program allocates a fresh heap and re-lowers nothing. `examples/rules/README.md` measures compiling as worth about 168 invocations. |
| Trace collection can be sampled or disabled without changing semantics | Disabled, yes, and provably free of the budget. Sampled, not shipped; a host sink decides. |
| Runtime version and source hashes are available for replay metadata | **No.** Only `trace::TRACE_FORMAT_VERSION` is public, and it versions the trace file format. The interface hash in `crates/cove-cli/src/api.rs:481` is `pub(crate)` and hashes declared signatures rather than source. This project therefore computes its own: the pinned Cove commit is a build input, and the catalog hashes its own species sources. That is arguably where it belongs — the hash a replay needs is of the source *this* project shipped. |
| A browser/Wasm embedding smoke test passes | For the Cove playground, yes, in CI. For this project's own wasm module, that is slice 2's job. |

## Not blockers, and none of them are present

Native AOT, a package registry, a production server framework, a strict memory
bucket, an effect system, totality proofs, a distributed runtime.

## What the assessment changed about the plan

- **`decide` takes its arguments as arguments.** The brief left open whether
  the observation would arrive through a Host API call. It does not. There is
  no host module in slice 0 at all.
- **The contract already exists in Cove and is already tested.**
  `examples/life/` in the cove repository is a creature simulation whose
  `life.schema` module declares `SelfView`, `Observation`, `Decision`, and
  `ActionResult` — the four names issue #2 asks for — and whose
  `life.scavenger` is a hand-written shy scavenger. It is in the differential
  corpus, so both backends are held to it. This project's contract is that one,
  ported, with two additions: a `Reason` the interface can turn into a
  sentence, and a `Role` vocabulary that reaches twelve species where
  `life.schema.Species` reached three.
- **The world is a grid.** That comes with the ported contract and it is the
  one place this diverges from the brief, which describes continuous pixel
  distances. It is a slice 1 decision, recorded here because slice 0 fixes the
  contract that slice 1 renders. A grid is legible, its tie-breaks are written
  down once, and it hashes exactly; smooth motion is a rendering question the
  simulation does not have to answer.
