"""Wisp + icon SVG generators for direction C (Warm Companion)."""

INK = "#1F2B29"
OUT = "#1E6B60"
ARM = "#E7F7F2"


def body_path(dl=0.0, dr=0.0, pinch=False):
    if pinch:
        top = "M60 6 C63.5 6 65.5 11 70 14 C84 19 92 33 93 49"
        close = "C28 33 36 19 50 14 C54.5 11 56.5 6 60 6Z"
    else:
        top = "M60 14 C82 14 92 31 93 49"
        close = "C28 31 38 14 60 14Z"
    return (f"{top} C94 66 102 79 102 96 C102 112 92 123 84 {128+dr} "
            f"Q78 {132.5+dr} 73.5 {127+dr} C69 121 64.5 118.5 60 118.5 "
            f"C55.5 118.5 51 121 46.5 {127+dl} Q42 {132.5+dl} 36 {128+dl} "
            f"C28 123 18 112 18 96 C18 79 26 66 27 49 {close}")


MOODS = {
    "resting":  dict(tf="translate(0,6)", eyes="normal", mouth="smile", shadow=(34, .22)),
    "floating": dict(tf="translate(0,-6) rotate(-5 60 80)", eyes="normal", look=(-1.5, 0), mouth="smile",
                     dl=-2.5, dr=3, shadow=(25, .13)),
    "listening": dict(tf="translate(-3,-2) rotate(-8 60 118) translate(60,118) scale(1.04) translate(-60,-118)",
                      eyes="wide", look=(-1, .5), mouth="o", dl=3, dr=-2, halo="mint", shadow=(28, .15), under="mint"),
    "thinking": dict(tf="rotate(8 60 112)", eyes="up", mouth="flat", arms=["chin"], shadow=(28, .15)),
    "speaking": dict(tf="translate(0,-8) translate(60,118) scale(1.03,.97) translate(-60,-118)", eyes="normal",
                     mouth="open", halo="mintsoft", dl=1.5, dr=1.5, shadow=(24, .12)),
    "problem":  dict(tf="translate(6,14) scale(.9)", eyes="small", brows=True, mouth="frown", halo="amber",
                     shadow=(30, .2)),
    "napping":  dict(tf="translate(-2,9) translate(60,128) scale(1.07,.88) translate(-60,-128)", eyes="closed",
                     mouth="sleep", shadow=(38, .22)),
    "carried":  dict(tf="translate(60,10) scale(.86,1.1) translate(-60,-8)", eyes="wide", look=(0, -3),
                     mouth="o", dl=7, dr=7, arms=["dangleL", "dangleR"], cursor=True, shadow=(16, .07)),
    "hiding":   dict(tf="translate(56,10) rotate(-12 60 120)", eyes="normal", look=(-2.5, 0), mouth="smile",
                     edge=True, shadow=None),
    "pointing": dict(tf="rotate(5 60 112)", eyes="normal", look=(2.5, -1), mouth="smile", arms=["point"],
                     shadow=(28, .15)),
}


def eyes_svg(kind, look=(0, 0)):
    lx, ly = look
    out = []
    pos = [(48.5, 57), (71.5, 57)]
    if kind == "up":
        pos = [(50, 54.5), (73, 54.5)]
    for (ex, ey) in pos:
        ex += lx; ey += ly
        if kind == "closed":
            out.append(f'<path d="M{ex-5.2} {ey+.5} Q{ex} {ey+5.2} {ex+5.2} {ey+.5}" fill="none" stroke="{INK}" '
                       f'stroke-width="2.4" stroke-linecap="round"/>')
            continue
        if kind == "happy":
            out.append(f'<path d="M{ex-4.6} {ey+1.8} Q{ex} {ey-5.6} {ex+4.6} {ey+1.8} Q{ex} {ey+.2} {ex-4.6} {ey+1.8}Z" '
                       f'fill="{INK}" stroke="{INK}" stroke-width="1.2" stroke-linejoin="round"/>')
            continue
        rx, ry, hr = {"normal": (4.4, 5.9, 1.5), "wide": (5.1, 6.9, 1.9), "up": (4.1, 5.5, 1.4),
                      "small": (3.8, 5.0, 1.3)}[kind]
        out.append(f'<ellipse cx="{ex}" cy="{ey}" rx="{rx}" ry="{ry}" fill="{INK}"/>')
        hx, hy = (ex + 1.5, ey - 2.4) if kind != "up" else (ex + 1.7, ey - 2.6)
        out.append(f'<circle cx="{hx}" cy="{hy}" r="{hr}" fill="#fff"/>')
        out.append(f'<circle cx="{ex-1.4}" cy="{ey+2.4}" r="{hr*.4:.2f}" fill="#fff" opacity=".55"/>')
    return "".join(out)


