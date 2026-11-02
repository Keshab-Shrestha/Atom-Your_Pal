import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";
import { randomUUID } from "node:crypto";

/**
 * 2026-11-02 (Keshab, after Empryo's "Morphs": panels from one JSON file): a panel is a named set of blocks on ARK's Panels page,
 * and on Home when pinned. A panel is inert data: ARK draws it and acts only when Keshab clicks. A block holds its own state
 * (a ticked item, a counter), saved with the panel. Kept in data/panels.json, owner-only. The agent adds one with `create_panel`,
 * on an approval card that lists its blocks and buttons; the window edits and deletes. Pure, apart from the store.
 */
export type PanelPage = "dashboard" | "board" | "chat" | "workflows" | "scheduled" | "brain" | "panels" | "you" | "settings";
export type PanelAction = { kind: "ask"; prompt: string } | { kind: "open"; page: PanelPage } | { kind: "workflow"; id: string };
export interface PanelItem { text: string; done?: boolean }
export interface PanelChart { type: "bar" | "line" | "pie"; title?: string; labels: string[]; series: { name: string; values: number[] }[] }
export interface PanelBlock {
  kind: "text" | "stat" | "progress" | "checklist" | "notes" | "counter" | "chart" | "button";
  label?: string;
  /** text: the words. */
  text?: string;
  /** stat and progress: the value; {{live.name}} reads ARK's live numbers. */
  value?: string;
  detail?: string;
  max?: number;
  count?: number;
  step?: number;
  items?: PanelItem[];
  chart?: PanelChart;
  action?: PanelAction;
}
export interface Panel {
  id: string;
  name: string;
  enabled: boolean;
  /** Also shown on Home. */
  home: boolean;
  blocks: PanelBlock[];
  createdAt: string;
  updatedAt: string;
}

export const MAX_PANELS = 20;
export const MAX_BLOCKS = 30;
export const MAX_ITEMS = 50;
export const MAX_TEXT = 2000;
export const MAX_SHORT = 120;
export const MAX_ITEM_TEXT = 300;
export const PAGES: readonly PanelPage[] = ["dashboard", "board", "chat", "workflows", "scheduled", "brain", "panels", "you", "settings"];
const KINDS = ["text", "stat", "progress", "checklist", "notes", "counter", "chart", "button"] as const;

const isObject = (v: unknown): v is Record<string, unknown> => typeof v === "object" && v !== null && !Array.isArray(v);
function str(v: unknown, max: number, what: string, required = false): string | undefined {
  if (v === undefined || v === null || v === "") { if (required) throw new Error(`${what} is empty.`); return undefined; }
  if (typeof v !== "string") throw new Error(`${what} is not text.`);
  if (v.length > max) throw new Error(`${what} is longer than ${max} characters.`);
  return v;
}
function num(v: unknown, what: string, min: number, max: number): number | undefined {
  if (v === undefined) return undefined;
  if (typeof v !== "number" || !Number.isFinite(v) || v < min || v > max) throw new Error(`${what} is a number from ${min} to ${max}.`);
  return v;
}

function checkChart(v: unknown): PanelChart {
  if (!isObject(v)) throw new Error("A chart block needs a chart.");
  if (v.type !== "bar" && v.type !== "line" && v.type !== "pie") throw new Error("A chart is a bar, line or pie.");
  if (!Array.isArray(v.labels) || v.labels.length < 1 || v.labels.length > 50) throw new Error("A chart has 1 to 50 labels.");
  const labels = v.labels.map((l) => str(l, MAX_SHORT, "A chart label", true)!);
  if (new Set(labels).size !== labels.length) throw new Error("A chart's labels are all different.");
  if (!Array.isArray(v.series) || v.series.length < 1 || v.series.length > 6) throw new Error("A chart has 1 to 6 series.");
  const series = v.series.map((s) => {
    if (!isObject(s) || !Array.isArray(s.values) || s.values.length !== labels.length || !s.values.every((n) => typeof n === "number" && Number.isFinite(n))) {
      throw new Error("Each chart series has one number for each label.");
    }
    return { name: str(s.name, MAX_SHORT, "A series name", true)!, values: s.values as number[] };
  });
  if (v.type === "pie" && (series.length !== 1 || series[0]!.values.some((n) => n < 0) || !series[0]!.values.some((n) => n > 0))) {
    throw new Error("A pie chart has one series of numbers that are not negative.");
  }
  const title = str(v.title, MAX_SHORT, "The chart title");
  return { type: v.type, ...(title ? { title } : {}), labels, series };
}

