"""Builds board.html (1440 wide)."""
import os, sys
sys.path.insert(0, os.path.dirname(__file__))
from wisp import wisp, portrait, ic, glyph, MOODS
from components import *

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
CSS = open(os.path.join(ROOT, "src", "shared.css")).read()

CAPTIONS = {
    "resting": ("Resting", "Settled on the walkway, slow 4 s breathe"),
    "floating": ("Floating", "Wanders the walkway, hem trails motion"),
    "listening": ("Listening", "Leans in, eyes wide; hem flutters with voice level"),
    "thinking": ("Thinking", "Head tilt, eyes up-right, hem-curl at chin"),
    "speaking": ("Speaking", "Mouth follows audio, gentle bounce"),
    "problem": ("Problem", "Small frown, shrinks 10 %, amber halo"),
    "napping": ("Napping", "Eyes closed, slow squash, sinks low"),
    "carried": ("Carried", "Pinched by the cursor, dangles and stretches"),
    "hiding": ("Hiding", "Leans in from the screen edge, hand on the bezel"),
    "pointing": ("Pointing", "Flies beside the target, label pill only"),
}


def section(letter, title, sub, inner, style=""):
    return (f'<section class="sec" style="{style}"><div class="sec-h"><span class="sl">{letter}</span>'
            f'<div><h2>{title}</h2><p>{sub}</p></div></div>{inner}</section>')


