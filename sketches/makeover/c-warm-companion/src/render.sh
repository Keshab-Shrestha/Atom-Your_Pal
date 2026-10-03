#!/bin/bash
# Rebuild + render both deliverables.
set -e
cd "$(dirname "$0")/.."
python3 src/build_desktop.py
python3 src/build_board.py
H=$(src/measure.sh "$PWD/board.html" 'return document.documentElement.scrollHeight' 1440 3000 | grep -o '@\?[0-9]\+$' | tail -1)
H=$(src/measure.sh "$PWD/board.html" 'return document.documentElement.scrollHeight' 1440 3000 | grep -oE '[0-9]+' | tail -1)
echo "board height: $H"
src/shot.sh "$PWD/desktop.html" "$PWD/desktop.png" 1440 900
src/shot.sh "$PWD/board.html" "$PWD/board.png" 1440 "$H"
sips -g pixelWidth -g pixelHeight desktop.png board.png | grep pixel
