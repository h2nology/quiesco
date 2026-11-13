#!/bin/bash
D=$(cd "$(dirname "$0")" && pwd)
( while true; do echo "$(date +%T) $(sysctl -n vm.loadavg)"; sleep 30; done ) > $D/android-load.txt &
L=$!
$D/run.sh android 5
$D/serial.sh android
kill $L
