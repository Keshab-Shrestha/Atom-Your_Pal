import type { Tool } from "../engine.ts";

/** The first and harmless tool: today's date and time. Proves the tool path end to end (Task 0.6.1). */
export function timeTool(now: () => Date = () => new Date()): Tool {
  return {
    capability: { title: "Date and time", examples: ["What time is it?", "What's the date today?"] },
    spec: {
      name: "current_time",
      description: "Gets the current date and time on this Mac. Use it when the user asks what time or day it is.",
      inputSchema: {
        type: "object",
        properties: { timezone: { type: "string", description: "Optional IANA time zone, e.g. Asia/Tokyo. Defaults to this Mac's." } },
      },
    },
    run(input) {
      const timeZone = typeof input.timezone === "string" ? input.timezone : undefined;
      try {
        return new Intl.DateTimeFormat("en-GB", {
          dateStyle: "full",
          timeStyle: "long",
          ...(timeZone ? { timeZone } : {}),
        }).format(now());
      } catch {
        throw new Error(`"${timeZone}" is not a time zone name`);
      }
    },
  };
}
