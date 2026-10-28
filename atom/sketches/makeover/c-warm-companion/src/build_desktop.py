"""Builds desktop.html (1440x900)."""
import os, sys
sys.path.insert(0, os.path.dirname(__file__))
from wisp import wisp, portrait, ic, glyph
from components import *

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
CSS = open(os.path.join(ROOT, "src", "shared.css")).read()


def dock_icon(kind):
    s = 54
    g = {
        "finder": ("linear-gradient(90deg,#5BB8F5 50%,#E9F3FB 50%)",
                   '<path d="M27 8 C24 20 23 30 26 46" stroke="#1D3B5C" stroke-width="2.2" fill="none" stroke-linecap="round"/>'
                   '<rect x="16" y="19" width="3" height="7" rx="1.5" fill="#1D3B5C"/><rect x="35" y="19" width="3" height="7" rx="1.5" fill="#1D3B5C"/>'
                   '<path d="M15 34 Q27 42 39 34" stroke="#1D3B5C" stroke-width="2.2" fill="none" stroke-linecap="round"/>'),
        "safari": ("linear-gradient(180deg,#FFFFFF,#E8EDF2)",
                   '<circle cx="27" cy="27" r="19" fill="url(#sf)"/><path d="M33 20 L29 29 L21 34 L25 25Z" fill="#fff"/><path d="M33 20 L29 29 L25 25Z" fill="#FF4F4F"/>'
                   '<defs><linearGradient id="sf" x1="0" x2="0" y1="0" y2="1"><stop offset="0" stop-color="#3FC3FF"/><stop offset="1" stop-color="#1B6FE8"/></linearGradient></defs>'),
        "messages": ("linear-gradient(180deg,#6EE66C,#21B735)",
                     '<ellipse cx="27" cy="26" rx="17" ry="14" fill="#fff"/><path d="M14 36 Q15 41 11 44 Q19 43 22 38Z" fill="#fff"/>'),
        "mail": ("linear-gradient(180deg,#5BB8FF,#1A73E8)",
                 '<rect x="11" y="16" width="32" height="22" rx="3" fill="#fff"/><path d="M12 18 L27 29 L42 18" fill="none" stroke="#7FA9D9" stroke-width="2"/>'),
        "calendar": ("linear-gradient(180deg,#FFFFFF,#F1F1F1)",
                     '<text x="27" y="16" text-anchor="middle" font-size="8.5" font-weight="700" fill="#F2453D" font-family="-apple-system">SAT</text>'
                     '<text x="27" y="42" text-anchor="middle" font-size="26" font-weight="300" fill="#222" font-family="-apple-system">3</text>'),
        "notes": ("linear-gradient(180deg,#FFE27A 0 26%,#FFFDF5 26%)",
                  '<path d="M12 22h30M12 30h30M12 38h22" stroke="#D9D2BE" stroke-width="1.4"/>'),
        "textedit": ("linear-gradient(180deg,#FFFFFF,#EDEDED)",
                     '<rect x="14" y="9" width="26" height="34" rx="2" fill="#fff" stroke="#C9C9C9"/>'
                     '<path d="M18 17h18M18 22h18M18 27h14M18 32h16" stroke="#9AA3AD" stroke-width="1.4"/>'
                     '<path d="M36 44 L45 22 L48 23.5 L39 45.5 L35.8 47.5Z" fill="#F2B23E" stroke="#8A5A10" stroke-width=".8"/>'),
        "music": ("linear-gradient(180deg,#FF6A7C,#F5254A)",
                  '<path d="M22 15 L38 12 V33" stroke="#fff" stroke-width="3" fill="none" stroke-linejoin="round"/><path d="M22 15 V37" stroke="#fff" stroke-width="3"/>'
                  '<ellipse cx="18.5" cy="37.5" rx="4.6" ry="3.8" fill="#fff"/><ellipse cx="34.5" cy="33.5" rx="4.6" ry="3.8" fill="#fff"/>'),
        "settings": ("linear-gradient(180deg,#B9BEC5,#7D848D)",
                     '<circle cx="27" cy="27" r="13" fill="none" stroke="#3F454C" stroke-width="5" stroke-dasharray="4 3.3"/><circle cx="27" cy="27" r="9" fill="#D3D7DC" stroke="#4A5058" stroke-width="2"/><circle cx="27" cy="27" r="3.5" fill="#4A5058"/>'),
        "trash": ("transparent;box-shadow:none",
                  '<path d="M14 13 h26 l-2.6 33 h-20.8z" fill="rgba(255,255,255,.55)" stroke="#9A948E" stroke-width="1.2"/><rect x="12.5" y="10.5" width="29" height="4" rx="2" fill="rgba(255,255,255,.7)" stroke="#9A948E" stroke-width="1.1"/><path d="M20 21 l1 19M27 21v19M34 21l-1 19" stroke="#A0A0A0" stroke-width="1"/>'),
    }[kind]
    return (f'<div class="di" style="background:{g[0]}"><svg width="{s}" height="{s}" viewBox="0 0 54 54">{g[1]}</svg></div>')


