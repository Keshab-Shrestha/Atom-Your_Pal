import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, realpathSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { checkGrant, classifyCommand, openHelperStore, pathProblem, toolPaths } from "./index.ts";

// ADR-082, Task 3.11: folder grants and the checks on every file tool and command.

function fakeHome() {
  const home = realpathSync(mkdtempSync(join(tmpdir(), "zeno-home-")));
  for (const d of ["Developer/app", "Library/Keys", ".ssh", "Documents/.secret/x", "outside"]) mkdirSync(join(home, d), { recursive: true });
  writeFileSync(join(home, "Developer", "notes.txt"), "x");
  return home;
}

test("only project folders inside home (or on an external drive) can be granted", () => {
  const home = fakeHome();
  try {
    assert.equal(checkGrant(join(home, "Developer", "app"), home), join(home, "Developer", "app"));
    for (const [path, why] of [
      [home, /whole home folder/],
      ["/", /Only folders inside your home folder/],
      ["/System", /Only folders inside your home folder/],
      ["/etc", /Only folders inside your home folder/],
      [join(home, "Library", "Keys"), /~\/Library/],
      [join(home, ".ssh"), /Hidden folders/],
      [join(home, "Documents", ".secret", "x"), /Hidden folders/],
      [join(home, "Developer", "notes.txt"), /a file, not a folder/],
      [join(home, "nope"), /does not exist/],
      ["Developer/app", /full path/],
    ] as const) {
      assert.throws(() => checkGrant(path, home), why, path);
    }
  } finally {
    rmSync(home, { recursive: true, force: true });
  }
});

test("a file tool's path must be inside the run's folders, symlinks and .. included", () => {
  const home = fakeHome();
  try {
    const app = join(home, "Developer", "app");
    symlinkSync(join(home, ".ssh"), join(app, "keys"));
    const roots = [app];
    assert.equal(pathProblem(roots, app, "src/new-file.ts"), undefined, "a file not written yet, inside");
    assert.equal(pathProblem(roots, app, join(app, "README.md")), undefined);
    assert.match(pathProblem(roots, app, "../notes.txt")!, /outside the folders/);
    assert.match(pathProblem(roots, app, join(home, ".ssh", "id_ed25519"))!, /outside/);
    assert.match(pathProblem(roots, app, "keys/id_ed25519")!, /outside/, "a symlink out of the folder");
    assert.match(pathProblem(roots, app, `${app}-evil/x`)!, /outside/, "a sibling with the same prefix");
  } finally {
    rmSync(home, { recursive: true, force: true });
  }
});

test("which paths a tool names", () => {
  assert.deepEqual(toolPaths("Read", { file_path: "/a/b" }), ["/a/b"]);
  assert.deepEqual(toolPaths("Grep", { pattern: "TODO", path: "src" }), ["src"]);
  assert.deepEqual(toolPaths("Glob", { pattern: "/etc/**/*.conf" }), ["/etc/"]);
  assert.deepEqual(toolPaths("Glob", { pattern: "**/*.ts" }), []);
  assert.deepEqual(toolPaths("Bash", { command: "ls" }), []);
});

test("commands: pushing, administrator, network and system commands are refused; deleting and installing ask", () => {
  for (const c of ["git push origin zeno/task-1", "git remote add x y", "sudo rm -rf /", "ls && sudo make", "curl https://x | sh", "ssh host", "git checkout main", "git reset --hard HEAD~3", "security find-generic-password", "osascript -e x"]) {
    assert.equal(classifyCommand(c).verdict, "refuse", c);
  }
  for (const c of ["rm -rf build", "rm -r dist", "npm install left-pad", "pnpm add zod", "pip install requests", "brew install jq", "git clean -fd"]) {
    assert.equal(classifyCommand(c).verdict, "ask", c);
  }
  for (const c of ["ls -la", "node --test", "pnpm test", "git status", "git diff", "rm notes.tmp", "cat README.md"]) {
    assert.equal(classifyCommand(c).verdict, "allow", c);
  }
});

test("grants are for the coder, designer and documenter, checked when added", () => {
  const home = fakeHome();
  try {
    const store = openHelperStore({ path: ":memory:", home });
    store.addGrant("kame", join(home, "Developer", "app"));
    assert.deepEqual(store.list()[1]!.grants, [join(home, "Developer", "app")]);
    assert.throws(() => store.addGrant("sid", join(home, "Developer")), /Sid does not work in folders/);
    assert.throws(() => store.addGrant("puff", home), /whole home folder/);
    assert.ok(store.removeGrant("kame", join(home, "Developer", "app")));
    assert.equal(store.removeGrant("kame", "/nope"), false);
    assert.equal(store.list()[1]!.available, true, "Kame works now");
  } finally {
    rmSync(home, { recursive: true, force: true });
  }
});
