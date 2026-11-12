// ADR-278 Phase 1: the parity fixtures of rust/crates/ark-core. Runs the TypeScript code on fixed inputs and writes each
// answer to rust/crates/ark-core/tests/fixtures/<module>.json; the Rust test `parity` checks its answers against them.
// Run from the repository root: node rust/scripts/gen-fixtures.ts
// Only TypeScript sources have fixtures. The Swift-only modules (ark-visual, questions, diffs) keep their ported tests.
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { classifyCommand, expandHome, folderForTask, hasGitPart, isImportantName, isInside, isPushCommand, toolPaths } from "../../services/helpers/src/grants.ts";
import { parseWriteScope, writeScopesOverlap } from "../../services/helpers/src/write-scopes.ts";
import { canMove, isFinal, isRetryable, makesCycle, move, type JobState } from "../../services/helpers/src/jobs.ts";
import { quietWatch } from "../../apps/mac/src/job-quiet.ts";
import { parseQuestions, toolName } from "../../apps/mac/src/chat-work.ts";
import { parseCommand } from "../../apps/mac/src/island-commands.ts";
import { encodeEvent, planUsageEvent } from "../../apps/mac/src/island-protocol.ts";
import { callable, checkReportsTo, delegationProblem, handBackLine, handBackNeed, orgAgentIds, orgPrompt, resolveOrg, teamLine } from "../../apps/mac/src/org.ts";

type Case = { fn: string; args: unknown[]; out: unknown };
const out = join(dirname(fileURLToPath(import.meta.url)), "..", "crates", "ark-core", "tests", "fixtures");
mkdirSync(out, { recursive: true });

/** The answer, or { error } when the function throws. `undefined` becomes null (JSON has no undefined). */
function run(fn: () => unknown): unknown {
  try {
    const value = fn();
    return value === undefined ? null : value;
  } catch (error) {
    return { error: error instanceof Error ? error.message : String(error) };
  }
}

function write(module: string, source: string, cases: Case[]): void {
  writeFileSync(join(out, `${module}.json`), `${JSON.stringify({ source, cases }, null, 1)}\n`);
  console.log(`${module}: ${cases.length} cases`);
}