def mb_icon(svg, extra=""):
    return f'<span class="mbi" {extra}>{svg}</span>'


def build():
    battery = '<svg width="25" height="12" viewBox="0 0 25 12"><rect x=".5" y=".5" width="21" height="11" rx="3.2" fill="none" stroke="#1D1B18" stroke-opacity=".5"/><rect x="2" y="2" width="15" height="8" rx="1.8" fill="#1D1B18"/><path d="M23 4v4" stroke="#1D1B18" stroke-opacity=".5" stroke-width="1.4" stroke-linecap="round"/></svg>'
    wifi = '<svg width="17" height="13" viewBox="0 0 17 13"><path d="M8.5 12.2 L5.8 9.2 A3.8 3.8 0 0 1 11.2 9.2Z" fill="#1D1B18"/><path d="M3.6 7.1 A6.9 6.9 0 0 1 13.4 7.1" fill="none" stroke="#1D1B18" stroke-width="1.7" stroke-linecap="round"/><path d="M1.3 4.6 A10.2 10.2 0 0 1 15.7 4.6" fill="none" stroke="#1D1B18" stroke-width="1.7" stroke-linecap="round"/></svg>'
    search = '<svg width="14" height="14" viewBox="0 0 14 14"><circle cx="5.8" cy="5.8" r="4.4" fill="none" stroke="#1D1B18" stroke-width="1.6"/><path d="M9.2 9.2l3.6 3.6" stroke="#1D1B18" stroke-width="1.8" stroke-linecap="round"/></svg>'
    cc = '<svg width="17" height="14" viewBox="0 0 17 14"><rect x=".8" y=".8" width="15.4" height="5" rx="2.5" fill="none" stroke="#1D1B18" stroke-width="1.3"/><circle cx="3.6" cy="3.3" r="1.6" fill="#1D1B18"/><rect x=".8" y="8.2" width="15.4" height="5" rx="2.5" fill="none" stroke="#1D1B18" stroke-width="1.3"/><circle cx="13.4" cy="10.7" r="1.6" fill="#1D1B18"/></svg>'
    moon = '<svg width="15" height="15" viewBox="0 0 16 16"><path d="M13.6 10.2A6 6 0 0 1 5.8 2.4a6 6 0 1 0 7.8 7.8z" fill="#1D1B18"/></svg>'
    volume = '<svg width="19" height="14" viewBox="0 0 19 14"><path d="M1.5 4.6h2.8L8 1.5v11L4.3 9.4H1.5z" fill="#1D1B18"/><path d="M11 4.6a3.3 3.3 0 0 1 0 4.8M13.4 2.4a6.4 6.4 0 0 1 0 9.2" fill="none" stroke="#1D1B18" stroke-width="1.5" stroke-linecap="round"/></svg>'
    other = '<svg width="16" height="16" viewBox="0 0 16 16"><circle cx="8" cy="8" r="6.2" fill="none" stroke="#1D1B18" stroke-width="1.5"/><path d="M8 4.6V8l2.4 1.6" stroke="#1D1B18" stroke-width="1.5" fill="none" stroke-linecap="round"/></svg>'
    apple = '<svg width="14" height="17" viewBox="0 0 170 200"><path fill="#1D1B18" d="M150.4 155.6c-2.8 6.4-6.1 12.3-9.9 17.7-5.2 7.4-9.5 12.5-12.7 15.4-5.1 4.6-10.5 7-16.3 7.2-4.2 0-9.2-1.2-15.1-3.6-5.9-2.4-11.3-3.6-16.3-3.6-5.2 0-10.8 1.2-16.8 3.6-6 2.4-10.9 3.7-14.5 3.8-5.6.2-11.2-2.3-16.7-7.4-3.5-3.1-8-8.4-13.3-15.9-5.7-8-10.4-17.3-14.1-27.9-4-11.4-5.9-22.5-5.9-33.2 0-12.2 2.6-22.8 7.9-31.6 4.2-7.1 9.7-12.8 16.7-16.9 7-4.1 14.5-6.3 22.6-6.4 4.4 0 10.3 1.4 17.6 4.1 7.3 2.7 12 4.1 14 4.1 1.5 0 6.7-1.6 15.5-4.8 8.3-3 15.3-4.2 21.1-3.7 15.6 1.3 27.3 7.4 35.1 18.5-14 8.5-20.9 20.3-20.7 35.5.1 11.8 4.4 21.6 12.8 29.4 3.8 3.6 8.1 6.4 12.8 8.4-1 3-2.1 5.8-3.2 8.6zM119 7.2c0 9.3-3.4 18-10.2 26-8.2 9.6-18.1 15.1-28.9 14.3-.1-1.1-.2-2.3-.2-3.5 0-8.9 3.9-18.4 10.7-26.2 3.4-3.9 7.8-7.2 13.1-9.8 5.3-2.6 10.3-4 15-4.3.1 1.2.2 2.4.2 3.5z"/></svg>'

    # TextEdit window
    textedit = f'''
<div class="win">
  <div class="win-bar">
    <div class="lights"><i style="background:#FF5F57"></i><i style="background:#FEBC2E"></i><i style="background:#28C840"></i></div>
    <div class="win-title">{ic("textedit_doc", 1) if False else ""}Meeting notes.rtf <span style="color:rgba(0,0,0,.35);font-weight:400">— Edited</span></div>
  </div>
  <div class="win-tools">
    <span class="tt">¶</span><span class="tsel">Helvetica Neue<i>⌄</i></span><span class="tsel">Regular<i>⌄</i></span><span class="tsel" style="width:44px">13<i>⌄</i></span>
    <span class="tsw"></span><span class="tb"><b>B</b></span><span class="tb"><i style="font-style:italic">I</i></span><span class="tb"><u>U</u></span>
    <span class="tdiv"></span><span class="tb">≡</span><span class="tb">≣</span>
  </div>
  <div class="ruler"></div>
  <div class="win-doc">
    <h3>Design review — 15:00</h3>
    <p>• Panel: warmer material, fewer chips</p>
    <p>• Wisp moods, check “problem” reads at 64 pt</p>
    <p>• Strip sits above the walkway, never covers Wisp</p>
    <p style="margin-top:14px"><b>Call with Aiko — 16:30</b></p>
    <p>Send the slides after the call<span class="caret"></span></p>
  </div>
</div>'''

    dock = '<div class="dock glass-dock">' + "".join(
        dock_icon(k) + ('<span class="run"></span>' if k in ("finder", "calendar", "textedit") else "")
        for k in ["finder", "safari", "messages", "mail", "calendar", "notes", "textedit", "music", "settings"]) \
        + '<span class="dsep"></span>' + dock_icon("trash") + '</div>'

    # Panel: waiting-for-approval live state
    head = (f'<div class="p-head"><div class="avatar ask">{portrait("listening", 40, "dph")}</div>'
            f'<div class="grow"><div class="p-title">Allow one step?</div><div class="p-sub">Say “allow”, or use the strip below</div></div>'
            f'<div style="display:flex;align-items:center;padding-right:6px">{meter([.3,.6,1,.7,.45,.8,.35], h=16)}</div></div>')
    body = f'''
<div class="conv">
  <div class="daysep">Today · 18:31</div>
  <div class="turn-u"><div class="ub">What’s on my calendar this afternoon?</div></div>
  <div class="turn-z">{za("dpa")}<div><div class="zt">You have a design review at 3 and a call with Aiko at 4:30. Nothing after that.</div>
    <div class="meta"><span>heard <b>0.6 s</b></span><span class="dot"></span><span>AI <b>1.8 s</b></span><span class="dot"></span><span>first sound <b>2.7 s</b></span></div></div></div>
  <div class="daysep">Today · 18:42</div>
  <div class="turn-u"><div class="ub">In TextEdit, press return once</div></div>
  <div class="turn-z">{za("dpb")}<div><div class="zt">TextEdit is open. I’ll press Return as soon as you say it’s OK.</div>
    <div class="pending"><span class="chip coral">{ic("shield", 12)}Waiting for you to allow</span></div></div></div>
</div>'''
    foot = f'''<div class="p-foot"><div class="hint">Hold <span class="kgroup"><kbd>⌃</kbd><kbd>⌥</kbd></span> to talk</div>
<button class="btn soft">{ic("compose", 14)}New conversation</button></div>'''
    panel = panel_wrap(head + tabs("Conversation") + f'<div class="p-body">{body}</div>' + foot, style="height:auto")

    html = f'''<!doctype html><html><head><meta charset="utf-8"><title>ZENO · C Warm Companion · desktop</title>
<style>{CSS}
html,body{{width:1440px;height:900px;overflow:hidden}}
.desk{{position:relative;width:1440px;height:900px;overflow:hidden;
 background:
  radial-gradient(60% 55% at 82% 92%, rgba(255,170,130,.85), rgba(255,170,130,0) 70%),
  radial-gradient(45% 50% at 12% 18%, rgba(255,214,170,.9), rgba(255,214,170,0) 70%),
  radial-gradient(50% 60% at 30% 95%, rgba(150,205,190,.75), rgba(150,205,190,0) 70%),
  radial-gradient(40% 45% at 70% 30%, rgba(214,196,232,.75), rgba(214,196,232,0) 70%),
  linear-gradient(160deg,#F3E3CF 0%,#EBD3C2 45%,#DCD3CC 100%)}}
.wave{{position:absolute;border-radius:50%;filter:blur(2px)}}
.menubar{{position:absolute;left:0;top:0;right:0;height:26px;display:flex;align-items:center;padding:0 10px 0 18px;
 background:rgba(255,250,244,.42);-webkit-backdrop-filter:blur(30px) saturate(1.6);backdrop-filter:blur(30px) saturate(1.6);
 box-shadow:0 .5px 0 rgba(90,60,30,.12);font-size:13px;color:#1D1B18;z-index:5}}
.menubar .m{{padding:0 9px;height:22px;display:flex;align-items:center;border-radius:6px}}
.menubar .app{{font-weight:700}}
.menubar .sp{{flex:1}}
.mbi{{height:22px;min-width:30px;padding:0 6px;display:flex;align-items:center;justify-content:center;border-radius:6px}}
.mbi.open{{background:rgba(29,27,24,.12)}}
.clock{{padding:0 8px;font-variant-numeric:tabular-nums;white-space:nowrap}}
.win{{position:absolute;left:150px;top:92px;width:640px;height:520px;border-radius:16px;background:#fff;overflow:hidden;
 box-shadow:0 0 0 .5px rgba(60,40,20,.25),0 30px 80px -20px rgba(80,50,20,.45),0 10px 24px -12px rgba(80,50,20,.3)}}
.win-bar{{height:40px;display:flex;align-items:center;padding:0 14px;background:#F6F4F1;position:relative}}
.lights{{display:flex;gap:8px}}.lights i{{width:12px;height:12px;border-radius:50%;display:block;box-shadow:inset 0 0 0 .5px rgba(0,0,0,.15)}}
.win-title{{position:absolute;left:0;right:0;text-align:center;font-size:13px;font-weight:600;color:rgba(0,0,0,.8);pointer-events:none}}
.win-tools{{height:36px;display:flex;align-items:center;gap:6px;padding:0 12px;background:#F6F4F1;border-bottom:.5px solid rgba(0,0,0,.1);font-size:12px;color:#333}}
.tt{{width:26px;text-align:center;color:#666}}
.tsel{{height:22px;padding:0 6px 0 8px;border-radius:5px;background:#fff;box-shadow:0 0 0 .5px rgba(0,0,0,.18),0 .5px 1px rgba(0,0,0,.08);display:flex;align-items:center;gap:6px;white-space:nowrap}}
.tsel i{{font-style:normal;color:#888;font-size:10px}}
.tsw{{width:22px;height:22px;border-radius:5px;background:#1D1B18;box-shadow:inset 0 0 0 2px #fff,0 0 0 .5px rgba(0,0,0,.25)}}
.tb{{width:24px;height:22px;display:grid;place-items:center;border-radius:5px;color:#333}}
.tdiv{{width:.5px;height:16px;background:rgba(0,0,0,.18);margin:0 4px}}
.ruler{{height:18px;background:repeating-linear-gradient(90deg,rgba(0,0,0,.18) 0 1px,transparent 1px 12px) 0 12px/100% 6px no-repeat,#FBFBFB;border-bottom:.5px solid rgba(0,0,0,.08)}}
.win-doc{{padding:26px 46px;font-family:'Helvetica Neue',Helvetica,sans-serif;font-size:14px;line-height:22px;color:#222}}
.win-doc h3{{font-size:18px;font-weight:600;margin-bottom:8px}}
.caret{{display:inline-block;width:1.5px;height:17px;background:#1D1B18;vertical-align:-3px;margin-left:1px}}
.glass-dock{{position:absolute;left:50%;transform:translateX(-50%);bottom:8px;height:70px;padding:8px 10px;border-radius:24px;display:flex;align-items:center;gap:8px;
 background:rgba(255,250,244,.42);-webkit-backdrop-filter:blur(30px) saturate(1.6);backdrop-filter:blur(30px) saturate(1.6);
 box-shadow:0 0 0 .5px rgba(255,255,255,.6) inset,0 0 0 .5px rgba(90,60,30,.2),0 14px 40px -12px rgba(90,60,30,.3)}}
.di{{width:54px;height:54px;border-radius:13px;box-shadow:0 1px 2px rgba(0,0,0,.15),0 0 0 .5px rgba(0,0,0,.08);overflow:hidden;position:relative;flex:none}}
.run{{width:4px;height:4px;border-radius:50%;background:rgba(29,27,24,.6);margin:0 -6px 0 -6px;align-self:flex-end;margin-bottom:-4px;transform:translateX(-25px)}}
.dsep{{width:1px;height:46px;background:rgba(29,27,24,.18);margin:0 2px}}
.abs{{position:absolute}}
</style></head><body>
<div class="desk">
  <div class="wave" style="left:-200px;top:520px;width:1100px;height:600px;background:radial-gradient(closest-side,rgba(255,255,255,.35),rgba(255,255,255,0))"></div>
  <div class="wave" style="left:900px;top:-260px;width:800px;height:640px;background:radial-gradient(closest-side,rgba(255,240,225,.55),rgba(255,240,225,0))"></div>

  <div class="menubar">
    <span class="m">{apple}</span><span class="m app">TextEdit</span><span class="m">File</span><span class="m">Edit</span><span class="m">Format</span><span class="m">View</span><span class="m">Window</span><span class="m">Help</span>
    <span class="sp"></span>
    {mb_icon(glyph("attention", 16, "mbz"), 'class="mbi open" id="zeno"')}
    {mb_icon(moon)}
    {mb_icon(other)}
    {mb_icon(volume)}
    {mb_icon(battery)}
    {mb_icon(wifi)}
    {mb_icon(search)}
    {mb_icon(cc, 'id="cc"')}
    <span class="clock">Sat 3 Oct 18:42</span>
  </div>

  {textedit}

  <div class="abs" id="panelwrap" style="left:900px;top:31px;z-index:6">{panel}</div>

  <!-- pointing Wisp, top-right corner (mirrored so it points up-left at Control Centre) -->
  <div class="abs" style="left:1342px;top:24px;z-index:7;transform:scaleX(-1)">{wisp("pointing", 56, "dpw")}</div>
  <div class="abs" style="right:10px;top:86px;z-index:7">{pill("Control Centre")}</div>

  <!-- work strip, asking -->
  <div class="abs" style="left:510px;top:606px;z-index:6">{strip("ask")}</div>

  <!-- Wisp on its walkway, listening (waiting for a spoken "allow") -->
  <div class="abs" style="left:1000px;top:728px;z-index:6">{wisp("listening", 84, "dwl")}</div>

  {dock}
</div>
<script>/* hang the panel centred under ZENO's menu-bar icon, kept 8pt from the screen edge */
const z=document.getElementById('zeno').getBoundingClientRect(),w=document.getElementById('panelwrap');
w.style.left=Math.min(1440-8-380,Math.round(z.left+z.width/2-190))+'px';</script>
</body></html>'''
    open(os.path.join(ROOT, "desktop.html"), "w").write(html)


if __name__ == "__main__":
    build()
