"""HTML component builders for direction C."""
from wisp import wisp, portrait, ic, glyph


def meter(levels, cls="", w=3, gap=2, h=18, color=None):
    bars = "".join(
        f'<i style="height:{max(3, round(l*h))}px;width:{w}px{";background:"+color if color else ""}"></i>' for l in levels)
    return f'<span class="meter {cls}" style="gap:{gap}px;height:{h}px">{bars}</span>'


LEVELS = [.25, .4, .7, .95, .6, .85, .5, .3, .55, .8, .45, .25, .35, .2]


def tabs(active):
    items = [("chat", "Conversation"), ("pulse", "Status"), ("sliders", "Settings")]
    out = '<div class="tabs">'
    for icon, name in items:
        on = " on" if name == active else ""
        out += f'<div class="tab{on}">{ic(icon, 14)}{name}</div>'
    return out + "</div>"


def header(mood="resting", title="Ready", sub="Claude Sonnet 5.5 · my plan", ring="", uid="h", right=None):
    right = right if right is not None else f'<div class="hbtn">{ic("dots", 18)}</div>'
    return (f'<div class="p-head"><div class="avatar {ring}">{portrait(mood, 40, uid)}</div>'
            f'<div class="grow"><div class="p-title">{title}</div><div class="p-sub">{sub}</div></div>{right}</div>')


def panel_wrap(inner, extra_cls="", style=""):
    return f'<div class="panel glass {extra_cls}" style="{style}">{inner}</div>'


def za(uid):
    return f'<div class="za">{portrait("resting", 24, uid)}</div>'


def conversation(uid="c", mood="listening", live=True):
    if live:
        head = header(mood, "Listening…", f'Claude Sonnet 5.5 · my plan', "live", uid + "h",
                      right=f'<div style="display:flex;align-items:center;gap:8px;padding-right:6px">{meter([.3,.6,1,.7,.45,.8,.35], h=16)}</div>')
    else:
        head = header("resting", "Ready", "Claude Sonnet 5.5 · my plan", "", uid + "h")
    body = f'''
<div class="conv">
  <div class="daysep">Today · 18:31</div>
  <div class="turn-u"><div class="ub">What’s on my calendar this afternoon?</div></div>
  <div class="turn-z">{za(uid+"a")}<div><div class="zt">You have a design review at 3 and a call with Aiko at 4:30. Nothing after that.</div>
    <div class="meta"><span>heard <b>0.6 s</b></span><span class="dot"></span><span>AI <b>1.8 s</b></span><span class="dot"></span><span>first sound <b>2.7 s</b></span></div></div></div>
  <div class="turn-u"><div class="ub">In TextEdit, press return once</div></div>
  <div class="turn-z">{za(uid+"b")}<div><div class="zt">Done — I pressed Return in TextEdit.</div>
    <div class="meta"><span>heard <b>0.5 s</b></span><span class="dot"></span><span>AI <b>2.1 s</b></span><span class="dot"></span><span>1 step · approved</span></div></div></div>
  <div class="turn-u"><div class="ub" style="background:transparent;box-shadow:inset 0 0 0 1px rgba(51,209,188,.55);color:var(--ink2)">
     Remind me to send Aiko the slides<span style="color:var(--ink3)"> after…</span></div></div>
</div>'''
    foot = f'''<div class="p-foot"><div class="hint">Hold <span class="kgroup"><kbd>⌃</kbd><kbd>⌥</kbd></span> to talk</div>
<button class="btn soft">{ic("compose", 14)}New conversation</button></div>'''
    return panel_wrap(head + tabs("Conversation") + f'<div class="p-body">{body}</div>' + foot)


