import { spawn } from "node:child_process";
import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL("../../../", import.meta.url));
const home = join(root, ".ark");
const settings = join(home, "userdata/settings.json");
if (!existsSync(settings)) {
  mkdirSync(join(home, "userdata"), { recursive: true, mode: 0o700 });
  writeFileSync(settings, JSON.stringify({ defaultRuntimeMode: "approval-required" }), {
    mode: 0o600,
    flag: "wx",
  });
}
if (process.argv.includes("--setup-only")) {
  console.log("ARK configured. Chat uses T3's original provider system.");
} else {
  const child = spawn(
    process.execPath,
    [join(root, "scripts/dev-runner.ts"), "dev", "--home-dir", home, "--no-seed"],
    {
      cwd: root,
      env: {
        ...process.env,
        ARK_BACKEND_ROOT: join(root, "atom"),
        ARK_NODE_PATH: process.execPath,
        T3CODE_HOME: home,
        T3CODE_DEV_SEED: "0",
      },
      stdio: "inherit",
    },
  );
  process.on("SIGINT", () => child.kill("SIGTERM"));
  process.on("SIGTERM", () => child.kill("SIGTERM"));
  child.once("error", (error) => {
    console.error(error.message);
    process.exitCode = 1;
  });
  child.once("exit", (code) => {
    process.exitCode = code ?? 1;
  });
}