function checkAction(v: unknown): PanelAction {
  if (!isObject(v)) throw new Error("A button needs an action.");
  if (v.kind === "ask") return { kind: "ask", prompt: str(v.prompt, MAX_TEXT, "The prompt", true)! };
  if (v.kind === "open" && PAGES.includes(v.page as PanelPage)) return { kind: "open", page: v.page as PanelPage };
  if (v.kind === "workflow" && typeof v.id === "string" && /^[a-z0-9-]{1,40}$/.test(v.id)) return { kind: "workflow", id: v.id };
  throw new Error("A button asks ARK something, opens a page, or runs a workflow.");
}

function checkBlock(raw: unknown, i: number): PanelBlock {
  const at = `Block ${i + 1}`;
  if (!isObject(raw)) throw new Error(`${at} is not a block.`);
  const kind = raw.kind as PanelBlock["kind"];
  if (!KINDS.includes(kind)) throw new Error(`${at} is one of: ${KINDS.join(", ")}.`);
  const label = str(raw.label, MAX_SHORT, `${at}'s label`);
  const block: PanelBlock = { kind, ...(label ? { label } : {}) };
  const set = <K extends keyof PanelBlock>(key: K, value: PanelBlock[K] | undefined) => { if (value !== undefined) block[key] = value; };
  if (kind === "text") set("text", str(raw.text, MAX_TEXT, `${at}'s text`, true));
  if (kind === "stat") { set("value", str(raw.value, MAX_SHORT, `${at}'s value`, true)); set("detail", str(raw.detail, MAX_SHORT, `${at}'s detail`)); }
  if (kind === "progress") { set("value", str(raw.value, MAX_SHORT, `${at}'s value`, true)); set("max", num(raw.max, `${at}'s max`, 0.000001, 1e12) ?? 100); }
  if (kind === "counter") { set("count", num(raw.count, `${at}'s count`, -1e12, 1e12) ?? 0); set("step", num(raw.step, `${at}'s step`, 0.000001, 1e9) ?? 1); }
  if (kind === "checklist" || kind === "notes") {
    const items = raw.items === undefined ? [] : raw.items;
    if (!Array.isArray(items) || items.length > MAX_ITEMS) throw new Error(`${at} has at most ${MAX_ITEMS} items.`);
    block.items = items.map((item) => {
      const o = typeof item === "string" ? { text: item } : item;
      if (!isObject(o)) throw new Error(`${at} has an item that is not text.`);
      const text = str(o.text, MAX_ITEM_TEXT, `${at}'s item`, true)!;
      return kind === "checklist" ? { text, done: o.done === true } : { text };
    });
  }
  if (kind === "chart") block.chart = checkChart(raw.chart);
  if (kind === "button") { block.action = checkAction(raw.action); if (!block.label) throw new Error(`${at}, a button, needs a label.`); }
  return block;
}

/** A panel from the agent or the window, checked: 1 to 30 blocks, text within limits, buttons that only ask, open a page or run a workflow. */
export function checkPanel(input: unknown, now = new Date()): Panel {
  if (!isObject(input)) throw new Error("A panel is an object.");
  if (!Array.isArray(input.blocks) || input.blocks.length < 1 || input.blocks.length > MAX_BLOCKS) throw new Error(`A panel has 1 to ${MAX_BLOCKS} blocks.`);
  const id = typeof input.id === "string" && /^[a-z0-9-]{1,40}$/.test(input.id) ? input.id : randomUUID().slice(0, 8);
  const stamp = (v: unknown) => (typeof v === "string" && !Number.isNaN(Date.parse(v)) ? v : now.toISOString());
  return {
    id, name: str(input.name, 60, "The name", true)!, enabled: input.enabled !== false, home: input.home === true,
    blocks: input.blocks.map(checkBlock), createdAt: stamp(input.createdAt), updatedAt: now.toISOString(),
  };
}

/** What the approval card shows: each block's kind and label, and what each button does. */
export function describePanel(p: Panel): string {
  const blocks = p.blocks.map((b) => (b.label ? `${b.kind} "${b.label}"` : b.kind)).join(", ");
  const buttons = p.blocks.filter((b) => b.kind === "button").map((b) => {
    const a = b.action!;
    return `${b.label} → ${a.kind === "ask" ? `asks "${a.prompt.slice(0, 80)}"` : a.kind === "open" ? `opens ${a.page}` : `runs workflow ${a.id}`}`;
  });
  return `Blocks: ${blocks}.${buttons.length ? `\nButtons: ${buttons.join("; ")}.` : ""}${p.home ? "\nShown on Home." : ""}`;
}

