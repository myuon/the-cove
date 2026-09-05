#!/usr/bin/env bash
# Builds the whole page: the wasm module, then the TypeScript, then puts the
# module where the compiled page can fetch it. `npm run build` alone only
# does the middle step — this is what a fresh checkout actually needs.
set -euo pipefail

here="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
root="$(cd "$here/../.." && pwd)"
wasm="$root/target/wasm32-unknown-unknown/checked/tank_wasm.wasm"

echo "==> cargo build -p tank-wasm --profile checked --target wasm32-unknown-unknown"
(cd "$root" && cargo build -p tank-wasm --profile checked --target wasm32-unknown-unknown)

echo "==> tsc"
(cd "$here" && npm run build --silent)

# dist/ is tsc's output directory and is where index.html fetches the module
# from (`new URL("./tank_wasm.wasm", import.meta.url)` in src/main.ts resolves
# next to the compiled main.js) — it has to land there, not next to index.html.
echo "==> copying tank_wasm.wasm into dist/"
cp "$wasm" "$here/dist/tank_wasm.wasm"

echo "==> done. Serve $here (e.g. \`npx serve $here\`) and open index.html."
