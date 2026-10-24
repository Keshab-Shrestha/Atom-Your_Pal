import type { Tool, ToolOutput } from "../engine.ts";
import type { ToolImage } from "@atom/contracts";
import type { CuaTransport } from "./cua-client.ts";
import { appBlock, deleteDenial, deleteKeyDenial, isSearchField, keyApproval, labelApproval, secretField, typeApproval } from "./policy.ts";

export interface ApprovalRequest {
  /** What ATOM is about to do, in words for the user: "Click \"Send\" in Mail". */
  summary: string;
  /** Why it is asking. */
  reason: string;
}

export interface ComputerAction {
  /** Count only, never image bytes or screen content. */
  imageCount?: number;
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
  /** Progress within one action; does not begin another action or extend its authority. */
  onProgress?: (step: { action: string; app: string; current: number; total: number }) => void;
  /** Visual overlay only; observed global screen points, never a real-pointer input. */
  onCursorMove?: (point: { x: number; y: number }) => void;
  /** The user's Settings default for input, read at each action. Absent: background. A request's own `mode` wins over it. */
  deliveryMode?: () => DeliveryMode;
  /** Optional fast selector; only a prepared plan index may come back, never arbitrary actions. */
  decisionProvider?: () => "off" | "jev" | "laya";
  choosePlan?: (state: { state: string; criteria: Record<string, string> }, signal?: AbortSignal) => Promise<{ index?: number; source: "jev" | "laya"; reason?: "uncertain" | "unavailable" } | undefined>;
  maxElements?: number;
}

/** Background acts without fronting the app, so the user keeps working. Foreground briefly fronts the window, acts, then gives focus back. */
export type DeliveryMode = "background" | "foreground";
const MODES: readonly string[] = ["background", "foreground"];

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
  bounds?: { x: number; y: number; width: number; height: number };
  generation: number | undefined;
  pid: number;
  windowId: number;
  app: string;
  bundleId: string | undefined;
  elements: Map<number, Element>;
  justTyped: boolean;
  readings: Array<{ label: string; value: string }>;
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

const ACTIONS = ["status", "list_apps", "windows", "look", "open", "click", "click_sequence", "choose_sequence", "type", "key", "scroll", "set_value", "point"] as const;

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
const MAX_SCREEN_TEXTS = 20;
const MAX_SCREEN_TEXT = 80;

/** Exact labelled read-only values, never truncated or inferred from an image. Ambiguous labels do not match. */
function labelledReadings(tree: string): Array<{ label: string; value: string }> {
  const out: Array<{ label: string; value: string }> = [];
  for (const line of tree.split("\n")) {
    const m = line.match(/^\s*- AXStaticText = ("(?:[^"\\]|\\.)*") \(([^)]*)\)\s*$/);
    if (!m || secretField({ role: "AXStaticText", label: m[2]! })) continue;
    try { out.push({ label: m[2]!, value: JSON.parse(m[1]!) as string }); } catch { /* malformed driver text is not evidence */ }
  }
  return out;
}

interface ButtonStep { button: string; expect: { label: string; value: string } }
function buttonSteps(value: unknown): ButtonStep[] {
  if (!Array.isArray(value) || value.length < 1 || value.length > 8) throw new Refused("click_sequence needs 1–8 steps. Nothing was clicked.");
  const short = (s: unknown): s is string => typeof s === "string" && s.length > 0 && s.length <= 120 && !/[\u0000-\u001f]/.test(s);
  return value.map((v) => {
    if (!v || typeof v !== "object" || Array.isArray(v) || Object.keys(v).some((k) => k !== "button" && k !== "expect") ||
        !short(v.button) || !v.expect || typeof v.expect !== "object" || Array.isArray(v.expect) ||
        Object.keys(v.expect).some((k) => k !== "label" && k !== "value") || !short(v.expect.label) || !short(v.expect.value) ||
        secretField({ role: "AXStaticText", label: v.expect.label })) {
      throw new Refused("Each sequence step needs an exact button and expect {label, value} for non-secret read-only text (1–120 characters each). Nothing was clicked.");
    }
    // A sequence never bundles consequential controls or approvals. Use an individual click for those.
    const denied = deleteDenial(v.button, "AXButton");
    if (denied) throw new Refused(denied);
    if (labelApproval(v.button, "AXButton")) throw new Refused("Approval-requiring buttons must be clicked individually, outside a sequence. Nothing was clicked.");
    return { button: v.button, expect: { label: v.expect.label, value: v.expect.value } };
  });
}

