import type { Tool } from "../engine.ts";
import type { CuaTransport } from "./cua-client.ts";
import { appBlock, deleteDenial, deleteKeyDenial, isSearchField, keyApproval, labelApproval, secretField, typeApproval } from "./policy.ts";

export interface ApprovalRequest {
  /** What ATOM is about to do, in words for the user: "Click \"Send\" in Mail". */
  summary: string;
  /** Why it is asking. */
  reason: string;
}

export interface ComputerAction {
  action: string;
  app?: string;
  ok: boolean;
  /** Set when ATOM refused or the user declined. Never contains typed text. */
  reason?: string;
}

export interface ComputerToolOptions {
  cua: CuaTransport;
  /** Asks the user. Resolves true only if they approve. The model cannot call this. */
  approve: (request: ApprovalRequest, signal?: AbortSignal) => Promise<boolean>;
  /** One call per action, for the log. Receives no typed text and no screen content. */
  onAction?: (event: ComputerAction) => void;
  /**
   * Pal flies to this place on screen and the bubble shows the label (the `point` action). Returns false if there is no
   * island to show it. Coordinates are screen points, origin at the top-left of the main display, as Cua reports them.
   */
  onPoint?: (target: { x: number; y: number; w: number; h: number; label: string }) => boolean | void;
  /** Called as an action begins, so the user can see what ATOM is doing. Carries the action and app only. */
  onStep?: (step: { action: string; app?: string }) => void;
  maxElements?: number;
}

interface Element {
  element_index: number;
  element_token: string;
  role?: string;
  label?: string;
  value?: string;
  enabled?: boolean;
  depth?: number;
  frame?: { x?: number; y?: number; w?: number; h?: number };
}

interface Target {
  generation: number | undefined;
  pid: number;
  windowId: number;
  app: string;
  bundleId: string | undefined;
  elements: Map<number, Element>;
  justTyped: boolean;
}

class Refused extends Error {}

/**
 * Drops the app menu bar and everything under it. It is a long list (the whole Apple menu) that crowds out the window, and
 * ATOM has no menu action. Elements keep Cua's own numbers, so a dropped element simply cannot be picked.
 */
function withoutMenuBar(elements: Element[]): Element[] {
  const kept: Element[] = [];
  let barDepth: number | undefined;
  for (const el of elements) {
    if (barDepth !== undefined && (el.depth ?? 0) > barDepth) continue;
    barDepth = undefined;
    if (el.role === "AXMenuBar") {
      barDepth = el.depth ?? 0;
      continue;
    }
    kept.push(el);
  }
  return kept;
}

const ACTIONS = ["status", "list_apps", "look", "open", "click", "type", "key", "scroll", "set_value", "point"] as const;

/** Actions that change something in an app, so `look_after` makes sense for them. */
const INPUT_ACTIONS = new Set(["click", "type", "key", "scroll", "set_value"]);
const TEXT_INPUT_ROLES = new Set(["AXTextArea", "AXTextField", "AXSearchField", "AXComboBox"]);

/** Roles that take typed text, so a value set into one counts as typing. */

/** An element's place on screen, or nothing if it has none worth flying to (missing, not a number, empty, or off in space). */
function usableFrame(f: Element["frame"]): { x: number; y: number; w: number; h: number } | undefined {
  if (!f) return undefined;
  const { x, y, w, h } = f;
  if (![x, y, w, h].every((n) => typeof n === "number" && Number.isFinite(n))) return undefined;
  if ((w as number) < 1 || (h as number) < 1) return undefined;
  if (Math.abs(x as number) > 100_000 || Math.abs(y as number) > 100_000) return undefined; // not a real screen position
  return { x: x as number, y: y as number, w: w as number, h: h as number };
}

/** A window this high or lower is a menu-bar strip, not something to read (a TextEdit with no document owns several). */
const MIN_WINDOW_HEIGHT = 40;

/**
 * The one computer-control tool the model sees (ADR-054). It exposes a small set of actions on top of Cua Driver,
 * and enforces ATOM's rules around every one: blocked apps, approval for risky clicks and keys, no typing into
 * secret fields, and only elements from the latest `look`. The model chooses actions; it never touches Cua directly.
 */