export interface PanelStore {
  list(): Panel[];
  save(panel: unknown): Panel[];
  remove(id: string): Panel[];
}

/** data/panels.json: `{ version: 1, panels: [...] }`, written whole (a temp file, then rename), owner-only. */
export function createPanelStore(path: string): PanelStore {
  let cache: Panel[] | undefined;
  const read = (): Panel[] => {
    if (cache) return cache;
    if (!existsSync(path)) return (cache = []);
    const raw = JSON.parse(readFileSync(path, "utf8")) as { panels?: unknown[] };
    cache = (raw.panels ?? []).flatMap((p) => { try { return [checkPanel(p)]; } catch { return []; } });
    return cache;
  };
  const write = (list: Panel[]) => {
    mkdirSync(dirname(path), { recursive: true, mode: 0o700 });
    const temp = `${path}.${process.pid}.tmp`;
    writeFileSync(temp, JSON.stringify({ version: 1, panels: list }, null, 2), { mode: 0o600 });
    renameSync(temp, path);
    cache = list;
    return [...list];
  };
  return {
    list: () => [...read()],
    save(input) {
      const panel = checkPanel(input);
      const current = read();
      const index = current.findIndex((p) => p.id === panel.id);
      if (index < 0 && current.length >= MAX_PANELS) throw new Error(`ARK keeps at most ${MAX_PANELS} panels.`);
      return write(index < 0 ? [...current, panel] : current.map((p) => (p.id === panel.id ? { ...panel, createdAt: p.createdAt } : p)));
    },
    remove: (id) => write(read().filter((p) => p.id !== id)),
  };
}

/**
 * The `create_panel` tool. Keshab approves each new panel on the approval card, which lists its blocks and what its buttons do.
 * A panel is inert: it acts only when he clicks a button, and a button never sends a message by itself.
 */
export function createPanelTool(options: {
  store: Pick<PanelStore, "save">;
  approve(request: { summary: string; reason: string; reasonMax?: number }, signal?: AbortSignal): Promise<boolean>;
  onCreated?(event: { panel: string; blocks: number }): void;
}) {
  return {
    spec: {
      name: "create_panel",
      description:
        "Add a panel to the user's Panels page (and Home when home is true). A panel is a name and 1 to 30 blocks. Block kinds: " +
        "text {text}; stat {label, value, detail?}; progress {label, value, max}; checklist {label?, items:[{text,done}]}; notes {label?, items:[text]}; " +
        "counter {label, count, step?}; chart {chart:{type bar|line|pie, title?, labels, series:[{name, values}]}}; " +
        "button {label, action: {kind:'ask', prompt} | {kind:'open', page} | {kind:'workflow', id}}. " +
        "In a stat or progress value write {{live.needsYou}}, {{live.working}}, {{live.agents}}, {{live.chats}}, {{live.workflows}}, {{live.tokensToday}} or {{live.tokensWeek}} for ARK's live numbers. " +
        "The user ticks, adds and counts in it; a button only acts when clicked, and an ask button puts the prompt in a new chat for the user to send.",
      inputSchema: {
        type: "object" as const,
        properties: {
          name: { type: "string" },
          home: { type: "boolean" },
          blocks: { type: "array", items: { type: "object" } },
        },
        required: ["name", "blocks"],
      },
    },
    capability: { title: "Add a panel", examples: ["Make me a panel with a reading list and a counter for glasses of water"] },
    async run(input: Record<string, unknown>, signal?: AbortSignal): Promise<string> {
      let panel: Panel;
      try { panel = checkPanel({ name: input.name, home: input.home, blocks: input.blocks }); }
      catch (error) { return `The panel is not valid: ${error instanceof Error ? error.message : "unknown problem"} Fix it and call create_panel again.`; }
      const ok = await options.approve({ summary: `Add a panel: ${panel.name.slice(0, 40)}`, reason: describePanel(panel), reasonMax: 600 }, signal);
      if (!ok) return "The user did not approve the panel on the approval card. Nothing was made. Tell the user in one short sentence.";
      options.store.save(panel);
      options.onCreated?.({ panel: panel.id, blocks: panel.blocks.length });
      return `The panel "${panel.name}" is on the Panels page${panel.home ? " and on Home" : ""}. Tell the user in one short sentence.`;
    },
  };
}