def mouth_svg(kind, u, look=(0, 0)):
    lx, ly = look
    sk = f'fill="none" stroke="{INK}" stroke-width="2.2" stroke-linecap="round"'
    g = f'<g transform="translate({lx*.6},{ly*.6})">'
    if kind == "smile":
        m = f'<path d="M55 72.5 Q60 77 65 72.5" {sk}/>'
    elif kind == "o":
        m = f'<ellipse cx="60" cy="74" rx="2.5" ry="3.1" fill="{INK}"/>'
    elif kind == "flat":
        m = f'<path d="M58 72.5 Q61.5 72 65.5 70.6" {sk}/>'
    elif kind == "frown":
        m = f'<path d="M55.5 76 Q60 72.2 64.5 76" {sk}/>'
    elif kind == "sleep":
        m = f'<path d="M57.5 74.5 Q60 75.8 62.5 74.5" {sk} stroke-width="2"/>'
    elif kind == "open":
        d = "M53.6 70.6 Q60 69.4 66.4 70.6 Q66 80.5 60 80.5 Q54 80.5 53.6 70.6Z"
        m = (f'<clipPath id="{u}mc"><path d="{d}"/></clipPath><path d="{d}" fill="#3A2724"/>'
             f'<ellipse cx="60" cy="80" rx="4.4" ry="3" fill="#FF8D72" clip-path="url(#{u}mc)"/>'
             f'<path d="{d}" fill="none" stroke="{INK}" stroke-width="1.3" stroke-linejoin="round"/>')
    else:
        m = ""
    return g + m + "</g>"


import math

ARMS = {
    # (p0, c1, c2, p3, base width, tip width)
    "chin": ((24, 100), (28, 88), (41, 82.5), (55, 78.2), 11.5, 7.5),
    "point": ((84, 90), (97, 86), (107, 77), (117, 66), 12, 7.5),
    "dangleL": ((31, 80), (22, 88), (17, 99), (17, 110), 12.5, 8.5),
    "dangleR": ((89, 80), (98, 88), (103, 99), (103, 110), 12.5, 8.5),
}


def _bez(p0, c1, c2, p3, t):
    mt = 1 - t
    x = mt**3*p0[0] + 3*mt*mt*t*c1[0] + 3*mt*t*t*c2[0] + t**3*p3[0]
    y = mt**3*p0[1] + 3*mt*mt*t*c1[1] + 3*mt*t*t*c2[1] + t**3*p3[1]
    return x, y


def limb_path(p0, c1, c2, p3, w0, w1, n=18):
    pts = [_bez(p0, c1, c2, p3, i / n) for i in range(n + 1)]
    L, R = [], []
    for i, (x, y) in enumerate(pts):
        a = pts[max(i - 1, 0)]; b = pts[min(i + 1, n)]
        dx, dy = b[0] - a[0], b[1] - a[1]
        d = math.hypot(dx, dy) or 1
        nx, ny = -dy / d, dx / d
        t = i / n
        w = (w0 + (w1 - w0) * t) / 2
        L.append((x + nx * w, y + ny * w)); R.append((x - nx * w, y - ny * w))
    ex, ey = pts[-1]; r = w1 / 2
    d = "M" + " L".join(f"{x:.2f} {y:.2f}" for x, y in L)
    d += f" A{r:.2f} {r:.2f} 0 0 0 {R[-1][0]:.2f} {R[-1][1]:.2f}"
    d += " L" + " L".join(f"{x:.2f} {y:.2f}" for x, y in reversed(R))
    d += f" A{w0/2:.2f} {w0/2:.2f} 0 0 0 {L[0][0]:.2f} {L[0][1]:.2f}Z"
    return d, (ex, ey)


