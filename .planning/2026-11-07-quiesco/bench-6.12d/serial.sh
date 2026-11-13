#!/bin/bash
# Phase 6.12 batch D: serial regression (no --parallel). Usage: serial.sh <platform>
cd /Users/hu.shukang.19/workspaces/private/quiesco/examples/todo-app
export QUIESCO_AVD=Medium_Phone_API_37.0 QUIESCO_IOS_DEVICE="iPhone 17" QUIESCO_IOS_OS=27.0
P=$1; D=$(dirname "$0"); LOG=$D/serial-$P.log
T=$(perl -MTime::HiRes=time -e 'printf "%.1f", time')
pnpm test:e2e:$P > "$LOG" 2>&1
E=$(perl -MTime::HiRes=time -e 'printf "%.1f", time')
printf '%s\tserial\t%.1f\t%s\t%s\n' "$P" "$(echo "$E - $T" | bc)" "$(grep -E '^[0-9]+ scenarios' "$LOG")" "$(grep -E '^\s+[0-9]+\) ' "$LOG" | sed 's/ #.*//; s/^ *//' | tr '\n' ';')" | tee -a "$D/serial.tsv"
