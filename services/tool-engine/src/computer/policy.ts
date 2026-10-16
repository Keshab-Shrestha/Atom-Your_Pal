/**
 * Deterministic rules for computer control (ADR-054, SECURITY.md §8 and §12). Plain functions, no model in
 * the loop: what ATOM refuses and what it asks about is decided here, from facts Cua reports.
 */

/** Apps ATOM never controls, matched by bundle id. */
const BLOCKED_BUNDLES = [
  /^com\.apple\.terminal$/i,
  /^com\.googlecode\.iterm2$/i,
  /^com\.mitchellh\.ghostty$/i,
  /^dev\.warp\./i,
  /^net\.kovidgoyal\.kitty$/i,
  /^org\.alacritty$/i,
  /^com\.apple\.keychainaccess$/i,
  /^com\.apple\.passwords$/i,
  /^com\.(1password|agilebits)\./i,
  /^com\.bitwarden\./i,
  /^com\.lastpass\./i,
  /^com\.apple\.systempreferences$/i,
  /^com\.apple\.security/i,
  /^com\.apple\.activitymonitor$/i,
  /^com\.nousresearch\./i, // Hermes
  /^com\.trycua\./i, // Cua itself
  /^com\.anthropic\./i, // Claude desktop and Claude Code
  /^com\.zeno\./i, // the island under its old name
  /^dev\.zeno\./i, // ADR-105: the bundle id ZENO moves to
  /^dev\.atom\./i, // ATOM's own island
  // 2026-10-16 (code check): apps that run scripts or shell commands (or hold an integrated terminal), so a click on "Run" would be code on the Mac.
  /^com\.apple\.scripteditor/i,
  /^com\.apple\.automator$/i,
  /^com\.apple\.shortcuts/i,
  /^com\.apple\.console$/i,
  /^com\.apple\.dt\.xcode$/i,
  /^com\.microsoft\.vscode/i,
  /^com\.todesktop\./i, // Cursor and other Electron editors built with ToDesktop
  /^com\.raycast\./i,
  /^com\.runningwithcrayons\.alfred/i,
  /^com\.github\.wez\.wezterm$/i,
  /^co\.zeit\.hyper$/i,
];

/** Why an app is off limits, or undefined if ATOM may control it. An app with no bundle id is not trusted. */
export function appBlock(bundleId: string | undefined, name: string): string | undefined {
  if (!bundleId) return `${name} has no app identity, so ATOM will never control it.`;
  if (BLOCKED_BUNDLES.some((re) => re.test(bundleId))) return `ATOM will never control ${name} (terminals, password managers, system settings and AI agents are off limits).`;
  return undefined;
}

/** Words that name an action which sends, buys, deletes or changes something. */
const STRONG_LABEL =
  /\b(send|submit|buy|purchase|pay|place\s+order|checkout|check\s+out|order|confirm|delete|remove|erase|trash|empty|sign\s*out|log\s*out|publish|post|share|transfer|donate|subscribe|unsubscribe|quit|force\s+quit|shut\s*down|restart|reset|install|uninstall|format|deactivate|close\s+account|apply)\b/i;
/** Consent and sign-in words: a button says these, but text that merely contains them ("Continue reading", "Grant Smith") does not act. */
const CONSENT_LABEL = /\b(allow|accept|agree|authorize|approve|grant|unlock|yes|continue|sign\s*in|log\s*in|ok|okay|reply|forward|sign\s*up|register|upload|overwrite|discard|replace|book|reserve)\b/i;
const RISKY_LABEL = { test: (text: string) => STRONG_LABEL.test(text) || CONSENT_LABEL.test(text) };

/**
 * Roles whose label is content the user wrote or read, not the name of an action. Clicking them only moves the cursor.
 * Not static text, images or headings (2026-10-15, security review): a web page can make a "Delete account" image or a "Pay" heading
 * clickable, so these ask when their label names a risky action, like a button.
 */
const CONTENT_ROLES = new Set(["AXTextArea", "AXTextField", "AXWebArea", "AXScrollArea"]);
/** Roles that are text or pictures: clickable on a web page, so they ask, but only for the strong action words (2026-10-16). */
const PLAIN_ROLES = new Set(["AXStaticText", "AXImage", "AXHeading"]);

/**
 * Why a click on this element needs the user's approval, or undefined. Only the label of something that can do
 * an action counts: a text area's "label" is the document itself. Unlabeled buttons are unknown, so they ask.
 */
/**
 * A label as the rules read it (code check, 2026-10-16): Unicode compatibility form (fullwidth "Ｓｅｎｄ" becomes "Send"), no zero-width or
 * format characters inside a word, underscores and camelCase read as word breaks ("SendEmail", "Send_now"). A page chooses its own labels.
 * Not covered: look-alike letters from another script (a Cyrillic "Р" in "Рay"); that needs a confusables table.
 */
export function normalizeLabel(label: string): string {
  return label
    .normalize("NFKC")
    .replace(/[\u00ad\u200b-\u200f\u2060-\u2064\ufeff]/g, "")
    .replace(/_+/g, " ")
    .replace(/([a-z])([A-Z])/g, "$1 $2")
    .replace(/\s+/g, " ")
    .trim();
}

