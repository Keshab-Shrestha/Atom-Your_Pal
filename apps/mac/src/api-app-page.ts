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
    <section><h2>Needs you</h2><div id="needs"></div></section>
    <section>
      <h2>New goal</h2>
      <form id="goal"><textarea id="goalText" rows="3" maxlength="2000" placeholder="What should ATOM do?"></textarea><button type="submit">Send</button></form>
    </section>
    <section><h2>Tasks</h2><div id="tasks"></div></section>
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

  token = load();
  if (token) show(); else { $("login").hidden = false; }
})();
`;