function preparedPlans(input: Record<string, unknown>): Array<{ description: string; steps: ButtonStep[] }> {
  if (typeof input.goal !== "string" || !input.goal.trim() || input.goal.length > 500 || !Array.isArray(input.plans) || input.plans.length < 2 || input.plans.length > 4)
    throw new Refused("choose_sequence needs a goal (1–500 characters) and 2–4 prepared plans. Nothing was clicked.");
  return input.plans.map((p) => {
    if (!p || typeof p !== "object" || Array.isArray(p) || Object.keys(p).some((k) => k !== "description" && k !== "steps") || typeof p.description !== "string" || !p.description.trim() || p.description.length > 300)
      throw new Refused("Each prepared plan needs a description (1–300 characters) and checked steps. Nothing was clicked.");
    return { description: p.description, steps: buttonSteps(p.steps) };
  });
}

function matchesReading(t: Target, expect: ButtonStep["expect"]): boolean {
  const values = t.readings.filter((r) => r.label === expect.label);
  return values.length === 1 && values[0]!.value === expect.value;
}

/**
 * Read-only text the driver lists without a number (a calculator display, a label, a status line). It is never actionable, only shown:
 * Calculator's result exists only this way, so the model could not read it (speed baseline 2026-10-23). Secret-labelled text is left out.
 */
function screenTexts(tree: string): string[] {
  const out: string[] = [];
  for (const line of tree.split("\n")) {
    if (out.length >= MAX_SCREEN_TEXTS) break;
    const m = line.match(/^\s*- AXStaticText = "((?:[^"\\]|\\.)*)"(?: \(([^)]*)\))?\s*$/);
    if (!m) continue;
    const value = m[1]!.trim();
    const label = m[2]?.trim();
    if (!value || secretField({ role: "AXStaticText", label: label ?? "" })) continue;
    const shown = `"${value.slice(0, MAX_SCREEN_TEXT)}"${label ? ` (${label.slice(0, 40)})` : ""}`;
    if (!out.includes(shown)) out.push(shown);
  }
  return out;
}

/**
 * The one computer-control tool the model sees (ADR-054). It exposes a small set of actions on top of Cua Driver,
 * and enforces ATOM's rules around every one: blocked apps, approval for risky clicks and keys, no typing into
 * secret fields, and only elements from the latest `look`. The model chooses actions; it never touches Cua directly.
 */
