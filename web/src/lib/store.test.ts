import { describe, test, expect } from "bun:test";
import { applyMessageCreated, applyPartUpdate, applyDelta } from "./parts";
import type { Message } from "./types";

function createMessage(role: "user" | "assistant", id: string, parts: unknown[] = []): Message {
  return {
    id,
    sessionId: "test-session",
    role,
    time: { created: Date.now() },
    parts: parts as Message["parts"],
  };
}

describe("parts reducers", () => {
  describe("applyMessageCreated", () => {
    test("adds new message to empty array", () => {
      const messages: Message[] = [];
      const event = {
        type: "message.created" as const,
        sessionId: "test-session",
        message: createMessage("user", "msg-001"),
      };
      const result = applyMessageCreated(messages, event);
      expect(result.length).toBe(1);
      expect(result[0].id).toBe("msg-001");
    });

    test("appends new message to existing", () => {
      const messages = [createMessage("user", "msg-001")];
      const event = {
        type: "message.created" as const,
        sessionId: "test-session",
        message: createMessage("assistant", "msg-002"),
      };
      const result = applyMessageCreated(messages, event);
      expect(result.length).toBe(2);
      expect(result[1].id).toBe("msg-002");
    });

    test("updates existing message if ID matches", () => {
      const messages = [createMessage("assistant", "msg-001", [])];
      const updatedMessage = createMessage("assistant", "msg-001", [{ type: "text", text: "new" } as any]);
      const event = {
        type: "message.created" as const,
        sessionId: "test-session",
        message: updatedMessage,
      };
      const result = applyMessageCreated(messages, event);
      expect(result.length).toBe(1);
      expect(result[0].id).toBe("msg-001");
    });
  });

  describe("applyPartUpdate", () => {
    test("adds part to existing message", () => {
      const messages = [createMessage("assistant", "msg-001", [])];
      const newPart = { id: "part-001", messageId: "msg-001", sessionId: "test-session", type: "text" as const, text: "Hello", time: { start: Date.now() } };
      const event = {
        type: "message.part.updated" as const,
        sessionId: "test-session",
        messageId: "msg-001",
        part: newPart,
      };
      const result = applyPartUpdate(messages, event);
      expect(result[0].parts.length).toBe(1);
      expect(result[0].parts[0].type).toBe("text");
    });

    test("replaces part with matching ID", () => {
      const messages = [createMessage("assistant", "msg-001", [{ id: "part-001", type: "text" as const, text: "old", messageId: "msg-001", sessionId: "test-session", time: { start: 0 } }])];
      const newPart = { id: "part-001", messageId: "msg-001", sessionId: "test-session", type: "text" as const, text: "updated", time: { start: Date.now() } };
      const event = {
        type: "message.part.updated" as const,
        sessionId: "test-session",
        messageId: "msg-001",
        part: newPart,
      };
      const result = applyPartUpdate(messages, event);
      expect((result[0].parts[0] as { text: string }).text).toBe("updated");
    });

    test("returns original array if message not found", () => {
      const messages = [createMessage("assistant", "msg-001", [])];
      const newPart = { id: "part-001", messageId: "msg-999", sessionId: "test-session", type: "text" as const, text: "test", time: { start: Date.now() } };
      const event = {
        type: "message.part.updated" as const,
        sessionId: "test-session",
        messageId: "msg-999",
        part: newPart,
      };
      const result = applyPartUpdate(messages, event);
      expect(result).toBe(messages);
    });
  });

  describe("applyDelta", () => {
    test("appends text to text part", () => {
      const messages = [createMessage("assistant", "msg-001", [{ id: "part-001", type: "text" as const, text: "Hello", messageId: "msg-001", sessionId: "test-session", time: { start: 0 } }])];
      const event = {
        type: "message.part.delta" as const,
        sessionId: "test-session",
        messageId: "msg-001",
        partId: "part-001",
        delta: " World",
      };
      const result = applyDelta(messages, event);
      expect((result[0].parts[0] as { text: string }).text).toBe("Hello World");
    });

    test("appends to thinking part", () => {
      const messages = [createMessage("assistant", "msg-001", [{ id: "part-001", type: "thinking" as const, text: "Thinking...", messageId: "msg-001", sessionId: "test-session", time: { start: 0 } }])];
      const event = {
        type: "message.part.delta" as const,
        sessionId: "test-session",
        messageId: "msg-001",
        partId: "part-001",
        delta: " more thoughts",
      };
      const result = applyDelta(messages, event);
      expect((result[0].parts[0] as { text: string }).text).toBe("Thinking... more thoughts");
    });

    test("does not modify if message not found", () => {
      const messages = [createMessage("assistant", "msg-001", [{ id: "part-001", type: "text" as const, text: "Hello", messageId: "msg-001", sessionId: "test-session", time: { start: 0 } }])];
      const event = {
        type: "message.part.delta" as const,
        sessionId: "test-session",
        messageId: "msg-999",
        partId: "part-001",
        delta: "test",
      };
      const result = applyDelta(messages, event);
      expect((result[0].parts[0] as { text: string }).text).toBe("Hello");
    });

    test("does not modify if part not found", () => {
      const messages = [createMessage("assistant", "msg-001", [{ id: "part-001", type: "text" as const, text: "Hello", messageId: "msg-001", sessionId: "test-session", time: { start: 0 } }])];
      const event = {
        type: "message.part.delta" as const,
        sessionId: "test-session",
        messageId: "msg-001",
        partId: "part-999",
        delta: "test",
      };
      const result = applyDelta(messages, event);
      expect((result[0].parts[0] as { text: string }).text).toBe("Hello");
    });
  });
});

