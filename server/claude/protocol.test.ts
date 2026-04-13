import { describe, test, expect } from "bun:test";
import { parseLine, type SystemInitEvent } from "./protocol";

describe("protocol", () => {
  test("parses system.init event", () => {
    const line = `{"type":"system","subtype":"init","session_id":"sess-001","cwd":"/project","model":"claude-sonnet-4-20250514","tools":["Bash","Read"],"permissionMode":"normal"}`;
    const result = parseLine(line);
    expect(result).not.toBeNull();
    expect(result?.type).toBe("system");
    expect((result as SystemInitEvent | null)?.subtype).toBe("init");
    expect((result as { session_id: string }).session_id).toBe("sess-001");
    expect((result as { cwd: string }).cwd).toBe("/project");
    expect((result as { model: string }).model).toBe("claude-sonnet-4-20250514");
  });

  test("parses user event", () => {
    const line = `{"type":"user","message":{"role":"user","content":"Hello"},"session_id":"sess-001"}`;
    const result = parseLine(line);
    expect(result).not.toBeNull();
    expect(result?.type).toBe("user");
    const userResult = result as { message: { role: string; content: string } };
    expect(userResult.message.role).toBe("user");
    expect(userResult.message.content).toBe("Hello");
  });

  test("parses assistant event", () => {
    const line = `{"type":"assistant","message":{"id":"msg-001","role":"assistant","model":"claude-3-5","content":[{"type":"text","text":"Hi there!"}]},"session_id":"sess-001"}`;
    const result = parseLine(line);
    expect(result).not.toBeNull();
    expect(result?.type).toBe("assistant");
    const asst = result as { message: { id: string; content: Array<{ type: string; text: string }> } };
    expect(asst.message.id).toBe("msg-001");
    expect(asst.message.content[0].type).toBe("text");
    expect(asst.message.content[0].text).toBe("Hi there!");
  });

  test("parses stream content_block_start", () => {
    const line = `{"type":"stream_event","event":{"type":"content_block_start","index":0,"content_block":{"type":"text","text":""}},"session_id":"sess-001"}`;
    const result = parseLine(line);
    expect(result).not.toBeNull();
    expect(result?.type).toBe("stream_event");
    const env = result as { event: { type: string; index: number } };
    expect(env.event.type).toBe("content_block_start");
    expect(env.event.index).toBe(0);
  });

  test("parses stream content_block_delta with text_delta", () => {
    const line = `{"type":"stream_event","event":{"type":"content_block_delta","index":0,"delta":{"type":"text_delta","text":"Hello world"}},"session_id":"sess-001"}`;
    const result = parseLine(line);
    expect(result).not.toBeNull();
    const env = result as { event: { type: string; delta: { type: string; text: string } } };
    expect(env.event.type).toBe("content_block_delta");
    expect(env.event.delta.type).toBe("text_delta");
    expect(env.event.delta.text).toBe("Hello world");
  });

  test("parses stream content_block_stop", () => {
    const line = `{"type":"stream_event","event":{"type":"content_block_stop","index":0},"session_id":"sess-001"}`;
    const result = parseLine(line);
    expect(result).not.toBeNull();
    const env = result as { event: { type: string } };
    expect(env.event.type).toBe("content_block_stop");
  });

  test("parses result event", () => {
    const line = `{"type":"result","subtype":"success","is_error":false,"duration_ms":1000,"num_turns":1,"result":"Done","session_id":"sess-001"}`;
    const result = parseLine(line);
    expect(result).not.toBeNull();
    expect(result?.type).toBe("result");
    const res = result as { subtype: string; is_error: boolean; duration_ms: number };
    expect(res.subtype).toBe("success");
    expect(res.is_error).toBe(false);
    expect(res.duration_ms).toBe(1000);
  });

  test("returns null for empty line", () => {
    const result = parseLine("");
    expect(result).toBeNull();
  });

  test("returns null for invalid JSON", () => {
    const result = parseLine("not valid json");
    expect(result).toBeNull();
  });

  test("reads from fixture file and parses multiple lines", async () => {
    const file = Bun.file("test/fixtures/stream-json/system-init.json");
    const text = await file.text();
    const lines = text.split("\n").filter((l) => l.length > 0);
    
    expect(lines.length).toBeGreaterThan(0);
    
    const init = parseLine(lines[0]);
    expect(init?.type).toBe("system");
    expect((init as SystemInitEvent | null)?.subtype).toBe("init");
    
    const user = parseLine(lines[1]);
    expect(user?.type).toBe("user");
    
    const assistant = parseLine(lines[2]);
    expect(assistant?.type).toBe("assistant");
    
    const result = parseLine(lines[lines.length - 1]);
    expect(result?.type).toBe("result");
  });
});