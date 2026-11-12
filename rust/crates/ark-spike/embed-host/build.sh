#!/bin/sh
# Builds the ark-spike static library, then the SwiftUI host, then runs it.
# Run from this folder: ./build.sh  (needs rustup on PATH, see rust/README.md).
set -eu
cd "$(dirname "$0")"
(cd ../../.. && cargo rustc --locked -p ark-spike --lib --crate-type staticlib)
swift build
exec .build/debug/EmbedHost
