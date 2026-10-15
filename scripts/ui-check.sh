#!/bin/sh
# UI check for the island app (pnpm island:ui-check). Build the app first (pnpm island:build).
#
# 1. Gallery: renders every window with sample data to PNG files with no screen. Fails on any "gallery:" error, a
#    missing shot, or an almost empty file. Includes the shots for what broke in use: a reply with a table, and a
#    Settings page with its Back arrow. Look at them: GALLERY_DIR=<dir> keeps the files there.
# 2. Live: reads the text of the open ATOM window through Accessibility. Fails when the window is not up or raw
#    Markdown (a `| a | b |` row, `**bold**`) reaches the screen.
#    Skipped with LIVE=0. It starts ATOM with its window open when the app is not running.
set -eu
cd "$(dirname "$0")/.."
app="apps/mac/island/build/ATOM.app"
[ -d "$app" ] || { echo "FAIL build the app first: pnpm island:build"; exit 1; }

dir="${GALLERY_DIR:-$(mktemp -d)}"
mkdir -p "$dir"
errors="$(ATOM_ISLAND_GALLERY="$dir" "$app/Contents/MacOS/ATOM" 2>&1 >/dev/null | grep '^gallery:' || true)"
[ -z "$errors" ] || { echo "FAIL the gallery reported errors:"; echo "$errors"; exit 1; }
for shot in 13-helpers 13-helpers-chat-table 13-helpers-settings-page 13-helpers-dashboard; do
  file="$dir/$shot.png"
  [ -f "$file" ] || { echo "FAIL missing gallery shot: $shot.png"; exit 1; }
  [ "$(wc -c < "$file")" -gt 30000 ] || { echo "FAIL gallery shot is almost empty: $shot.png"; exit 1; }
done
echo "ok gallery: $(ls "$dir" | grep -c '\.png$') shots in $dir"

[ "${LIVE:-1}" = "1" ] || exit 0
if ! pgrep -f "ATOM.app/Contents/MacOS/ATOM" >/dev/null; then
  open --env ATOM_OPEN_WINDOW=1 "$app"
  sleep 8
fi
result="$(osascript -l JavaScript scripts/ui-check.js 2>&1 | awk '!seen[$0]++')" # osascript prints to both streams
echo "$result"
case "$result" in ok*) ;; *) exit 1 ;; esac
