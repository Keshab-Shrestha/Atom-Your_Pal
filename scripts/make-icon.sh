#!/bin/sh
# Renders ARK's Orbit icon (AppIconArt.swift) and makes assets/icon/ARK.icns.
#   scripts/make-icon.sh
# Run again after changing the icon's drawing or Pal's file; build-app.sh copies the .icns into the app.
set -eu
root=$(cd "$(dirname "$0")/.." && pwd)
island="$root/apps/mac/island"
work=$(mktemp -d)
trap 'rm -rf "$work"' EXIT

(cd "$island" && swift build --build-system native -c release --product ArkIsland)
ARK_ISLAND_GALLERY="$work" ARK_ISLAND_GALLERY_ONLY=icon "$island/.build/release/ArkIsland"
[ -f "$work/icon-1024.png" ] || { echo "The icon was not rendered." >&2; exit 1; }

set_dir="$work/ARK.iconset"
mkdir -p "$set_dir"
for size in 16 32 128 256 512; do
  sips -z "$size" "$size" "$work/icon-1024.png" --out "$set_dir/icon_${size}x${size}.png" >/dev/null
  double=$((size * 2))
  sips -z "$double" "$double" "$work/icon-1024.png" --out "$set_dir/icon_${size}x${size}@2x.png" >/dev/null
done
mkdir -p "$root/assets/icon"
iconutil -c icns "$set_dir" -o "$root/assets/icon/ARK.icns"
cp "$work/icon-1024.png" "$root/assets/icon/icon-1024.png"
echo "Made assets/icon/ARK.icns"
