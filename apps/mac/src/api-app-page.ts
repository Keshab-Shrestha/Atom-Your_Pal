// ADR-121: the phone page. Three plain files, served by the Local API with no token (they hold no data): a page, a script and a style
// sheet. Separate files, because the strict Content-Security-Policy (default-src 'self') forbids inline script and style. The script
// shows task and need text with textContent only, never as HTML: that text comes from agents and web pages.

export const APP_HTML = `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="color-scheme" content="light dark">
<title>ATOM</title>
<meta name="apple-mobile-web-app-capable" content="yes">
<meta name="mobile-web-app-capable" content="yes">
<meta name="apple-mobile-web-app-title" content="ATOM">
<meta name="apple-mobile-web-app-status-bar-style" content="default">
<meta name="theme-color" content="#5b50e6">
<link rel="manifest" href="/app.webmanifest">
<link rel="apple-touch-icon" href="/app-icon.png">
<link rel="icon" href="/app-icon.png">
<link rel="stylesheet" href="/app.css">
</head>
<body>
<main>
  <header><h1>ATOM</h1><button id="out" type="button" hidden>Sign out</button></header>
  <p id="note" role="status"></p>
  <form id="login" hidden>
    <label for="token">Token</label>
    <input id="token" type="password" autocomplete="off" autocapitalize="off" spellcheck="false" placeholder="Paste the token from ATOM Settings">
    <button type="submit">Connect</button>
  </form>
  <div id="app" hidden>
    <nav id="tabs"><button type="button" data-tab="chat" class="on">Chat</button><button type="button" data-tab="work">Work</button></nav>
    <div id="chatTab">
      <div id="log"></div>
      <form id="say"><textarea id="sayText" rows="2" maxlength="4000" placeholder="Message ATOM"></textarea><button type="submit">Send</button></form>
      <button id="newChat" type="button" class="link">New chat</button>
    </div>
    <div id="workTab" hidden>
    <section><h2>Needs you</h2><div id="needs"></div></section>
    <section>
      <h2>New goal</h2>
      <form id="goal"><textarea id="goalText" rows="3" maxlength="2000" placeholder="What should ATOM do?"></textarea><button type="submit">Send</button></form>
    </section>
    <section><h2>Tasks</h2><div id="tasks"></div></section>
    </div>
  </div>
</main>
<script src="/app.js"></script>
</body>
</html>
`;

export const APP_CSS = `:root{--bg:#f6f6f8;--card:#fff;--line:#d8dbe3;--text:#2b2b38;--mute:#6b6b78;--accent:#5b50e6;--bad:#c0392b}
@media (prefers-color-scheme:dark){:root{--bg:#121218;--card:#1b1b24;--line:#2d2d3a;--text:#e8e8f0;--mute:#9a9aab;--accent:#8b83ff;--bad:#ff7b6b}}
*{box-sizing:border-box}
body{margin:0;background:var(--bg);color:var(--text);font:16px/1.45 -apple-system,system-ui,sans-serif}
main{max-width:640px;margin:0 auto;padding:16px}
header{display:flex;align-items:center;justify-content:space-between}
h1{font-size:22px;margin:8px 0}
h2{font-size:13px;letter-spacing:.06em;text-transform:uppercase;color:var(--mute);margin:24px 0 8px}
section>div,.card{display:grid;gap:8px}
.card{background:var(--card);border:1px solid var(--line);border-radius:12px;padding:12px}
.card p{margin:0;white-space:pre-wrap;word-break:break-word}
.row{display:flex;gap:8px;flex-wrap:wrap}
.mute{color:var(--mute);font-size:14px}
.state{font-size:12px;font-weight:600;color:var(--mute)}
.state.failed{color:var(--bad)}
.state.running{color:var(--accent)}
button{font:inherit;min-height:44px;padding:0 16px;border-radius:10px;border:1px solid var(--line);background:var(--card);color:var(--text)}
button.primary,form button[type=submit]{background:var(--accent);border-color:var(--accent);color:#fff}
button:disabled{opacity:.5}
input,textarea{font:inherit;width:100%;padding:10px;border-radius:10px;border:1px solid var(--line);background:var(--card);color:var(--text);margin:6px 0}
label{display:block;color:var(--mute);font-size:14px}
#note{min-height:1.4em;color:var(--mute);margin:4px 0}
#note.bad{color:var(--bad)}
.report{white-space:pre-wrap;word-break:break-word;font-size:15px;border-top:1px solid var(--line);padding-top:8px;margin:0}
nav{display:flex;gap:8px;margin:8px 0}
nav button{flex:1}
nav button.on{background:var(--accent);border-color:var(--accent);color:#fff}
#log{display:flex;flex-direction:column;gap:8px;min-height:40vh;padding:8px 0}
.msg{max-width:85%;padding:10px 12px;border-radius:16px;white-space:pre-wrap;word-break:break-word;border:1px solid var(--line);background:var(--card)}
.msg.me{align-self:flex-end;background:var(--accent);border-color:var(--accent);color:#fff}
.msg.wait{color:var(--mute)}
.msg.bad{color:var(--bad)}
#say{position:sticky;bottom:0;background:var(--bg);padding:8px 0;display:grid;grid-template-columns:1fr auto;gap:8px;align-items:end}
#say textarea{margin:0;resize:none}
button.link{background:none;border:none;color:var(--mute);min-height:36px;padding:0;text-decoration:underline}
[hidden]{display:none!important}
`;