def status_view(uid="s"):
    head = header("resting", "Ready", "Claude Sonnet 5.5 · my plan", "", uid + "h")

    def row(icon, tone, t, s, v):
        return (f'<div class="row"><div class="tile {tone}">{ic(icon, 15)}</div><div class="rl"><div class="rt">{t}</div>'
                f'<div class="rs">{s}</div></div><div class="rv">{v}</div></div>')
    ok = '<span class="sdot ok"></span>'
    body = f'''<div style="padding:0 2px">
<div class="glabel">Hearing &amp; voice</div>
<div class="card">
 {row("mic","mint","Microphone","MacBook Pro Microphone", meter([.3,.55,.9,.6,.4,.75,.3], h=14, w=2.5))}
 {row("wave","mint","Speech recognition","Parakeet · on-device", ok+"Ready")}
 {row("speaker","mint","Voice","On-device", ok+"Ready")}
</div>
<div class="glabel">Brain &amp; hands</div>
<div class="card">
 {row("sparkle","coral","AI provider","Claude (my plan) · Sonnet 5.5", ok+"Signed in")}
 {row("cursor","coral","Computer control","Asks before every action", ok+"On")}
 {row("cpu","","Runtime","Running · 0 restarts", ok+"2 h 14 m")}
</div>
<div class="glabel">Last turn</div>
<div class="card" style="padding:12px 12px 11px">
 <div style="display:flex;height:8px;border-radius:4px;overflow:hidden;gap:2px">
  <span style="flex:6;background:var(--mint)"></span><span style="flex:18;background:var(--coral)"></span><span style="flex:3;background:#C9B79F"></span></div>
 <div style="display:flex;justify-content:space-between;margin-top:8px;font-size:11.5px;color:var(--ink2)" class="tnum">
  <span><span class="sdot" style="display:inline-block;background:var(--mint);margin-right:5px"></span>Heard 0.6 s</span>
  <span><span class="sdot" style="display:inline-block;background:var(--coral);margin-right:5px"></span>AI 1.8 s</span>
  <span><span class="sdot" style="display:inline-block;background:#C9B79F;margin-right:5px"></span>First sound 2.7 s</span></div>
</div></div>'''
    foot = f'<div class="p-foot"><div class="hint">All systems normal</div><button class="btn ghost">{ic("refresh", 14)}Restart runtime</button></div>'
    return panel_wrap(head + tabs("Status") + f'<div class="p-body">{body}</div>' + foot)


def settings_main(uid="m"):
    head = header("resting", "Ready", "Claude Sonnet 5.5 · my plan", "", uid + "h")

    def nav(icon, tone, t, v):
        return (f'<div class="row tight"><div class="tile {tone}">{ic(icon, 15)}</div><div class="rl"><div class="rt">{t}</div></div>'
                f'<div class="rv">{v}{ic("chevR", 14, extra="class=chev")}</div></div>')
    body = f'''<div style="padding:0 2px">
<div class="glabel">AI model</div>
<div class="card">
 <div class="row" style="min-height:48px;padding-top:8px;padding-bottom:8px">
  <div class="seg" style="flex:1"><span style="flex:1">Claude API</span><span class="on" style="flex:1">Claude · my plan</span><span style="flex:1">Gemini</span></div></div>
 <div class="row tight noicon"><div class="rl"><div class="rt">Model</div></div><span class="popup">Sonnet 5.5{ic("updown", 13)}</span></div>
</div>
<div class="glabel">Preferences</div>
<div class="card">
 {nav("keyboard","coral","Shortcuts","4 set")}
 {nav("ibeam","","Dictation","Hold")}
 {nav("ghost","mint","Wisp","On · Medium")}
 {nav("bubble","","Speech bubble","4 s")}
 {nav("window","","Panel","Normal · Glass")}
</div>
</div>'''
    foot = f'<div class="p-foot"><div class="hint">ZENO 0.9 · up to date</div><button class="btn danger">{ic("power", 14)}Quit ZENO</button></div>'
    return panel_wrap(head + tabs("Settings") + f'<div class="p-body">{body}</div>' + foot)


def stops(labels, idx):
    n = len(labels)
    ticks = "".join(f'<span class="tick" style="left:{i/(n-1)*100:.2f}%"></span>' for i in range(n))
    lbl = "".join(f'<{"b" if i == idx else "span"}>{l}</{"b" if i == idx else "span"}>' for i, l in enumerate(labels))
    pct = idx / (n - 1) * 100
    return (f'<div class="stops"><div class="track"><span class="fill" style="width:{pct:.2f}%"></span>{ticks}'
            f'<span class="knob" style="left:{pct:.2f}%"></span></div><div class="lbls">{lbl}</div></div>')


