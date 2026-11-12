#!/bin/sh
# Build ARK.app (dev.ark.island) from the release binaries. No signing.
# Usage: scripts/bundle-app.sh [OUT_DIR]   (default OUT_DIR: target)
set -eu
cd "$(dirname "$0")/.."
export CARGO_INCREMENTAL=0
cargo build --release -p ark-app -p ark-runtime
OUT="${1:-target}/ARK.app"
rm -rf "$OUT"
mkdir -p "$OUT/Contents/MacOS" "$OUT/Contents/Resources"
cp target/release/ark-app "$OUT/Contents/MacOS/ARK"
[ -f target/release/ark-runtime ] && cp target/release/ark-runtime "$OUT/Contents/MacOS/ark-runtime"
# The Node project root; the launcher reads Resources/project-root.
printf '%s\n' "$(cd .. && pwd)" > "$OUT/Contents/Resources/project-root"
cat > "$OUT/Contents/Info.plist" <<'PL'
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0"><dict>
<key>CFBundleIdentifier</key><string>dev.ark.island</string>
<key>CFBundleName</key><string>ARK</string>
<key>CFBundleExecutable</key><string>ARK</string>
<key>CFBundlePackageType</key><string>APPL</string>
<key>CFBundleShortVersionString</key><string>0.0.1</string>
<key>LSMinimumSystemVersion</key><string>13.0</string>
<key>NSHighResolutionCapable</key><true/>
<key>NSMicrophoneUsageDescription</key><string>ARK listens when you dictate.</string>
</dict></plist>
PL
echo "$OUT"
