#!/bin/sh
# ADR-091: renders ZENO.app's icon (Pal on the Void tile, AppIconArt.swift) and makes assets/icon/ZENO.icns.
#   scripts/make-icon.sh
# Run again after changing the icon's drawing or Pal's file; build-app.sh copies the .icns into the app.
set -eu
root=$(cd "$(dirname "$0")/.." && pwd)
island="$root/apps/mac/island"
work=$(mktemp -d)
trap 'rm -rf "$work"' EXIT

(cd "$island" && swift build --product ZenoIsland 2>&1 | grep -E "error" || true)
ZENO_ISLAND_GALLERY="$work" ZENO_ISLAND_GALLERY_ONLY=icon "$island/.build/debug/ZenoIsland"
[ -f "$work/icon-1024.png" ] || { echo "The icon was not rendered." >&2; exit 1; }

set_dir="$work/ZENO.iconset"
mkdir -p "$set_dir"
for size in 16 32 128 256 512; do
  sips -z "$size" "$size" "$work/icon-1024.png" --out "$set_dir/icon_${size}x${size}.png" >/dev/null
  double=$((size * 2))
  sips -z "$double" "$double" "$work/icon-1024.png" --out "$set_dir/icon_${size}x${size}@2x.png" >/dev/null
done
mkdir -p "$root/assets/icon"
iconutil -c icns "$set_dir" -o "$root/assets/icon/ZENO.icns"
cp "$work/icon-1024.png" "$root/assets/icon/icon-1024.png"
echo "Made assets/icon/ZENO.icns"