def build():
    # (a) mood sheet
    moods = '<div class="moods">'
    for m in MOODS:
        t, s = CAPTIONS[m]
        extra = ""
        if m == "pointing":
            extra = f'<div style="position:absolute;right:6px;top:18px">{pill("Save button")}</div>'
        if m == "listening":
            extra = f'<div style="position:absolute;left:50%;bottom:58px;transform:translateX(-50%)">{meter([.2,.45,.8,1,.7,.5,.85,.4,.25], h=12, w=2.5, gap=2)}</div>'
        moods += (f'<div class="mood"><div class="stage">{wisp(m, 124, "m"+m)}{extra}</div>'
                  f'<div class="mt">{t}</div><div class="ms">{s}</div></div>')
    moods += '</div>'
    anatomy = f'''<div class="anat">
  <div class="anat-fig">{wisp("resting", 210, "anat")}
    <svg class="leads" width="460" height="230" viewBox="0 0 460 230" style="position:absolute;left:-130px;top:0;pointer-events:none">
      <g stroke="rgba(29,27,24,.35)" stroke-width="1" fill="none"><path d="M42 42 L200 52"/><path d="M400 84 H252"/><path d="M400 170 H228"/><path d="M42 198 H192"/></g>
      <g fill="#1D1B18" opacity=".5"><circle cx="200" cy="52" r="2.5"/><circle cx="252" cy="84" r="2.5"/><circle cx="228" cy="170" r="2.5"/><circle cx="192" cy="198" r="2.5"/></g></svg>
    <span class="ann" style="right:290px;top:30px">Rim light, top-left key</span>
    <span class="ann" style="left:272px;top:72px">Oval eyes + 1 highlight</span>
    <span class="ann" style="left:272px;top:158px">Inner shade gives volume</span>
    <span class="ann" style="right:290px;top:186px">Two soft hem points</span></div>
  <div class="anat-txt">
   <h3>Wisp, the character</h3>
   <p>A pear-shaped ghost in matte mint-white. A cool inner shade pools at the hem, so it reads as a soft object, not a sticker. The face uses only eyes and a mouth: no cheeks, no props, no clip-art symbols. Moods come from pose, squash and the face.</p>
   <div class="portraits">{''.join(f'<div class="avatar" style="width:44px;height:44px">{portrait(m, 44, "pp"+m)}</div>' for m in ["resting","listening","thinking","speaking","problem","napping"])}</div>
   <p class="small">Header portraits: a 96 pt head crop, re-posed per state.</p>
  </div></div>'''

    # (b) panel views
    panels = f'''<div class="row3">
  <div><div class="cap">Conversation · listening</div>{conversation("pc")}</div>
  <div><div class="cap">Status</div>{status_view("ps")}</div>
  <div><div class="cap">Settings · main page</div>{settings_main("pm")}</div>
</div>
<div class="row3" style="margin-top:36px">
  <div><div class="cap">Settings › Wisp (sub-page)</div>{settings_wisp("pw")}</div>
  <div><div class="cap">Settings › Shortcuts &amp; dictation · recording a key</div>{settings_shortcuts("pk")}</div>
  <div class="notes"><div class="cap">Rationale</div>
    <h3>Settings structure</h3>
    <ul>
      <li><b>AI model</b> lives on the main page: a 3-way provider control and one model popup replace 13 chips.</li>
      <li><b>Five rows</b> drill into sub-pages. Each row previews its current value. Dictation shares a page with Shortcuts, so both entries open the same sub-page.</li>
      <li><b>One control per setting.</b> Switches for on/off. Segmented controls for up to 4 short options. Popups for longer lists. A stepped slider where order matters (Movement).</li>
      <li><b>Quit ZENO</b> sits in the footer, away from the switches.</li>
    </ul>
    <h3 style="margin-top:22px">Speech bubble · Panel</h3>
    <div class="card" style="margin-top:10px">
      <div class="row tight noicon"><div class="rl"><div class="rt">Bubble stays</div></div><div class="seg"><span>1 s</span><span>2 s</span><span class="on">4 s</span><span>8 s</span></div></div>
      <div class="row tight noicon"><div class="rl"><div class="rt">Bubble size</div></div><div class="seg"><span>S</span><span class="on">M</span><span>L</span></div></div>
      <div class="row tight noicon"><div class="rl"><div class="rt">Bubble background</div></div><div class="seg"><span>Clear</span><span class="on">Normal</span><span>Solid</span></div></div>
      <div class="row tight noicon"><div class="rl"><div class="rt">Panel size</div></div><div class="seg"><span>Compact</span><span class="on">Normal</span><span>Large</span></div></div>
      <div class="row tight noicon"><div class="rl"><div class="rt">Panel background</div></div><div class="seg"><span class="on">Glass</span><span>Solid</span></div></div>
    </div>
  </div>
</div>'''

    # (c) strips
    strips = f'''<div class="strips">
  <div><div class="cap">Working · step + Stop</div>{strip("step")}</div>
  <div><div class="cap">Asking for permission</div>{strip("ask")}</div>
  <div><div class="cap">Done</div>{strip("done")}</div>
  <div><div class="cap">Stopped</div>{strip("stopped")}</div>
  <div><div class="cap">Couldn’t finish</div>{strip("fail")}</div>
  <div class="cap-note">The strip is 420 pt wide and sits 12 pt above Wisp’s walkway. It grows downward into the ask row with a 0.35 s spring, then shrinks back. End states stay for 4 s, then fade.</div>
</div>'''

    # (d) status cards, (e) bubbles
    cards = f'''<div class="cards">
  <div><div class="cap">Listening</div>{status_card("listening","sc1")}</div>
  <div><div class="cap">Thinking</div>{status_card("thinking","sc2")}</div>
  <div><div class="cap">Problem · No internet</div>{status_card("problem","sc3")}</div>
</div>'''
    bub = f'''<div class="bubs">
  <div class="bstage">{wisp("listening", 70, "bw1")}<div class="bb">{bubble("dictating")}</div><div class="cap2">Dictating · live words + level</div></div>
  <div class="bstage">{wisp("thinking", 70, "bw2")}<div class="bb">{bubble("transcribing")}</div><div class="cap2">Transcribing</div></div>
  <div class="bstage">{wisp("speaking", 70, "bw3")}<div class="bb">{bubble("typed")}</div><div class="cap2">Typed · 12 words</div></div>
  <div class="bstage">{wisp("problem", 70, "bw4")}<div class="bb">{bubble("copied")}</div><div class="cap2">Copied to clipboard</div></div>
  <div class="bstage pt">{wisp("pointing", 70, "bw5")}<div class="bb" style="bottom:52px">{pill("Control Centre")}</div><div class="cap2">Pointing label pill (2–4 words)</div></div>
</div>'''

    # (f) menu bar icons
    states = [("idle", "Idle"), ("listening", "Listening"), ("thinking", "Thinking"), ("speaking", "Speaking"),
              ("working", "Working"), ("attention", "Needs attention"), ("problem", "Problem")]
    mb = '<div class="mbrow">'
    for k, t in states:
        mb += (f'<div class="mbcell"><div class="big">{glyph(k, 64, "G"+k)}</div>'
               f'<div class="realbars"><span class="rb light">{glyph(k, 16, "gl"+k)}</span><span class="rb dark">{glyph(k, 16, "gd"+k, dark=True)}</span></div>'
               f'<div class="mt" style="margin-top:10px">{t}</div></div>')
    mb += '</div><div class="cap-note" style="margin-top:14px">Template glyph (black, or white on dark menu bars) when idle. Mint when ZENO is busy, coral dot when it needs you, amber badge for problems. Shown at 4× and at real 16 pt, on light and dark menu bars.</div>'

    # (g) tokens
    sw = [("ink", "#1D1B18", "Text, glyph idle"), ("paper", "#FBF8F3", "Panel glass · 88 % + blur 34"),
          ("sand", "#F1E8DC", "User bubble"), ("coral", "#FF7A59", "Accent, switches"),
          ("coral-deep", "#D9532F", "Accent text, Allow"), ("mint", "#33D1BC", "Live: listening, meter"),
          ("mint-deep", "#0B8F7E", "Live text"), ("amber", "#F4A62A", "Problem")]
    swatches = "".join(f'<div class="sw"><span style="background:{h}"></span><b>{n}</b><i>{h}</i><em>{u}</em></div>' for n, h, u in sw)
    tokens = f'''<div class="tokens">
 <div class="tk"><h4>Colour</h4><div class="sws">{swatches}</div></div>
 <div class="tk"><h4>Type</h4>
   <div class="ts"><span style="font-family:var(--rounded);font-weight:650;font-size:20px">Title 20</span><i>SF Rounded Semibold</i></div>
   <div class="ts"><span style="font-family:var(--rounded);font-weight:650;font-size:16.5px">Headline 16.5</span><i>SF Rounded Semibold</i></div>
   <div class="ts"><span style="font-size:13.5px">Body 13.5 / 19</span><i>SF Pro Text</i></div>
   <div class="ts"><span style="font-size:12px;color:var(--ink2)">Secondary 12 · 66 %</span><i>SF Pro Text</i></div>
   <div class="ts"><span style="font-size:11px;font-weight:600;letter-spacing:.04em;color:var(--ink3)">GROUP 11</span><i>SF Pro · caps +4 %</i></div>
 </div>
 <div class="tk"><h4>Radii (concentric)</h4>
   <div class="radii">{''.join(f'<div><span style="border-radius:{r}px"></span><b>{n}</b><i>{r}</i></div>' for n, r in [("panel",22),("strip",20),("card",14),("control",10),("key",6)])}</div>
   <div class="cap-note" style="margin-top:12px">Panel 22 − 8 inset = card 14 · card − 4 = control 10</div>
   <h4 style="margin-top:18px">Spacing</h4>
   <div class="spc">{''.join(f'<div><span style="width:{v}px"></span><i>{v}</i></div>' for v in [4,6,8,10,12,16,24])}</div>
 </div>
 <div class="tk"><h4>Motion (SwiftUI springs)</h4>
   <table class="mo">
    <tr><td>snappy</td><td>response 0.28 · damping 0.86</td><td>tabs, switches</td></tr>
    <tr><td>panel</td><td>response 0.38 · damping 0.82</td><td>panel open, strip grow</td></tr>
    <tr><td>float</td><td>response 0.9 · damping 0.6</td><td>Wisp flight, pointing</td></tr>
    <tr><td>bounce</td><td>response 0.32 · damping 0.55</td><td>speaking hop (per word)</td></tr>
    <tr><td>breathe</td><td>easeInOut 4 s, ±3 % scaleY</td><td>resting / napping (6 s)</td></tr>
    <tr><td>flutter</td><td>hem offset = level × 5 pt, 60 Hz</td><td>listening</td></tr>
   </table>
 </div>
</div>'''

    html = f'''<!doctype html><html><head><meta charset="utf-8"><title>ZENO · C Warm Companion · board</title>
<style>{CSS}
html,body{{width:1440px;background:#E9E1D6}}
.board{{width:1440px;padding:56px 64px 96px;background:
  radial-gradient(900px 600px at 90% 0%,rgba(255,190,160,.35),transparent 70%),
  radial-gradient(900px 700px at 0% 40%,rgba(170,220,205,.3),transparent 70%),
  radial-gradient(900px 700px at 100% 75%,rgba(220,200,235,.3),transparent 70%),#ECE4D9}}
.top{{display:flex;align-items:flex-end;justify-content:space-between;margin-bottom:40px}}
.top h1{{font-family:var(--rounded);font-weight:700;font-size:44px;letter-spacing:-.02em;line-height:1}}
.top h1 span{{color:var(--coral-deep)}}
.top p{{font-size:15px;color:var(--ink2);margin-top:10px;max-width:640px;line-height:22px}}
.sec{{margin-top:56px}}
.sec-h{{display:flex;gap:14px;align-items:flex-start;margin-bottom:22px}}
.sl{{width:30px;height:30px;border-radius:10px;background:var(--ink);color:#FBF8F3;font-family:var(--rounded);font-weight:700;font-size:15px;display:grid;place-items:center;flex:none;margin-top:1px}}
.sec h2{{font-family:var(--rounded);font-weight:650;font-size:22px;letter-spacing:-.01em;line-height:28px}}
.sec-h p{{font-size:13px;color:var(--ink2);line-height:18px}}
.moods{{display:grid;grid-template-columns:repeat(5,1fr);gap:16px}}
.mood{{background:rgba(251,248,243,.7);border-radius:20px;padding:0 14px 16px;box-shadow:0 0 0 .5px rgba(70,45,20,.08),0 10px 30px -18px rgba(90,55,20,.3);text-align:center}}
.stage{{height:182px;display:flex;align-items:flex-end;justify-content:center;position:relative;padding-bottom:12px;overflow:hidden;border-radius:20px 20px 0 0}}
.mood .mt,.mbcell .mt{{font-family:var(--rounded);font-weight:650;font-size:15px}}
.mood .ms{{font-size:12px;color:var(--ink2);line-height:16px;margin-top:3px;min-height:32px}}
.anat{{display:flex;gap:48px;align-items:center;margin-top:20px;background:rgba(251,248,243,.55);border-radius:22px;padding:22px 40px;box-shadow:0 0 0 .5px rgba(70,45,20,.08)}}
.anat-fig{{position:relative;width:200px;height:226px;margin-left:150px;margin-right:170px;flex:none}}
.ann{{position:absolute;font-size:11.5px;color:var(--ink2);white-space:nowrap;background:rgba(255,255,255,.8);padding:3px 8px;border-radius:7px;box-shadow:0 0 0 .5px rgba(70,45,20,.12)}}
.anat-txt h3,.notes h3{{font-family:var(--rounded);font-weight:650;font-size:17px}}
.anat-txt p{{font-size:13.5px;line-height:20px;color:var(--ink2);max-width:520px;margin-top:6px}}
.anat-txt p.small{{font-size:12px}}
.portraits{{display:flex;gap:12px;margin-top:16px}}
.row3{{display:grid;grid-template-columns:repeat(3,380px);gap:40px;justify-content:space-between}}
.cap{{font-size:12px;font-weight:600;color:var(--ink2);margin-bottom:10px;letter-spacing:.01em}}
.cap2{{position:absolute;left:0;right:0;bottom:-26px;font-size:12px;font-weight:600;color:var(--ink2);text-align:center}}
.cap-note{{font-size:12.5px;color:var(--ink2);line-height:18px;max-width:420px}}
.notes{{}}
.notes ul{{margin-top:10px;padding-left:16px;font-size:13px;line-height:19px;color:var(--ink2)}}
.notes li{{margin-bottom:6px}} .notes li b{{color:var(--ink);font-weight:600}}
.strips{{display:grid;grid-template-columns:420px 420px 420px;gap:32px 26px;justify-content:space-between;align-items:start}}
.cards{{display:grid;grid-template-columns:repeat(3,380px);justify-content:space-between;align-items:start}} .cards .scard{{width:380px}}
.bubs{{display:grid;grid-template-columns:repeat(5,1fr);gap:16px;padding-bottom:30px}}
.bstage{{position:relative;height:210px;background:rgba(251,248,243,.45);border-radius:20px;box-shadow:0 0 0 .5px rgba(70,45,20,.08);display:flex;align-items:flex-end;padding:0 0 12px 14px}}
.bstage .bb{{position:absolute;left:78px;bottom:74px;right:-60px}}
.bstage.pt .bb{{left:80px}}
.de{{display:grid;grid-template-columns:auto 1fr;gap:56px;align-items:start}}
.mbrow{{display:grid;grid-template-columns:repeat(7,1fr);gap:14px}}
.mbcell{{background:rgba(251,248,243,.7);border-radius:18px;padding:22px 10px 16px;text-align:center;box-shadow:0 0 0 .5px rgba(70,45,20,.08)}}
.mbcell .big{{height:70px;display:flex;align-items:center;justify-content:center}}
.realbars{{display:flex;gap:6px;justify-content:center;margin-top:14px}}
.rb{{height:24px;padding:0 10px;border-radius:7px;display:flex;align-items:center}}
.rb.light{{background:#F4EEE6;box-shadow:0 0 0 .5px rgba(70,45,20,.12)}}
.rb.dark{{background:#2B2724}}
.tokens{{display:grid;grid-template-columns:1.45fr .95fr .95fr 1.35fr;gap:16px}}
.tk{{background:rgba(251,248,243,.7);border-radius:18px;padding:18px 18px 20px;box-shadow:0 0 0 .5px rgba(70,45,20,.08)}}
.tk h4{{font-size:11px;font-weight:650;letter-spacing:.05em;text-transform:uppercase;color:var(--ink3);margin-bottom:12px}}
.sws{{display:grid;grid-template-columns:1fr 1fr;gap:10px 12px}}
.sw{{display:grid;grid-template-columns:30px 1fr;column-gap:9px;align-items:center}}
.sw span{{grid-row:span 3;width:30px;height:30px;border-radius:9px;box-shadow:0 0 0 .5px rgba(70,45,20,.18) inset}}
.sw b{{font-size:12px;font-weight:600;line-height:14px}} .sw i{{font-style:normal;font-size:10.5px;color:var(--ink3);font-family:ui-monospace,SFMono-Regular,monospace;line-height:13px}}
.sw em{{font-style:normal;font-size:10.5px;color:var(--ink2);line-height:13px}}
.ts{{display:flex;justify-content:space-between;align-items:baseline;padding:7px 0;border-bottom:.5px solid var(--hair)}}
.ts i{{font-style:normal;font-size:10.5px;color:var(--ink3)}}
.radii{{display:flex;gap:10px}}
.radii div{{text-align:center}} .radii span{{display:block;width:44px;height:44px;background:#fff;box-shadow:0 0 0 1px rgba(255,122,89,.6) inset}}
.radii b{{display:block;font-size:11px;font-weight:600;margin-top:6px}} .radii i{{font-style:normal;font-size:10.5px;color:var(--ink3)}}
.spc{{display:flex;align-items:flex-end;gap:12px}} .spc div{{text-align:center}}
.spc span{{display:block;height:24px;background:var(--coral-tint);box-shadow:0 0 0 .5px var(--coral) inset;border-radius:3px;margin:0 auto}}
.spc i{{font-style:normal;font-size:10.5px;color:var(--ink3)}}
.mo{{width:100%;border-collapse:collapse;font-size:12px}}
.mo td{{padding:7px 0;border-bottom:.5px solid var(--hair);vertical-align:top}}
.mo td:first-child{{font-weight:600;width:70px}} .mo td:nth-child(2){{font-family:ui-monospace,SFMono-Regular,monospace;font-size:11px;color:var(--ink);padding-right:8px}}
.mo td:last-child{{color:var(--ink2);text-align:right}}
</style></head><body><div class="board">
<div class="top"><div><h1>ZENO · <span>Warm Companion</span></h1>
<p>Direction C. Wisp is a character with a personality, drawn adult and premium. Warm paper glass, ink type, one coral accent, and Wisp’s mint for anything live.</p></div>
<div style="display:flex;align-items:flex-end;gap:6px">{wisp("floating",86,"hero1")}{wisp("speaking",64,"hero2")}</div></div>

{section("a", "Wisp mood sheet", "Ten moods, carried by pose, squash and the face. Drawn at 124 pt; ships at 64 pt.", moods + anatomy)}
{section("b", "Panel · 380 pt", "Hangs under the menu-bar icon. The header portrait shows Wisp’s current mood instead of a generic state icon.", panels)}
{section("c", "Work strip", "Bottom centre, above Wisp’s walkway, only while ZENO operates the Mac.", strips)}
{section("d", "Status card", "Used when Wisp is off. Hangs under the menu-bar icon during a voice turn.", cards)}
{section("e", "Dictation bubble &amp; pointing pill", "The bubble hugs its content, with a tail towards Wisp. Pointing only ever shows a 2–4 word pill.", bub)}
{section("f", "Menu-bar icon", "Seven states, at 4× and at real size.", mb)}
{section("g", "Tokens", "Named values for SwiftUI.", tokens)}
</div></body></html>'''
    open(os.path.join(ROOT, "board.html"), "w").write(html)


if __name__ == "__main__":
    build()
