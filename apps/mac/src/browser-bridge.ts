// The worker browser runs agent-browser (a Rust daemon that talks to the browser directly) instead of Playwright MCP (Node).
// This bridge keeps ARK's own policy layer untouched: it offers the same `browser_*` tools with the same fixed arguments, and prints
// results in the shape `browserCheck` (browser.ts) and the Codex adapter (codex-browser.ts) already read ("- Page URL:", "[ref=eN]").
// It exposes only the tools below. agent-browser's own extra arguments (state files, certificates, extra flags, script evaluation)
// are never offered to the model.

export interface BridgeResult {
  ok: boolean;
  data?: Record<string, any>;
  error?: string;
}

/** Runs one agent-browser command (arguments after the global flags) and returns its parsed `--json` answer. */
export type BridgeRun = (args: string[]) => Promise<BridgeResult>;

export interface BridgeOutput {
  text: string;
  isError?: boolean;
  image?: { data: string; mimeType: string };
}

export interface BridgeOptions {
  run: BridgeRun;
  /** Takes a screenshot and returns it base64 encoded; the file is the bridge host's to delete. */
  screenshot?: () => Promise<{ data: string; mimeType: string }>;
  sleep?: (ms: number) => Promise<void>;
}

const MAX_TREE = 60_000;
const REF = /^(f\d+)?e\d+$/;
const KEY = /^[A-Za-z0-9+_.,/;'\[\]\\=`-]{1,40}$/;
const text = (value: unknown, max: number): value is string => typeof value === "string" && value.length > 0 && value.length <= max && !value.includes("\0");

function str(description: string) {
  return { type: "string", description };
}
function tool(name: string, description: string, properties: Record<string, unknown>, required: string[]) {
  return { name: `browser_${name}`, description, inputSchema: { type: "object", properties, required, additionalProperties: false } };
}

export const BRIDGE_TOOLS = [
  tool("navigate", "Go to an http or https address.", { url: str("The address.") }, ["url"]),
  tool("navigate_back", "Go back to the previous page.", {}, []),
  tool("snapshot", "Read the page as an accessibility tree. Elements carry [ref=eN] markers; act on those refs.", {}, []),
  tool("click", "Click an element by its ref from the last snapshot.", { element: str("What the element is, in a few words."), target: str("The ref, such as e12."), doubleClick: { type: "boolean" } }, ["target"]),
  tool("hover", "Hover an element by its ref.", { element: str("What the element is."), target: str("The ref.") }, ["target"]),
  tool("type", "Type text into an editable element by its ref.", { element: str("What the element is."), target: str("The ref."), text: str("The text."), submit: { type: "boolean", description: "Press Enter afterwards." } }, ["target", "text"]),
  tool("fill_form", "Fill several fields at once.", { fields: { type: "array", items: { type: "object", properties: { name: str("Field name."), target: str("The ref."), type: { type: "string", enum: ["textbox", "checkbox", "radio", "combobox", "slider"] }, value: str("The value; for a checkbox, true or false.") }, required: ["name", "target", "type", "value"] } } }, ["fields"]),
  tool("select_option", "Choose options in a drop-down by its ref.", { element: str("What the element is."), target: str("The ref."), values: { type: "array", items: { type: "string" } } }, ["target", "values"]),
  tool("press_key", "Press one key, such as ArrowDown or Enter.", { key: str("The key.") }, ["key"]),
  tool("handle_dialog", "Accept or dismiss the open JavaScript dialog.", { accept: { type: "boolean" }, promptText: str("Text for a prompt dialog.") }, ["accept"]),
  tool("file_upload", "Upload files, given by full path, to the page's file input.", { paths: { type: "array", items: { type: "string" } } }, ["paths"]),
  tool("wait_for", "Wait for a time in seconds, for text to appear, or for text to disappear.", { time: { type: "number" }, text: str("Text to wait for."), textGone: str("Text to wait to disappear.") }, []),
  tool("take_screenshot", "Take a screenshot of the page.", {}, []),
  tool("tabs", "List, open, close or select tabs.", { action: { type: "string", enum: ["list", "new", "close", "select"] }, index: { type: "number" }, url: str("Address for a new tab.") }, ["action"]),
  tool("resize", "Resize the browser window.", { width: { type: "number" }, height: { type: "number" } }, ["width", "height"]),
  tool("close", "Close the browser.", {}, []),
];

/** `[level=1, ref=e1]` becomes `[level=1] [ref=e1]`: browserCheck reads the ref as its own marker at the end of the line. */
export function withRefMarker(line: string): string {
  return line.replace(/\[([^\[\]]*\bref=(\w+)[^\[\]]*)\](?=(?::.*)?$)/, (_m, inner: string, ref: string) => {
    const rest = inner.split(",").map((s) => s.trim()).filter((s) => s && !s.startsWith("ref="));
    return `${rest.length ? `[${rest.join(", ")}] ` : ""}[ref=${ref}]`;
  });
}

const fence = (tree: string) => "```yaml\n" + tree.replace(/```/g, "'''") + "\n```";

export function createBridge(options: BridgeOptions) {
  const { run, screenshot, sleep = (ms) => new Promise<void>((resolve) => setTimeout(resolve, ms)) } = options;
  const sel = (target: unknown): string => {
    if (typeof target !== "string" || !REF.test(target)) throw new Error("A target must be a ref from the last snapshot, such as e12. Selectors are not allowed.");
    return `@${target}`;
  };
  const must = async (args: string[]): Promise<Record<string, any>> => {
    const r = await run(args);
    if (!r.ok) throw new Error(String(r.error ?? "The browser command failed.").slice(0, 300));
    return r.data ?? {};
  };

  async function read(): Promise<{ url: string; tree: string }> {
    const data = await must(["snapshot", "-c"]);
    const url = String(data.origin ?? "about:blank");
    const raw = String(data.snapshot ?? "");
    const tree = raw.split("\n").map(withRefMarker).join("\n");
    return { url, tree: tree.length > MAX_TREE ? `${tree.slice(0, MAX_TREE)}\n[Rest of the page omitted.]` : tree };
  }
  const state = async () => {
    const { url, tree } = await read();
    return `### Page state\n- Page URL: ${url}\n- Page Snapshot:\n${fence(tree)}\n`;
  };

  async function fillOne(f: Record<string, unknown>) {
    const target = sel(f.target);
    const value = String(f.value ?? "");
    if (f.type === "checkbox") return must([value === "true" ? "check" : "uncheck", target]);
    if (f.type === "radio") return value === "false" ? undefined : must(["check", target]);
    if (f.type === "combobox") return must(["select", target, value]);
    return must(["fill", target, value]);
  }

  async function act(name: string, input: Record<string, any>): Promise<BridgeOutput> {
    switch (name) {
      case "navigate": {
        let url: URL;
        try { url = new URL(String(input.url)); } catch { throw new Error("That is not an address."); }
        if (!["http:", "https:"].includes(url.protocol)) throw new Error("The browser opens only http and https addresses.");
        await must(["open", url.href]);
        return { text: await state() };
      }
      case "navigate_back": await must(["back"]); return { text: await state() };
      case "snapshot": {
        const { url, tree } = await read();
        return { text: `### Page\n- Page URL: ${url}\n\n### Snapshot\n${fence(tree)}\n` };
      }
      case "click": await must([input.doubleClick === true ? "dblclick" : "click", sel(input.target)]); return { text: await state() };
      case "hover": await must(["hover", sel(input.target)]); return { text: await state() };
      case "type": {
        if (!text(input.text, 2_000)) throw new Error("The text is missing or too long.");
        await must(["fill", sel(input.target), input.text]);
        if (input.submit === true) await must(["press", "Enter"]);
        return { text: await state() };
      }
      case "fill_form": {
        if (!Array.isArray(input.fields) || !input.fields.length || input.fields.length > 8) throw new Error("fill_form needs one to eight fields.");
        for (const f of input.fields) await fillOne(f as Record<string, unknown>);
        return { text: await state() };
      }
      case "select_option": {
        if (!Array.isArray(input.values) || !input.values.length || input.values.length > 8 || !input.values.every((v: unknown) => text(v, 200))) throw new Error("select_option needs one to eight values.");
        await must(["select", sel(input.target), ...input.values]);
        return { text: await state() };
      }
      case "press_key": {
        if (typeof input.key !== "string" || !KEY.test(input.key)) throw new Error("That key is not allowed.");
        await must(["press", input.key]);
        return { text: await state() };
      }
      case "handle_dialog": await must(input.accept === true ? ["dialog", "accept", ...(text(input.promptText, 500) ? [input.promptText] : [])] : ["dialog", "dismiss"]); return { text: await state() };
      case "file_upload": {
        if (!Array.isArray(input.paths) || !input.paths.length || !input.paths.every((p: unknown) => text(p, 1_000))) throw new Error("An upload needs the full paths of the files.");
        await must(["upload", "input[type=file]", ...input.paths]);
        return { text: await state() };
      }
      case "wait_for": return waitFor(input);
      case "take_screenshot": {
        if (!screenshot) throw new Error("Screenshots are not available.");
        const image = await screenshot();
        return { text: await state(), image };
      }
      case "tabs": return tabs(input);
      case "resize": {
        const { width, height } = input;
        if (![width, height].every((n) => Number.isInteger(n) && n >= 200 && n <= 4_000)) throw new Error("The size must be whole numbers from 200 to 4000.");
        await must(["set", "viewport", String(width), String(height)]);
        return { text: await state() };
      }
      case "close": await run(["close"]); return { text: "Browser closed.\n" };
      default: throw new Error("ARK does not offer that browser tool.");
    }
  }

  async function waitFor(input: Record<string, any>): Promise<BridgeOutput> {
    if (input.time !== undefined) {
      if (typeof input.time !== "number" || input.time <= 0 || input.time > 30) throw new Error("The wait must be 1 to 30 seconds.");
      await must(["wait", String(Math.round(input.time * 1000))]);
    } else if (text(input.text, 200)) {
      await must(["wait", "--text", input.text]);
    } else if (text(input.textGone, 200)) {
      for (let i = 0; ; i++) {
        if (!(await read()).tree.includes(input.textGone)) break;
        if (i >= 20) throw new Error("The text did not disappear in time.");
        await sleep(300);
      }
    } else throw new Error("wait_for needs a time, text or textGone.");
    return { text: await state() };
  }

  async function tabs(input: Record<string, any>): Promise<BridgeOutput> {
    const index = Number.isInteger(input.index) && input.index >= 0 ? input.index : undefined;
    if (input.action === "list") {
      const data = await must(["tab"]);
      return { text: `### Tabs\n${JSON.stringify(data.tabs ?? data).slice(0, 4_000)}\n` };
    }
    if (input.action === "new") {
      const url = input.url === undefined ? undefined : new URL(String(input.url));
      if (url && !["http:", "https:"].includes(url.protocol)) throw new Error("The browser opens only http and https addresses.");
      await must(["tab", "new", ...(url ? [url.href] : [])]);
    } else if (input.action === "close") await must(["tab", "close", ...(index !== undefined ? [`t${index + 1}`] : [])]);
    else if (input.action === "select" && index !== undefined) await must(["tab", `t${index + 1}`]);
    else throw new Error("tabs needs an action, and an index for select.");
    return { text: await state() };
  }

  return {
    tools: BRIDGE_TOOLS,
    /** Runs one tool. Never throws: a failure is an error result with a short, secret-free message. */
    async call(name: string, input: unknown): Promise<BridgeOutput> {
      try {
        if (!BRIDGE_TOOLS.some((t) => t.name === name)) throw new Error("ARK does not offer that browser tool.");
        const args = input && typeof input === "object" && !Array.isArray(input) ? (input as Record<string, any>) : {};
        return await act(name.slice("browser_".length), args);
      } catch (error) {
        return { text: `Error: ${error instanceof Error ? error.message : "The browser command failed."}`, isError: true };
      }
    },
  };
}
