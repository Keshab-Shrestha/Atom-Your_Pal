// Starts ATOM's runtime and the local server in front of it: `pnpm --filter @atom/desktop start`.
// With --demo it starts a fake runtime that needs no API keys. It prints the one address to open; the token travels in the
// address's #fragment, which a browser never sends to a server and the page removes from the address bar.

import { randomBytes } from "node:crypto";
import { existsSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { createHub } from "./hub.ts";
import { createBridgeServer } from "./server.ts";
import { createSupervisor, type RuntimeLaunch } from "./supervisor.ts";

const here = dirname(fileURLToPath(import.meta.url));
const root = resolve(here, "../../..");

const demo = process.argv.includes("--demo");
const portArg = process.argv.find((a) => a.startsWith("--port="));
const wantedPort = portArg ? Number(portArg.slice(7)) : Number(process.env.ATOM_DESKTOP_PORT ?? 0);
if (!Number.isInteger(wantedPort) || wantedPort < 0 || wantedPort > 65535) {
  console.error("ATOM_DESKTOP_PORT must be a whole number from 0 to 65535 (0 picks a free port).");
  process.exit(2);
}

const launch: RuntimeLaunch = demo
  ? { command: process.execPath, args: [join(here, "fixtures/fake-runtime.mjs")], cwd: root }
  : {
      command: process.execPath,
      args: ["--env-file-if-exists=.env", "--disable-warning=ExperimentalWarning", "apps/mac/src/main.ts", "--island"],
      cwd: root,
    };

const token = randomBytes(32).toString("hex");
const hub = createHub();
const supervisor = createSupervisor({
  launch,
  onEvent: hub.event,
  onStatus: (status) => {
    hub.status(status);
    if (status.state === "configError" || status.state === "failed") console.error(`ATOM: ${status.state}: ${status.message}`);
  },
  onDiagnostic: (line) => console.error(`runtime: ${line}`),
});

const uiDir = join(here, "../ui/dist");
// Staged attachments live in one private folder (mode 0700) that is removed when the bridge stops.
const uploadDir = mkdtempSync(join(tmpdir(), "atom-uploads-"));
const bridge = createBridgeServer({ hub, token, uiDir: existsSync(uiDir) ? uiDir : undefined, uploadDir, send: supervisor.send, status: supervisor.status });
const { port } = await bridge.listen(wantedPort);
supervisor.start();

console.log(`ATOM is running${demo ? " with the demo runtime (no AI model)" : ""}.`);
console.log(`Open: http://127.0.0.1:${port}/#token=${token}`);
if (!existsSync(uiDir)) console.log("The window is not built yet: run `pnpm --filter @atom/desktop ui:build` and restart.");

let stopping = false;
async function shutdown() {
  if (stopping) return;
  stopping = true;
  await supervisor.stop();
  await bridge.close();
  rmSync(uploadDir, { recursive: true, force: true });
  process.exit(0);
}
process.on("SIGINT", () => void shutdown());
process.on("SIGTERM", () => void shutdown());