def arm_svg(name, u):
    p0, c1, c2, p3, w0, w1 = ARMS[name]
    d, (ex, ey) = limb_path(p0, c1, c2, p3, w0, w1)
    return (f'<path d="{d}" fill="url(#{u}g)" stroke="{OUT}" stroke-opacity=".3" stroke-width="1"/>'
            f'<circle cx="{ex-1.2:.1f}" cy="{ey-1.4:.1f}" r="1.6" fill="#fff" opacity=".85"/>')


def wisp(mood="resting", h=120, uid="w", vb=None, cls="", style="", portrait=False):
    m = MOODS[mood]
    u = uid
    B = body_path(m.get("dl", 0), m.get("dr", 0), m.get("pinch", False))
    W, H = 140, 150
    viewbox = vb or f"0 0 {W} {H}"
    vbw, vbh = [float(x) for x in viewbox.split()[2:]]
    w = h * vbw / vbh
    under = {"mint": "#2BC9B2", "amber": "#E7A33B"}.get(m.get("under"), "#4FB8A6")
    under_op = .5 if m.get("under") else .34
    p = []
    p.append(f'<svg class="wisp {cls}" style="{style}" width="{w:.1f}" height="{h}" viewBox="{viewbox}" '
             f'xmlns="http://www.w3.org/2000/svg" overflow="visible">')
    p.append(f'''<defs>
<radialGradient id="{u}g" gradientUnits="userSpaceOnUse" cx="47" cy="36" r="104"><stop offset="0" stop-color="#FFFFFF"/><stop offset=".4" stop-color="#F2FBF8"/><stop offset=".78" stop-color="#D9F2EB"/><stop offset="1" stop-color="#C6E9DF"/></radialGradient>
<clipPath id="{u}c"><path d="{B}"/></clipPath>
<filter id="{u}b8" x="-50%" y="-50%" width="200%" height="200%"><feGaussianBlur stdDeviation="7"/></filter>
<filter id="{u}b2" x="-20%" y="-20%" width="140%" height="140%"><feGaussianBlur stdDeviation="1.8"/></filter>
<linearGradient id="{u}rim" gradientUnits="userSpaceOnUse" x1="40" y1="120" x2="100" y2="40"><stop offset=".45" stop-color="#fff" stop-opacity="0"/><stop offset=".85" stop-color="#fff" stop-opacity=".95"/></linearGradient>
<radialGradient id="{u}hm"><stop offset="0" stop-color="#FFFFFF" stop-opacity=".75"/><stop offset=".42" stop-color="#7FE6D6" stop-opacity=".38"/><stop offset=".72" stop-color="#5ADCC8" stop-opacity=".12"/><stop offset="1" stop-color="#5ADCC8" stop-opacity="0"/></radialGradient>
<radialGradient id="{u}hs"><stop offset="0" stop-color="#FFFFFF" stop-opacity=".6"/><stop offset=".5" stop-color="#7FE6D6" stop-opacity=".18"/><stop offset="1" stop-color="#7FE6D6" stop-opacity="0"/></radialGradient>
<radialGradient id="{u}ha"><stop offset="0" stop-color="#FFF6E2" stop-opacity=".85"/><stop offset=".45" stop-color="#FFC861" stop-opacity=".42"/><stop offset=".75" stop-color="#FFB33D" stop-opacity=".12"/><stop offset="1" stop-color="#FFB33D" stop-opacity="0"/></radialGradient>
<clipPath id="{u}edge"><rect x="-40" y="-40" width="160" height="240"/></clipPath>
<linearGradient id="{u}bz" x1="0" x2="1"><stop offset="0" stop-color="#3A3530"/><stop offset="1" stop-color="#1D1B18"/></linearGradient>
</defs>''')
    halo = m.get("halo")
    if halo and not portrait:
        gid = {"mint": "hm", "mintsoft": "hs", "amber": "ha"}[halo]
        cy = 94 if halo == "amber" else 78
        p.append(f'<ellipse cx="70" cy="{cy}" rx="70" ry="68" fill="url(#{u}{gid})"/>')
    sh = m.get("shadow")
    if sh and not portrait:
        p.append(f'<ellipse cx="70" cy="146" rx="{sh[0]}" ry="4" fill="#5A3A1C" opacity="{sh[1]}" filter="url(#{u}b2)"/>')
    clip = f' clip-path="url(#{u}edge)"' if m.get("edge") else ""
    p.append(f'<g{clip}><g transform="translate(10,4)"><g transform="{m["tf"]}">')
    for a in m.get("arms", []):
        if a != "chin":
            p.append(arm_svg(a, u))
    p.append(f'<path d="{B}" fill="url(#{u}g)"/>')
    p.append(f'<g clip-path="url(#{u}c)">'
             f'<ellipse cx="60" cy="140" rx="58" ry="32" fill="{under}" opacity="{under_op}" filter="url(#{u}b8)"/>'
             f'<path d="{B}" fill="none" stroke="#2F8F80" stroke-opacity=".18" stroke-width="7" filter="url(#{u}b2)"/>'
             f'<path d="{B}" fill="none" stroke="url(#{u}rim)" stroke-width="4.5"/>'
             f'<ellipse cx="44" cy="33" rx="12" ry="6.5" fill="#fff" opacity=".95" transform="rotate(-30 44 33)" filter="url(#{u}b2)"/>'
             f'</g>')
    p.append(f'<path d="{B}" fill="none" stroke="{OUT}" stroke-opacity=".3" stroke-width="1.1"/>')
    if m.get("brows"):
        p.append(f'<path d="M43.5 47.6 Q47.8 46.6 52.6 44" fill="none" stroke="{INK}" stroke-width="2" stroke-linecap="round" opacity=".85"/>'
                 f'<path d="M67.4 44 Q72.2 46.6 76.5 47.6" fill="none" stroke="{INK}" stroke-width="2" stroke-linecap="round" opacity=".85"/>')
    p.append(eyes_svg(m["eyes"], m.get("look", (0, 0))))
    p.append(mouth_svg(m["mouth"], u, m.get("look", (0, 0))))
    if "chin" in m.get("arms", []):
        p.append(arm_svg("chin", u))
    p.append('</g></g></g>')
    if m.get("edge") and not portrait:
        # screen bezel + mitten hand curled over its edge
        p.append(f'<rect x="120" y="-14" width="22" height="178" fill="url(#{u}bz)"/>'
                 f'<rect x="120" y="-14" width="1" height="178" fill="#fff" opacity=".22"/>')
        p.append(f'<path d="M114 43 C114 40 117 38.5 121 38.5 L126.5 38.5 C129.5 38.5 131 40.3 131 42.4 C131 44.4 129.6 45.6 128 45.8 '
                 f'C129.8 46 131 47.4 131 49.3 C131 51.2 129.8 52.6 128 52.8 C129.6 53 130.6 54.3 130.6 56 C130.6 58.2 128.8 59.5 126.4 59.5 '
                 f'L121 59.5 C117 59.5 114 57.5 114 54.5Z" fill="url(#{u}g)" stroke="{OUT}" stroke-opacity=".38" stroke-width="1.1"/>'
                 f'<circle cx="124" cy="42" r="1.4" fill="#fff" opacity=".9"/>')
    if m.get("cursor") and not portrait:
        p.append('<g transform="translate(66,-2)"><path d="M0 0 L0 15.5 L3.9 12.1 L6.6 18.3 L9.2 17.2 L6.6 11.2 L11.6 11.2Z" '
                 'fill="#1D1B18" stroke="#fff" stroke-width="1.3" stroke-linejoin="round"/></g>')
    p.append('</svg>')
    return "".join(p)


