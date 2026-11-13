#!/bin/bash
D=$(cd "$(dirname "$0")" && pwd); A=$ANDROID_HOME/platform-tools/adb
: > $D/serial.tsv
xcrun simctl shutdown all
$D/run.sh android 5
$D/serial.sh android
for s in $($A devices | awk '/emulator-/{print $1}'); do $A -s $s emu kill; done
$D/run.sh web 5
$D/serial.sh web
$D/serial.sh ios
