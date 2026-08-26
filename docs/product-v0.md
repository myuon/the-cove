# The Cove — V0 Product & Implementation Brief

> **AI wrote their instincts. Now watch them live.**

Status: ready to start after Cove reaches the readiness gate below.

## Product promise

The Cove is a small, beautiful digital ecosystem whose creatures are controlled by programs written in [Cove](https://github.com/myuon/cove). Visitors open the page and immediately see recognizable behaviors, surprising interactions, and a living world.

V0 is an observation experience, not a creation tool:

- No visitor prompts or visitor-provided code.
- No LLM calls in the browser or simulation loop.
- Each world selects 8–14 creatures from an owner-curated catalog.
- A seed makes the 60-second world replayable and shareable.
- Clicking a creature reveals its reason, state, Cove source, and trace.

The artifact should prove one claim:

> Cove can run many independent, understandable behaviors safely inside a host-controlled world.

## V0 experience

The page opens directly onto an animated 2D tide pool. A seed chooses the environment and inhabitants. Visitors can pause, change speed, rewind, create a new seeded world, share it, and follow a creature.

The creature panel exposes three progressive layers:

1. Plain language: “Hid in the coral because a larger hunter came within 42 px.”
2. Current state: energy, health, age, current goal, and remembered facts.
3. Cove: the source function and trace event responsible for the action.

The visual world stays primary. Code is a discoverable payoff, never a prerequisite.

## World and execution model

Use a deterministic fixed-step simulation with creatures, food, shelters, signals, and environmental zones.

Each tick:

1. Read an immutable world snapshot.
2. Build a bounded observation for every creature.
3. Invoke its Cove `decide` function with an independent fuel budget.
4. Validate and collect exactly one intent.
5. Resolve interactions in stable creature-ID order.
6. Apply metabolism, cooldowns, respawn, damage, and death.
7. Append state delta, action result, and Cove trace to the event log.

Creature programs never mutate the world directly. They receive a snapshot and return one decision:

```cove
pub fn decide(self: SelfView, world: Observation) -> Decision
```

Exact syntax will be adapted to Cove’s accepted Language Reference.

Supported decisions:

- `Move { direction, effort }`
- `Eat { target }`
- `Hide { shelter }`
- `Attack { target }`
- `ShareFood { target, amount }`
- `Signal { kind, strength }`
- `Rest`

The host clamps numeric values, rejects stale or invisible targets, enforces cooldowns, and records an explicit result. Invalid decisions degrade to `Rest`; they never crash the world.

Reasons use a small stable enum such as `fleeing_threat`, `seeking_food`, `helping_ally`, and `exploring`. The UI turns these into authored prose while the underlying trace remains available.

## Determinism

A replay is identified by:

```text
world_seed + catalog_version + simulation_version + cove_runtime_version
```

- Rendering time is separate from the fixed simulation timestep.
- The host owns all randomness.
- Iteration and conflict resolution have stable order.
- Cove sees no wall clock or ambient host state.
- Debug replay compares periodic state hashes and reports first divergence.

## Curated catalog

Start with 12 visually distinct species:

- 3 grazers/foragers
- 2 ambush predators
- 2 active hunters
- 2 scavengers
- 2 cooperative/signaling species
- 1 wildcard with a clearly legible rule

Each entry contains metadata, visual recipe, spawn constraints, base traits, Cove source, behavior tests, expected capabilities, compiled artifact hash, and catalog version.

Every creature must compile against pinned schemas, pass scenario tests, stay within fuel/time bounds, produce valid decisions for empty/crowded/adversarial observations, and have readable visual behavior.

## Architecture

Keep this repository separate from `myuon/cove`.

- Browser UI: TypeScript + Canvas 2D
- Simulation: Rust compiled to WebAssembly, including embedded Cove runtime
- Content: static, versioned creature catalog
- Hosting: static site/CDN; no database or application server
- Replay: URL parameters containing seed and pinned versions

If Cove cannot target browser/Wasm when the readiness gate opens, temporarily run the same renderer-independent Rust core behind a minimal server adapter. Browser execution remains the target.

Suggested layout:

```text
the-cove/
  docs/product-v0.md
  apps/web/
  crates/simulation/
  crates/cove-creature-host/
  catalog/species/<species-id>/
  packages/replay-format/
```

## Cove readiness gate

Implementation starts from a pinned Cove commit when all **must** items are satisfied.

### Must

- Authoritative Language Reference backed by conformance tests.
- Checker/interpreter agreement on references, values, and exported types.
- Host-provided nominal schemas visible to static checking.
- Typed Host inputs/outputs and invocation of a known export.
- Deterministic fuel budget with structured exhaustion errors.
- Invocation-local panic/runtime errors with useful spans.
- Bounded structured trace linked to invocation and creature ID.
- Embeddable runtime for the chosen Rust simulation target.
- No unbounded task/runtime-state growth across repeated invocation.

### Should

- Cheap compiled-module caching/instantiation.
- Trace sampling/disablement without semantic changes.
- Runtime/source identifiers for replay metadata.
- Browser/Wasm smoke test.

### Not blockers

Native AOT, package registry, server framework, strict memory bucket, effect system, totality proofs, and distributed runtime.

## Delivery slices

1. **Executable contract:** one headless creature, synthetic observations, deterministic/fuel/error/trace golden tests.
2. **Living tank:** Canvas renderer, fixed-step world, three visibly distinct species.
3. **Inspectability:** follow camera, plain-language reason, state, source, trace.
4. **Replay and catalog:** scrubber, state hashes, 12 species, share links.
5. **Public polish:** responsive UI, accessibility, profiling, static deployment, social preview.

## V0 acceptance criteria

- A cold visit starts without input.
- A world contains 8–14 creatures and at least three ecological roles.
- The same replay identity matches state hashes for 60 simulated seconds.
- One broken or fuel-exhausted creature cannot stop the world.
- Every visible action connects to a reason and Cove invocation.
- Source for every shipped creature is viewable.
- Creature programs have no network, filesystem, wall-clock, or visitor-code capability.
- Rendering targets 60 FPS on a representative laptop.
- The experience requires no account or backend.

## Measurements

Measure from the first slice: simulation and Cove invocation p50/p95/p99, fuel per species/tick, decisions per second, invalid decisions, runtime errors, fuel exhaustion, trace bytes, replay divergence, time to first world, and time to first interesting event.

These are product/runtime measurements, not a Go/Rust language benchmark.

## Deferred

- V1: authored daily worlds, richer explanations, replay gallery.
- V2: visitor prompts with a reviewed and sandboxed generation flow.
- V3: reproduction, numeric heritable traits, mutation, lineage tree.
- Later: AST-aware Cove behavior crossover.

Visitor generation stays deferred until the curated world proves compelling.