export function labelApproval(label: string | undefined, role: string | undefined): string | undefined {
  const text = normalizeLabel(label ?? "");
  if (role && CONTENT_ROLES.has(role)) return undefined;
  if (!text) {
    return role === "AXButton" || role === "AXMenuItem" || role === "AXMenuButton" || role === "AXPopUpButton"
      ? "a button with no name, so ATOM cannot tell what it does"
      : undefined;
  }
  const risky = role && PLAIN_ROLES.has(role) ? STRONG_LABEL.test(text) : RISKY_LABEL.test(text);
  return risky ? `"${text.length > 40 ? `${text.slice(0, 40)}…` : text}"` : undefined;
}

/**
 * ADR-123: ATOM never deletes. A control whose label names a delete (Move to Trash, Empty Trash, Delete, Erase, Uninstall) is refused outright, not
 * asked, so a web page or a confused model cannot get a "yes" for it. Returns the refusal text, or undefined. Only an action role counts, like a button;
 * a text area's label is the document itself.
 */
const DELETE_LABEL = /\b(?:move to (?:the )?trash|empty (?:the )?trash|delete|erase|uninstall|permanently remove|secure empty trash)\b/i;
export function deleteDenial(label: string | undefined, role: string | undefined): string | undefined {
  if (role && CONTENT_ROLES.has(role)) return undefined;
  const text = normalizeLabel(label ?? "");
  return text && DELETE_LABEL.test(text) ? `ATOM never deletes. "${text.length > 40 ? `${text.slice(0, 40)}…` : text}" is refused. Ask the user to do it in Finder.` : undefined;
}

/** ADR-123: the keys that delete files in Finder (Command+Delete moves to the Trash, with Shift it empties it, with Option it deletes at once). */
export function deleteKeyDenial(keys: string[]): string | undefined {
  const lower = keys.map(canonicalKey);
  const key = lower[lower.length - 1] ?? "";
  return DELETE_KEYS.has(key) && lower.includes("cmd") ? "ATOM never deletes files. Ask the user to do it in Finder." : undefined;
}

/** Other names for the same key, so "command", "alt" or "kp_enter" cannot get past a rule written for "cmd", "option" or "enter". */
const KEY_ALIASES: Readonly<Record<string, string>> = {
  command: "cmd", "⌘": "cmd", super: "cmd", meta: "cmd", opt: "option", alt: "option", esc: "escape",
  kp_enter: "enter", kpenter: "enter", keypadenter: "enter", numpadenter: "enter", "numpad enter": "enter", "keypad enter": "enter",
};
const canonicalKey = (key: string): string => {
  const k = key.trim().toLowerCase();
  if (!k && key.length > 0) return "space"; // the space character itself, which trimming turned into nothing
  return KEY_ALIASES[k] ?? k;
};

/**
 * A field where Return runs a search or opens an address and sends nothing. Only here may Return follow typing without a card
 * (it used to follow any typing, so "type, then Return" sent a message in a compose box).
 */
export function isSearchField(label: string | undefined, role: string | undefined): boolean {
  // Only the search role, or a label that starts like a browser's address and search box. "Address line 1", "Location", "Filter by..." and "Find a
  // friend" are ordinary fields (a page chooses its labels, so this stays narrow; code check, 2026-10-16).
  return /search/i.test(role ?? "") || /^\s*(search\b|smart search|address and search|address bar|url\b|enter url)/i.test(normalizeLabel(label ?? ""));
}

/** Why typing this text needs approval, or undefined. A line break inside typed text presses Return. */
export function typeApproval(text: string): string | undefined {
  return /[\r\n]/.test(text) ? "text with a line break, which can send or confirm" : undefined;
}

const DELETE_KEYS = new Set(["delete", "backspace", "forwarddelete", "del"]);
const SENDING_KEYS = new Set(["return", "enter", "space", " ", "spacebar"]); // Space presses the focused button or checkbox

/**
 * Why a key press needs approval, or undefined. Return can send or confirm, so it asks, except straight after
 * typing into a field with no modifier (a search or address box). Delete, Quit, Spotlight and force-quit always ask.
 */
export function keyApproval(keys: string[], justTyped: boolean): string | undefined {
  const lower = keys.map(canonicalKey);
  const key = lower[lower.length - 1] ?? "";
  const mods = lower.slice(0, -1).filter((k) => k !== "shift");
  const hasMod = mods.length > 0;
  if (DELETE_KEYS.has(key)) return "the Delete key";
  if (key === "space" && lower.includes("cmd")) return "Spotlight";
  if (SENDING_KEYS.has(key)) return justTyped && !hasMod ? undefined : hasMod ? `${lower.join("+")}, which can send or confirm` : "the Return key, which can send or confirm";
  if (key === "q" && lower.includes("cmd")) return "Quit";
  if (key === "space" && lower.includes("cmd")) return "Spotlight";
  if (key === "escape" && lower.includes("cmd") && lower.includes("option")) return "Force Quit";
  return undefined;
}

const SECRET_LABEL =
  /\b(passwords?|passcode|pass\s*phrase|pin|otp|one[-\s]*time|verification\s+code|security\s+code|cvv|cvc|card\s+(number|no\b)|credit\s+card|secret|token|recovery\s+key|api[-\s]*keys?|access\s+keys?|private\s+keys?|ssn|social\s+security|account\s+number|iban|routing\s+number)\b/i;

/** Why ATOM must not type into this element, or undefined. */
export function secretField(el: { role?: string; label?: string }): string | undefined {
  if (el.role === "AXSecureTextField") return "a password field";
  if (el.label && SECRET_LABEL.test(normalizeLabel(el.label))) return `a field named "${el.label}"`;
  return undefined;
}
