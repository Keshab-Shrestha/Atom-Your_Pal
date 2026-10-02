#!/bin/sh
# Runs the island's Swift tests (pnpm island:test).
#
# With only the Command Line Tools installed, SwiftPM loses track of the swift-testing macro plugin
# when it rebuilds a changed test file ("plugin for module 'TestingMacros' not found"); a clean build
# works. Passing the plugin folder explicitly makes every build work.
set -eu
cd "$(dirname "$0")"

plugins="$(xcode-select -p)/usr/lib/swift/host/plugins/testing"
if [ -d "$plugins" ]; then
  exec swift test -Xswiftc -plugin-path -Xswiftc "$plugins" "$@"
fi
exec swift test "$@"
