#!/bin/sh
# UI check for the island app (pnpm island:ui-check). Build the app first (pnpm island:build).
#
# 1. Gallery: renders every window with sample data to PNG files with no screen. Fails on any "gallery:" error, a
#    missing shot, or an almost empty file. Includes the shots for what broke in use: a reply with a table, and a
#    Settings page with its Back arrow. Look at them: GALLERY_DIR=<dir> keeps the files there.
# 1b. Golden shots (below): three shots are compared to tests/ui-golden by pixel; UPDATE=1 keeps a new look.
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
for shot in 13-helpers 13-helpers-chat-table 13-helpers-settings-page 13-helpers-dashboard 40-notes-source-analysis 40-analysis-recovery-dark 40-contextual-reply 40-prepared-brief-cards 40-local-backup 40-local-backup-compact-dark; do
  file="$dir/$shot.png"
  [ -f "$file" ] || { echo "FAIL missing gallery shot: $shot.png"; exit 1; }
  [ "$(wc -c < "$file")" -gt 30000 ] || { echo "FAIL gallery shot is almost empty: $shot.png"; exit 1; }
done
echo "ok gallery: $(ls "$dir" | grep -c '\.png$') shots in $dir"

# 1b. Golden shots: the render must look like tests/ui-golden/*.png. Two renders of the same code differ by under
#     0.2% (moving avatars), so more than 1% changed pixels, or another size, fails. A diff image (changes in red)
#     is written next to the shots. After a change you meant, look at the new shots, then run UPDATE=1 to keep them.
for golden in tests/ui-golden/*.png; do
  name="$(basename "$golden")"
  if [ "${UPDATE:-0}" = "1" ]; then cp "$dir/$name" "$golden"; echo "updated golden: $name"; continue; fi
  result="$(swift scripts/png-diff.swift "$golden" "$dir/$name" "$dir/diff-$name")" || { echo "FAIL $name: $result (diff: $dir/diff-$name)"; exit 1; }
  awk -v p="${result%% *}" 'BEGIN { exit !(p > 1.0) }' && { echo "FAIL $name changed in ${result%% *}% of its pixels (diff: $dir/diff-$name; UPDATE=1 keeps the new look)"; exit 1; }
  echo "ok golden: $name ${result%% *}% changed"
done

[ "${LIVE:-1}" = "1" ] || exit 0
if ! pgrep -f "ATOM.app/Contents/MacOS/ATOM" >/dev/null; then
  open --env ATOM_OPEN_WINDOW=1 "$app"
  sleep 8
fi
result="$(osascript -l JavaScript scripts/ui-check.js 2>&1 | awk '!seen[$0]++')" # osascript prints to both streams
echo "$result"
case "$result" in ok*) ;; *) exit 1 ;; esac