def settings_wisp(uid="w"):
    head = header("resting", "Ready", "Claude Sonnet 5.5 · my plan", "", uid + "h")

    def r(t, ctl, cls="row tight noicon"):
        return f'<div class="{cls}"><div class="rl"><div class="rt">{t}</div></div>{ctl}</div>'

    def seg(opts, on):
        return '<div class="seg">' + "".join(f'<span class="{"on" if o == on else ""}">{o}</span>' for o in opts) + "</div>"
    body = f'''<div style="padding:0 2px">
<div class="subhead"><span class="back">{ic("chevL", 15)}Settings</span><span class="st">Wisp</span></div>
<div class="card">
 <div class="row noicon" style="min-height:52px">
  <div style="width:34px;height:36px;display:grid;place-items:center;margin:-4px 0">{wisp("floating", 38, uid + "f")}</div>
  <div class="rl"><div class="rt">Show Wisp</div><div class="rs">Floats above the Dock</div></div><span class="switch on"></span></div>
 {r("Size", seg(["S","M","L","XL"],"M"))}
 {r("Glow", seg(["Off","Soft","Normal","Bright"],"Soft"))}
</div>
<div class="glabel">Behaviour</div>
<div class="card">
 {r("Movement", stops(["Still","Calm","Normal","Lively"], 1), "row noicon")}
 {r("Falls asleep", f'<span class="popup">After 3 min{ic("updown", 13)}</span>')}
 {r("Hiding lean", seg(["Slight","Normal","Deep"],"Normal"))}
 {r("Tuck away", f'<span class="popup">After 30 s{ic("updown", 13)}</span>')}
</div>
<div class="help">Tucked away, Wisp leans in from the screen edge.</div>
</div>'''
    foot = f'<div class="p-foot"><div class="hint">Changes apply right away</div><button class="btn ghost">Reset</button></div>'
    return panel_wrap(head + tabs("Settings") + f'<div class="p-body">{body}</div>' + foot)


def settings_shortcuts(uid="k"):
    head = header("resting", "Ready", "Claude Sonnet 5.5 · my plan", "", uid + "h")

    def keys(ks, rec=False):
        if rec:
            return '<span class="popup" style="box-shadow:0 0 0 1.5px var(--coral),0 0 0 4px var(--coral-tint);color:var(--coral-deep);padding:0 10px">' + \
                   f'{ic("record", 10, color="var(--coral)")}Press keys…</span>'
        return '<span class="kgroup">' + "".join(f"<kbd>{k}</kbd>" for k in ks) + "</span>"

    def r(t, s, ctl):
        return f'<div class="row noicon"><div class="rl"><div class="rt">{t}</div><div class="rs">{s}</div></div>{ctl}</div>'

    def seg(opts, on):
        return '<div class="seg">' + "".join(f'<span class="{"on" if o == on else ""}">{o}</span>' for o in opts) + "</div>"
    body = f'''<div style="padding:0 2px">
<div class="subhead"><span class="back">{ic("chevL", 15)}Settings</span><span class="st">Shortcuts &amp; dictation</span></div>
<div class="card">
 {r("Talk to ZENO","Hold", keys(["⌃","⌥"]))}
 {r("Dictate","Hold, right side", keys(["Right ⌥","⌘"], rec=True))}
 {r("Show or hide panel","Press", keys(["⌃","⌥","Z"]))}
 {r("Cancel","While ZENO is busy", keys(["esc"]))}
</div>
<div class="glabel">Dictation</div>
<div class="card">
 <div class="row tight noicon"><div class="rl"><div class="rt">Start and stop</div></div>{seg(["Hold","Tap","Either"],"Hold")}</div>
 <div class="row tight noicon"><div class="rl"><div class="rt">Live preview</div></div><span class="switch on"></span></div>
 <div class="row tight noicon"><div class="rl"><div class="rt">Remove “um” and “uh”</div></div><span class="switch on"></span></div>
</div></div>'''
    foot = f'<div class="p-foot"><div class="hint">Click a shortcut to record a new one</div></div>'
    return panel_wrap(head + tabs("Settings") + f'<div class="p-body">{body}</div>' + foot)


