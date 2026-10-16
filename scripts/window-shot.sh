#!/bin/sh
# Captures ATOM's open window to a PNG: sh scripts/window-shot.sh [out.png]  (default: /tmp/atom-window.png).
# Needs Screen Recording for the app that runs it. The window must be open (ATOM_OPEN_WINDOW=1, or open it from the menu bar).
set -eu
cd "$(dirname "$0")/.."
out="${1:-/tmp/atom-window.png}"
id="$(swift scripts/window-shot.swift)" || { echo "FAIL no ATOM window on screen (open it first)"; exit 1; }
screencapture -x -o -l "$id" "$out"
[ "$(wc -c < "$out")" -gt 20000 ] || { echo "FAIL the capture is almost empty: $out"; exit 1; }
echo "ok $out"
