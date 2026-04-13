import { describe, test, expect, beforeEach } from "bun:test";
import { loadSessionMessages } from "./history";
import { claudeProjectsRoot } from "./paths";
import { mkdir, rm } from "fs/promises";
import { join } from "path";

describe("history", () => {
  const testProjectDir = join(claudeProjectsRoot(), "-test-project-history");

  beforeEach(async () => {
    await mkdir(testProjectDir, { recursive: true });
  });

  test("loads simple user/assistant turn from fixture", async () => {
    const sessionId = "jsonl-test-001";
    const fixturePath = join(testProjectDir, `${sessionId}.jsonl`);
    
    await Bun.write(fixturePath, `{"type":"user","message":{"role":"user","content":"What is 2+2?"},"session_id":"jsonl-test-001","timestamp":"2025-06-15T10:00:00.000Z","cwd":"/tmp/test","version":"1.0.0"}
{"type":"assistant","message":{"id":"msg-assist-001","role":"assistant","model":"claude-sonnet-4-20250514","content":[{"type":"text","text":"2 + 2 equals 4."}]},"session_id":"jsonl-test-001","timestamp":"2025-06-15T10:00:01.000Z"}
{"type":"result","subtype":"success","is_error":false,"duration_ms":500,"num_turns":1,"result":"Answered: 2+2=4","session_id":"jsonl-test-001"}`);

    const messages = await loadSessionMessages("-test-project-history", sessionId);

    expect(messages.length).toBe(2);
    expect(messages[0].role).toBe("user");
    expect(messages[0].parts[0].type).toBe("text");
    expect((messages[0].parts[0] as { text: string }).text).toBe("What is 2+2?");
    
    expect(messages[1].role).toBe("assistant");
    expect(messages[1].parts[0].type).toBe("text");
    expect((messages[1].parts[0] as { text: string }).text).toBe("2 + 2 equals 4.");
    expect(messages[1].model).toBe("claude-sonnet-4-20250514");

    await rm(fixturePath).catch(() => {});
  });

  test("loads tool use cycle from fixture", async () => {
    const sessionId = "jsonl-test-002";
    const fixturePath = join(testProjectDir, `${sessionId}.jsonl`);
    
    await Bun.write(fixturePath, `{"type":"user","message":{"role":"user","content":"List files in /tmp"},"session_id":"jsonl-test-002","timestamp":"2025-06-15T11:00:00.000Z","cwd":"/tmp","version":"1.0.0"}
{"type":"assistant","message":{"id":"msg-assist-002","role":"assistant","model":"claude-sonnet-4-20250514","content":[{"type":"tool_use","id":"tool-001","name":"Bash","input":{"command":"ls /tmp"}}]},"session_id":"jsonl-test-002","timestamp":"2025-06-15T11:00:01.000Z"}
{"type":"user","message":{"role":"user","content":[{"type":"tool_result","tool_use_id":"tool-001","content":"file1.txt\\nfile2.txt"}]},"session_id":"jsonl-test-002","timestamp":"2025-06-15T11:00:02.000Z"}
{"type":"assistant","message":{"id":"msg-assist-003","role":"assistant","model":"claude-sonnet-4-20250514","content":[{"type":"text","text":"Found 2 files: file1.txt and file2.txt"}]},"session_id":"jsonl-test-002","timestamp":"2025-06-15T11:00:03.000Z"}
{"type":"result","subtype":"success","is_error":false,"duration_ms":1200,"num_turns":2,"result":"Listed files","session_id":"jsonl-test-002"}`);

    const messages = await loadSessionMessages("-test-project-history", sessionId);

    expect(messages.length).toBe(2);
    expect(messages[0].role).toBe("user");
    expect(messages[1].role).toBe("assistant");
    expect(messages[1].parts[0].type).toBe("tool_use");
    const toolPart = messages[1].parts[0] as { tool: string; input: unknown; state: string };
    expect(toolPart.tool).toBe("Bash");
    expect(toolPart.input).toEqual({ command: "ls /tmp" });
    expect(toolPart.state).toBe("completed");
    expect(messages[1].parts[1].type).toBe("text");
    expect((messages[1].parts[1] as { text: string }).text).toBe("Found 2 files: file1.txt and file2.txt");

    await rm(fixturePath).catch(() => {});
  });

  test("returns empty array for non-existent session", async () => {
    const messages = await loadSessionMessages("-test-project-history", "nonexistent-session");
    expect(messages).toEqual([]);
  });

  test("returns empty array for invalid project slug", async () => {
    const messages = await loadSessionMessages("not-a-valid-slug", "any-session");
    expect(messages).toEqual([]);
  });
});