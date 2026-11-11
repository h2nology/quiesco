#!/bin/bash
# 6.10 spike: does a module-level singleton survive across Vitest test files? Usage: bash run.sh
cd "$(dirname "$0")"
for cfg in "forks true" "forks false" "threads false"; do
  set -- $cfg
  printf 'export default { test: { pool: "%s", isolate: %s, fileParallelism: false, include: ["*.test.mjs"] } };\n' "$1" "$2" > vitest.config.mjs
  : > log.txt
  SPIKE_LOG="$PWD/log.txt" npx vitest run --config vitest.config.mjs 2>&1 | grep -E "Tests |Error" | head -3
  echo "== pool=$1 isolate=$2"
  cat log.txt
done