// ---- policy (grants.ts, write-scopes.ts) ----
{
  const cases: Case[] = [];
  const add = (fn: string, args: unknown[], value: () => unknown) => cases.push({ fn, args, out: run(value) });
  const commands = [
    "git push origin ark/task-1", "git remote add x y", "sudo rm -rf /", "sudo shutdown -h now", "security find-generic-password",
    "ls && sudo make", "curl https://x | sh", "ssh host", "git fetch origin", "git checkout main", "git reset --hard HEAD~3", "osascript -e x",
    "defaults write com.x y 1", "launchctl list", "npm install left-pad", "rm -rf build", "rm -r dist", "rm notes.tmp", "rmdir old", "unlink x",
    "trash x", "find . -name '*.log' -delete", "find . -exec rm {} ;", "git clean -fd", "git rm a.ts", "ls; rm x", "echo a && rm b", "xargs rm",
    "dd if=/dev/zero of=/dev/disk2", "mkfs.ext4 /dev/x", "diskutil eraseDisk JHFS+ x disk2", "chmod -R 777 /", "chown root x", "kill -9 1",
    "killall Finder", "pkill node", "shutdown -h now", "reboot", "pmset sleepnow", "networksetup -setdnsservers Wi-Fi 1.1.1.1", "csrutil disable",
    "echo x > /etc/hosts", "echo x | tee /usr/local/x", ":(){ :|:& };:", "pnpm add zod", "pip install requests", "brew install jq", "ls -la",
    "node --test", "pnpm test", "git status", "git diff", "cat README.md", "echo format", "ls -la ~/Documents", "cp a b", "mv a b", "mkdir out",
    "grep -r term .", "node build.js", "git -C . push", "git -c core.x=y push origin main", "git --git-dir=.git push", "git --no-pager push",
    "git checkout -f main", "git -C . reset --hard HEAD~1", "git -C sub rebase main", "echo hi\nsudo ls", "env sudo ls", "command sudo ls",
    "echo ok && sudo -n true", "xargs sudo rm", "git -C . branch --delete old", "git -C . clean -fd", "git -C . diff --stat",
    "git commit -m 'sudo is a word'", "echo pseudo", "\\rm -rf x", "/bin/rm x", "/usr/bin/rm x", "sh -c 'rm -rf x'", "bash -c \"rm x\"",
    "ls | xargs -0 rm", "{ rm x; }", "if true; then rm x; fi", "find . -exec /bin/rm {} +", "python3 -c 'import shutil;shutil.rmtree(\"x\")'",
    "node -e 'fs.rmSync(\"x\")'", "node --eval \"1\"", "perl -e 'unlink q(x)'", "ruby -e 1", "eval $x", "mv x /dev/null", "truncate -s 0 f",
    "git stash clear", "git worktree remove x", "git gc --prune=now", "git reflog expire --all", "echo 'fs.rmSync(p)' > a.js && node a.js",
    "python3 script.py", "git log --oneline", "cat form.txt", "echo firm", "grep -r norm .", "git commit -m 'update'", "mkdir -p out && cp a out/",
    `git ${"-c a=b ".repeat(8)}push origin x`, "a".repeat(8001), "a".repeat(8000), "é".repeat(8001), "😀".repeat(4001),
    // ASCII word boundaries and JavaScript white space
    "égit push", "git\u{FEFF}push", "git\u{85}push", "rm\u{A0}x", "sudo\u{2028}ls", "ünlink x", "café rm x", "x\u{3000}curl y",
    // the hostile shapes of the speed test: the answer must match too (a Rust pattern that gives up refuses)
    "git ".repeat(2000), `git ${"-c ".repeat(60)}x`, `git ${"-C a ".repeat(40)}push`, "a.".repeat(3000), " ".repeat(7000), ";rm ".repeat(1500),
    "find x ".repeat(1000), "sh -c ".repeat(1000), "$(".repeat(3000), "\\".repeat(5000),
  ];
  for (const c of commands) add("classifyCommand", [c], () => classifyCommand(c));
  for (const c of ["git push", "git -C . push", "git pushx", "git stash push", "gitpush", "legit push"]) add("isPushCommand", [c], () => isPushCommand(c));
  for (const p of ["/a/.git/hooks", "a\\.GIT\\x", ".gitignore", "/a/.git", "x"]) add("hasGitPart", [p], () => hasGitPart(p));
  for (const [r, p] of [["/a", "/a"], ["/a", "/a/b"], ["/a", "/ab"], ["/a/", "/a/b"], ["/", "/x"]]) add("isInside", [r, p], () => isInside(r!, p!));
  for (const p of ["~", "~/x", "~/../y", "~x", "/abs", "rel/~/x", "~/"]) add("expandHome", [p, "/Users/me"], () => expandHome(p, "/Users/me"));
  for (const n of ["passport-scan.pdf", "Bank statement 2025.xlsx", "tax_2024", "medical", "my SSN.txt", "taxonomy.md", "design.png", "Statement-of-work.docx",
    "banker", "ID card.jpg", "national-id", "birth certificate.pdf", "Payslip", "SALARY", "visa", "bankers", "ſsn", "bank\u{FEFF}"]) add("isImportantName", [n], () => isImportantName(n));
  const tools: [string, Record<string, unknown>][] = [
    ["Read", { file_path: "/a/b" }], ["Grep", { pattern: "TODO", path: "src" }], ["Glob", { pattern: "/etc/**/*.conf" }], ["Glob", { pattern: "**/*.ts" }],
    ["Bash", { command: "ls" }], ["NotebookEdit", { notebook_path: "/n.ipynb" }], ["Write", { file_path: "" }], ["Edit", { file_path: 3 }],
    ["Glob", { pattern: "/*" }], ["Grep", { pattern: "/a/b?c\nd", path: "/x" }], ["Glob", { pattern: "/a/{x,y}/z*\nq" }], ["MultiEdit", { file_path: "rel" }],
  ];
  for (const [name, input] of tools) add("toolPaths", [name, input], () => toolPaths(name, input));
  const tasks = [
    "Create a document about the match. Save it as a text or PDF document in a folder named ArkDoc in the user's home directory.",
    "Save notes to ~/Projects/site/notes.", "Write it into /Users/me/Writing", "Put it in a folder called Drafts on my Desktop",
    "a folder named Reports in Documents", "Save it to ~/", "Save it in ~/Library/Prefs", "Save to ~/.ssh/x", "Save to /etc/hosts",
    "a folder named ../../etc", "Write a file", "save to ~/library/stuff", "Save to /Users/other/x", "folder named \"Q3 Plans\", please",
    "a FOLDER CALLED Notes on the desktop", "folder named “Smart”.", "Save to ~/a/../b", "folder named café", "Save to ~/Documents/x’),",
  ];
  for (const t of tasks) add("folderForTask", [t, "/Users/me"], () => folderForTask(t, "/Users/me"));
  const scopes: unknown[] = [
    ["src", "docs/"], ["."], ["a//b"], ["a/./b"], ["../x"], ["/abs"], ["C:\\x"], ["a*"], ["~/x"], [" a"], ["a\u{FEFF}"], [""], [3], ["src/.GIT/x"],
    ["src", "src/"], Array.from({ length: 33 }, (_, i) => `f${i}`), "src", null, ["a\u{85}"], ["dir/"], ["x$y"],
  ];
  for (const s of scopes) add("parseWriteScope", [s], () => parseWriteScope(s));
  add("parseWriteScope", [], () => parseWriteScope(undefined));
  const binding = (paths: string[] | null) => ({ schema: "atom.write-scope/v1" as const, root: "/p", paths });
  const pairs: [string[] | null, string[] | null][] = [
    [["/p/src"], ["/p/src/a.ts"]], [["/p/src"], ["/p/src-old"]], [["/p/Src"], ["/p/src/x"]], [null, ["/p/a"]], [["/p/a"], []],
    [["/p/caf\u{E9}"], ["/p/cafe\u{301}/x"]], [["/p/a", "/p/b"], ["/p/c", "/p/b"]],
  ];
  for (const [a, b] of pairs) add("writeScopesOverlap", [a, b], () => writeScopesOverlap(binding(a), binding(b)));
  write("policy", "services/helpers/src/grants.ts, services/helpers/src/write-scopes.ts", cases);
}

