#!/bin/bash
# 6.10 spike: Vitest worker-scoped fixture across files (setup once? teardown runs?). Usage: bash run-fixture.sh
cd "$(dirname "$0")"
for iso in true false; do
  printf 'export default { test: { pool: "forks", isolate: %s, fileParallelism: false, include: ["*.fx.test.mjs"] } };\n' "$iso" > vitest.config.mjs
  : > log.txt
  SPIKE_LOG="$PWD/log.txt" npx vitest run --config vitest.config.mjs 2>&1 | grep -E "Tests |Error" | head -3
  echo "== isolate=$iso"; cat log.txt
done
