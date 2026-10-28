// ADR-098 item 4: ZENO's own init script for the worker browser (Playwright MCP --init-script). It runs in every page
// before the page's scripts. It puts "[password field] " in front of the accessible name of each password input, so
// the page snapshot shows it and `browserCheck` can ask before anything is typed there. Not a tool: the model cannot call it.
// ponytail: inputs in shadow roots are not marked; they look like plain text fields. Upgrade: walk open shadow roots.
(() => {
  const MARK = "[password field] ";
  const isSecret = (type, autocomplete) => String(type || "").toLowerCase() === "password" || /password/i.test(String(autocomplete || ""));
  if (typeof module !== "undefined" && module.exports) module.exports = { isSecret, MARK };
  if (typeof document === "undefined") return;

  const nameOf = (el) =>
    (el.getAttribute("aria-label") || "").replace(MARK, "").trim() ||
    Array.from(el.labels || []).map((l) => (l.textContent || "").trim()).join(" ") ||
    el.getAttribute("placeholder") || el.getAttribute("name") || "";
  const sync = (el) => {
    if (!(el instanceof HTMLInputElement)) return;
    const current = el.getAttribute("aria-label") || "";
    if (isSecret(el.type, el.getAttribute("autocomplete"))) {
      const want = MARK + nameOf(el);
      if (current !== want) el.setAttribute("aria-label", want);
    } else if (current.startsWith(MARK)) {
      el.setAttribute("aria-label", current.slice(MARK.length));
    }
  };
  const sweep = (root) => {
    sync(root);
    if (root.querySelectorAll) root.querySelectorAll("input").forEach(sync);
  };
  new MutationObserver((records) => {
    for (const r of records) {
      if (r.type === "attributes") sync(r.target);
      else r.addedNodes.forEach((n) => n.nodeType === 1 && sweep(n));
    }
  }).observe(document, { childList: true, subtree: true, attributes: true, attributeFilter: ["type", "autocomplete", "aria-label"] });
  document.addEventListener("DOMContentLoaded", () => sweep(document.documentElement));
})();