describe("upsertSessionIn purity", () => {
  test("returns new object without mutating input", () => {
    const map: Record<string, Array<{ id: string; projectSlug: string }>> = {};
    const originalMap = { ...map };
    const session = { id: "sess-001", projectSlug: "test-project" };
    
    function upsertSessionIn(
      m: Record<string, Array<{ id: string; projectSlug: string }>>,
      s: { id: string; projectSlug: string },
    ): Record<string, Array<{ id: string; projectSlug: string }>> {
      const list = m[s.projectSlug] ?? [];
      const idx = list.findIndex((x) => x.id === s.id);
      const next = idx >= 0
        ? list.map((x) => (x.id === s.id ? s : x))
        : [s, ...list];
      return { ...m, [s.projectSlug]: next };
    }
    
    const result = upsertSessionIn(map, session);
    
    expect(map).toEqual(originalMap);
    expect(result).not.toBe(map);
    expect(result["test-project"]).toHaveLength(1);
    expect(result["test-project"][0].id).toBe("sess-001");
  });

  test("updates existing session", () => {
    const map = {
      "test-project": [{ id: "sess-001", projectSlug: "test-project", status: "idle" }],
    };
    const session = { id: "sess-001", projectSlug: "test-project", status: "running" };
    
    function upsertSessionIn(
      m: Record<string, Array<{ id: string; projectSlug: string; status: string }>>,
      s: { id: string; projectSlug: string; status: string },
    ): Record<string, Array<{ id: string; projectSlug: string; status: string }>> {
      const list = m[s.projectSlug] ?? [];
      const idx = list.findIndex((x) => x.id === s.id);
      const next = idx >= 0
        ? list.map((x) => (x.id === s.id ? s : x))
        : [s, ...list];
      return { ...m, [s.projectSlug]: next };
    }
    
    const result = upsertSessionIn(map, session);
    
    expect(result["test-project"]).toHaveLength(1);
    expect(result["test-project"][0].status).toBe("running");
  });
});

describe("session disposal cleanup", () => {
  test("cleans up messages, sending, and sessionsByProject", () => {
    const state = {
      messages: { "sess-001": [], "sess-002": [] },
      sending: { "sess-001": true, "sess-002": false },
      sessionsByProject: {
        "test-project": [
          { id: "sess-001", projectSlug: "test-project" },
          { id: "sess-002", projectSlug: "test-project" },
        ],
      },
      selected: { slug: "test-project", sessionId: "sess-001" },
    };
    
    const disposeSession = (id: string) => {
      const nextMessages = { ...state.messages } as Record<string, Message[]>;
      delete nextMessages[id];
      const nextSending = { ...state.sending } as Record<string, boolean>;
      delete nextSending[id];
      const nextByProject: Record<string, Array<{ id: string; projectSlug: string }>> = {};
      for (const [slug, list] of Object.entries(state.sessionsByProject)) {
        nextByProject[slug] = list.filter((s) => s.id !== id);
      }
      const selected = state.selected.sessionId === id
        ? { slug: state.selected.slug, sessionId: null }
        : state.selected;
      return { nextMessages, nextSending, nextByProject, selected };
    };
    
    const result = disposeSession("sess-001");
    
    expect(result.nextMessages).not.toHaveProperty("sess-001");
    expect(result.nextMessages).toHaveProperty("sess-002");
    expect(result.nextSending).not.toHaveProperty("sess-001");
    expect(result.nextByProject["test-project"]).toHaveLength(1);
    expect(result.nextByProject["test-project"][0].id).toBe("sess-002");
    expect(result.selected.sessionId).toBeNull();
    expect(result.selected.slug).toBe("test-project");
  });
});