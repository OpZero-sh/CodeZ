import { describe, test, expect } from "bun:test";
import { parseChannelFrame } from "./channel-bridge";

type PermissionRequestEvent = {
  type: "channel.permission_request";
  sessionId: string;
  request: { requestId: string; toolName: string; description: string; inputPreview: string };
};

describe("channel-bridge", () => {
  test("parses SSE permission_request frame", () => {
    const frame = `data: {"type":"permission_request","request_id":"req-123","tool_name":"Bash","description":"Run shell command","input_preview":"ls -la"}`;

    const event = parseChannelFrame("test-session", frame) as PermissionRequestEvent | null;

    expect(event).not.toBeNull();
    expect(event!.type).toBe("channel.permission_request");
    expect(event!.sessionId).toBe("test-session");
    expect(event!.request.requestId).toBe("req-123");
    expect(event!.request.toolName).toBe("Bash");
    expect(event!.request.description).toBe("Run shell command");
    expect(event!.request.inputPreview).toBe("ls -la");
  });

  test("parses SSE permission_resolved frame", () => {
    const frame = `data: {"type":"permission_resolved","request_id":"req-123"}`;

    const event = parseChannelFrame("test-session-2", frame);

    expect(event).not.toBeNull();
    expect(event!.type).toBe("channel.permission_resolved");
    expect(event!.sessionId).toBe("test-session-2");
    expect((event as { requestId: string }).requestId).toBe("req-123");
  });

  test("returns null for invalid JSON", () => {
    const frame = `data: not valid json`;

    const event = parseChannelFrame("test-session", frame);

    expect(event).toBeNull();
  });

  test("returns null for unknown event types", () => {
    const frame = `data: {"type":"unknown_event","foo":"bar"}`;

    const event = parseChannelFrame("test-session", frame);

    expect(event).toBeNull();
  });

  test("ignores comment lines", () => {
    const frame = `: comment line\ndata: {"type":"permission_request","request_id":"req-456","tool_name":"Read","description":"Read file","input_preview":"/etc/passwd"}`;

    const event = parseChannelFrame("test-session", frame) as PermissionRequestEvent | null;

    expect(event).not.toBeNull();
    expect(event!.type).toBe("channel.permission_request");
    expect(event!.request.requestId).toBe("req-456");
  });

  test("handles multiline JSON data", () => {
    const frame = `data: {"type":"permission_request","request_id":"req-789","tool_name":"Edit","description":"Edit a file","input_preview":"// content"}`;

    const event = parseChannelFrame("test-session", frame) as PermissionRequestEvent | null;

    expect(event).not.toBeNull();
    expect(event!.type).toBe("channel.permission_request");
  });

  test("returns null for empty frame", () => {
    const event = parseChannelFrame("test-session", "");
    expect(event).toBeNull();
  });
});
