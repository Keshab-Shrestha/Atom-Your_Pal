import { fileURLToPath } from "node:url";
import { resolve } from "node:path";
import { tmpdir } from "node:os";
import { createHash } from "node:crypto";

export const backendRoot = fileURLToPath(new URL("../../", import.meta.url));
const checkoutId = createHash("sha256").update(backendRoot).digest("hex").slice(0, 12);
export const socketPath = resolve(
  process.env.ATOM_T3_SOCKET ??
    `${tmpdir()}/atom-t3-${process.getuid?.() ?? "user"}-${checkoutId}/rpc.sock`,
);
