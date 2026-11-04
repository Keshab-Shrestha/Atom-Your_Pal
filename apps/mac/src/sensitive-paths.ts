// Files an ARK fix may not push (2026-11-05, ARK notices phase 2, ADR-240). A note can start a coding task on ARK's own source. Whatever the
// agent changes lands on a branch the user reviews. These paths decide what ARK may do (permissions, approvals, safety, policy, the sandbox),
// how it updates itself, what it depends on, or how it improves itself. A branch that touches one is never pushed from the ARK window:
// the user reads it and pushes it from a terminal. A plain-code list: no model decides it.

const EXACT = new Set([
  "SECURITY.md",
  "CLAUDE.md",
  "AGENTS.md",
  "package.json",
  "pnpm-lock.yaml",
  "pnpm-workspace.yaml",
  "apps/mac/island/Package.swift",
  "apps/mac/island/make-signing-identity.sh",
  "apps/mac/src/improve.ts",
  "apps/mac/src/island-commands.ts",
  "apps/mac/src/ark-apps.ts",
  "apps/mac/src/watches.ts",
  "apps/mac/src/public-page.ts",
  "apps/mac/src/git-branches.ts",
  "apps/mac/src/sensitive-paths.ts",
  "apps/mac/island/Sources/ArkIslandCore/Apps.swift",
  "apps/mac/island/Sources/ArkIslandCore/AppUpdate.swift",
  "apps/mac/island/Sources/ArkIslandCore/Improvements.swift",
  "apps/mac/island/Sources/ArkIsland/AppsPane.swift",
  "apps/mac/island/Sources/ArkIsland/AppUpdater.swift",
  "apps/mac/island/Sources/ArkIsland/WakeInstaller.swift",
]);
const PREFIXES = [".github/", "scripts/", "apps/mac/island/Resources/", "apps/mac/island/Entitlements"];
/** Any file named for what it guards. */
const NAMED = /(safety|policy|guard|permission|approval|credential|secret|token|sandbox|entitlement)/i;

export function isSensitivePath(path: string): boolean {
  const p = path.replace(/^\.\//, "");
  if (EXACT.has(p) || PREFIXES.some((prefix) => p.startsWith(prefix))) return true;
  const name = p.split("/").at(-1) ?? p;
  return NAMED.test(name) || /\.(plist|entitlements)$/i.test(name);
}

export function sensitiveFiles(paths: readonly string[]): string[] {
  return paths.filter(isSensitivePath);
}

/** The words a refused push says. */
export function sensitiveRefusal(paths: readonly string[]): string {
  const shown = paths.slice(0, 5).join(", ") + (paths.length > 5 ? ` and ${paths.length - 5} more` : "");
  return `This branch changes files that decide what ARK may do, how it updates, or what it depends on: ${shown}. ARK does not push it from here. Read the diff, then push it yourself from a terminal.`;
}
