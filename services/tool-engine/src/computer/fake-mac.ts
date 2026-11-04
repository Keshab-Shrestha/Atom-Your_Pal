import type { CuaResult, CuaTransport } from "./cua-client.ts";

// A fake Mac for scenario evals (2026-11-04, idea from atticus-mac "fake-Mac scenario evals"). Apps are small state machines with
// buttons, fields and read-only text. The computer tool runs against them through the same CuaTransport it uses for the real driver,
// so a scenario checks what the tool refuses, asks, clicks and saves without a screen, a driver or a model.

export interface FakeElement { role: string; label: string; enabled?: boolean }
export interface FakeApp {
  name: string;
  pid: number;
  /** The elements now on screen. */
  elements(): FakeElement[];
  /** Read-only text shown, by label. */
  readings(): Record<string, string>;
  click(label: string): void;
  /** A field was typed into or set. */
  write(label: string, text: string): void;
}

const ok = (data: Record<string, unknown>): CuaResult => ({ data, text: "ok", isError: false, refusal: undefined });

export interface FakeMac {
  cua: CuaTransport;
  /** Every driver call that sends input, in order: "click:Send", "type_text:Body". */
  inputs: string[];
  app(name: string): FakeApp;
}

export function fakeMac(apps: FakeApp[]): FakeMac {
  const inputs: string[] = [];
  let snapshot = 0;
  /** token → element label and app, valid only for the latest snapshot of that app. */
  let live = new Map<string, { app: FakeApp; label: string; role: string }>();
  const byPid = (pid: unknown) => apps.find((a) => a.pid === pid);
  const cua: CuaTransport = {
    get generation() { return 1; },
    async close() {},
    async call(name, args) {
      if (name === "list_apps") return ok({ apps: apps.map((a) => ({ name: a.name, pid: a.pid, bundle_id: `fake.${a.name.toLowerCase()}`, running: true })) });
      if (name === "list_windows") {
        const app = byPid(args.pid);
        return ok({ windows: app ? [{ app_name: app.name, pid: app.pid, window_id: app.pid * 10, is_on_screen: true }] : [] });
      }
      if (name === "get_window_state") {
        const app = byPid(args.pid);
        if (!app) throw new Error("No such window.");
        snapshot++;
        live = new Map([...live].filter(([, v]) => v.app !== app));
        const elements = app.elements().map((e, i) => {
          const token = `t${snapshot}-${i}`;
          live.set(token, { app, label: e.label, role: e.role });
          return { element_index: snapshot * 100 + i, element_token: token, role: e.role, label: e.label, enabled: e.enabled !== false };
        });
        const tree = Object.entries(app.readings()).map(([label, value]) => `- AXStaticText = ${JSON.stringify(value)} (${label})`).join("\n");
        return ok({ pid: app.pid, window_id: app.pid * 10, app_name: app.name, elements, tree_markdown: tree });
      }
      const target = live.get(String(args.element_token));
      if (!target) throw new Error("That element is no longer on screen.");
      if (name === "click") {
        inputs.push(`click:${target.label}`);
        target.app.click(target.label);
        return ok({ effect: "confirmed" });
      }
      if (name === "type_text" || name === "set_value") {
        inputs.push(`${name}:${target.label}`);
        target.app.write(target.label, String(args.text ?? args.value ?? ""));
        return ok({ effect: "confirmed" });
      }
      throw new Error(`The fake Mac does not do ${name}.`);
    },
  };
  return { cua, inputs, app: (n) => apps.find((a) => a.name === n)! };
}

/** Buttons 0-9, +, = and C; the display shows what was keyed, and = adds. */
export function calculatorApp(options: { renameButton?: { from: string; to: string } } = {}): FakeApp {
  let display = "0", pending = 0, adding = false, fresh = true;
  const rename = (label: string) => (options.renameButton && label === options.renameButton.from ? options.renameButton.to : label);
  const labels = ["0", "1", "2", "3", "4", "5", "6", "7", "8", "9", "+", "=", "C"];
  return {
    name: "Calculator",
    pid: 101,
    elements: () => labels.map((label) => ({ role: "AXButton", label: rename(label) })),
    readings: () => ({ Display: display }),
    click(label) {
      const key = options.renameButton && label === options.renameButton.to ? options.renameButton.from : label;
      if (/^\d$/.test(key)) { display = fresh ? key : display + key; fresh = false; }
      else if (key === "+") { pending = Number(display); adding = true; fresh = true; }
      else if (key === "=") { display = String(adding ? pending + Number(display) : Number(display)); adding = false; fresh = true; }
      else if (key === "C") { display = "0"; pending = 0; adding = false; fresh = true; }
    },
    write() {},
  };
}

/** A compose window: To, Body, a password field, and Save Draft, Send and Delete buttons. */
export function mailApp(): FakeApp & { fields: Record<string, string>; sent: number } {
  const state = { fields: { To: "", Body: "", Password: "" } as Record<string, string>, sent: 0 };
  return {
    name: "Mail",
    pid: 202,
    get fields() { return state.fields; },
    get sent() { return state.sent; },
    elements: () => [
      { role: "AXTextField", label: "To" }, { role: "AXTextArea", label: "Body" }, { role: "AXSecureTextField", label: "Password" },
      { role: "AXButton", label: "Save Draft" }, { role: "AXButton", label: "Send" }, { role: "AXButton", label: "Delete" },
    ],
    readings: () => ({ Status: state.sent ? "Sent" : "Draft" }),
    click(label) { if (label === "Send") state.sent += 1; },
    write(label, text) { state.fields[label] = text; },
  };
}
