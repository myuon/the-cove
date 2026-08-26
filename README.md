# The Cove

**AI wrote their instincts. Now watch them live.**

The Cove is a public digital ecosystem whose creatures are controlled by programs written in [Cove](https://github.com/myuon/cove).

V0 will be a deterministic observation experience: each visit assembles a seeded world from a curated catalog of creatures. There is no visitor prompt or visitor-provided code. Visitors can watch, rewind, share, and inspect why each creature acted—including the Cove source and execution trace.

Development begins when Cove satisfies the tracked readiness gate.

- [V0 product and implementation brief](docs/product-v0.md)
- [Open issues](https://github.com/myuon/the-cove/issues)

## Planned stack

TypeScript + Canvas 2D for the browser UI, with a deterministic Rust simulation and embedded Cove runtime targeting WebAssembly. The intended deployment is a static site with no account, database, or application server.
