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
  /^com\.zeno\./i, // ATOM's own island
];

/** Why an app is off limits, or undefined if ATOM may control it. An app with no bundle id is not trusted. */
export function appBlock(bundleId: string | undefined, name: string): string | undefined {
  if (!bundleId) return `${name} has no app identity, so ATOM will never control it.`;
  if (BLOCKED_BUNDLES.some((re) => re.test(bundleId))) return `ATOM will never control ${name} (terminals, password managers, system settings and AI agents are off limits).`;
  return undefined;
}

const RISKY_LABEL =
  /\b(send|submit|buy|purchase|pay|place\s+order|checkout|check\s+out|order|confirm|delete|remove|erase|trash|empty|sign\s*out|log\s*out|publish|post|share|transfer|donate|subscribe|unsubscribe|quit|force\s+quit|shut\s*down|restart|reset|install|uninstall|format|deactivate|close\s+account|apply)\b/i;

/** Roles whose label is content the user wrote or read, not the name of an action. Clicking them only moves the cursor. */
const CONTENT_ROLES = new Set(["AXTextArea", "AXTextField", "AXStaticText", "AXWebArea", "AXScrollArea", "AXImage", "AXHeading"]);

/**
 * Why a click on this element needs the user's approval, or undefined. Only the label of something that can do
 * an action counts: a text area's "label" is the document itself. Unlabeled buttons are unknown, so they ask.
 */
export function labelApproval(label: string | undefined, role: string | undefined): string | undefined {
  const text = (label ?? "").trim();
  if (role && CONTENT_ROLES.has(role)) return undefined;
  if (!text) {
    return role === "AXButton" || role === "AXMenuItem" || role === "AXMenuButton" || role === "AXPopUpButton"
      ? "a button with no name, so ATOM cannot tell what it does"
      : undefined;
  }
  return RISKY_LABEL.test(text) ? `"${text.length > 40 ? `${text.slice(0, 40)}…` : text}"` : undefined;
}

const DELETE_KEYS = new Set(["delete", "backspace", "forwarddelete", "del"]);
const SENDING_KEYS = new Set(["return", "enter"]);

/**
 * Why a key press needs approval, or undefined. Return can send or confirm, so it asks, except straight after
 * typing into a field with no modifier (a search or address box). Delete, Quit, Spotlight and force-quit always ask.
 */
export function keyApproval(keys: string[], justTyped: boolean): string | undefined {
  const lower = keys.map((k) => k.toLowerCase());
  const key = lower[lower.length - 1] ?? "";
  const mods = lower.slice(0, -1).filter((k) => k !== "shift");
  const hasMod = mods.length > 0;
  if (DELETE_KEYS.has(key)) return "the Delete key";
  if (SENDING_KEYS.has(key)) return justTyped && !hasMod ? undefined : hasMod ? `${lower.join("+")}, which can send or confirm` : "the Return key, which can send or confirm";
  if (key === "q" && lower.includes("cmd")) return "Quit";
  if (key === "space" && lower.includes("cmd")) return "Spotlight";
  if (key === "escape" && lower.includes("cmd") && lower.includes("option")) return "Force Quit";
  return undefined;
}

const SECRET_LABEL = /\b(password|passcode|pass\s*phrase|pin|otp|one[-\s]*time|verification\s+code|security\s+code|cvv|cvc|card\s+number|secret|token|recovery\s+key)\b/i;

/** Why ATOM must not type into this element, or undefined. */
export function secretField(el: { role?: string; label?: string }): string | undefined {
  if (el.role === "AXSecureTextField") return "a password field";
  if (el.label && SECRET_LABEL.test(el.label)) return `a field named "${el.label}"`;
  return undefined;
}
