import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createAiPrograms, programStatus, scanAiPrograms } from "./ai-programs.ts";
import type { ScanDeps } from "./ai-tools.ts";
import { parseCommand } from "./island-commands.ts";

// ADR-269: the AI programs on this Mac, found live.

const never = new Promise<string>(() => {});

function deps(files: string[], answers: Record<string, string | "hang"> = {}, seen: string[] = []): ScanDeps {
  return {
    env: { PATH: "/usr/bin" },
    exists: (path) => { seen.push(path); return files.includes(path); },
    run: async (program, args) => {
      seen.push(`run ${program} ${args.join(" ")}`);
      const answer = answers[program];
      if (answer === "hang") return never;
      if (answer === undefined) throw new Error("no");
      return answer;
    },
    home: "/h",
  };
}

const byId = <T extends { id: string }>(items: T[]) => Object.fromEntries(items.map((p) => [p.id, p]));

test("finds programs on PATH, in the extra folders and as app bundles; versions and sign-in files by name only", async () => {
  const seen: string[] = [];
  const found = byId(await scanAiPrograms(deps(
    ["/h/.local/bin/claude", "/usr/bin/codex", "/h/.codex/auth.json", "/h/.bun/bin/opencode", "/h/Applications/Kiro.app", "/Applications/Ollama.app"],
    { "/h/.local/bin/claude": "2.1.312 (Claude Code)", "/usr/bin/codex": "codex-cli 0.98.0", "/usr/bin/plutil": "0.9.1\n" },
    seen,
  ), 1_000));
  assert.deepEqual([found["claude-code"]!.found, found["claude-code"]!.path, found["claude-code"]!.version], [true, "~/.local/bin/claude", "2.1.312"]);
  assert.equal(found["claude-code"]!.signedIn, undefined, "the Keychain sign-in is not looked at");
  assert.deepEqual([found.codex!.version, found.codex!.signedIn], ["0.98.0", true]);
  assert.deepEqual([found.opencode!.path, found.opencode!.version, found.opencode!.signedIn], ["~/.bun/bin/opencode", undefined, undefined]);
  assert.deepEqual([found.kiro!.path, found.kiro!.version], ["~/Applications/Kiro.app", "0.9.1"]);
  assert.ok(seen.includes("run /usr/bin/plutil -extract CFBundleShortVersionString raw -o - /h/Applications/Kiro.app/Contents/Info.plist"));
  assert.equal(found.ollama!.found, true);
  assert.deepEqual([found.aider!.found, found.aider!.path], [false, undefined]);
  assert.ok(!seen.some((s) => s.startsWith("run") && s.includes("auth.json")), "a sign-in file is never opened or passed to a program");
});

test("a version that hangs is left out, and the scan keeps to its time box", async () => {
  const started = Date.now();
  const found = byId(await scanAiPrograms(deps(["/usr/bin/gemini", "/usr/bin/claude"], { "/usr/bin/gemini": "hang", "/usr/bin/claude": "2.0.0" }), 60));
  assert.ok(Date.now() - started < 1_000);
  assert.deepEqual([found["gemini-cli"]!.found, found["gemini-cli"]!.version], [true, undefined]);
  assert.equal(found["claude-code"]!.version, "2.0.0");
});

test("the old gh copilot extension is only a note", async () => {
  const copilot = byId(await scanAiPrograms(deps(["/h/.local/share/gh/extensions/gh-copilot"]), 100)).copilot!;
  assert.equal(copilot.found, false);
  assert.match(copilot.note!, /gh copilot/);
});

test("status: ready when the gateway has the provider, found when not yet, local-model for local models", () => {
  const gateway = (ids: string[]) => (id: string) => ids.includes(id);
  assert.equal(programStatus({ provider: "codex" }, gateway(["codex"])), "ready");
  assert.equal(programStatus({ provider: "copilot" }, gateway(["codex"])), "found");
  assert.equal(programStatus({ provider: "copilot" }, gateway(["codex", "copilot"])), "ready");
  assert.equal(programStatus({}, gateway(["codex"])), "found");
  assert.equal(programStatus({ local: true }, gateway(["codex"])), "local-model");
});

test("scans never overlap, changes alone count, and the may-use choice is saved and read back", async () => {
  const dir = mkdtempSync(join(tmpdir(), "ark-programs-"));
  const path = join(dir, "config", "ai-programs.json");
  const files = ["/usr/bin/claude", "/usr/bin/codex"];
  let runs = 0;
  const scanDeps = (): ScanDeps => ({ ...deps(files), run: async () => { runs++; await new Promise((r) => setTimeout(r, 10)); return "1.0.0"; } });
  const programs = createAiPrograms({ path, deps: scanDeps, isProvider: (id) => ["claude-plan", "codex", "gemini-cli"].includes(id), budgetMs: 1_000 });
  assert.equal(programs.event(), undefined);
  const [a, b] = await Promise.all([programs.scan(), programs.scan()]);
  assert.equal(runs, 2, "two programs found, asked once each: the second scan joined the first");
  assert.equal(a, b);
  assert.equal(a.changed, true);
  assert.equal((await programs.scan()).changed, false);
  files.push("/usr/bin/gemini");
  const { event, changed } = await programs.scan();
  assert.equal(changed, true);
  const shown = byId(event.programs);
  assert.deepEqual([shown.codex!.status, shown.codex!.allowed, shown.copilot!.status, shown.copilot!.allowed, shown.ollama!.status], ["ready", true, "found", false, "local-model"]);

  assert.deepEqual(programs.setAllowed("codex", false), { ok: true });
  assert.deepEqual(programs.blockedProviders(), ["codex"]);
  assert.equal(byId(programs.event()!.programs).codex!.allowed, false);
  assert.deepEqual(JSON.parse(readFileSync(path, "utf8")), { disallowed: ["codex"] });
  assert.match((programs.setAllowed("copilot", false) as { error: string }).error, /not connected/);
  assert.match((programs.setAllowed("nope", true) as { error: string }).error, /Unknown/);
  assert.deepEqual(createAiPrograms({ path }).blockedProviders(), ["codex"], "read back at the next start");

  writeFileSync(path, "{ not json");
  const warnings: string[] = [];
  assert.deepEqual(createAiPrograms({ path, log: { info: () => {}, warn: (e) => warnings.push(e) } }).blockedProviders(), []);
  assert.deepEqual(warnings, ["ai_programs.settings_ignored"]);
});

test("ai.programs commands take only their own keys", () => {
  assert.deepEqual(parseCommand('{"type":"ai.programs.scan"}'), { command: { type: "ai.programs.scan" } });
  assert.ok("error" in parseCommand('{"type":"ai.programs.scan","force":true}'));
  assert.deepEqual(parseCommand('{"type":"ai.programs.allow","id":"codex","allowed":false}'), { command: { type: "ai.programs.allow", id: "codex", allowed: false } });
  assert.ok("error" in parseCommand('{"type":"ai.programs.allow","id":"codex","allowed":false,"x":1}'));
  assert.ok("error" in parseCommand('{"type":"ai.programs.allow","id":"codex","allowed":"no"}'));
  assert.ok("error" in parseCommand('{"type":"ai.programs.allow","id":"../x","allowed":true}'));
});