export const APP_JS = `(function () {
  "use strict";
  var KEY = "atom.token";
  var REFRESH_MS = 15000;
  var $ = function (id) { return document.getElementById(id); };
  var token = "";
  var timer = 0;
  var open = {};

  function load() { try { return localStorage.getItem(KEY) || ""; } catch (e) { return ""; } }
  function save(v) { try { if (v) localStorage.setItem(KEY, v); else localStorage.removeItem(KEY); } catch (e) { /* private mode: the token lives until the page closes */ } }
  function note(text, bad) { var n = $("note"); n.textContent = text || ""; n.className = bad ? "bad" : ""; }
  function el(tag, text, cls) { var e = document.createElement(tag); if (text !== undefined) e.textContent = text; if (cls) e.className = cls; return e; }

  function signOut(message) {
    token = ""; save("");
    chat = { id: newId(), msgs: [] }; sending = false; open = {};
    try { localStorage.removeItem(CHAT_KEY); } catch (e) { /* private mode */ }
    $("log").replaceChildren(); $("needs").replaceChildren(); $("tasks").replaceChildren();
    clearInterval(timer);
    $("app").hidden = true; $("out").hidden = true; $("login").hidden = false;
    $("token").value = "";
    note(message || "", Boolean(message));
  }

  function api(path, method, body) {
    var init = { method: method || "GET", headers: { authorization: "Bearer " + token } };
    if (body !== undefined) { init.headers["content-type"] = "application/json"; init.body = JSON.stringify(body); }
    return fetch(path, init).then(function (res) {
      return res.json().catch(function () { return { ok: false, error: "ATOM sent an answer this page cannot read." }; }).then(function (json) {
        if (res.status === 401) { signOut("The token is wrong or was regenerated. Paste the new one."); throw new Error("401"); }
        if (res.status === 429) { throw new Error("Too many wrong tokens. Wait a minute."); }
        if (!json.ok) throw new Error(json.error || "ATOM could not do that.");
        return json.data;
      });
    });
  }

  function fail(error) { if (error && error.message !== "401") note(error.message, true); }

  function renderNeeds(list) {
    var box = $("needs"); box.replaceChildren();
    if (!list.length) { box.appendChild(el("p", "Nothing waits for you.", "mute")); return; }
    list.forEach(function (need) {
      var card = el("div", undefined, "card");
      card.appendChild(el("p", need.text));
      if (!need.answerable) { card.appendChild(el("p", "Answer this one on the Mac or on Telegram.", "mute")); box.appendChild(card); return; }
      var row = el("div", undefined, "row");
      need.actions.forEach(function (a, i) {
        var b = el("button", a.label); b.type = "button"; if (i === 0) b.className = "primary";
        b.addEventListener("click", function () {
          row.querySelectorAll("button").forEach(function (x) { x.disabled = true; });
          api("/v1/needs/" + encodeURIComponent(need.key), "POST", { action: a.action }).then(function (r) { note(r.said || "Done."); refresh(); }).catch(function (e) { fail(e); refresh(); });
        });
        row.appendChild(b);
      });
      card.appendChild(row); box.appendChild(card);
    });
  }

  function renderTasks(list) {
    var box = $("tasks"); box.replaceChildren();
    if (!list.length) { box.appendChild(el("p", "No tasks yet.", "mute")); return; }
    list.slice(0, 30).forEach(function (t) {
      var card = el("div", undefined, "card");
      card.appendChild(el("span", t.state + " · " + t.worker, "state " + t.state));
      card.appendChild(el("p", t.title || t.task));
      if (t.summary) card.appendChild(el("p", t.summary, "mute"));
      var slot = el("div"); card.appendChild(slot);
      if (open[t.id]) showReport(t.id, slot);
      card.addEventListener("click", function () { if (open[t.id]) { delete open[t.id]; slot.replaceChildren(); } else { open[t.id] = true; showReport(t.id, slot); } });
      box.appendChild(card);
    });
  }

  function showReport(id, slot) {
    api("/v1/tasks/" + id).then(function (d) {
      slot.replaceChildren();
      var text = d.report ? d.report.body : (d.task.error || d.task.step || "No report yet.");
      slot.appendChild(el("p", text, "report"));
    }).catch(fail);
  }

  function refresh() {
    if (!token) return;
    Promise.all([api("/v1/needs"), api("/v1/tasks")]).then(function (r) { renderNeeds(r[0].needs); renderTasks(r[1].tasks); }).catch(fail);
  }

  // Chat: the conversation lives in ATOM under this chat id; the page keeps the text of it in this browser so a reload shows it again.
  var CHAT_KEY = "atom.chat";
  var CHAT_MAX = 60;
  var chat = { id: "", msgs: [] };
  var sending = false;

  function newId() { var a = new Uint8Array(6); crypto.getRandomValues(a); var s = "m"; for (var i = 0; i < a.length; i++) s += (a[i] % 36).toString(36); return s; }
  function loadChat() {
    try { var c = JSON.parse(localStorage.getItem(CHAT_KEY) || "null"); if (c && typeof c.id === "string" && Array.isArray(c.msgs)) return c; } catch (e) { /* none saved */ }
    return { id: newId(), msgs: [] };
  }
  function saveChat() { try { localStorage.setItem(CHAT_KEY, JSON.stringify({ id: chat.id, msgs: chat.msgs.slice(-CHAT_MAX) })); } catch (e) { /* private mode */ } }
  function drawChat() {
    var log = $("log"); log.replaceChildren();
    if (!chat.msgs.length) log.appendChild(el("p", "Say something to ATOM.", "mute"));
    chat.msgs.forEach(function (m) { log.appendChild(el("div", m.text, "msg " + m.who)); });
    window.scrollTo(0, document.body.scrollHeight);
  }
  function tab(name) {
    $("chatTab").hidden = name !== "chat"; $("workTab").hidden = name !== "work";
    document.querySelectorAll("#tabs button").forEach(function (b) { b.className = b.getAttribute("data-tab") === name ? "on" : ""; });
    if (name === "work") refresh(); else drawChat();
  }

  function show() {
    $("login").hidden = true; $("app").hidden = false; $("out").hidden = false;
    refresh();
    clearInterval(timer);
    timer = setInterval(function () { if (!document.hidden) refresh(); }, REFRESH_MS);
  }

  $("login").addEventListener("submit", function (e) {
    e.preventDefault();
    var v = $("token").value.trim();
    if (!/^[0-9a-f]{64}$/.test(v)) { note("A token is 64 letters and digits (a to f). Copy it again from ATOM Settings.", true); return; }
    token = v; note("");
    api("/v1/needs").then(function () { save(v); show(); }).catch(function (err) { if (err.message !== "401") { token = ""; note(err.message, true); } });
  });
  $("out").addEventListener("click", function () { signOut(""); });
  $("goal").addEventListener("submit", function (e) {
    e.preventDefault();
    var box = $("goalText"); var text = box.value.trim(); if (!text) return;
    var button = e.target.querySelector("button"); button.disabled = true; note("Sending. ATOM is reading it…");
    api("/v1/goals", "POST", { goal: text }).then(function (d) { box.value = ""; note(d.answer || "Sent."); refresh(); }).catch(fail).then(function () { button.disabled = false; });
  });

  document.querySelectorAll("#tabs button").forEach(function (b) { b.addEventListener("click", function () { tab(b.getAttribute("data-tab")); }); });
  $("newChat").addEventListener("click", function () { if (sending) return; chat = { id: newId(), msgs: [] }; saveChat(); drawChat(); });
  $("say").addEventListener("submit", function (e) {
    e.preventDefault();
    var box = $("sayText"); var text = box.value.trim(); if (!text || sending) return;
    sending = true; box.value = "";
    var button = e.target.querySelector("button"); button.disabled = true;
    chat.msgs.push({ who: "me", text: text }); saveChat(); // kept at once: a reload during a long turn still shows what was sent
    chat.msgs.push({ who: "wait", text: "ATOM is thinking…" }); drawChat();
    api("/v1/chat", "POST", { text: text, chatId: chat.id }).then(function (d) {
      chat.msgs.pop(); chat.msgs.push({ who: "atom", text: d.answer || "(no answer)" });
    }).catch(function (err) {
      chat.msgs.pop(); if (err.message !== "401") { chat.msgs.push({ who: "bad", text: err.message }); box.value = text; }
    }).then(function () { sending = false; button.disabled = false; saveChat(); drawChat(); });
  });
  chat = loadChat();
  token = load();
  if (token) { show(); drawChat(); } else { $("login").hidden = false; }
})();
`;

