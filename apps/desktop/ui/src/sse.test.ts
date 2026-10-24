import { test } from "node:test";
import assert from "node:assert/strict";
import { parseFrames } from "./sse.ts";

test("complete frames are returned and a partial one is kept for the next chunk", () => {
  const first = parseFrames('data: {"a":1}\n\nevent: status\ndata: {"state":"running"}\n\ndata: {"b"');
  assert.deepEqual(first.frames, [{ event: "message", data: '{"a":1}' }, { event: "status", data: '{"state":"running"}' }]);
  assert.equal(first.rest, 'data: {"b"');
  const second = parseFrames(`${first.rest}:2}\n\n`);
  assert.deepEqual(second.frames, [{ event: "message", data: '{"b":2}' }]);
});

test("keep-alive comments and CRLF line ends are handled", () => {
  const { frames, rest } = parseFrames(": keep-alive\n\r\ndata: x\r\n\r\n");
  assert.deepEqual(frames, [{ event: "message", data: "x" }]);
  assert.equal(rest, "");
});