def portrait(mood, size=40, uid="p"):
    """Head-and-shoulders crop for avatars."""
    return wisp(mood, h=size, uid=uid, vb="22 20 96 96", portrait=True)


# ---------- line icons (24 grid, 1.6 stroke, round) ----------
IC = {
    "chat": '<path d="M7.5 4.5h9A2.5 2.5 0 0 1 19 7v6a2.5 2.5 0 0 1-2.5 2.5H11.5L7.5 19v-3.5A2.5 2.5 0 0 1 5 13V7a2.5 2.5 0 0 1 2.5-2.5z"/>',
    "pulse": '<path d="M3.5 12.5h3.8l2.4-5.5 4.6 11 2.4-5.5h3.8"/>',
    "sliders": '<path d="M4 7.5h9.5M18.5 7.5H20M4 16.5h2.5M11.5 16.5H20"/><circle cx="16" cy="7.5" r="2.4"/><circle cx="9" cy="16.5" r="2.4"/>',
    "compose": '<path d="M12 5H7.5A2.5 2.5 0 0 0 5 7.5v9A2.5 2.5 0 0 0 7.5 19h9a2.5 2.5 0 0 0 2.5-2.5V12"/><path d="M17.3 4.2l2.5 2.5-7.3 7.3-3.3.8.8-3.3z"/>',
    "mic": '<rect x="9" y="3.5" width="6" height="10.5" rx="3"/><path d="M5.8 11a6.2 6.2 0 0 0 12.4 0M12 17.2v3.3"/>',
    "wave": '<path d="M4 10.5v3M8 7.5v9M12 4.5v15M16 8v8M20 10.5v3"/>',
    "speaker": '<path d="M4.5 9.5h2.8l4.2-3.8v12.6l-4.2-3.8H4.5z"/><path d="M15 9.2a3.8 3.8 0 0 1 0 5.6M17.6 6.6a7.5 7.5 0 0 1 0 10.8"/>',
    "sparkle": '<path d="M11 4l1.7 4.8 4.8 1.7-4.8 1.7L11 17l-1.7-4.8-4.8-1.7 4.8-1.7z"/><path d="M18 14.5l.7 1.8 1.8.7-1.8.7-.7 1.8-.7-1.8-1.8-.7 1.8-.7z"/>',
    "cursor": '<path d="M6.5 4.5l12 6.3-5.2 1.6-2.2 5.1z"/>',
    "cpu": '<rect x="6.5" y="6.5" width="11" height="11" rx="2.5"/><path d="M9.5 3.5v3M14.5 3.5v3M9.5 17.5v3M14.5 17.5v3M3.5 9.5h3M3.5 14.5h3M17.5 9.5h3M17.5 14.5h3"/>',
    "timer": '<circle cx="12" cy="13" r="7"/><path d="M12 13V9.5M10 3.5h4"/>',
    "chevR": '<path d="M9.5 6.5l5.5 5.5-5.5 5.5"/>',
    "chevL": '<path d="M14.5 6.5L9 12l5.5 5.5"/>',
    "updown": '<path d="M8.5 9.5L12 6l3.5 3.5M8.5 14.5L12 18l3.5-3.5"/>',
    "keyboard": '<rect x="3.5" y="6.5" width="17" height="11" rx="2.5"/><path d="M7.5 10.2h.01M10.5 10.2h.01M13.5 10.2h.01M16.5 10.2h.01M8.5 14h7"/>',
    "ibeam": '<path d="M9 4.5c1.6 0 3 .8 3 2.5v10c0 1.7-1.4 2.5-3 2.5M15 4.5c-1.6 0-3 .8-3 2.5M15 19.5c-1.6 0-3-.8-3-2.5M10 12h4"/>',
    "window": '<rect x="3.5" y="5" width="17" height="14" rx="3"/><path d="M3.5 9h17"/>',
    "power": '<path d="M12 3.8v7.4M7.4 6.6a7.2 7.2 0 1 0 9.2 0"/>',
    "check": '<path d="M5.5 12.5l4.2 4.2L18.5 7.8"/>',
    "warn": '<path d="M10.3 5.2a2 2 0 0 1 3.4 0l7 12.1a2 2 0 0 1-1.7 3H5a2 2 0 0 1-1.7-3z"/><path d="M12 10v3.8M12 16.9v.1"/>',
    "wifislash": '<path d="M4 9.2a12 12 0 0 1 16 0M7.1 12.6a7.5 7.5 0 0 1 9.8 0M10 16a3 3 0 0 1 4 0M4.5 4.5l15 15"/>',
    "clipboard": '<rect x="5.5" y="5" width="13" height="15.5" rx="2.5"/><rect x="9" y="3.2" width="6" height="3.6" rx="1.4"/>',
    "return": '<path d="M18.5 6v5a3 3 0 0 1-3 3h-10M9 10.5L5.5 14 9 17.5"/>',
    "bubble": '<path d="M6 5.5h12a2.5 2.5 0 0 1 2.5 2.5v6a2.5 2.5 0 0 1-2.5 2.5h-7l-4 3v-3H6A2.5 2.5 0 0 1 3.5 14V8A2.5 2.5 0 0 1 6 5.5z"/><path d="M8 11h8"/>',
    "ghost": '<path d="M12 4c3.4 0 5 2.6 5.1 5.4.1 2.4 1.4 4 1.4 6.2 0 1.9-1.2 3-2.5 3.6-.6.3-1.1 0-1.5-.5-.7-.8-1.6-1.2-2.5-1.2s-1.8.4-2.5 1.2c-.4.5-.9.8-1.5.5-1.3-.6-2.5-1.7-2.5-3.6 0-2.2 1.3-3.8 1.4-6.2C7 6.6 8.6 4 12 4z"/><path d="M10 10v.6M14 10v.6"/>',
    "xmark": '<path d="M7.5 7.5l9 9M16.5 7.5l-9 9"/>',
    "stop": '<rect x="7" y="7" width="10" height="10" rx="2.2" fill="currentColor" stroke="none"/>',
    "shield": '<path d="M12 3.8l6.5 2.5v5.2c0 4.2-2.8 7.2-6.5 8.7-3.7-1.5-6.5-4.5-6.5-8.7V6.3z"/><path d="M9.2 12l2 2 3.8-4"/>',
    "refresh": '<path d="M18.5 9.5A7 7 0 0 0 5.6 9M5.5 14.5a7 7 0 0 0 12.9.5"/><path d="M18.8 5v4.6h-4.6M5.2 19v-4.6h4.6"/>',
    "dots": '<path d="M6.5 12h.01M12 12h.01M17.5 12h.01" stroke-width="2.6"/>',
    "plus": '<path d="M12 6v12M6 12h12"/>',
    "record": '<circle cx="12" cy="12" r="5" fill="currentColor" stroke="none"/>',
}