export const APP_MANIFEST = JSON.stringify({
  name: "ATOM",
  short_name: "ATOM",
  start_url: "/app",
  scope: "/",
  display: "standalone",
  background_color: "#f6f6f8",
  theme_color: "#5b50e6",
  icons: [{ src: "/app-icon.png", sizes: "180x180", type: "image/png" }],
});

/** A 180 x 180 PNG: a white A on indigo. The home-screen icon on an iPhone. */
export const APP_ICON_PNG = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAALQAAAC0CAIAAACyr5FlAAACZklEQVR42u3bMVbDUAxE0SyRnv2zDbMB0hjb0WiuzyspvqRbhtf314/0Zy8rEByCQ3AIDsEhOASH4BAcgkOCQ3AIDsEhOASH4BAcgkNwSHAIDsEhOASH4BAcgkNwCA4JDsEhOASH4Liu4+oPDjjgIIMPOOCA47yME38PBxxwwAFHD45zl+YDDjiKcfznxnzAAQcccMBx7XX5gAOOMhxX3bXcBxxwwAEHHJdftNkHHHDU4LjjlrU+4IADDjjKcdx3xU4fcMBRgOPu+xX6gAMOOOCoxfHM5dp8wAHHahxP3qzKBxxwwAFHIY7nr9XjAw44luL41J1KfMABBxxwVOH47IUafMABxzocE26z3gcccMABRwmOOVfZ7QMOOBbhmHaPxT7ggAMOONbjmHmJrT7ggGMFjsk3WOkDDjjggGMxjvnb3+cDDjjCcaTsfZkPOOCAwztX4sja+CYfcMARiyNx12t8wOHNcHjzMhy5W97hAw4vD8RxNH1wwAEHHHCQsd4HHHBE4ThaPzjggAMOOMhY7AMOOEJwHL5JPuCAAw44onEs+3XugungMN14HLtlhM4IhxnhMGMojgYZiZPCYdLBOHpkxM0Lh3nhgCMOR5uMrKnhMPVIHJ0ygmaHw+xwwBGEo1lGygbggGMYDjIi9gAHHHDAEYGDjJRtwAHHGBxkBO0EDjjggGM4DjKyNgMHHANwkBG3HzjggAOOsTjISNwSHHB8FAcZobuCA47B/9SkscEhOASH4BAcgkNwCA7BITgEhwSH4BAcgkNwCA7BITgEh+CQ4BAcgkNwCA7BITgEh+AQHBIcet8vKJOTmQainOYAAAAASUVORK5CYII=", "base64");
