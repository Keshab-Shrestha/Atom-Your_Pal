import type { Tool } from "../engine.ts";
import type { CuaTransport } from "./cua-client.ts";
import { appBlock, keyApproval, labelApproval, secretField } from "./policy.ts";

export interface ApprovalRequest {
  /** What ZENO is about to do, in words for the user: "Click \"Send\" in Mail". */
  summary: string;
  /** Why it is asking. */
  reason: string;
}

export interface ComputerAction {
  action: string;
  app?: string;
  ok: boolean;
  /** Set when ZENO refused or the user declined. Never contains typed text. */
  reason?: string;
}

export interface ComputerToolOptions {
  cua: CuaTransport;
  /** Asks the user. Resolves true only if they approve. The model cannot call this. */
  approve: (request: ApprovalRequest, signal?: AbortSignal) => Promise<boolean>;
  /** One call per action, for the log. Receives no typed text and no screen content. */
  onAction?: (event: ComputerAction) => void;
  /**
   * Wisp flies to this place on screen and the bubble shows the label (the `point` action). Returns false if there is no
   * island to show it. Coordinates are screen points, origin at the top-left of the main display, as Cua reports them.
   */
  onPoint?: (target: { x: number; y: number; w: number; h: number; label: string }) => boolean | void;
  /** Called as an action begins, so the user can see what ZENO is doing. Carries the action and app only. */
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
 * ZENO has no menu action. Elements keep Cua's own numbers, so a dropped element simply cannot be picked.
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

const ACTIONS = ["list_apps", "look", "open", "click", "type", "key", "scroll", "set_value", "point"] as const;

/** Actions that change something in an app, so `look_after` makes sense for them. */
const INPUT_ACTIONS = new Set(["click", "type", "key", "scroll", "set_value"]);

/** Roles that take typed text, so a value set into one counts as typing. */
const TEXT_ROLE = /text|combo|search/i;

/** An element's place on screen, or nothing if it has none worth flying to (missing, not a number, empty, or off in space). */
function usableFrame(f: Element["frame"]): { x: number; y: number; w: number; h: number } | undefined {
  if (!f) return undefined;
  const { x, y, w, h } = f;
  if (![x, y, w, h].every((n) => typeof n === "number" && Number.isFinite(n))) return undefined;
  if ((w as number) < 1 || (h as number) < 1) return undefined;
  if (Math.abs(x as number) > 100_000 || Math.abs(y as number) > 100_000) return undefined; // not a real screen position
  return { x: x as number, y: y as number, w: w as number, h: h as number };
}

/**
 * The one computer-control tool the model sees (ADR-054). It exposes a small set of actions on top of Cua Driver,
 * and enforces ZENO's rules around every one: blocked apps, approval for risky clicks and keys, no typing into
 * secret fields, and only elements from the latest `look`. The model chooses actions; it never touches Cua directly.
 */
export function createComputerTool(options: ComputerToolOptions): Tool {
  const { cua, approve, onAction, onStep, onPoint, maxElements = 150 } = options;
  let target: Target | undefined;

  const log = (e: ComputerAction) => onAction?.(e);

  async function apps(signal?: AbortSignal) {
    const r = await cua.call("list_apps", {}, signal);
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

  async function look(appName: string, signal?: AbortSignal): Promise<string> {
    const app = await findApp(appName, signal);
    if (!app.running || app.pid === undefined) throw new Refused(`${app.name} is not running. Use action "open" first.`);
    const wins = ((await cua.call("list_windows", { pid: app.pid }, signal)).data.windows ?? []) as Array<{ window_id: number; title?: string; is_on_screen?: boolean }>;
    const win = wins.find((w) => w.is_on_screen) ?? wins[0];
    if (!win) throw new Refused(`${app.name} has no window yet. Wait a moment and look again.`);
    const state = await cua.call("get_window_state", { pid: app.pid, window_id: win.window_id }, signal);
    if (state.isError) refuse(state.refusal?.code, app.name, `Could not read ${app.name}: ${state.refusal?.message ?? state.text}`);
    const elements = withoutMenuBar((state.data.elements ?? []) as Element[]);
    target = { pid: app.pid, windowId: win.window_id, app: app.name, bundleId: app.bundle_id, elements: new Map(elements.map((e) => [e.element_index, e])), justTyped: false };
    const shown = elements.slice(0, maxElements).map((e) => {
      const bits = [`[${e.element_index}] ${e.role ?? "?"}`];
      if (e.label) bits.push(`"${e.label.slice(0, 80)}"`);
      if (e.value && e.role !== "AXSecureTextField") bits.push(`value=${JSON.stringify(e.value.slice(0, 80))}`);
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
      if (error instanceof Refused || (error as Error)?.name !== "AbortError") return "\n\nZENO could not read the window again. Look again.";
      throw error;
    }
  }

  function need(): Target {
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
        return `${app} has more than one window open, so ZENO cannot type or press keys there without risking the wrong window. Ask the user to close the other ${app} windows. Clicking still works. ${FINAL}`;
      case "minimized_or_hidden_window":
        return `The ${app} window is minimized or hidden. Ask the user to bring it back. ${FINAL}`;
      case "off_space_or_ax_unresolved":
        return `The ${app} window is on another desktop (Space) or ZENO cannot read it. Ask the user to switch to it. ${FINAL}`;
      case "window_not_found":
      case "owner_pid_mismatch":
        return `ZENO lost track of the ${app} window. Look again; if that fails, ${FINAL.toLowerCase()}`;
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
    if (r.refusal?.code === "stale_element_token") throw new Refused("The window changed since the last look. Look again, then retry.");
    if (r.isError) refuse(r.refusal?.code, app, `${what} failed: ${r.refusal?.message ?? r.text}`);
    lastRefusal = undefined;
  }

  // Cua says whether an input worked: confirmed (it read the result back), unverifiable, or suspected_noop. The model gets
  // that in plain words, never Cua's own retry ladder (foreground input is not something ZENO offers).
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
    if (effect === "unverifiable") return " ZENO could not confirm it worked; look to check.";
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
      log({ action, ...(appName ? { app: appName } : {}), ok: false, reason: error instanceof Refused ? error.message.slice(0, 160) : "error" });
      throw error;
    }
  }

  async function perform(action: string, input: Record<string, unknown>, signal?: AbortSignal): Promise<string> {
    switch (action) {
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
        const why = labelApproval(el.label, el.role);
        if (why) await ask(`Click ${why} in ${t.app}`, "it may send, buy, delete or change something", signal);
        const r = await cua.call("click", { pid: t.pid, window_id: t.windowId, element_token: el.element_token, delivery_mode: "background" }, signal);
        checkResult(r, "Click", t.app);
        t.justTyped = false;
        return `Clicked [${el.element_index}]${el.label ? ` "${el.label}"` : ""}.${verdict(r, `click:${el.element_index}`)}`;
      }
      case "type": {
        const t = need();
        const el = pick(t, input.element);
        const secret = secretField(el);
        if (secret) throw new Refused(`ZENO never types into ${secret}. Ask the user to type it themselves.`);
        if (typeof input.text !== "string" || !input.text) throw new Refused('"text" is required.');
        const r = await cua.call("type_text", { pid: t.pid, window_id: t.windowId, element_token: el.element_token, text: input.text, delivery_mode: "background" }, signal);
        checkResult(r, "Typing", t.app);
        t.justTyped = true;
        return `Typed ${input.text.length} characters into [${el.element_index}].${verdict(r, `type:${el.element_index}`)}`;
      }
      case "key": {
        const t = need();
        const keys = Array.isArray(input.keys) ? input.keys.map(String) : [];
        if (!keys.length) throw new Refused('"keys" is required, e.g. ["tab"] or ["cmd","c"].');
        const why = keyApproval(keys, t.justTyped);
        if (why) await ask(`Press ${keys.join("+")} in ${t.app}`, `it uses ${why}`, signal);
        const key = keys[keys.length - 1];
        const mods = keys.slice(0, -1);
        const r = await cua.call(mods.length ? "hotkey" : "press_key", mods.length ? { pid: t.pid, window_id: t.windowId, keys, delivery_mode: "background" } : { pid: t.pid, window_id: t.windowId, key, delivery_mode: "background" }, signal);
        checkResult(r, "Key press", t.app);
        t.justTyped = false;
        return `Pressed ${keys.join("+")}.${verdict(r, `key:${keys.join("+")}`)}`;
      }
      case "point": {
        // Shows the user a place on screen. It changes nothing in any app, so it never asks.
        const t = need();
        const el = pick(t, input.element);
        const box = usableFrame(el.frame);
        if (!box) throw new Refused(`ZENO cannot show where [${el.element_index}] is: it has no place on screen. Describe it in words instead.`);
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
        const r = await cua.call("scroll", { pid: t.pid, window_id: t.windowId, direction, amount: 5, by: "line", ...(el ? { element_token: el.element_token } : {}), delivery_mode: "background" }, signal);
        checkResult(r, "Scroll", t.app);
        t.justTyped = false;
        return `Scrolled ${direction}.${verdict(r, `scroll:${direction}:${input.element ?? ""}`)}`;
      }
      case "set_value": {
        // Sets a slider, stepper or menu choice directly (AXValue), instead of clicking toward it. Same rules as typing and clicking.
        const t = need();
        const el = pick(t, input.element);
        const secret = secretField(el);
        if (secret) throw new Refused(`ZENO never types into ${secret}. Ask the user to type it themselves.`);
        if (typeof input.text !== "string" || !input.text) throw new Refused('"text" is required: the value to set.');
        const why = labelApproval(el.label, el.role);
        if (why) await ask(`Change ${why} in ${t.app}`, "it may send, buy, delete or change something", signal);
        const r = await cua.call("set_value", { pid: t.pid, window_id: t.windowId, element_token: el.element_token, value: input.text }, signal);
        checkResult(r, "Setting the value", t.app);
        t.justTyped = TEXT_ROLE.test(el.role ?? "");
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
        "Controls apps on the user's Mac in the background. First `look` at an app to get its numbered elements, then `click`, " +
        "`type` or `key` using those numbers; look again after anything that changes the window. Typed text goes in at the cursor, " +
        "not at the end. Use `open` to start an app. " +
        "Use `set_value` to set a slider, stepper or choice to a value in one step (text holds the value), instead of clicking toward it. " +
        "Add `look_after: true` to a click, type, key, scroll or set_value to get the new screen in the same reply. " +
        "Each reply says whether the action was confirmed; if it says it probably did nothing, look before trying again. " +
        "Use `point` with an element number (and a short label) to show the user where something is: Wisp flies to it. " +
        "Point when the user asks where something is or how to do it, instead of doing it for them. " +
        "ZENO asks the user before sending, buying, deleting or changing anything, and never types passwords. " +
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
