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

const ACTIONS = ["list_apps", "look", "open", "click", "type", "key", "scroll"] as const;

/**
 * The one computer-control tool the model sees (ADR-054). It exposes a small set of actions on top of Cua Driver,
 * and enforces ZENO's rules around every one: blocked apps, approval for risky clicks and keys, no typing into
 * secret fields, and only elements from the latest `look`. The model chooses actions; it never touches Cua directly.
 */
export function createComputerTool(options: ComputerToolOptions): Tool {
  const { cua, approve, onAction, maxElements = 150 } = options;
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
    if (state.isError) throw new Refused(`Could not read ${app.name}: ${state.refusal?.message ?? state.text}`);
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

  function checkResult(r: { isError: boolean; text: string; refusal?: { code: string; message: string } }, what: string) {
    if (r.refusal?.code === "stale_element_token") throw new Refused("The window changed since the last look. Look again, then retry.");
    if (r.isError) throw new Refused(`${what} failed: ${r.refusal?.message ?? r.text}`);
  }

  async function run(input: Record<string, unknown>, signal?: AbortSignal): Promise<string> {
    const action = String(input.action);
    const appName = typeof input.app === "string" ? input.app : target?.app;
    try {
      const out = await perform(action, input, signal);
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
        checkResult(r, `Opening ${app.name}`);
        return `Opened ${app.name} in the background. Use action "look" to read it.`;
      }
      case "click": {
        const t = need();
        const el = pick(t, input.element);
        const why = labelApproval(el.label, el.role);
        if (why) await ask(`Click ${why} in ${t.app}`, "it may send, buy, delete or change something", signal);
        const r = await cua.call("click", { pid: t.pid, window_id: t.windowId, element_token: el.element_token, delivery_mode: "background" }, signal);
        checkResult(r, "Click");
        t.justTyped = false;
        return `Clicked [${el.element_index}]${el.label ? ` "${el.label}"` : ""}. ${r.text}`.trim();
      }
      case "type": {
        const t = need();
        const el = pick(t, input.element);
        const secret = secretField(el);
        if (secret) throw new Refused(`ZENO never types into ${secret}. Ask the user to type it themselves.`);
        if (typeof input.text !== "string" || !input.text) throw new Refused('"text" is required.');
        const r = await cua.call("type_text", { pid: t.pid, window_id: t.windowId, element_token: el.element_token, text: input.text, delivery_mode: "background" }, signal);
        checkResult(r, "Typing");
        t.justTyped = true;
        return `Typed ${input.text.length} characters into [${el.element_index}].`;
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
        checkResult(r, "Key press");
        t.justTyped = false;
        return `Pressed ${keys.join("+")}.`;
      }
      case "scroll": {
        const t = need();
        const direction = String(input.direction ?? "down");
        if (!["up", "down", "left", "right"].includes(direction)) throw new Refused("direction must be up, down, left or right.");
        const el = input.element === undefined ? undefined : pick(t, input.element);
        const r = await cua.call("scroll", { pid: t.pid, window_id: t.windowId, direction, amount: 5, by: "line", ...(el ? { element_token: el.element_token } : {}), delivery_mode: "background" }, signal);
        checkResult(r, "Scroll");
        t.justTyped = false;
        return `Scrolled ${direction}.`;
      }
      default:
        throw new Refused(`"${action}" is not an action. Use one of: ${ACTIONS.join(", ")}.`);
    }
  }

  return {
    spec: {
      name: "computer",
      description:
        "Controls apps on the user's Mac in the background. First `look` at an app to get its numbered elements, then `click`, " +
        "`type` or `key` using those numbers; look again after anything that changes the window. Typed text goes in at the cursor, " +
        "not at the end. Use `open` to start an app. " +
        "ZENO asks the user before sending, buying, deleting or changing anything, and never types passwords. " +
        "If the user declines, stop and say so.",
      inputSchema: {
        type: "object",
        properties: {
          action: { type: "string", description: `One of: ${ACTIONS.join(", ")}` },
          app: { type: "string", description: "App name for look and open, e.g. TextEdit" },
          element: { type: "number", description: "Element number from the last look" },
          text: { type: "string", description: "Text to type" },
          keys: { type: "array", description: 'Keys to press, last one is the key, e.g. ["cmd","c"] or ["tab"]' },
          direction: { type: "string", description: "up, down, left or right" },
        },
        required: ["action"],
      },
    },
    run,
  };
}
