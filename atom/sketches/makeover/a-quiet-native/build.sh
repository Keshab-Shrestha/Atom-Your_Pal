#!/bin/sh
# Inline src/shared.css + src/components.js into self-contained pages, then render PNGs.
set -e
cd "$(dirname "$0")"
python3 - <<'PY'
css = open('src/shared.css').read()
js = open('src/components.js').read()
for name in ('desktop', 'board'):
    src = open(f'src/{name}.src.html').read()
    open(f'{name}.html', 'w').write(src.replace('/*CSS*/', css, 1).replace('/*JS*/', js, 1))
PY
B="/Applications/Brave Browser.app/Contents/MacOS/Brave Browser"
# the page writes its real height to <html data-h>, and any JS error to <html data-err>
DOM=$("$B" --headless=new --disable-gpu --window-size=1440,900 --dump-dom "file://$PWD/board.html" 2>/dev/null | head -c 400)
H=$(printf '%s' "$DOM" | sed -n 's/.*data-h="\([0-9]*\)".*/\1/p' | head -1)
printf '%s' "$DOM" | grep -o 'data-err="[^"]*"' || true
"$B" --headless=new --disable-gpu --dump-dom "file://$PWD/desktop.html" 2>/dev/null | head -c 400 | grep -o 'data-err="[^"]*"' || true
"$B" --headless=new --disable-gpu --hide-scrollbars --force-device-scale-factor=1 --window-size=1440,900 --screenshot="$PWD/desktop.png" "file://$PWD/desktop.html" 2>/dev/null
"$B" --headless=new --disable-gpu --hide-scrollbars --force-device-scale-factor=1 --window-size=1440,${H:-3000} --screenshot="$PWD/board.png" "file://$PWD/board.html" 2>/dev/null
echo "rendered (board height ${H})"
