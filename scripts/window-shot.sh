#!/bin/sh
# Captures ARK's open window to a PNG: sh scripts/window-shot.sh [out.png]  (default: /tmp/ark-window.png).
# Needs Screen Recording for the app that runs it. The window must be open (ARK_OPEN_WINDOW=1, or open it from the menu bar).
set -eu
cd "$(dirname "$0")/.."
out="${1:-/tmp/ark-window.png}"
id="$(swift scripts/window-shot.swift)" || { echo "FAIL no ARK window on screen (open it first)"; exit 1; }
screencapture -x -o -l "$id" "$out"
[ "$(wc -c < "$out")" -gt 20000 ] || { echo "FAIL the capture is almost empty: $out"; exit 1; }
echo "ok $out"
