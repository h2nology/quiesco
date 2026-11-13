#!/bin/bash
D=$(cd "$(dirname "$0")" && pwd); A=$ANDROID_HOME/platform-tools/adb
$D/run.sh android 5
for s in $($A devices | awk '/emulator-/{print $1}'); do $A -s $s emu kill; done
$D/run.sh ios 20
xcrun simctl shutdown all
$D/run.sh web 5