// ---- org (org.ts) ----
{
  const cases: Case[] = [];
  const add = (fn: string, args: unknown[], value: () => unknown) => cases.push({ fn, args, out: run(value) });
  // `names` stands for the name function: an id missing from it has no name.
  const namer = (names: Record<string, string>) => (id: string) => names[id];
  const ids = ["kame", "lyra", "pk", "sid", "quill"];
  const deep = { lyra: "kame", pk: "lyra", sid: "pk" };
  add("orgAgentIds", [[{ id: "sid", role: "researcher" }, { id: "tinker", role: "improver" }, { id: "kame", role: "coder" }]],
    () => orgAgentIds([{ id: "sid", role: "researcher" }, { id: "tinker", role: "improver" }, { id: "kame", role: "coder" }]));
  const changes: [string, string | null, Record<string, string>][] = [
    ["nobody", "kame", {}], ["sid", "tinker", {}], ["sid", "sid", {}], ["kame", "sid", { sid: "kame" }], ["kame", "pk", { sid: "kame", pk: "sid" }],
    ["quill", "sid", deep], ["kame", "quill", deep], ["quill", "pk", deep], ["sid", null, deep], ["sid", "kame", {}], ["kame", null, {}],
    ["lyra", "quill", { quill: "sid", sid: "kame" }], ["pk", "lyra", { lyra: "kame", kame: "sid" }],
  ];
  for (const [agent, lead, current] of changes) add("checkReportsTo", [agent, lead, current, ids], () => checkReportsTo(agent, lead, current, ids));
  const raws: [Record<string, string>, string[]][] = [
    [deep, ["kame", "pk", "sid"]], [deep, ["pk", "sid"]], [{ a: "b", b: "a" }, ["a", "b"]], [{ a: "b", b: "c", c: "d", d: "e", e: "f" }, ["a", "b", "c", "d", "e", "f"]],
    [{ a: "gone", gone: "b" }, ["a", "b"]], [{ a: "gone", gone: "a" }, ["a"]], [{}, ["a"]], [{ x: "a" }, ["a"]],
  ];
  for (const [raw, agents] of raws) add("resolveOrg", [raw, agents], () => resolveOrg(raw, agents));
  const names = { kame: "Kame", lyra: "Lyricists", pk: "ProjectK", sid: "Sid" };
  for (const map of [{}, { pk: "kame", lyra: "kame", kame: "sid" }, { quill: "kame" }]) add("orgPrompt", [map, names], () => orgPrompt(map, namer(names)));
  const reports = [
    "Done. The table is filled in.", "Hand back: a designer\nThen I stopped.", "I could not do the logo.\n\nHand back: someone who can draw a logo  \n",
    "hand back: a second\u0007line\rhere", `Hand back: ${"x".repeat(1000)}`, "Hand back:   ", "HAND BACK:x​y­z", `Hand back: ${"😀".repeat(200)}`,
    "Hand back:\u{FEFF}tabs\tand spaces", "  Hand back: trimmed  \n\n\n", "",
  ];
  for (const r of reports) add("handBackNeed", [r], () => handBackNeed(r));
  add("handBackLine", ["Kame", "a logo designer", { kame: "sid" }, { kame: "Kame", sid: "Sid" }], () => handBackLine("Kame", "a logo designer", { kame: "sid" }, namer({ kame: "Kame", sid: "Sid" })));
  add("handBackLine", ["Kame", "a logo designer", {}, { kame: "Kame", sid: "Sid" }], () => handBackLine("Kame", "a logo designer", {}, namer({ kame: "Kame", sid: "Sid" })));
  const team = ["ana", "bo", "cy", "di", "ed"];
  const chart = { bo: "ana", cy: "ana", di: "bo" };
  const upper = Object.fromEntries(team.map((id) => [id, id.toUpperCase()]));
  for (const a of team) add("callable", [a, chart, team], () => callable(a, chart, team));
  for (const a of team) for (const b of team) add("delegationProblem", [a, b, chart, team, upper], () => delegationProblem(a, b, chart, team, namer(upper)));
  add("delegationProblem", ["ana", "zed", chart, team, {}], () => delegationProblem("ana", "zed", chart, team, namer({})));
  for (const a of team) add("teamLine", [a, chart, team, upper], () => teamLine(a, chart, team, namer(upper)));
  add("teamLine", ["bo", chart, team, {}], () => teamLine("bo", chart, team, namer({})));
  write("org", "apps/mac/src/org.ts", cases);
}

