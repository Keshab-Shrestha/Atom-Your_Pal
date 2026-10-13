import { mock, test } from "node:test";
import assert from "node:assert/strict";
import { existsSync, mkdirSync, mkdtempSync, realpathSync, rmSync, symlinkSync, truncateSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { openHelperStore } from "@atom/helpers";
import { PROJECT_FILE_BYTES, askForFolder, checkpointBefore, denyRead, folderCheck, projectReadCheck } from "./folder-run.ts";

// Task 3.11: every tool call of a run in folders, checked in code; risky commands ask on Pal's card.

test("paths outside are refused, risky commands ask, refused ones never ask; the log keeps verdicts only", async () => {
  const root = realpathSync(mkdtempSync(join(tmpdir(), "atom-run-")));
  try {
    const asked: string[] = [];
    let answer = true;
    const logged: unknown[] = [];
    const check = folderCheck({
      roots: [root],
      cwd: root,
      name: "Kame",
      approve: async (r) => (asked.push(r.summary), answer),
      onCheck: (e) => logged.push(e),
    });
    assert.equal(await check("Edit", { file_path: join(root, "a.ts") }), undefined);
    assert.match((await check("Read", { file_path: "/etc/passwd" }))!, /outside the folders/);
    assert.match((await check("Write", { file_path: join(root, ".git") }))!, /ATOM commits the work/);
    assert.match((await check("Bash", { command: "git push" }))!, /never done/);
    assert.equal(await check("Bash", { command: "rm -rf build" }), undefined, "asked, and allowed");
    answer = false;
    assert.match((await check("Bash", { command: "npm install x" }))!, /did not allow/);
    assert.deepEqual(asked, ["Kame wants to run: rm -rf build", "Kame wants to run: npm install x"]);
    assert.deepEqual(logged.map((e) => (e as { verdict: string }).verdict), ["allowed", "refused", "refused", "refused", "asked", "allowed", "asked", "declined"]);
    assert.ok(!JSON.stringify(logged).includes("passwd") && !JSON.stringify(logged).includes("npm"), "no paths or commands in the log");
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("sandboxed commands cannot read keys and tokens", () => {
  const paths = denyRead("/Users/k");
  for (const p of ["/Users/k/.ssh", "/Users/k/.aws", "/Users/k/Library/Keychains", "/Users/k/.claude"]) assert.ok(paths.includes(p), p);
});

// ADR-090: Quill had no folder, ran without file tools and could not save. Now it asks for the folder its task names.
test("a file worker with no folder asks for the one its task names; allowed, it is made and granted", async () => {
  const home = realpathSync(mkdtempSync(join(tmpdir(), "atom-home-")));
  try {
    const store = openHelperStore({ path: ":memory:", home });
    const asked: string[] = [];
    const task = "Save it as a text document in a folder named ZenoDoc in the user's home directory.";
    const grants = await askForFolder({
      task,
      name: "Quill",
      home,
      approve: async (r) => (asked.push(`${r.summary} | ${r.reason}`), true),
      grant: (folder) => (store.addGrant("quill", folder), store.list().find((h) => h.id === "quill")!.grants),
    });
    assert.deepEqual(grants, [join(home, "ZenoDoc")]);
    assert.ok(existsSync(join(home, "ZenoDoc")));
    assert.match(asked[0]!, /^Quill needs a folder to save files in: ~\/ZenoDoc \| .*~\/ZenoDoc/);
    // Said no (or no answer): a clear error, nothing made.
    await assert.rejects(
      askForFolder({ task: "Save it to ~/Other", name: "Kame", home, approve: async () => false, grant: () => [] }),
      /You declined: Kame needs a folder to save files in, and none was allowed/,
    );
    assert.ok(!existsSync(join(home, "Other")));
  } finally {
    rmSync(home, { recursive: true, force: true });
  }
});

// B3.4: the before-hook runs for tools that change files, after the checks pass, and never fails the run.
test("before runs only for file-changing tools whose paths passed; a throw does not fail the call", async () => {
  const root = realpathSync(mkdtempSync(join(tmpdir(), "atom-run-")));
  try {
    const seen: [string, string[]][] = [];
    const failed: string[] = [];
    let boom = false;
    const check = folderCheck({
      roots: [root],
      cwd: root,
      name: "Kame",
      approve: async () => true,
      before: (tool, paths) => {
        seen.push([tool, paths]);
        if (boom) throw new Error("disk full");
      },
      onBeforeError: (e) => failed.push(e.tool),
    });
    assert.equal(await check("Write", { file_path: join(root, "a.ts") }), undefined);
    assert.equal(await check("Edit", { file_path: "rel.ts" }), undefined, "a relative path is made absolute");
    assert.equal(await check("MultiEdit", { file_path: join(root, "m.ts") }), undefined);
    assert.equal(await check("NotebookEdit", { notebook_path: join(root, "n.ipynb") }), undefined);
    assert.equal(await check("Read", { file_path: join(root, "a.ts") }), undefined);
    assert.equal(await check("Grep", { pattern: "x", path: root }), undefined);
    assert.equal(await check("Bash", { command: "ls" }), undefined);
    assert.match((await check("Write", { file_path: "/etc/passwd" }))!, /outside the folders/);
    assert.match((await check("Write", { file_path: join(root, ".git", "x") }))!, /ATOM commits the work/);
    assert.deepEqual(seen, [
      ["Write", [join(root, "a.ts")]],
      ["Edit", [join(root, "rel.ts")]],
      ["MultiEdit", [join(root, "m.ts")]],
      ["NotebookEdit", [join(root, "n.ipynb")]],
    ]);
    boom = true;
    assert.equal(await check("Write", { file_path: join(root, "b.ts") }), undefined, "the call is still allowed");
    assert.deepEqual(failed, ["Write"]);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("checkpointBefore keeps files outside the git worktree and leaves the worktree to git", () => {
  const root = realpathSync(mkdtempSync(join(tmpdir(), "atom-run-")));
  try {
    const tree = join(root, "tree");
    const other = join(root, "other");
    mkdirSync(tree);
    mkdirSync(other);
    const kept: string[] = [];
    const before = checkpointBefore({ roots: [tree, other], tree, keep: (_roots, p) => kept.push(p) });
    before("Write", [join(tree, "a.ts"), join(tree, "sub", "b.ts"), join(other, "c.ts")]);
    assert.deepEqual(kept, [join(other, "c.ts")]);
    kept.length = 0;
    checkpointBefore({ roots: [other], keep: (_roots, p) => kept.push(p) })("Edit", [join(other, "d.ts")]);
    assert.deepEqual(kept, [join(other, "d.ts")], "no worktree: every path is kept");
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

// ADR-107: a project chat reads its folder directly (Read, Glob, Grep) and never writes. Each refusal below comes with
// its twin that passes, so removing the check would fail one of the pair.
function projectFixture() {
  const home = realpathSync(mkdtempSync(join(tmpdir(), "atom-proj-home-")));
  const root = join(home, "Developer", "app");
  for (const d of ["src", ".git", "docs"]) mkdirSync(join(root, d), { recursive: true });
  mkdirSync(join(home, ".ssh"), { recursive: true });
  mkdirSync(join(home, "Developer", "other"), { recursive: true });
  for (const f of ["src/a.ts", "env.txt", ".env", ".env.local", "key.pem", "id_rsa", "id_rsa.pub", ".git/config", "docs/notes.md"]) writeFileSync(join(root, f), "x");
  writeFileSync(join(home, ".ssh", "id_ed25519"), "secret");
  writeFileSync(join(home, "Developer", "other", "x.ts"), "x");
  symlinkSync(join(home, ".ssh"), join(root, "keys"));
  symlinkSync(join(root, "src", "a.ts"), join(root, ".env.alias"));
  symlinkSync(join(root, "docs"), join(root, "docs-link"));
  symlinkSync(join(home, "Developer", "other", "x.ts"), join(root, "out.ts"));
  return { home, root };
}

test("project reads: inside the folder passes; outside, symlink escapes, .. and absolute patterns are refused", async () => {
  const { home, root } = projectFixture();
  try {
    const seen: unknown[] = [];
    const check = projectReadCheck([root], "Haat coder", { home, onCheck: (e) => seen.push(e) });
    assert.equal(await check("Read", { file_path: join(root, "src/a.ts") }), undefined);
    assert.equal(await check("Read", { file_path: "src/a.ts" }), undefined, "relative to the folder");
    assert.equal(await check("Read", { file_path: join(root, "docs-link", "notes.md") }), undefined, "a symlink that stays inside");
    assert.equal(await check("Glob", { pattern: "**/*.ts" }), undefined);
    assert.equal(await check("Grep", { pattern: "TODO", path: "src" }), undefined);
    assert.equal(await check("Grep", { pattern: "TODO" }), undefined, "no path: the folder itself");
    assert.match((await check("Read", { file_path: join(home, "Developer", "other", "x.ts") }))!, /outside/);
    assert.match((await check("Read", { file_path: join(home, ".ssh", "id_ed25519") }))!, /outside/);
    assert.match((await check("Read", { file_path: join(root, "keys", "id_ed25519") }))!, /outside/, "a symlink to ~/.ssh");
    assert.match((await check("Read", { file_path: join(root, "out.ts") }))!, /outside/, "a symlink to a file outside");
    assert.match((await check("Read", { file_path: "../other/x.ts" }))!, /outside/);
    assert.match((await check("Read", { file_path: "/etc/passwd" }))!, /outside/);
    assert.match((await check("Glob", { pattern: "/etc/**" }))!, /outside/, "an absolute pattern");
    assert.equal(await check("Glob", { pattern: `${root}/src/*.ts` }), undefined, "an absolute pattern inside the folder");
    assert.match((await check("Glob", { pattern: "../**/*.ts" }))!, /\.\./, "a .. pattern");
    assert.match((await check("Glob", { pattern: "src/../../*" }))!, /\.\./);
    assert.match((await check("Grep", { pattern: "x", path: join(home, ".ssh") }))!, /outside/);
    assert.match((await check("Grep", { pattern: "x", glob: "../*" }))!, /\.\./);
    assert.match((await check("Grep", { pattern: "x", path: "keys" }))!, /outside/);
    assert.deepEqual(seen.map((e) => (e as { verdict: string }).verdict).filter((v) => v === "refused").length, 12);
    assert.ok(!JSON.stringify(seen).includes("ssh") && !JSON.stringify(seen).includes("etc"), "the log has tools and verdicts only");
  } finally {
    rmSync(home, { recursive: true, force: true });
  }
});

test("project reads: secret-like files, ~/.ssh and git internals are refused; look-alikes pass", async () => {
  const { home, root } = projectFixture();
  try {
    const check = projectReadCheck([root], "Haat coder", { home });
    for (const f of [".env", ".env.local", "key.pem", "id_rsa", "id_rsa.pub"]) assert.match((await check("Read", { file_path: join(root, f) }))!, /secret/i, f);
    assert.equal(await check("Read", { file_path: join(root, "env.txt") }), undefined, "env.txt is not .env");
    assert.match((await check("Read", { file_path: join(root, ".env.alias") }))!, /secret/i, "a link named like a secret file is refused by its own name");
    assert.match((await check("Read", { file_path: join(root, ".git", "config") }))!, /git/i);
    assert.match((await check("Grep", { pattern: "x", path: ".git" }))!, /git/i);
    assert.match((await check("Glob", { pattern: ".git/**" }))!, /git/i);
    assert.equal(await check("Read", { file_path: join(root, "docs", "notes.md") }), undefined);
    const asHome = projectReadCheck([join(home, ".ssh")], "x", { home }); // a root inside a deny dir is still refused
    assert.match((await asHome("Read", { file_path: join(home, ".ssh", "id_ed25519") }))!, /secret|keys/i);
    assert.match((await check("Grep", { pattern: "x", glob: ".env*" }))!, /glob/i, "a glob that names secrets");
    assert.match((await check("Grep", { pattern: "x", glob: "*.pem" }))!, /glob/i, "a glob that names key files");
    assert.match((await check("Grep", { pattern: "x", glob: "*" }))!, /glob/i, "a glob that is not an extension filter");
    assert.equal(await check("Grep", { pattern: "x", glob: "*.ts" }), undefined);
    assert.equal(await check("Grep", { pattern: "x", glob: "**/*.{ts,tsx}" }), undefined);
  } finally {
    rmSync(home, { recursive: true, force: true });
  }
});

test("project reads: a file over 2 MB is refused; exactly 2 MB passes; only Read, Glob and Grep are allowed", async () => {
  const { home, root } = projectFixture();
  try {
    const check = projectReadCheck([root], "Haat coder", { home });
    writeFileSync(join(root, "big.bin"), "");
    truncateSync(join(root, "big.bin"), PROJECT_FILE_BYTES);
    assert.equal(await check("Read", { file_path: join(root, "big.bin") }), undefined);
    truncateSync(join(root, "big.bin"), PROJECT_FILE_BYTES + 1);
    assert.match((await check("Read", { file_path: join(root, "big.bin") }))!, /2 MB/);
    assert.match((await check("Read", { file_path: join(root, "src") }))!, /file/i, "a folder is not a file");
    assert.match((await check("Read", {}))!, /file/i);
    for (const tool of ["Write", "Edit", "MultiEdit", "NotebookEdit", "Bash", "WebFetch", "Task"]) {
      assert.match((await check(tool, { file_path: join(root, "src/a.ts"), command: "ls" }))!, /Haat coder/, tool);
    }
  } finally {
    rmSync(home, { recursive: true, force: true });
  }
});

test("project reads: a grep that names no glob is given an exclusion for secrets and git", async () => {
  const { home, root } = projectFixture();
  try {
    const check = projectReadCheck([root], "Haat coder", { home });
    const prepared = check.prepare("Grep", { pattern: "TODO" });
    assert.match(String(prepared.glob), /^!\{/);
    for (const word of [".git", ".env", ".pem", "id_rsa"]) assert.ok(String(prepared.glob).includes(word), word);
    assert.deepEqual(check.prepare("Grep", { pattern: "TODO", glob: "*.ts" }), { pattern: "TODO", glob: "*.ts" }, "an extension glob stays");
    assert.deepEqual(check.prepare("Read", { file_path: "a" }), { file_path: "a" });
  } finally {
    rmSync(home, { recursive: true, force: true });
  }
});

// Job 2: the folder question waits 10 minutes (not 60 s), says why it ended, and shows the job step.
test("a folder question waits 10 minutes, then the error says you did not answer", async (t) => {
  t.after(() => mock.timers.reset());
  mock.timers.enable({ apis: ["setTimeout"] });
  const home = realpathSync(mkdtempSync(join(tmpdir(), "atom-home-")));
  try {
    const seen: { timeoutMs: number; summary: string }[] = [];
    let waiting = 0;
    let answer: [boolean, boolean] | undefined;
    const result = askForFolder({
      task: "Run du -sh on ~/Other",
      name: "Kame",
      home,
      approve: (request, signal) => (seen.push(request), new Promise<boolean>((resolve) => signal.addEventListener("abort", () => resolve(false)))),
      grant: () => [],
      onWaiting: () => waiting++,
      onAnswer: (allowed, timedOut) => (answer = [allowed, timedOut]),
    });
    const outcome = assert.rejects(result, /You did not answer in 10 minutes: Kame needs a folder/);
    mock.timers.tick(9 * 60_000 + 59_000); // still waiting after 60 s and after 9:59
    assert.equal(answer, undefined);
    mock.timers.tick(1_000);
    await outcome;
    assert.equal(waiting, 1);
    assert.deepEqual(answer, [false, true]);
    assert.ok(seen[0]!.timeoutMs >= 10 * 60_000);
    assert.match(seen[0]!.summary, /~\/Other$/); // the folder is in the line that is never cut
  } finally {
    rmSync(home, { recursive: true, force: true });
  }
});

test("a folder question answered late (inside 10 minutes) is allowed; stopping the job withdraws it", async (t) => {
  t.after(() => mock.timers.reset());
  mock.timers.enable({ apis: ["setTimeout"] });
  const home = realpathSync(mkdtempSync(join(tmpdir(), "atom-home-")));
  try {
    let yes!: (v: boolean) => void;
    const late = askForFolder({ task: "Save it to ~/Late", name: "Quill", home, approve: () => new Promise<boolean>((r) => (yes = r)), grant: (f) => [f] });
    mock.timers.tick(5 * 60_000);
    yes(true);
    assert.deepEqual(await late, [join(home, "Late")]);
    const stop = new AbortController();
    const withdrawn = askForFolder({
      task: "Save it to ~/Gone",
      name: "Quill",
      home,
      signal: stop.signal,
      approve: (_r, signal) => new Promise<boolean>((r) => signal.addEventListener("abort", () => r(false))),
      grant: () => [],
    });
    stop.abort();
    await assert.rejects(withdrawn, /You declined/); // ponytail: a stop reads as a refusal; the job is cancelled anyway
  } finally {
    rmSync(home, { recursive: true, force: true });
  }
});
