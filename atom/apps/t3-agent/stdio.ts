import { connect } from "node:net";
import { socketPath } from "./paths.ts";

// A provider process is a connection, never another owner of ATOM's databases.
const socket = connect(socketPath);
socket.once("connect", () => {
  process.stdin.pipe(socket);
  socket.pipe(process.stdout);
});
socket.once("error", () => {
  console.error(
    "ATOM backend is unavailable. Start it with pnpm atom:backend, then reconnect this provider.",
  );
  process.exitCode = 1;
  process.stdin.destroy();
});
socket.once("close", () => process.stdin.destroy());
process.stdout.on("error", () => socket.destroy());
process.on("SIGTERM", () => {
  socket.destroy();
  process.stdin.destroy();
});
process.on("SIGINT", () => {
  socket.destroy();
  process.stdin.destroy();
});
