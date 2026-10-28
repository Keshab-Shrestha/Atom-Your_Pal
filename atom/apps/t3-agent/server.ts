import { createServer } from "node:net";
import { chmodSync, existsSync, lstatSync, mkdirSync, unlinkSync } from "node:fs";
import { dirname, join } from "node:path";
import { loadConfig, readProviderKeys } from "@atom/shared";
import { createRuntime } from "../mac/src/runtime.ts";
import { acquireInstanceLock } from "../mac/src/instance-lock.ts";
import { readSavedChoice, settingsPath } from "../mac/src/model-settings.ts";
import { createAcpService, type Peer } from "./service.ts";
import { backendRoot, socketPath } from "./paths.ts";

process.chdir(backendRoot);
const lock = acquireInstanceLock(join(backendRoot, "data/.atom.lock"));
if (!lock.ok)
  throw new Error(
    `ATOM already owns this backend's data (pid ${lock.pid}). Stop that instance before starting this one.`,
  );

let runtime: ReturnType<typeof createRuntime> | undefined;
let stopped = false;
try {
  const keys = readProviderKeys();
  const saved = readSavedChoice(settingsPath(), keys);
  const config = loadConfig(process.env, { llm: saved.choice });
  runtime = createRuntime(config, undefined, { keys });
  const agent = createAcpService(runtime, join(backendRoot, "data/t3-sessions.json"));
  const directory = dirname(socketPath);
  mkdirSync(directory, { recursive: true, mode: 0o700 });
  const directoryInfo = lstatSync(directory);
  if (!directoryInfo.isDirectory() || directoryInfo.uid !== process.getuid?.())
    throw new Error(
      "The ATOM socket folder must be owned by your user and must not be a symbolic link.",
    );
  chmodSync(directory, 0o700);
  if (Buffer.byteLength(socketPath) > 103)
    throw new Error("ATOM_T3_SOCKET is too long for a macOS local socket. Choose a shorter path.");
  if (existsSync(socketPath)) {
    if (!lstatSync(socketPath).isSocket())
      throw new Error("The ATOM socket path contains another file. Choose a different path.");
    unlinkSync(socketPath);
  }
  const connections = new Set<import("node:net").Socket>();
  const server = createServer((socket) => {
    connections.add(socket);
    let buffer = "";
    socket.setEncoding("utf8");
    const peer: Peer = {
      send(value) {
        if (socket.destroyed) return;
        if (socket.writableLength > 16 * 1024 * 1024) {
          socket.destroy();
          return;
        }
        socket.write(`${JSON.stringify(value)}\n`);
      },
    };
    socket.on("data", (data: string) => {
      buffer += data;
      if (Buffer.byteLength(buffer) > 16 * 1024 * 1024) {
        socket.destroy();
        return;
      }
      let newline: number;
      while ((newline = buffer.indexOf("\n")) >= 0) {
        const line = buffer.slice(0, newline);
        buffer = buffer.slice(newline + 1);
        if (!line.trim()) continue;
        let message: unknown;
        try {
          message = JSON.parse(line);
        } catch {
          peer.send({
            jsonrpc: "2.0",
            id: null,
            error: { code: -32700, message: "Invalid JSON." },
          });
          continue;
        }
        void agent.receive(peer, message).catch(() => socket.destroy());
      }
    });
    socket.on("error", () => socket.destroy());
    socket.once("close", () => {
      connections.delete(socket);
      agent.disconnected(peer);
    });
  });
  const shutdown = () => {
    if (stopped) return;
    stopped = true;
    agent.stop();
    for (const connection of connections) connection.destroy();
    server.close(() => {
      runtime?.close();
      lock.release();
      process.exit(0);
    });
    setTimeout(() => {
      runtime?.close();
      lock.release();
      process.exit(0);
    }, 5_000).unref();
  };
  server.once("error", (error) => {
    console.error(`ATOM backend could not listen: ${error.message}`);
    shutdown();
  });
  server.listen(socketPath, () => {
    chmodSync(socketPath, 0o600);
    console.log("ATOM backend ready. T3 chat can connect through the ATOM provider.");
  });
  process.on("SIGINT", shutdown);
  process.on("SIGTERM", shutdown);
} catch (error) {
  runtime?.close();
  lock.release();
  throw error;
}
