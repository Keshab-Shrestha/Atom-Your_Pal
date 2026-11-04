import { test } from "node:test";
import assert from "node:assert/strict";
import { isSensitivePath, sensitiveFiles, sensitiveRefusal } from "./sensitive-paths.ts";

test("files that decide what ARK may do, how it updates or what it needs are sensitive", () => {
  for (const path of [
    "SECURITY.md", "CLAUDE.md", "package.json", "pnpm-lock.yaml", "scripts/setup.sh", ".github/workflows/ci.yml", "apps/mac/src/native-safety.ts",
    "apps/mac/src/island-commands.ts", "apps/mac/src/improve.ts", "apps/mac/src/ark-apps.ts", "services/tool-engine/src/computer/policy.ts",
    "apps/mac/island/Sources/ArkIslandCore/Apps.swift", "apps/mac/island/Resources/ARK.entitlements", "apps/mac/island/Info.plist", "services/x/src/credentials-store.ts",
    "./SECURITY.md", "apps/mac/src/approval-cards.ts", "apps/mac/src/permission-map.ts", "apps/mac/src/sandbox-profile.ts",
  ]) assert.equal(isSensitivePath(path), true, path);
});

test("ordinary source, tests and docs are not", () => {
  for (const path of ["README.md", "DECISIONS.md", "apps/mac/src/weather.ts", "apps/mac/src/watches.test.ts".replace("watches", "weather"), "services/memory/src/suggestions.ts", "apps/mac/island/Sources/ArkIsland/DashboardHome.swift", "tests/ui-golden/13-helpers.png"]) {
    assert.equal(isSensitivePath(path), false, path);
  }
});

test("the filter keeps only the sensitive ones, and the refusal names a few and counts the rest", () => {
  assert.deepEqual(sensitiveFiles(["README.md", "SECURITY.md", "a.ts", "package.json"]), ["SECURITY.md", "package.json"]);
  assert.match(sensitiveRefusal(["SECURITY.md"]), /changes files that decide what ARK may do.*SECURITY\.md.*push it yourself from a terminal/s);
  assert.match(sensitiveRefusal(["a", "b", "c", "d", "e", "f", "g"]), /a, b, c, d, e and 2 more/);
});
