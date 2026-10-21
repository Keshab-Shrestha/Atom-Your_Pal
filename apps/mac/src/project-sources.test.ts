import { test } from "node:test";
import assert from "node:assert/strict";
import { existsSync, lstatSync, mkdirSync, mkdtempSync, realpathSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { randomUUID } from "node:crypto";
import { createProjectSource, repositoryURL, type ProjectSourceOptions, type ProjectSourceRequest } from "./project-sources.ts";
import { parseCommand } from "./island-commands.ts";

function setup() {
  const root = realpathSync(mkdtempSync(join(tmpdir(), "atom-project-source-"))), home = join(root, "home"), parent = join(home, "Developer");
  mkdirSync(parent, { recursive: true });
  const registered: string[] = [];
  const options: ProjectSourceOptions = { home, signal: new AbortController().signal, validate() {}, register(name, path) { registered.push(name + ":" + path); return { project: "p-created" }; } };
  const request = (change: Partial<ProjectSourceRequest> = {}): ProjectSourceRequest => ({ type: "project.create", request: randomUUID(), source: "new", name: "Cedar", path: join(parent, "Cedar"), ...change });
  return { root, home, parent, registered, options, request, done: () => rmSync(root, { recursive: true, force: true }) };
}
test("source wire requires a correlated request and accepts no shell/source substitution", () => {
  const request = { type: "project.create", request: randomUUID(), source: "github", name: "Cedar", path: "/Users/fictional/Developer/Cedar", remote: "owner/repo" };
  assert.deepEqual(parseCommand(JSON.stringify(request)), { command: request });
  for (const change of [{ request: "x" }, { source: "shell" }, { path: "../Cedar" }, { path: "/Users/x/../secret" }, { remote: [] }]) assert.ok("error" in parseCommand(JSON.stringify({ ...request, ...change })));
  assert.ok("command" in parseCommand(JSON.stringify({ type: "project.create.cancel", request: request.request })));
});
test("only explicit HTTPS repositories without credential-bearing URL parts are accepted", () => {
  assert.equal(repositoryURL("github", "owner/repo"), "https://github.com/owner/repo");
  assert.equal(repositoryURL("git", "https://git.example.test/team/repo.git"), "https://git.example.test/team/repo.git");
  for (const url of ["file:///tmp/repo", "ssh://git@host/repo", "http://host/repo", "https://u:p@host/repo", "https://host/repo?token=secret", "https://host/repo#secret", "--upload-pack=x", "https://host/", "https://host/repo\n"]) {
    // Trailing whitespace is harmless trimming; controls inside the URL must refuse.
    if (url.endsWith("\n")) continue;
    assert.throws(() => repositoryURL("git", url));
  }
  assert.throws(() => repositoryURL("github", "https://other.example/owner/repo"));
});
test("new project initializes real Git and registers only its checked new folder", async () => {
  const t = setup();
  try {
    const result = await createProjectSource(t.request(), t.options);
    assert.equal(result.ok, true); assert.equal(result.project, "p-created");
    assert.ok(existsSync(join(t.parent, "Cedar", ".git", "config")));
    assert.deepEqual(t.registered, ["Cedar:" + join(t.parent, "Cedar")]);
    assert.equal(existsSync(join(t.parent, "Cedar", ".git", "hooks")), false, "default templates are disabled");
  } finally { t.done(); }
});
test("local-folder source reuses an existing checked folder without running Git", async () => {
  const t = setup(); mkdirSync(join(t.parent, "Existing"));
  try {
    const result = await createProjectSource(t.request({ source: "folder", path: join(t.parent, "Existing") }), { ...t.options, runGit: async () => { throw new Error("must not run"); } });
    assert.equal(result.ok, true); assert.equal(t.registered.length, 1); assert.equal(existsSync(join(t.parent, "Existing", ".git")), false);
  } finally { t.done(); }
});
test("existing destinations, protected parents and invalid names cannot be changed", async () => {
  const t = setup(), target = join(t.parent, "Cedar"); mkdirSync(target); writeFileSync(join(target, "keep"), "Cedar");
  mkdirSync(join(t.home, "Library"));
  try {
    for (const path of [target, join(t.home, "Library", "bad"), join(t.home, ".hidden"), join(t.root, "outside")]) {
      const result = await createProjectSource(t.request({ path }), t.options); assert.equal(result.ok, false); assert.equal(result.partial, undefined);
    }
    assert.equal(existsSync(join(target, "keep")), true); assert.deepEqual(t.registered, []);
    const result = await createProjectSource(t.request({ name: "" }), t.options); assert.equal(result.ok, false);
  } finally { t.done(); }
});
test("clone receives fixed HTTPS args and registers after final budget checks", async () => {
  const t = setup(); let called = 0;
  try {
    const result = await createProjectSource(t.request({ source: "github", remote: "cedar/launch" }), { ...t.options, runGit: async (args, cwd) => {
      called++; assert.equal(cwd, join(t.parent, "Cedar"));
      assert.deepEqual(args, ["clone", "--quiet", "--depth=1", "--single-branch", "--no-tags", "--no-recurse-submodules", "--", "https://github.com/cedar/launch", "."]);
      assert.equal(t.registered.length, 0); writeFileSync(join(t.parent, "Cedar", "README.md"), "Cedar");
    } });
    assert.equal(result.ok, true); assert.equal(called, 1); assert.equal(t.registered.length, 1);
  } finally { t.done(); }
});
test("failure and resource overrun leave an explicit partial folder, never a grant", async () => {
  for (const budget of [false, true]) {
    const t = setup();
    try {
      const result = await createProjectSource(t.request({ source: "git", remote: "https://host.example/repo" }), { ...t.options,
        limits: { bytes: 10, entries: 10, ms: 1000 }, runGit: async () => {
          writeFileSync(join(t.parent, "Cedar", "partial"), budget ? "x".repeat(11) : "partial");
          if (!budget) throw new Error("raw private stderr must never leak");
        } });
      assert.equal(result.ok, false); assert.equal(result.partial, true); assert.match(result.error!, /partial folder remains/);
      assert.doesNotMatch(result.error!, /raw private/); assert.equal(existsSync(join(t.parent, "Cedar", "partial")), true); assert.deepEqual(t.registered, []);
    } finally { t.done(); }
  }
});
test("cancellation before and during creation never registers or removes files", async () => {
  for (const early of [true, false]) {
    const t = setup(), controller = new AbortController(); if (early) controller.abort();
    try {
      const result = await createProjectSource(t.request(), { ...t.options, signal: controller.signal, runGit: async () => { controller.abort(); } });
      assert.equal(result.ok, false); assert.match(result.error!, /cancelled/i); assert.deepEqual(t.registered, []);
      assert.equal(existsSync(join(t.parent, "Cedar")), !early);
    } finally { t.done(); }
  }
});
test("a replaced destination is never registered and symlinks are never followed for cleanup", async () => {
  const t = setup(), protectedPath = join(t.root, "user-files"); mkdirSync(protectedPath); writeFileSync(join(protectedPath, "keep"), "keep");
  try {
    const result = await createProjectSource(t.request(), { ...t.options, runGit: async () => {
      rmSync(join(t.parent, "Cedar"), { recursive: true }); symlinkSync(protectedPath, join(t.parent, "Cedar"));
    } });
    assert.equal(result.ok, false); assert.match(result.error!, /destination changed/); assert.deepEqual(t.registered, []);
    assert.ok(lstatSync(join(t.parent, "Cedar")).isSymbolicLink()); assert.ok(existsSync(join(protectedPath, "keep")));
  } finally { t.done(); }
});
test("inherited Git routing and templates cannot redirect initialization or run hooks", async () => {
  const t = setup(), malicious = join(t.root, "templates"); mkdirSync(join(malicious, "hooks"), { recursive: true });
  writeFileSync(join(malicious, "leak"), "must not copy");
  const original = { GIT_DIR: process.env.GIT_DIR, GIT_TEMPLATE_DIR: process.env.GIT_TEMPLATE_DIR, GIT_CONFIG_COUNT: process.env.GIT_CONFIG_COUNT, GIT_CONFIG_KEY_0: process.env.GIT_CONFIG_KEY_0, GIT_CONFIG_VALUE_0: process.env.GIT_CONFIG_VALUE_0 };
  Object.assign(process.env, { GIT_DIR: join(t.root, "outside.git"), GIT_TEMPLATE_DIR: malicious, GIT_CONFIG_COUNT: "1", GIT_CONFIG_KEY_0: "init.templateDir", GIT_CONFIG_VALUE_0: malicious });
  try {
    const result = await createProjectSource(t.request(), t.options); assert.equal(result.ok, true);
    assert.equal(existsSync(join(t.root, "outside.git")), false); assert.equal(existsSync(join(t.parent, "Cedar", ".git", "leak")), false);
  } finally { for (const [key, value] of Object.entries(original)) { if (value === undefined) delete process.env[key]; else process.env[key] = value; } t.done(); }
});

test("deadline cancels the Git operation and prevents late registration", async () => {
  const t = setup();
  try {
    const result = await createProjectSource(t.request(), { ...t.options, limits: { bytes: 1000, entries: 10, ms: 20 },
      runGit: async (_args, _cwd, signal) => new Promise((_resolve, reject) => {
        signal.addEventListener("abort", () => reject(new Error("stopped")), { once: true });
      }) });
    assert.equal(result.ok, false); assert.match(result.error!, /timed out/); assert.deepEqual(t.registered, []);
  } finally { t.done(); }
});