def ic(name, size=16, color="currentColor", sw=1.6, extra=""):
    return (f'<svg class="ic" width="{size}" height="{size}" viewBox="0 0 24 24" fill="none" stroke="{color}" '
            f'stroke-width="{sw}" stroke-linecap="round" stroke-linejoin="round" {extra}>{IC[name]}</svg>')


# ---------- menu-bar glyph ----------
GLYPH = ("M8 1.7 C10.9 1.7 12.2 3.8 12.3 6.2 C12.4 8.3 13.4 9.7 13.4 11.6 C13.4 13.3 12.4 14.3 11.3 14.8 "
         "Q10.4 15.2 9.9 14.6 C9.3 13.9 8.7 13.6 8 13.6 C7.3 13.6 6.7 13.9 6.1 14.6 Q5.6 15.2 4.7 14.8 "
         "C3.6 14.3 2.6 13.3 2.6 11.6 C2.6 9.7 3.6 8.3 3.7 6.2 C3.8 3.8 5.1 1.7 8 1.7Z")

GCOL = {"idle": "#1D1B18", "listening": "#0E9E8B", "thinking": "#0E9E8B", "speaking": "#0E9E8B",
        "working": "#0E9E8B", "attention": "#F0603C", "problem": "#D98600"}
GCOL_DARK = {"idle": "#FFFFFF", "listening": "#45E3CD", "thinking": "#45E3CD", "speaking": "#45E3CD",
             "working": "#45E3CD", "attention": "#FF8A6B", "problem": "#FFB83D"}


