#!/bin/sh
# Prints the crates that package $1 adds to the ark-hello list, with licences. Fails on MPL, GPL or LGPL.
# Usage (in rust/): sh scripts/third-party-section.sh ark-llm
set -eu
all=$(cargo tree -p "$1" -e normal,build --target aarch64-apple-darwin --prefix none -f '{p} {l}' | grep -v "^$1 " | sed 's/ (\*)$//;s/ (proc-macro)//' | sort -u)
if printf '%s\n' "$all" | grep -Ei 'MPL|GPL'; then echo "copyleft licence found" >&2; exit 1; fi
base=$(cargo tree -p ark-hello -e normal,build --target aarch64-apple-darwin --prefix none -f '{p} {l}' | sed 's/ (\*)$//;s/ (proc-macro)//' | sort -u)
printf '%s\n' "$all" | while IFS= read -r l; do printf '%s\n' "$base" | grep -qxF "$l" || printf '   %s\n' "$l"; done