// ---- jobs (jobs.ts, job-quiet.ts) ----
{
  const cases: Case[] = [];
  const add = (fn: string, args: unknown[], value: () => unknown) => cases.push({ fn, args, out: run(value) });
  const states: JobState[] = ["queued", "running", "done", "failed", "stopped"];
  for (const s of states) add("isFinal", [s], () => isFinal(s));
  for (const from of states) {
    for (const to of states) {
      add("canMove", [from, to], () => canMove(from, to));
      add("move", [from, to], () => move(from, to));
    }
  }
  for (const e of ["Took longer than 15 minutes", "Claude Code ended without a report.", "The report came back in the wrong shape (body).", "It took more than 40 steps",
    "The app was closed while this job ran", "COULD NOT RUN", "Sid needs the Claude plan for research.", "Your Claude plan limit is reached.", "took more than ٤ steps", "", "ſtook longer than"]) {
    add("isRetryable", [e], () => isRetryable(e));
  }
  add("isRetryable", [null], () => isRetryable(undefined));
  const graphs: [Record<string, number[]>, number, number[]][] = [
    [{ 2: [1], 3: [2], 4: [] }, 1, [3]], [{ 2: [1], 3: [2], 4: [] }, 1, [4]], [{ 2: [1], 3: [2], 4: [] }, 5, [3, 4]], [{}, 1, [1]], [{ 1: [2], 2: [1] }, 3, [1]], [{ 1: [2], 2: [3] }, 3, [1]],
  ];
  for (const [edges, id, blockers] of graphs) {
    add("makesCycle", [edges, id, blockers], () => makesCycle(new Map(Object.entries(edges).map(([k, v]) => [Number(k), v])), id, blockers));
  }

  // The quiet watch on a fake store: each scenario is a list of steps; the answer is each step's result.
  type Job = { id: number; parentId?: number; state: string; chatId?: string };
  type Step = { tick: number } | { move: number } | { sweep: true } | { since: number } | { set: Job };
  const scenario = (jobs: Job[], steps: Step[]) => {
    const table = new Map(jobs.map((j) => [j.id, { ...j }]));
    let clock = 1_000_000;
    let listener: ((change: { action: string; job: number }) => void) | undefined;
    const logs: Record<string, unknown>[] = [];
    let heard = 0;
    const store = {
      list: () => [{ jobs: [...table.values()] }],
      get: (id: number) => table.get(id),
      onChange: (l: typeof listener) => { listener = l; return () => undefined; },
    };
    const watch = quietWatch(store as never, { now: () => clock, sweepMs: 0, log: (_event, fields) => void logs.push(fields) });
    watch.onChange(() => void heard++);
    return steps.map((step) => {
      if ("tick" in step) { clock += step.tick; return null; }
      if ("move" in step) { const before = heard; listener!({ action: "step", job: step.move }); return heard - before; }
      if ("sweep" in step) { const before = logs.length, heardBefore = heard; watch.sweep(); return { logs: logs.slice(before), heard: heard - heardBefore }; }
      if ("since" in step) return watch.since(step.since)?.getTime() ?? null;
      table.set(step.set.id, { ...step.set });
      return null;
    });
  };
  const Q = 8 * 60_000;
  const minutes: Step[] = Array.from({ length: 20 }, () => [{ tick: 60_000 }, { move: 3 }, { sweep: true }] as Step[]).flat();
  const scenarios: [Job[], Step[]][] = [
    [[{ id: 1, state: "running", chatId: "c" }, { id: 2, parentId: 1, state: "running", chatId: "c" }],
      [{ sweep: true }, { tick: Q - 1 }, { sweep: true }, { since: 2 }, { tick: 1 }, { sweep: true }, { since: 2 }, { since: 1 }, { tick: Q }, { sweep: true },
        { move: 2 }, { since: 2 }, { since: 1 }, { tick: Q - 1 }, { sweep: true }, { since: 2 }]],
    [[{ id: 1, state: "running", chatId: "c" }, { id: 2, parentId: 1, state: "running", chatId: "c" }, { id: 3, parentId: 2, state: "running", chatId: "c" }],
      [{ sweep: true }, ...minutes, { since: 1 }, { since: 2 }, { since: 3 }, { tick: Q }, { move: 1 }, { sweep: true }, { since: 1 }, { since: 2 }, { since: 3 }]],
    [[{ id: 1, state: "running", chatId: "c" }],
      [{ sweep: true }, { tick: Q }, { sweep: true }, { since: 1 }, { set: { id: 1, state: "stopped", chatId: "c" } }, { move: 1 }, { sweep: true }, { since: 1 }]],
    [[{ id: 1, state: "running" }, { id: 2, state: "queued", chatId: "c" }, { id: 3, state: "running", chatId: "c", parentId: 4 }, { id: 4, state: "running", chatId: "c", parentId: 3 }],
      [{ sweep: true }, { tick: Q + 5 }, { sweep: true }, { move: 3 }, { since: 3 }, { since: 4 }, { tick: Q }, { sweep: true }, { since: 1 }]],
  ];
  for (const [jobs, steps] of scenarios) add("quietScenario", [jobs, steps], () => scenario(jobs, steps));
  write("jobs", "services/helpers/src/jobs.ts, apps/mac/src/job-quiet.ts", cases);
}