export function createComputerTool(options: ComputerToolOptions): Tool<string | ToolOutput> {
  const { cua, approve, onAction, onStep, onPoint, deliveryMode, maxElements = 150 } = options;
  let target: Target | undefined;
  let observationImages: ToolImage[] | undefined;
  let active = false;
  const capturedImages = (): ToolImage[] | undefined => observationImages;
  /** The app of the last good look. list_apps cost 0.55-0.70 s per look (speed baseline 2026-10-23); its pid is reused while it owns windows. */
  let lastApp: { name: string; bundle_id?: string; pid: number; generation: number | undefined } | undefined;

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

  async function look(appName: string, signal?: AbortSignal, windowId?: number, query?: string): Promise<string> {
    target = undefined; // a failed fresh observation must not leave the previous window's elements actionable
    const cached = lastApp && lastApp.generation === cua.generation && lastApp.name.toLowerCase() === appName.trim().toLowerCase() ? lastApp : undefined;
    lastApp = undefined;
    const app = cached ?? (await findApp(appName, signal));
    const pid = cached?.pid ?? (await pidOf(app, signal));
    if (pid === undefined) throw new Refused(`${app.name} is not running. Use action "open" first.`);
    const windows = await cua.call("list_windows", { pid }, signal);
    checkResult(windows, "Listing windows", app.name);
    const all = (windows.data.windows ?? []) as Array<{ window_id: number; pid?: number; app_name?: string; title?: string; is_on_screen?: boolean; on_current_space?: boolean | null; bounds?: { height?: number } }>;
    // A PID can be reused after an app quits. Reuse the fast path only while window metadata confirms the same owner.
    // Older drivers without owner metadata get a fresh app lookup instead of inheriting cached policy identity.
    if (cached && !all.some((w) => w.pid === pid && w.app_name === app.name)) return look(appName, signal, windowId, query);
    // A running app with no document still owns thin menu-bar windows (30 points high, 1 per screen): they are no window to read.
    const wins = all.filter((w) => (w.pid === undefined || w.pid === pid) && (w.app_name === undefined || w.app_name === app.name) && (w.bounds?.height ?? Number.POSITIVE_INFINITY) > MIN_WINDOW_HEIGHT);
    // Off screen, only a window on another Space is worth reading. Helpers belong to no Space (null) and a hidden panel is off screen on
    // this Space (true): reading one returned an empty window, and input then blamed "another Space" (live baseline 2026-10-23).
    // Older drivers do not report the field (undefined) and keep the earlier fallback.
    const win = windowId === undefined ? wins.find((w) => w.is_on_screen) ?? wins.find((w) => w.on_current_space === false || w.on_current_space === undefined) : wins.find((w) => w.window_id === windowId);
    if (!win) throw new Refused(`${app.name} has no window open (no document) that ATOM can see. Open, unhide or create one, or ask the user to, then look again.`);
    return readWindow(app, pid, win.window_id, win.title, signal, undefined, query);
  }

  /** Read exactly the observed window; the driver rechecks its ownership and this host checks the returned identity. */
  async function readWindow(app: { name: string; bundle_id?: string }, pid: number, windowId: number, title?: string, signal?: AbortSignal, generation?: number, query?: string): Promise<string> {
    target = undefined;
    lastApp = undefined;
    const state = await cua.call("get_window_state", { pid, window_id: windowId, include_screenshot: true, max_dimension: 1280, ...(query ? { query } : {}) }, signal, generation);
    if (state.isError) refuse(state.refusal?.code, app.name, `Could not read ${app.name}: ${state.refusal?.message ?? state.text}`);
    if (generation !== undefined && generation !== cua.generation) throw new Refused("The computer session changed while reading the window. Look again.");
    if ((state.data.pid !== undefined && state.data.pid !== pid) ||
        (state.data.window_id !== undefined && state.data.window_id !== windowId) ||
        (state.data.app_name !== undefined && state.data.app_name !== app.name)) {
      throw new Refused(`The ${app.name} window owner changed. No elements were retained; look again.`);
    }
    const elements = withoutMenuBar((state.data.elements ?? []) as Element[]);
    observationImages = state.images;
    target = { generation: cua.generation, pid, windowId: windowId, app: app.name, bundleId: app.bundle_id, bounds: state.data.window_bounds, elements: new Map(elements.map((e) => [e.element_index, e])), justTyped: false, readings: labelledReadings(String(state.data.tree_markdown ?? "")) };
    lastApp = { name: app.name, ...(app.bundle_id ? { bundle_id: app.bundle_id } : {}), pid, generation: cua.generation };
    const shown = elements.slice(0, maxElements).map((e) => {
      const bits = [`[${e.element_index}] ${e.role ?? "?"}`];
      if (e.label) bits.push(`"${e.label.slice(0, 80)}"`);
      // A field named like a secret (card number, API key...) is not shown with its value either: type and set_value refuse the same names.
      if (e.value && e.role !== "AXSecureTextField" && !secretField(e)) bits.push(`value=${JSON.stringify(e.value.slice(0, 80))}`);
      if (e.enabled === false) bits.push("(disabled)");
      return bits.join(" ");
    });
    const more = elements.length > maxElements ? `\n(${elements.length - maxElements} more elements not shown)` : "";
    const texts = screenTexts(String(state.data.tree_markdown ?? ""));
    const read = texts.length ? `\nText on screen (read only): ${texts.join("; ")}` : "";
    const picture = observationImages?.length ? "Complete window image attached; cross-check it with the elements." : "No usable window image was returned: accessibility-only observation. Do not claim visual verification.";
    const decisionProvider = options.decisionProvider?.() ?? "off";
    const decisionHint = `Fast decision provider: ${decisionProvider === "off" ? "off (use the main model and ordinary checked sequences)" : decisionProvider + " (choose_sequence may select between prepared plans)"}.`;
    const geometry = state.data.window_bounds ? `Window bounds in global screen points: ${JSON.stringify(state.data.window_bounds)}.\n` : "";
    return `${app.name} — window "${title ?? state.data.window_title ?? ""}" (window_id=${windowId})\n${geometry}Current computer actions include windows(app) to list windows on connected displays, look(app, window_id) to select one, and click_sequence with steps:[{button:"exact button label",expect:{label:"read-only text label",value:"expected text"}}] for up to 8 buttons, checking fresh labelled text after each click. Refresh the tool definition if an earlier session described fewer actions.\n${decisionHint}\n${picture}\n${shown.join("\n")}${more}${read}`;
  }

  /** The new screen, appended to an action's reply so the model needs no extra step. The "just typed" memory survives it. */
  async function lookAfter(signal?: AbortSignal): Promise<string> {
    const keep = target?.justTyped ?? false;
    try {
      const previous = need();
      const seen = await readWindow({ name: previous.app, ...(previous.bundleId ? { bundle_id: previous.bundleId } : {}) }, previous.pid, previous.windowId, undefined, signal, previous.generation);
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

  /** The request's own mode, else the Settings default. */
  function modeOf(input: Record<string, unknown>): DeliveryMode {
    if (input.mode === undefined) return deliveryMode?.() ?? "background";
    if (typeof input.mode !== "string" || !MODES.includes(input.mode)) throw new Refused('mode must be "background" or "foreground".');
    return input.mode as DeliveryMode;
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
  // that in plain words, never Cua's own retry ladder: foreground is the user's choice (Settings or the request), never an automatic retry.
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

  async function run(input: Record<string, unknown>, signal?: AbortSignal): Promise<string | ToolOutput> {
    if (active) throw new Refused("A computer action is still running. Wait for its result before observing or acting again.");
    active = true;
    observationImages = undefined;
    const action = String(input.action);
    const appName = typeof input.app === "string" ? input.app : target?.app;
    try {
      // Reject malformed delivery modes before approvals or cursor/step side effects.
      if (["click", "click_sequence", "choose_sequence", "type", "key", "scroll"].includes(action)) modeOf(input);
      if (action === "click_sequence") buttonSteps(input.steps);
      if (action === "choose_sequence") preparedPlans(input);
      onStep?.({ action, ...(appName ? { app: appName } : {}) });
      const result = await perform(action, input, signal);
      let out = typeof result === "string" ? result : result.text;
      const uncertain = typeof result !== "string" && result.uncertain;
      if ((input.look_after === true || uncertain) && INPUT_ACTIONS.has(action) && target) out += await lookAfter(signal);
      const images = capturedImages();
      const stopped = typeof result !== "string" && result.stopped === true;
      log({ action, ...(appName ? { app: appName } : {}), ok: !stopped, ...(stopped ? { reason: "sequence_stopped" } : {}), ...(images?.length ? { imageCount: images.length } : {}) });
      return images?.length ? { text: out, images } : out;
    } catch (error) {
      if (!(error instanceof Refused)) target = undefined;
      log({ action, ...(appName ? { app: appName } : {}), ok: false, reason: error instanceof Refused ? error.message.slice(0, 160) : "error" });
      throw error;
    } finally {
      active = false;
      observationImages = undefined;
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

  function inputResult(text: string, result: { data: Record<string, unknown> }, key: string) {
    return { text: text + verdict(result, key), uncertain: result.data.effect === "unverifiable" || result.data.effect === "suspected_noop", effect: result.data.effect };
  }

  function moveVisualCursor(t: Target, el?: Element) {
    const frame = usableFrame(el?.frame);
    const bounds = t.bounds;
    if (frame) options.onCursorMove?.({ x: frame.x + frame.w / 2, y: frame.y + frame.h / 2 });
    else if (bounds) options.onCursorMove?.({ x: bounds.x + bounds.width / 2, y: bounds.y + bounds.height / 2 });
  }

  async function perform(action: string, input: Record<string, unknown>, signal?: AbortSignal): Promise<string | { text: string; uncertain: boolean; effect?: unknown; stopped?: boolean }> {
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
      case "windows": {
        const app = await findApp(String(input.app ?? ""), signal);
        const pid = await pidOf(app, signal);
        if (pid === undefined) throw new Refused(`${app.name} is not running. Open it first.`);
        const result = await cua.call("list_windows", { pid }, signal);
        checkResult(result, "Listing windows", app.name);
        const windows = (result.data.windows ?? []).filter((w: any) => w.pid === pid && w.app_name === app.name && (w.bounds?.height ?? 0) > MIN_WINDOW_HEIGHT);
        return `${app.name} windows across connected displays (coordinates may be negative):\n` + windows.map((w: any) =>
          `window_id=${w.window_id} ${JSON.stringify(String(w.title ?? ""))} bounds=${JSON.stringify(w.bounds ?? {})} visible=${Boolean(w.is_on_screen)} current_space=${w.on_current_space ?? "unknown"}`).join("\n");
      }
      case "look":
        if (input.window_id !== undefined && (!Number.isSafeInteger(input.window_id) || Number(input.window_id) <= 0)) throw new Refused("window_id must identify a window returned by windows.");
        return look(String(input.app ?? target?.app ?? ""), signal, input.window_id as number | undefined,
          typeof input.query === "string" ? input.query.trim().slice(0, 120) : undefined);
      case "choose_sequence": {
        const plans = preparedPlans(input);
        if (!options.choosePlan) throw new Refused("Fast computer decisions are unavailable. Use the ordinary model path.");
        const pinned = need();
        const mode = modeOf(input);
        // No image, chat history or editable-field values are shared with the selector.
        const state = JSON.stringify({ goal: input.goal, app: pinned.app,
          buttons: [...pinned.elements.values()].filter((e) => e.role === "AXButton" && e.label && !secretField(e) && !labelApproval(e.label, e.role) && !deleteDenial(e.label, e.role)).map((e) => e.label).slice(0, 80),
          readings: pinned.readings.filter((r) => r.label.length <= 120 && r.value.length <= 120).slice(0, 20),
          plans: plans.map((p, i) => ({ id: `plan_${i}`, description: p.description, steps: p.steps })) });
        if (Buffer.byteLength(state) > 12_000) throw new Refused("The decision context is too large. Use the ordinary model path.");
        const criteria = Object.fromEntries(plans.map((p, i) => [`plan_${i}`, p.description]));
        criteria.review = "None clearly fits the goal and current window; return to the main model without input.";
        const selected = await options.choosePlan({ state, criteria }, signal);
        if (signal?.aborted) { target = undefined; throw new Refused("Cancelled. No sequence was started."); }
        if (!selected || selected.index === undefined || !Number.isSafeInteger(selected.index) || selected.index < 0 || selected.index >= plans.length) {
          const why = selected?.reason === "uncertain" ? `${selected.source} could not confidently choose a prepared plan.` : selected?.reason === "unavailable" ? `${selected.source} was unavailable or exceeded its short time limit.` : "Fast decisions are off or the current configuration changed.";
          return `${why} No input was sent. Review the current window with the main model; do not retry the selector automatically.`;
        }
        if (need() !== pinned) throw new Refused("The observed window changed during the decision. Look again before acting.");
        const result = await perform("click_sequence", { steps: plans[selected.index]!.steps, mode }, signal);
        return typeof result === "string" ? result : { ...result, text: `Prepared plan ${selected.index + 1} selected by ${selected.source}; this is not permission or success verification.\n${result.text}` };
      }
      case "click_sequence": {
        const steps = buttonSteps(input.steps);
        const pinned = need();
        const mode = modeOf(input); // pin the requested delivery mode for the complete sequence
        let completed = 0;
        let unconfirmed = 0;
        let seen = "";
        for (const [i, step] of steps.entries()) {
          if (signal?.aborted) {
            target = undefined;
            throw new Refused(`Cancelled after ${completed}/${steps.length} checked clicks. No remaining clicks were sent; look again before continuing.`);
          }
          const t = need();
          if (t.pid !== pinned.pid || t.windowId !== pinned.windowId || t.generation !== pinned.generation) throw new Refused("The sequence window changed. No remaining clicks were sent; look again.");
          const buttons = [...t.elements.values()].filter((e) => e.role === "AXButton" && e.label === step.button);
          if (buttons.length !== 1 || buttons[0]!.enabled === false) {
            return { text: `Sequence stopped after ${completed}/${steps.length} checked clicks: the next button was missing, ambiguous or disabled. No remaining clicks were sent. Look again; do not replay the sequence.${seen ? `\n\n${seen}` : ""}`, uncertain: false, stopped: true };
          }
          const before = matchesReading(t, step.expect);
          options.onProgress?.({ action: "click", app: t.app, current: i + 1, total: steps.length });
          // Reuse all ordinary click policy and the fresh element token; never send a blind batch to the driver.
          let clicked: Awaited<ReturnType<typeof perform>>;
          try {
            clicked = await perform("click", { element: buttons[0]!.element_index, mode }, signal);
            seen = await readWindow({ name: pinned.app, ...(pinned.bundleId ? { bundle_id: pinned.bundleId } : {}) }, pinned.pid, pinned.windowId, undefined, signal, pinned.generation);
            if (signal?.aborted) throw new Refused("Cancelled.");
          } catch (error) {
            target = undefined;
            throw new Refused(`Sequence stopped at click ${i + 1}/${steps.length}; ${completed} earlier clicks passed checks. The current click may have happened. No remaining clicks were sent; look again, never replay the sequence. ${signal?.aborted ? "Cancelled." : error instanceof Refused ? error.message : "The driver or observation failed."}`);
          }
          const effect = typeof clicked !== "string" ? clicked.effect : undefined;
          const matched = matchesReading(need(), step.expect);
          if (!matched || (effect !== "confirmed" && !(effect === "unverifiable" && !before))) {
            return { text: `Sequence stopped at click ${i + 1}/${steps.length}; ${completed} earlier clicks passed their checks. The expected unique labelled value was missing, unchanged after unconfirmed input, or the driver reported no effect. This click is uncertain. No remaining clicks were sent. Inspect the observation; do not replay the sequence.\n\n${seen}`, uncertain: false, stopped: true };
          }
          completed += 1;
          if (effect !== "confirmed") unconfirmed += 1;
        }
        return { text: `Sequence completed: ${completed}/${steps.length} clicks passed exact labelled-value checks in the same window. ${unconfirmed} clicks were driver-unconfirmed; their expected value transitions were freshly observed, not driver-confirmed. Only the final complete window observation is attached.\n\n${seen}`, uncertain: false };
      }
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
        moveVisualCursor(t, el);
        const r = await cua.call("click", { pid: t.pid, window_id: t.windowId, element_token: el.element_token, delivery_mode: modeOf(input) }, signal, t.generation);
        // A text area or field has no press action (AX error -25206), so the click cannot focus it; `type` focuses it by itself.
        if (r.isError && TEXT_INPUT_ROLES.has(el.role ?? "") && /-25206/.test(r.text)) {
          throw new Refused(`[${el.element_index}] is a text field and cannot be pressed. To write in it, use action "type" with element ${el.element_index}; that focuses it. Nothing was clicked.`);
        }
        checkResult(r, "Click", t.app);
        t.justTyped = false;
        return inputResult(`Clicked [${el.element_index}]${el.label ? ` "${el.label}"` : ""}.`, r, `click:${el.element_index}`);
      }
      case "type": {
        const t = need();
        const el = pick(t, input.element);
        const secret = secretField(el);
        if (secret) throw new Refused(`ATOM never types into ${secret}. Ask the user to type it themselves.`);
        if (typeof input.text !== "string" || !input.text) throw new Refused('"text" is required.');
        const lineBreak = typeApproval(input.text);
        if (lineBreak) await ask(`Type text with a line break into ${t.app}`, `it has ${lineBreak}`, signal);
        moveVisualCursor(t, el);
        const r = await cua.call("type_text", { pid: t.pid, window_id: t.windowId, element_token: el.element_token, text: input.text, delivery_mode: modeOf(input) }, signal, t.generation);
        checkResult(r, "Typing", t.app);
        t.justTyped = isSearchField(el.label, el.role); // Return may follow without a card only in a search or address field
        return inputResult(`Typed ${input.text.length} characters into [${el.element_index}].`, r, `type:${el.element_index}`);
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
        const delivery_mode = modeOf(input);
        moveVisualCursor(t);
        const r = await cua.call(mods.length ? "hotkey" : "press_key", mods.length ? { pid: t.pid, window_id: t.windowId, keys, delivery_mode } : { pid: t.pid, window_id: t.windowId, key, delivery_mode }, signal, t.generation);
        checkResult(r, "Key press", t.app);
        t.justTyped = false;
        return inputResult(`Pressed ${keys.join("+")}.`, r, `key:${keys.join("+")}`);
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
        moveVisualCursor(t, el);
        const r = await cua.call("scroll", { pid: t.pid, window_id: t.windowId, direction, amount: 5, by: "line", ...(el ? { element_token: el.element_token } : {}), delivery_mode: modeOf(input) }, signal, t.generation);
        checkResult(r, "Scroll", t.app);
        t.justTyped = false;
        return inputResult(`Scrolled ${direction}.`, r, `scroll:${direction}:${input.element ?? ""}`);
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
        moveVisualCursor(t, el);
        const r = await cua.call("set_value", { pid: t.pid, window_id: t.windowId, element_token: el.element_token, value: input.text }, signal, t.generation);
        checkResult(r, "Setting the value", t.app);
        t.justTyped = isSearchField(el.label, el.role);
        return inputResult(`Set [${el.element_index}]${el.label ? ` "${el.label}"` : ""} to ${JSON.stringify(input.text.slice(0, 80))}.`, r, `set_value:${el.element_index}`);
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
        "Controls apps on the user's Mac, in the background by default. Use `status` to check driver readiness/timing and, read-only, the driver's Accessibility and Screen Recording permissions without reading desktop content. After a driver failure, look again; never automatically repeat an uncertain action. First `look` at an app to get its numbered elements, then `click`, " +
        "Each look includes the complete target-window image when capture is available; cross-check it with the numbered elements. No continuous or idle screen capture occurs. Use `windows` with an app name to list its windows on every connected display, then `look` with the chosen window_id. Window targeting is independent of the primary display; never reinterpret window coordinates as primary-display coordinates. If a needed element is omitted from a long list, look with query to filter the tree while retaining the full image. " +
        "`type` or `key` using those numbers; look again after anything that changes the window. There is no need to click a field before typing: `type` with its element focuses it. Typed text goes in at the cursor, " +
        "not at the end. Use `open` to start an app. " +
        "Use `set_value` to set a slider, stepper or choice to a value in one step (text holds the value), instead of clicking toward it. " +
        "Add `look_after: true` to a click, type, key, scroll or set_value to get the new screen in the same reply. " +
        "For a known short button task prefer click_sequence with 1–8 steps {button, expect:{label,value}}: exact unique AXButton labels from the observed window, and an exact labelled AXStaticText value expected after EACH click. The host re-resolves each button from a fresh same-window snapshot, applies ordinary click policy, observes the complete window after every click, and stops at any mismatch, ambiguity, failure or cancellation. Approval-requiring buttons are excluded. For unconfirmed input the expected value must newly appear/change; unchanged values cannot verify it. Only the final observation reaches the model. Never invent labels, batch unknown UI transitions, or replay a stopped sequence. Use individual actions where these checks are unavailable. " +
        "Only when the latest look reports a fast decision provider enabled and a genuine choice between prepared button sequences is needed, use choose_sequence with goal and plans:[{description,steps:[{button,expect:{label,value}}]}] (2–4 plans, each 1–8 steps). The Settings-selected Jev/Laya decider chooses one or returns review; off/low confidence/failure sends no input. The main model still prepares the plans and reviews outcomes. Do not use this for a single deterministic path or retry uncertain decisions. It shares bounded goal, button/read-only labels and prepared plans only, never images or editable-field values. " +
        "Unconfirmed input includes a fresh observation of the same window when available; inspect it before taking another step. A changed screen alone does not prove the intended outcome. Never replay uncertain input automatically. " +
        "Use `point` with an element number (and a short label) to show the user where something is: ATOM flies to it. " +
        "Point when the user asks where something is or how to do it, instead of doing it for them. " +
        "ATOM asks the user before sending, buying, deleting or changing anything, and never types passwords. " +
        "If the user declines, stop and say so. " +
        'Set `mode: "foreground"` on a click, type, key or scroll only when the user asks for it to happen in the foreground (it briefly brings the window to the front), and `mode: "background"` only when they ask for background; otherwise leave it out. Never switch mode by yourself to retry.',
      inputSchema: {
        type: "object",
        properties: {
          action: { type: "string", description: `One of: ${ACTIONS.join(", ")}` },
          app: { type: "string", description: "App name for windows, look and open, e.g. TextEdit" },
          window_id: { type: "number", description: "For look: a window_id from windows, including windows on secondary displays" },
          query: { type: "string", description: "For look: optional text filter for long element trees; the image still shows the whole window" },
          element: { type: "number", description: "Element number from the last look" },
          goal: { type: "string", description: "For choose_sequence: the current computer goal, 1–500 characters" },
          plans: { type: "array", description: "For choose_sequence: 2–4 objects {description: short plan purpose (1–300 characters), steps: 1–8 checked button steps}. No extra fields; each step has {button,expect:{label,value}}." },
          steps: { type: "array", description: 'For click_sequence: 1–8 objects {button: "exact AXButton label", expect: {label: "exact read-only AXStaticText label", value: "exact expected text"}}. All strings 1–120 characters; no extra fields. Checked by the host before any click.' },
          text: { type: "string", description: "Text to type, or the value for set_value" },
          look_after: { type: "boolean", description: "After a click, type, key, scroll or set_value: also return the new screen" },
          keys: { type: "array", description: 'Keys to press, last one is the key, e.g. ["cmd","c"] or ["tab"]' },
          direction: { type: "string", description: "up, down, left or right" },
          mode: { type: "string", description: "background or foreground, only when the user asked, for this click, type, key or scroll" },
        },
        required: ["action"],
      },
    },
    run,
  };
}
