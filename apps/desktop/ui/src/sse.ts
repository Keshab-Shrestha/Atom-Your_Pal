// Reads Server-Sent Events from a stream. `fetch` is used instead of EventSource because EventSource cannot send the token header,
// and the token must never be in a URL (it would reach history and logs).

export interface SseFrame {
  /** "message" unless the bridge named it (the bridge names its status frames "status"). */
  event: string;
  data: string;
}

/** Splits `buffer` into complete frames and what is left over. Comments (": keep-alive") are dropped. */
export function parseFrames(buffer: string): { frames: SseFrame[]; rest: string } {
  const frames: SseFrame[] = [];
  const parts = buffer.replace(/\r\n/g, "\n").split("\n\n");
  const rest = parts.pop() ?? "";
  for (const part of parts) {
    let event = "message";
    const data: string[] = [];
    for (const line of part.split("\n")) {
      if (line.startsWith(":") || line === "") continue;
      const colon = line.indexOf(":");
      const field = colon === -1 ? line : line.slice(0, colon);
      const value = colon === -1 ? "" : line.slice(colon + 1).replace(/^ /, "");
      if (field === "event") event = value;
      else if (field === "data") data.push(value);
    }
    if (data.length > 0) frames.push({ event, data: data.join("\n") });
  }
  return { frames, rest };
}