// ---- questions (chat-work.ts) ----
{
  const cases: Case[] = [];
  const add = (fn: string, args: unknown[], value: () => unknown) => cases.push({ fn, args, out: run(value) });
  const asked = (input: Record<string, unknown>) => {
    const result = parseQuestions(input);
    return typeof result === "string" ? { error: result } : result;
  };
  const inputs: Record<string, unknown>[] = [
    { questions: JSON.stringify([{ question: "Which database?", choices: "Postgres | Fits the stack (recommended)\nSQLite" }, { question: "When?" }]) },
    { question: "Ship today?", choices: "Yes\nNo" }, { question: "A?", questions: "[]" }, { questions: "not json" },
    { questions: JSON.stringify([1, 2, 3, 4, 5].map((n) => ({ question: `Q${n}?` }))) }, { questions: JSON.stringify([{ question: "A?", extra: 1 }]) },
    { question: "A?", choices: "x".repeat(161) }, { question: "A?", choices: "x".repeat(160) },
    { question: "Del‮ete​ the\u0007 file?\nWhy", choices: "Ye⁦s﻿\n‏\nN\u0000o" }, { question: "‮​" },
    { questions: "[]" }, { questions: 3 }, { questions: null }, { choices: "a" }, {}, { question: "A?", extra: true }, { questions: "x".repeat(4001) },
    { questions: JSON.stringify([null]) }, { questions: JSON.stringify([[]]) }, { questions: JSON.stringify([["a"]]) }, { questions: JSON.stringify([0]) },
    { questions: JSON.stringify(["text"]) }, { questions: JSON.stringify([{}]) }, { questions: JSON.stringify({ question: "A?" }) },
    { question: "A?", choices: "a\nb\nc\nd\ne" }, { question: "A?", choices: "a\na" }, { question: "A?", choices: "a\n\n  \nb" }, { question: "A?", choices: null },
    { question: "x".repeat(600) }, { question: "x".repeat(601) }, { question: "😀".repeat(300) }, { question: "😀".repeat(301) }, { question: "A?", choices: 4 },
    { question: "  padded　" }, { question: "A?", choices: "x".repeat(644) }, { questions: JSON.stringify([{ question: "A?", choices: ["a"] }]) },
  ];
  for (const input of inputs) add("parseQuestions", [input], () => asked(input));
  for (const name of ["Read", "mcp__ark__remember", "ark_time", "mcp__github__x", "bad name", "", "x".repeat(100), "x".repeat(101), "é", 3, null, "a:b.c-d_e", "ark_mcp__ark__x"]) {
    add("toolName", [name], () => toolName(name));
  }
  write("questions", "apps/mac/src/chat-work.ts (parseQuestions, toolName)", cases);
}

