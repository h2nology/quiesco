#!/bin/bash
D=$(dirname "$0"); A=$ANDROID_HOME/platform-tools/adb; : > $D/load.log
( while true; do { date +%T; uptime | sed 's/.*load/load/'; ps -Ao pcpu,comm -r | sed -n 2,6p | cut -c1-100; } >> $D/load.log; sleep 20; done ) &
P=$!
cd /Users/hu.shukang.19/workspaces/private/quiesco/examples/todo-app
export QUIESCO_AVD=Medium_Phone_API_37.0
for i in 1 2 3 4; do
  T=$(date +%s)
  pnpm test:e2e:android:parallel > $D/r2-$i.log 2>&1
  echo "run $i ($(( $(date +%s)-T ))s): $(grep -E '^[0-9]+ scenarios' $D/r2-$i.log)"
  for s in $($A devices | awk '/emulator-/{print $1}'); do echo "  $s watchdog kills: $($A -s $s logcat -d -b all | grep -c 'WATCHDOG KILLING')"; done
  grep -q "BeforeAll" $D/r2-$i.log && { echo STOPPED; break; }
done
kill $P