def glyph(state="idle", size=16, uid="g", dark=False):
    c = (GCOL_DARK if dark else GCOL)[state]
    bg = "#2B2724" if dark else "#F4EEE6"
    wide = state in ("listening", "speaking")
    vbw = 22 if wide else 16
    w = size * vbw / 16
    ex = [(6.3, 7.1), (9.7, 7.1)]
    eyes_r = (0.95, 1.35)
    tf = ""
    if state == "thinking":
        ex = [(6.9, 6.4), (10.2, 6.4)]
        tf = 'transform="rotate(9 8 9)"'
    if state == "listening":
        eyes_r = (1.1, 1.55)
    mask = (f'<mask id="{uid}m"><rect x="-4" y="-4" width="30" height="24" fill="#fff"/>'
            + "".join(f'<ellipse cx="{x}" cy="{y}" rx="{eyes_r[0]}" ry="{eyes_r[1]}" fill="#000"/>' for x, y in ex)
            + ('<ellipse cx="8" cy="10.4" rx="1.3" ry="1.1" fill="#000"/>' if state == "speaking" else "")
            + '</mask>')
    s = [f'<svg class="ic" width="{w:.1f}" height="{size}" viewBox="0 0 {vbw} 16" xmlns="http://www.w3.org/2000/svg">',
         f'<defs>{mask}</defs>',
         f'<g {tf}><path d="{GLYPH}" fill="{c}" mask="url(#{uid}m)"/></g>']
    if state == "listening":
        for i, (x, hh) in enumerate([(16.2, 4), (18.4, 7.5), (20.6, 5)]):
            s.append(f'<rect x="{x-0.75}" y="{8.4-hh/2}" width="1.5" height="{hh}" rx=".75" fill="{c}"/>')
    if state == "speaking":
        s.append(f'<path d="M15.6 6.2a3.6 3.6 0 0 1 0 5M18.1 4.3a6.4 6.4 0 0 1 0 8.8" fill="none" stroke="{c}" stroke-width="1.4" stroke-linecap="round"/>')
    if state == "working":
        s.append(f'<path d="M10.2 8.2 L10.2 15.6 L12 14 L13.3 16.6 L14.6 16 L13.4 13.4 L15.8 13.4Z" fill="{c}" stroke="{bg}" stroke-width="1.1" stroke-linejoin="round"/>')
    if state == "attention":
        s.append(f'<circle cx="13" cy="3.2" r="3" fill="{c}" stroke="{bg}" stroke-width="1.3"/>')
    if state == "problem":
        s.append(f'<circle cx="12.6" cy="12.6" r="3.4" fill="{c}" stroke="{bg}" stroke-width="1.2"/>'
                 f'<path d="M12.6 10.9v1.9M12.6 14.3v.05" stroke="{bg}" stroke-width="1.3" stroke-linecap="round"/>')
    s.append('</svg>')
    return "".join(s)
