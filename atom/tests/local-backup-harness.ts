import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import { once } from "node:events";

/** Owns a fictional loopback-only compatible server. Never starts or contacts a real model. */
export async function localFixture(handler: (request: IncomingMessage, response: ServerResponse, body: any) => void) {
  const server = createServer(async (request, response) => {
    const chunks: Buffer[] = []; for await (const chunk of request) chunks.push(chunk);
    handler(request, response, chunks.length ? JSON.parse(Buffer.concat(chunks).toString()) : undefined);
  });
  server.listen(0, "127.0.0.1"); await once(server, "listening");
  const port = (server.address() as { port: number }).port;
  return { config: { endpoint: `http://127.0.0.1:${port}/v1`, model: "cedar/fixture:tiny" },
    async close() { server.closeAllConnections(); await new Promise<void>((resolve) => server.close(() => resolve())); } };
}
