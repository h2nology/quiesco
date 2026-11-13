#!/bin/bash
# Phase 6.12 batch D: cucumber --parallel 2 stability. Usage: run.sh <platform> <runs>
cd /Users/hu.shukang.19/workspaces/private/quiesco/examples/todo-app
export QUIESCO_AVD=Medium_Phone_API_37.0 QUIESCO_IOS_DEVICE="iPhone 17" QUIESCO_IOS_OS=27.0
P=$1; N=$2; OUT=$(dirname "$0")/$P.tsv; : > "$OUT"
for i in $(seq 1 "$N"); do
  LOG=$(dirname "$0")/$P-$i.log
  T=$(perl -MTime::HiRes=time -e 'printf "%.1f", time')
  pnpm test:e2e:$P:parallel > "$LOG" 2>&1
  E=$(perl -MTime::HiRes=time -e 'printf "%.1f", time')
  SUM=$(grep -E '^[0-9]+ scenarios' "$LOG")
  FAILS=$(grep -E '^\s+[0-9]+\) ' "$LOG" | sed 's/ #.*//; s/^ *//' | tr '\n' ';')
  NOTES=$(grep -cE "chose Wait|stopped answering|dismissing a system alert|no Face ID" "$LOG")
  printf '%s\t%s\t%.1f\t%s\t%s\tnotes=%s\n' "$P" "$i" "$(echo "$E - $T" | bc)" "$SUM" "$FAILS" "$NOTES" | tee -a "$OUT"
done