// ---- protocol (island-commands.ts, island-protocol.ts): fixtures of rust/crates/ark-protocol ----
{
  const protocolOut = join(dirname(fileURLToPath(import.meta.url)), "..", "crates", "ark-protocol", "tests", "fixtures");
  mkdirSync(protocolOut, { recursive: true });
  // The accepted command types: read from the TypeScript source, as the `COMMANDS` set is not exported.
  const source = readFileSync(join(dirname(fileURLToPath(import.meta.url)), "..", "..", "apps", "mac", "src", "island-commands.ts"), "utf8");
  const set = /const COMMANDS = new Set<[^>]*>\(\[([\s\S]*?)\]\);/.exec(source)?.[1] ?? "";
  const commandNames = [...set.matchAll(/"([^"]+)"/g)].map((m) => m[1]);
  const lines = [
    "", "   ", "not json", "[1]", "3", "{}", '{"type":3}', '{"type":"nope"}', '{"type":"x".repeat}',
    '{"type":"talk.start"}', '{"type":"talk.send"}', '{"type":"talk.cancel"}', '{"type":"conversation.reset"}', '{"type":"quit"}',
    '{"type":"talk.start","extra":1}', '{"type":"model.set","provider":"gemini","model":"gemini-3.6-flash"}', '{"type":"model.set","provider":"gemini"}',
    '{"type":"approval.answer","id":"a1","approved":true}', '{"type":"approval.answer","id":"a1","approved":true,"rememberFile":true}', '{"type":"approval.answer","id":"a1","approved":"yes"}',
    '{"type":"brain.get"}', '{"type":"brain.note","id":3}', '{"type":"brain.note","id":"3"}', '{"type":"brain.search","query":"oslo"}', '{"type":"brain.save","title":"T","body":"B"}', '{"type":"brain.save","id":4,"title":"T","body":"B"}',
    '{"type":"memory.list"}', '{"type":"memory.forget","id":3}', '{"type":"memory.clear"}', '{"type":"text.send","text":"hi"}', '{"type":"text.send","text":"hi","files":["/a/b"]}',
    '{"type":"text.edit","id":"e1","text":"abc","selection":[0,2],"instruction":"shorter"}', '{"type":"text.edit.cancel","id":"e1"}',
    '{"type":"brief.set","change":{"enabled":true,"minute":480}}', '{"type":"brief.get"}', '{"type":"chat.new"}', '{"type":"chat.new","projectId":"p1"}', '{"type":"chat.open","id":"c1"}',
    '{"type":"job.add","helper":"sid","task":"Do it","blockedBy":[1]}', '{"type":"job.stop","id":12}', '{"type":"job.rate","id":12,"good":false,"comment":"Only one source"}',
    '{"type":"helper.reportsTo","helper":"sid","lead":null}', '{"type":"helper.reportsTo","helper":"sid","lead":"kame"}', '{"type":"helpers.list"}', '{"type":"thread.get","id":5}', '{"type":"search","query":"x"}',
    '{"type":"routine.add","helper":"researcher","task":"News","kind":"daily","minute":480}', '{"type":"routine.update","id":2,"helper":"researcher","task":"News","kind":"hours","every":4}',
    '{"type":"agent.create","name":"Rumi","role":"travel planner","kit":"research","personality":"p","howItWorks":"h","rules":"r"}',
    '{"type":"soul.set","helper":"sid","soul":{"name":"Sid","personality":"p","howItWorks":"h","rules":"r","lessons":"l"}}', '{"type":"grant.add","helper":"kame","path":"/Users/k/app"}',
    '{"type":"context.window","bundleId":"com.x","name":"X"}', '{"type":"speech.set","reports":true,"updates":false}', '{"type":"api.set","on":true}', '{"type":"git.list"}', '{"type":"git.diff","repo":"/r","branch":"ark/t-1"}',
    '{"type":"skill.get","name":"pdf"}', '{"type":"commands.list"}', '{"type":"job.undo","id":3,"force":true}', '{"type":"mcp.set","id":1,"enabled":true}',
    '{"type":"project.add","name":"P","path":"/p"}', '{"type":"workspace","request":"11111111-1111-4111-8111-111111111111","chat":"c","project":"p","action":"list","path":""}',
    '{"type":"brain.source","request":"r1","action":"get"}', '{"type":"foreground.list"}', '{"type":"chat.control","action":"x"}',
  ];
  const cases = lines.map((line) => {
    const parsed = parseCommand(line);
    return { line, out: "blank" in parsed ? { blank: true } : "error" in parsed ? { error: parsed.error } : { command: parsed.command } };
  });
  const events: unknown[] = [
    { type: "ready", protocol: 1, provider: "gemini", model: "m", microphone: "Mic", voice: true },
    { type: "ready", protocol: 1, provider: "gemini", model: "m", microphone: "Mic", voice: false, telegram: true, computer: false },
    { type: "state", state: "thinking" }, { type: "mic.ready" }, { type: "mic.level", peak: 0.5 }, { type: "mic.silent", microphone: "Mic" },
    { type: "transcript", text: "hi\nthere é" }, { type: "reply", text: "ok" },
    { type: "turn.complete", speechMs: 0, transcriptionMs: 0, modelMs: 12, firstSoundMs: 3 }, { type: "turn.complete", speechMs: 1, transcriptionMs: 2, modelMs: 3 },
    { type: "notice", kind: "too_short", message: "m" }, { type: "conversation.reset" }, { type: "conversation.reset", projectId: "p1" },
    { type: "api", on: true, port: 8123, tokenFile: "/t" }, { type: "api", on: false, port: 8123, tokenFile: "/t", error: "e" },
    { type: "computer.step", text: "Typing" }, { type: "computer.cursor", x: -10, y: 4.5 }, { type: "computer.end" }, { type: "settings.open" }, { type: "media.key", key: "playpause" },
    { type: "approval.closed", id: "a1" }, { type: "timer", id: 1, label: "l", message: "m" }, { type: "worker.line", line: "done" },
    { type: "brain.hits", query: "q", hits: [{ id: 1, title: "T", kind: "note", snippet: "s" }] },
    { type: "brain.note", note: { id: 1, title: "T", body: "B", kind: "note", ghost: false, tags: ["a"], links: [{ id: 2, title: "U", kind: "note", ghost: true, auto: false }], backlinks: [{ id: 3, title: "V", kind: "memory", auto: true }], updatedAt: "2026-11-01T00:00:00.000Z" } },
    { type: "error", stage: "settings", message: "That note is gone." }, { type: "error", stage: "model", message: "m", kind: "rate", retryable: true },
    { type: "info", provider: "p", model: "m", providers: [] }, { type: "capabilities", items: [] }, planUsageEvent({ fiveHour: 0.5, limited: false }),
  ];
  const eventCases = events.map((event) => ({ line: encodeEvent(event as Parameters<typeof encodeEvent>[0]), typed: !["info", "capabilities", "plan.usage"].includes((event as { type: string }).type) }));
  writeFileSync(join(protocolOut, "protocol.json"), `${JSON.stringify({ source: "apps/mac/src/island-commands.ts, apps/mac/src/island-protocol.ts", commandNames, cases, eventCases }, null, 1)}\n`);
  console.log(`protocol: ${commandNames.length} command names, ${cases.length} command lines, ${eventCases.length} events`);
}
