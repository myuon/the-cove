# The Cove

**AI wrote their instincts. Now watch them live.**

The Cove is a public digital ecosystem whose creatures are controlled by
programs written in [Cove](https://github.com/myuon/cove).

V0 will be a deterministic observation experience: each visit assembles a
seeded world from a curated catalog of creatures. There is no visitor prompt or
visitor-provided code. Visitors can watch, rewind, share, and inspect why each
creature acted—including the Cove source and execution trace.

- [V0 product and implementation brief](docs/product-v0.md)
- [The Cove readiness gate, assessed](docs/cove-gate.md) — every must-have
  checked against the implementation, with the file that proves it
- [Open issues](https://github.com/myuon/the-cove/issues)

## Status

The readiness gate ([#1](https://github.com/myuon/the-cove/issues/1)) is
passed and the contract runs. Cove is pinned by commit in the workspace
manifest, because the crates are not published and because a replay cannot
trust a branch.

Slice 0 is under way: one species, headless, and the golden tests that make it
an integration contract rather than a demonstration.

## The contract

One function crosses the boundary between the world and a creature:

```cove
export fn decide(view: SelfView, observation: Observation) -> Decision
```

The world hands a creature a bounded, immutable view of itself and of what it
can see. The creature answers exactly one intent and the reason for it.
Nothing else passes.

A species cannot name the world, so it cannot read the parts of it that it is
not being shown, and cannot write any part of it at all. Three things enforce
that and none of them is a runtime check: the module boundary decides what a
species may name, Cove's copy rule decides that what it names is a copy, and
the registry a session runs against is granted no capability, so a creature
program has no clock, no files, no network, and no randomness — not because it
is refused them, but because it was never handed anything to ask with.

There is no Host API module in slice 0 at all. The observation goes in as an
argument and the decision comes back as a result.

### What it costs

One decision costs the shy scavenger between **56 and 310 instructions**,
depending on how much it can see: 56 to eat what it is standing on, 246 to
decide there is nothing to do, 310 in a crowd. `fixtures/report.txt` is the
committed measurement and a test regenerates it, so a change in what a tick
costs arrives as a diff.

Every invocation carries its own fuel budget, installed as the call is entered
and left holding what that call spent. A creature that loops spends its own
fuel, is stopped, and the next creature is asked with a full budget on the same
backend. One broken creature costs one tick.

What the 1024-instruction safepoint stride decides is *when* the charge is
compared against the limit, not what the charge is. A run is stopped at the
first safepoint at or past its limit — a bound of 50,000 stops at 50,176 — and
a decision that ran to its end is charged exactly what it executed.

### What a replay is

```text
seed + catalog source hash + schema version + Cove commit + backend
```

The backend is in there because fuel is not portable between Cove's two
evaluators: they charge differently and can disagree on outcome under the same
limit. An identity that named a version and not a backend would not identify a
run.

## Layout

```text
catalog/
  contract/          the types the world and a creature share
  instinct/          the moves any creature could make, written once
  species/<id>/      one species, one `decide`
crates/creature-host/  compile once, invoke per creature per tick
docs/
fixtures/            the captured execution report
```

## Building it

```console
$ cargo t
```

`cargo t` is an alias carrying `--profile checked`, which is release with the
debug assertions and the overflow checks turned back on. This suite runs Cove
programs rather than merely compiling a harness, and an unoptimised build of
the VM is several times slower at it. A bare `cargo test` silently drops the
profile.

## Planned stack

TypeScript + Canvas 2D for the browser UI, with a deterministic Rust simulation
and embedded Cove runtime targeting WebAssembly. The intended deployment is a
static site with no account, database, or application server.

The wasm route is confirmed and its three conditions are known: the simulation
links `cove-runtime` directly rather than going through Cove's own playground
ABI, the JavaScript host must supply the import `cove.cove_now_millis() -> f64`
or the module will not instantiate, and Cove's `spawn` is refused on wasm — which
costs nothing here, because a creature is a pure function of its two arguments.