export function createComputerTool(options: ComputerToolOptions): Tool {
  const { cua, approve, onAction, onStep, onPoint, maxElements = 150 } = options;
  let target: Target | undefined;

  const log = (e: ComputerAction) => onAction?.(e);

  async function apps(signal?: AbortSignal) {
    const r = await cua.call("list_apps", {}, signal);
    checkResult(r, "Listing apps", "the desktop");
    return (r.data.apps ?? []) as Array<{ name: string; bundle_id?: string; pid?: number; running?: boolean }>;
  }

  async function findApp(name: string, signal?: AbortSignal) {
    const wanted = name.trim().toLowerCase();
    const all = await apps(signal);
    const match = all.find((a) => a.name.toLowerCase() === wanted) ?? all.find((a) => a.name.toLowerCase().includes(wanted) && wanted.length >= 3);
    if (!match) throw new Refused(`There is no app called "${name}".`);
    const block = appBlock(match.bundle_id, match.name);
    if (block) throw new Refused(block);
    return match;
  }

  /**
   * The process id of a running app. Cua's list_apps shows a running app with no document window yet (TextEdit with its Open
   * panel) as pid 0 and not running (benchmark of 2026-10-15), but list_windows names it: use the pid of its windows.
   */
  async function pidOf(app: { name: string; pid?: number; running?: boolean }, signal?: AbortSignal): Promise<number | undefined> {
    if (app.running && app.pid) return app.pid;
    const all = ((await cua.call("list_windows", {}, signal)).data.windows ?? []) as Array<{ app_name?: string; pid?: number }>;
    return all.find((w) => w.app_name === app.name && typeof w.pid === "number" && w.pid > 0)?.pid;
  }

  async function look(appName: string, signal?: AbortSignal): Promise<string> {
    target = undefined; // a failed fresh observation must not leave the previous window's elements actionable
    const app = await findApp(appName, signal);
    const pid = await pidOf(app, signal);
    if (pid === undefined) throw new Refused(`${app.name} is not running. Use action "open" first.`);
    const all = ((await cua.call("list_windows", { pid }, signal)).data.windows ?? []) as Array<{ window_id: number; title?: string; is_on_screen?: boolean; on_current_space?: boolean | null; bounds?: { height?: number } }>;
    // A running app with no document still owns thin menu-bar windows (30 points high, 1 per screen): they are no window to read.
    const wins = all.filter((w) => (w.bounds?.height ?? Number.POSITIVE_INFINITY) > MIN_WINDOW_HEIGHT);
    // Off screen, only a window on another Space is worth reading. Helpers belong to no Space (null) and a hidden panel is off screen on
    // this Space (true): reading one returned an empty window, and input then blamed "another Space" (live baseline 2026-10-23).
    // Older drivers do not report the field (undefined) and keep the earlier fallback.
    const win = wins.find((w) => w.is_on_screen) ?? wins.find((w) => w.on_current_space === false || w.on_current_space === undefined);
    if (!win) throw new Refused(`${app.name} has no window open (no document) that ATOM can see. Open, unhide or create one, or ask the user to, then look again.`);
    const state = await cua.call("get_window_state", { pid, window_id: win.window_id }, signal);
    if (state.isError) refuse(state.refusal?.code, app.name, `Could not read ${app.name}: ${state.refusal?.message ?? state.text}`);
    const elements = withoutMenuBar((state.data.elements ?? []) as Element[]);
    target = { generation: cua.generation, pid, windowId: win.window_id, app: app.name, bundleId: app.bundle_id, elements: new Map(elements.map((e) => [e.element_index, e])), justTyped: false };
    const shown = elements.slice(0, maxElements).map((e) => {
      const bits = [`[${e.element_index}] ${e.role ?? "?"}`];
      if (e.label) bits.push(`"${e.label.slice(0, 80)}"`);
      // A field named like a secret (card number, API key...) is not shown with its value either: type and set_value refuse the same names.
      if (e.value && e.role !== "AXSecureTextField" && !secretField(e)) bits.push(`value=${JSON.stringify(e.value.slice(0, 80))}`);
      if (e.enabled === false) bits.push("(disabled)");
      return bits.join(" ");
    });
    const more = elements.length > maxElements ? `\n(${elements.length - maxElements} more elements not shown)` : "";
    return `${app.name} — window "${win.title ?? ""}"\n${shown.join("\n")}${more}`;
  }

  /** The new screen, appended to an action's reply so the model needs no extra step. The "just typed" memory survives it. */
  async function lookAfter(signal?: AbortSignal): Promise<string> {
    const keep = target?.justTyped ?? false;
    const app = target?.app ?? "";
    try {
      const seen = await look(app, signal);
      if (target) target.justTyped = keep;
      return `\n\n${seen}`;
    } catch (error) {
      // A cancel is not "could not read": Cua's cancel is a plain Error("Cancelled."), not an AbortError, so the name alone never caught it.
      if (signal?.aborted || (error as Error)?.name === "AbortError" || /^cancel/i.test((error as Error)?.message ?? "")) throw error;
      return "\n\nATOM could not read the window again. Look again.";
    }
  }

  function need(): Target {
    if (target && target.generation !== cua.generation) target = undefined;
    if (!target) throw new Refused("Look at an app first (action \"look\"), then act on its numbered elements.");
    return target;
  }

  function pick(t: Target, n: unknown): Element {
    const el = typeof n === "number" ? t.elements.get(n) : undefined;
    if (!el) throw new Refused(`There is no element ${String(n)} in the last look. Look again.`);
    return el;
  }

  async function ask(summary: string, reason: string, signal?: AbortSignal) {
    if (signal?.aborted) throw new Refused("Cancelled.");
    const aborted = new Promise<boolean>((resolve) => signal?.addEventListener("abort", () => resolve(false), { once: true }));
    const yes = await Promise.race([approve({ summary, reason }, signal), aborted]);
    if (!yes) throw new Refused(`The user did not approve: ${summary}. Do not try again or find another way; tell the user it was not done.`);
  }

  // Cua's refusals are written for developers. The model only needs to know what to tell the user, and that
  // retrying will not help: a weak model that sees raw text keeps trying until it runs out of steps.
  const FINAL = "Do not retry or look for another way; tell the user this in one short sentence.";
  function explain(code: string | undefined, app: string): string | undefined {
    switch (code) {
      case "same_pid_keyboard_ambiguity":
        return `${app} has more than one window open, so ATOM cannot type or press keys there without risking the wrong window. Ask the user to close the other ${app} windows. Clicking still works. ${FINAL}`;
      case "minimized_or_hidden_window":
        return `The ${app} window is minimized or hidden. Ask the user to bring it back. ${FINAL}`;
      case "off_space_or_ax_unresolved":
        return `The ${app} window is on another desktop (Space) or ATOM cannot read it. Ask the user to switch to it. ${FINAL}`;
      case "window_not_found":
      case "owner_pid_mismatch":
        return `ATOM lost track of the ${app} window. Look again; if that fails, ${FINAL.toLowerCase()}`;
      default:
        return undefined;
    }
  }

  let lastRefusal: string | undefined;
  /** Throws the plain explanation for a refusal, and a firmer one the second time in a row. */
  function refuse(code: string | undefined, app: string, fallback: string): never {
    const plain = explain(code, app);
    const twice = code !== undefined && code === lastRefusal;
    lastRefusal = code;
    if (plain) throw new Refused(twice ? `This has failed twice for the same reason. Stop now. ${plain}` : plain);
    throw new Refused(fallback);
  }

  function checkResult(r: { isError: boolean; text: string; refusal?: { code: string; message: string } }, what: string, app: string) {
    if (r.refusal?.code === "stale_element_token") {
      target = undefined;
      throw new Refused("The window changed since the last look. Look again, then retry.");
    }
    if (r.isError) refuse(r.refusal?.code, app, `${what} failed: ${r.refusal?.message ?? r.text}`);
    lastRefusal = undefined;
  }

  // Cua says whether an input worked: confirmed (it read the result back), unverifiable, or suspected_noop. The model gets
  // that in plain words, never Cua's own retry ladder (foreground input is not something ATOM offers).
  let lastNoop: string | undefined;
  function verdict(r: { data: Record<string, unknown> }, key: string): string {
    const effect = r.data.effect;
    if (effect === "suspected_noop") {
      const twice = lastNoop === key;
      lastNoop = key;
      return twice
        ? " That has had no effect twice. Stop now: do not try it a third time or another way; tell the user it did not work."
        : " It probably did nothing. Look again to check before trying anything else.";
    }
    lastNoop = undefined;
    if (effect === "confirmed") return " (confirmed)";
    if (effect === "unverifiable") return " ATOM could not confirm it worked; look to check.";
    return "";
  }

  async function run(input: Record<string, unknown>, signal?: AbortSignal): Promise<string> {
    const action = String(input.action);
    const appName = typeof input.app === "string" ? input.app : target?.app;
    onStep?.({ action, ...(appName ? { app: appName } : {}) });
    try {
      let out = await perform(action, input, signal);
      if (input.look_after === true && INPUT_ACTIONS.has(action) && target) out += await lookAfter(signal);
      log({ action, ...(appName ? { app: appName } : {}), ok: true });
      return out;
    } catch (error) {
      if (!(error instanceof Refused)) target = undefined;
      log({ action, ...(appName ? { app: appName } : {}), ok: false, reason: error instanceof Refused ? error.message.slice(0, 160) : "error" });
      throw error;
    }
  }

  /** Read-only TCC status from the driver: never prompts and reads no screen. The grants belong to the process macOS holds responsible. */
  async function permissionsOf(signal?: AbortSignal): Promise<string> {
    try {
      const r = await cua.call("check_permissions", { prompt: false, probe_direct_capture: false }, signal);
      const d = r.data;
      if (r.isError || typeof d.accessibility !== "boolean" || typeof d.screen_recording !== "boolean") throw new Error("Invalid permission status.");
      const state = (on: boolean) => (on ? "granted" : "missing");
      const who = typeof d.source?.bundle_id === "string" ? ` for ${d.source.bundle_id}` : "";
      const fix = d.accessibility && d.screen_recording ? "" : " To grant, open System Settings → Privacy & Security, or run `cua-driver permissions grant` in Terminal.";
      return `Permissions${who} (read-only check, no prompt): Accessibility: ${state(d.accessibility)}; Screen Recording: ${state(d.screen_recording)}.${fix} ATOM did not change any permission.`;
    } catch (error) {
      if (signal?.aborted) throw error;
      return "The driver's permission status could not be read; Accessibility and Screen Recording are unknown, not confirmed.";
    }
  }

  async function perform(action: string, input: Record<string, unknown>, signal?: AbortSignal): Promise<string> {
    switch (action) {
      case "status": {
        if (!cua.probe) throw new Refused("This computer transport does not support a readiness check.");
        const status = await cua.probe(signal);
        if (!status.ready) {
          target = undefined;
          throw new Refused(`Computer driver is missing required methods: ${status.missingTools.join(", ")}. Check or update the driver installation; no desktop action was performed.`);
        }
        const startup = status.reused
          ? `Reused the existing helper; no startup for this check (last startup ${status.startupMs} ms).`
          : `Started the helper in ${status.startupMs} ms.`;
        const permissions = status.permissionCheck
          ? await permissionsOf(signal)
          : "macOS Accessibility and Screen Recording permissions are not tested by this check (this driver offers no read-only permission check).";
        return `Computer driver ready. ${startup} Protocol check: ${status.probeMs} ms. No apps, windows or screenshots were read and no input was sent. ${permissions} This does not grant access; existing computer policy still applies.`;
      }
      case "list_apps": {
        const visible = (await apps(signal)).filter((a) => a.running && !appBlock(a.bundle_id, a.name));
        return `Running apps: ${visible.map((a) => a.name).join(", ")}`;
      }
      case "look":
        return look(String(input.app ?? target?.app ?? ""), signal);
      case "open": {
        const app = await findApp(String(input.app ?? ""), signal);
        if (!app.bundle_id) throw new Refused(`Cannot open ${app.name}.`);
        const r = await cua.call("launch_app", { bundle_id: app.bundle_id }, signal);
        checkResult(r, `Opening ${app.name}`, app.name);
        return `Opened ${app.name} in the background. Use action "look" to read it.`;
      }
      case "click": {
        const t = need();
        const el = pick(t, input.element);
        const deleting = deleteDenial(el.label, el.role);
        if (deleting) throw new Refused(deleting);
        const why = labelApproval(el.label, el.role);
        if (why) await ask(`Click ${why} in ${t.app}`, "it may send, buy, delete or change something", signal);
        const r = await cua.call("click", { pid: t.pid, window_id: t.windowId, element_token: el.element_token, delivery_mode: "background" }, signal, t.generation);
        // A text area or field has no press action (AX error -25206), so the click cannot focus it; `type` focuses it by itself.
        if (r.isError && TEXT_INPUT_ROLES.has(el.role ?? "") && /-25206/.test(r.text)) {
          throw new Refused(`[${el.element_index}] is a text field and cannot be pressed. To write in it, use action "type" with element ${el.element_index}; that focuses it. Nothing was clicked.`);
        }
        checkResult(r, "Click", t.app);
        t.justTyped = false;
        return `Clicked [${el.element_index}]${el.label ? ` "${el.label}"` : ""}.${verdict(r, `click:${el.element_index}`)}`;
      }
      case "type": {
        const t = need();
        const el = pick(t, input.element);
        const secret = secretField(el);
        if (secret) throw new Refused(`ATOM never types into ${secret}. Ask the user to type it themselves.`);
        if (typeof input.text !== "string" || !input.text) throw new Refused('"text" is required.');
        const lineBreak = typeApproval(input.text);
        if (lineBreak) await ask(`Type text with a line break into ${t.app}`, `it has ${lineBreak}`, signal);
        const r = await cua.call("type_text", { pid: t.pid, window_id: t.windowId, element_token: el.element_token, text: input.text, delivery_mode: "background" }, signal, t.generation);
        checkResult(r, "Typing", t.app);
        t.justTyped = isSearchField(el.label, el.role); // Return may follow without a card only in a search or address field
        return `Typed ${input.text.length} characters into [${el.element_index}].${verdict(r, `type:${el.element_index}`)}`;
      }
      case "key": {
        const t = need();
        const keys = Array.isArray(input.keys) ? input.keys.map(String) : [];
        if (!keys.length) throw new Refused('"keys" is required, e.g. ["tab"] or ["cmd","c"].');
        const deleting = deleteKeyDenial(keys);
        if (deleting) throw new Refused(deleting);
        const why = keyApproval(keys, t.justTyped);
        if (why) await ask(`Press ${keys.join("+")} in ${t.app}`, `it uses ${why}`, signal);
        const key = keys[keys.length - 1];
        const mods = keys.slice(0, -1);
        const r = await cua.call(mods.length ? "hotkey" : "press_key", mods.length ? { pid: t.pid, window_id: t.windowId, keys, delivery_mode: "background" } : { pid: t.pid, window_id: t.windowId, key, delivery_mode: "background" }, signal, t.generation);
        checkResult(r, "Key press", t.app);
        t.justTyped = false;
        return `Pressed ${keys.join("+")}.${verdict(r, `key:${keys.join("+")}`)}`;
      }
      case "point": {
        // Shows the user a place on screen. It changes nothing in any app, so it never asks.
        const t = need();
        const el = pick(t, input.element);
        const box = usableFrame(el.frame);
        if (!box) throw new Refused(`ATOM cannot show where [${el.element_index}] is: it has no place on screen. Describe it in words instead.`);
        if (!onPoint) throw new Refused("Pointing is not available right now. Describe where it is in words instead.");
        const label = (typeof input.text === "string" && input.text.trim() ? input.text : el.label ?? "").replace(/\s+/g, " ").trim().slice(0, 60);
        if (onPoint({ ...box, label }) === false) throw new Refused("Pointing is not available right now. Describe where it is in words instead.");
        return `Pointed at [${el.element_index}]${label ? ` (${label})` : ""}. The user can see it now; do not point again unless asked.`;
      }
      case "scroll": {
        const t = need();
        const direction = String(input.direction ?? "down");
        if (!["up", "down", "left", "right"].includes(direction)) throw new Refused("direction must be up, down, left or right.");
        const el = input.element === undefined ? undefined : pick(t, input.element);
        const r = await cua.call("scroll", { pid: t.pid, window_id: t.windowId, direction, amount: 5, by: "line", ...(el ? { element_token: el.element_token } : {}), delivery_mode: "background" }, signal, t.generation);
        checkResult(r, "Scroll", t.app);
        t.justTyped = false;
        return `Scrolled ${direction}.${verdict(r, `scroll:${direction}:${input.element ?? ""}`)}`;
      }
      case "set_value": {
        // Sets a slider, stepper or menu choice directly (AXValue), instead of clicking toward it. Same rules as typing and clicking.
        const t = need();
        const el = pick(t, input.element);
        const secret = secretField(el);
        if (secret) throw new Refused(`ATOM never types into ${secret}. Ask the user to type it themselves.`);
        if (typeof input.text !== "string" || !input.text) throw new Refused('"text" is required: the value to set.');
        // A value of a setting ("Delete files after: 30 days") is not a delete: it asks, like a click on a risky control, and is never refused outright.
        const why = labelApproval(el.label, el.role);
        if (why) await ask(`Change ${why} in ${t.app}`, "it may send, buy, delete or change something", signal);
        const r = await cua.call("set_value", { pid: t.pid, window_id: t.windowId, element_token: el.element_token, value: input.text }, signal, t.generation);
        checkResult(r, "Setting the value", t.app);
        t.justTyped = isSearchField(el.label, el.role);
        return `Set [${el.element_index}]${el.label ? ` "${el.label}"` : ""} to ${JSON.stringify(input.text.slice(0, 80))}.${verdict(r, `set_value:${el.element_index}`)}`;
      }
      default:
        throw new Refused(`"${action}" is not an action. Use one of: ${ACTIONS.join(", ")}.`);
    }
  }

  return {
    capability: { title: "Use apps for you", examples: ["Where's Bluetooth in System Settings?", "In TextEdit, make the title bold"] },
    spec: {
      name: "computer",
      description:
        "Controls apps on the user's Mac in the background. Use `status` to check driver readiness/timing and, read-only, the driver's Accessibility and Screen Recording permissions without reading desktop content. After a driver failure, look again; never automatically repeat an uncertain action. First `look` at an app to get its numbered elements, then `click`, " +
        "`type` or `key` using those numbers; look again after anything that changes the window. There is no need to click a field before typing: `type` with its element focuses it. Typed text goes in at the cursor, " +
        "not at the end. Use `open` to start an app. " +
        "Use `set_value` to set a slider, stepper or choice to a value in one step (text holds the value), instead of clicking toward it. " +
        "Add `look_after: true` to a click, type, key, scroll or set_value to get the new screen in the same reply. " +
        "Each reply says whether the action was confirmed; if it says it probably did nothing, look before trying again. " +
        "Use `point` with an element number (and a short label) to show the user where something is: ATOM flies to it. " +
        "Point when the user asks where something is or how to do it, instead of doing it for them. " +
        "ATOM asks the user before sending, buying, deleting or changing anything, and never types passwords. " +
        "If the user declines, stop and say so.",
      inputSchema: {
        type: "object",
        properties: {
          action: { type: "string", description: `One of: ${ACTIONS.join(", ")}` },
          app: { type: "string", description: "App name for look and open, e.g. TextEdit" },
          element: { type: "number", description: "Element number from the last look" },
          text: { type: "string", description: "Text to type, or the value for set_value" },
          look_after: { type: "boolean", description: "After a click, type, key, scroll or set_value: also return the new screen" },
          keys: { type: "array", description: 'Keys to press, last one is the key, e.g. ["cmd","c"] or ["tab"]' },
          direction: { type: "string", description: "up, down, left or right" },
        },
        required: ["action"],
      },
    },
    run,
  };
}
