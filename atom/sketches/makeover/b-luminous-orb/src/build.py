#!/usr/bin/env python3
"""Inline common.js into each page so the delivered HTML is fully self-contained, then render with Brave."""
import pathlib, subprocess, sys

HERE = pathlib.Path(__file__).resolve().parent
OUT = HERE.parent
common = (HERE / "common.js").read_text()
B = "/Applications/Brave Browser.app/Contents/MacOS/Brave Browser"

def build(name, title, width, height):
    body = (HERE / f"{name}.body.html").read_text()
    html = f"""<!doctype html>
<html lang="en"><head><meta charset="utf-8"><title>{title}</title>
<meta name="viewport" content="width={width}">
<script>
{common}
</script>
</head><body>
{body}
</body></html>
"""
    (OUT / f"{name}.html").write_text(html)
    png = OUT / f"{name}.png"
    subprocess.run([B, "--headless=new", "--disable-gpu", "--hide-scrollbars", "--force-device-scale-factor=1",
                    f"--window-size={width},{height}", f"--screenshot={png}", f"file://{OUT / (name + '.html')}"],
                   check=True, capture_output=True, timeout=120)
    print("rendered", png)

if __name__ == "__main__":
    bh = int(sys.argv[1]) if len(sys.argv) > 1 else 3200
    build("desktop", "ZENO · B Luminous Orb · Desktop", 1440, 900)
    build("board", "ZENO · B Luminous Orb · Board", 1440, bh)