# ---------------- work strip ----------------
def strip(state, uid="ws"):
    if state == "step":
        return (f'<div class="strip glass"><div class="s-row"><div class="ring">{ic("cursor", 14, color="var(--mint-deep)")}</div>'
                f'<div class="s-main"><div class="s-t">Opening TextEdit</div><div class="s-s tnum">Step 2 of 3 · Computer control</div></div>'
                f'<button class="btn soft">{ic("stop", 13, color="var(--coral-deep)")}Stop</button></div></div>')
    if state == "ask":
        return (f'<div class="strip glass"><div class="s-row"><div class="s-ic" style="background:var(--coral-tint);color:var(--coral-deep)">{ic("shield", 16)}</div>'
                f'<div class="s-main"><div class="s-t">ZENO wants to press a key</div><div class="s-s">Step 3 of 3 · TextEdit</div></div>'
                f'</div>'
                f'<div class="s-ask"><div class="q">Press Return in TextEdit?</div>'
                f'<button class="btn soft">Decline<span class="kh">esc</span></button><button class="btn primary">Allow<span class="kh">⌘↩</span></button></div></div>')
    cfg = {
        "done": ("check", "var(--mint-tint)", "var(--mint-deep)", "Done", "Pressed Return in TextEdit · 3 steps · 6 s"),
        "stopped": ("stop", "var(--well)", "var(--ink2)", "Stopped", "You stopped at step 2 of 3"),
        "fail": ("warn", "var(--amber-tint)", "var(--amber-deep)", "Couldn’t finish", "TextEdit didn’t respond at step 2"),
    }[state]
    btn = '<button class="btn ghost">Details</button>' if state == "fail" else '<button class="btn ghost" style="color:var(--ink3)">' + ic("xmark", 14) + '</button>'
    return (f'<div class="strip glass"><div class="s-row"><div class="s-ic" style="background:{cfg[1]};color:{cfg[2]}">{ic(cfg[0], 16)}</div>'
            f'<div class="s-main"><div class="s-t">{cfg[3]}</div><div class="s-s">{cfg[4]}</div></div>{btn}</div></div>')


# ---------------- status card ----------------
def status_card(state, uid="sc"):
    if state == "listening":
        return (f'<div class="scard glass"><div class="sc-top"><div class="avatar live" style="width:34px;height:34px">{portrait("listening", 34, uid)}</div>'
                f'<div class="grow" style="flex:1"><div class="sc-t">Listening</div><div class="sc-s">Claude Sonnet 5.5 · my plan</div></div>'
                f'<span class="hint"><span class="kgroup"><kbd>⌃</kbd><kbd>⌥</kbd></span></span></div>'
                f'<div class="sc-bottom">{ic("mic", 14, color="var(--mint-deep)")}{meter([.2,.35,.6,.9,.7,1,.55,.75,.4,.6,.85,.5,.3,.45,.25,.35,.2,.15,.12,.1], h=18, w=3, gap=3)}</div></div>')
    if state == "thinking":
        return (f'<div class="scard glass"><div class="sc-top"><div class="avatar live" style="width:34px;height:34px">{portrait("thinking", 34, uid)}</div>'
                f'<div style="flex:1"><div class="sc-t">Thinking</div><div class="sc-s">Claude Sonnet 5.5 · my plan</div></div>'
                f'<span class="chip mint tnum">1.2 s</span></div>'
                f'<div class="sc-bottom"><span class="zt" style="font-size:12.5px;color:var(--ink2)">“What’s on my calendar this afternoon?”</span></div></div>')
    return (f'<div class="scard glass"><div class="sc-top"><div class="avatar warn" style="width:34px;height:34px">{portrait("problem", 34, uid)}</div>'
            f'<div style="flex:1"><div class="sc-t">No internet</div><div class="sc-s">Claude needs a connection</div></div></div>'
            f'<div class="sc-bottom" style="justify-content:space-between">{ic("wifislash", 15, color="var(--amber-deep)")}'
            f'<span style="flex:1;font-size:12px;color:var(--ink2)">Dictation still works offline</span><button class="btn tint" style="height:24px">Retry</button></div></div>')


# ---------------- dictation bubble ----------------
def bubble(kind):
    base = 'class="bubble glass"'
    if kind == "dictating":
        return (f'<div {base}>{meter([.4,.8,1,.6,.35], h=14, w=2.5)}<div><div class="b-k">Dictating</div>'
                f'<div class="b-w">so the slides go out <span class="fresh">tonight</span></div></div></div>')
    if kind == "transcribing":
        return (f'<div {base}><span class="dots3" style="display:flex;gap:3px">'
                + "".join(f'<i style="width:5px;height:5px;border-radius:50%;background:var(--mint);opacity:{o}"></i>' for o in (1, .6, .3))
                + '</span><div class="b-w">Transcribing</div></div>')
    if kind == "typed":
        return (f'<div {base}>{ic("check", 15, color="var(--mint-deep)", sw=2)}<div class="b-w">Typed <span style="color:var(--ink3)">·</span> <span class="tnum">12 words</span></div></div>')
    return (f'<div {base}>{ic("clipboard", 15, color="var(--amber-deep)")}<div><div class="b-w">Copied to clipboard</div>'
            f'<div class="s-s">A password field is focused</div></div></div>')


def pill(text, dark=False):
    return f'<span class="pill glass">{ic("cursor", 13, color="var(--coral-deep)", sw=1.8)}{text}</span>'
