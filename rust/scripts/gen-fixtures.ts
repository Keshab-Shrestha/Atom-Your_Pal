// ADR-278 Phase 1: the parity fixtures of rust/crates/ark-core. Runs the TypeScript code on fixed inputs and writes each
// answer to rust/crates/ark-core/tests/fixtures/<module>.json; the Rust test `parity` checks its answers against them.
// Run from the repository root: node rust/scripts/gen-fixtures.ts
// Only TypeScript sources have fixtures. The Swift-only modules (ark-visual, questions, diffs) keep their ported tests.
import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { classifyCommand, expandHome, folderForTask, hasGitPart, isImportantName, isInside, isPushCommand, toolPaths } from "../../services/helpers/src/grants.ts";
import { parseWriteScope, writeScopesOverlap } from "../../services/helpers/src/write-scopes.ts";

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
