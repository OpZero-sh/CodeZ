import type { Message, Part, SSEEvent, TextPart, ThinkingPart } from "./types";

export function findPart(
  messages: Message[],
  partId: string,
): { msg: Message; part: Part } | null {
  for (const msg of messages) {
    for (const part of msg.parts) {
      if (part.id === partId) return { msg, part };
    }
  }
  return null;
}

export function applyDelta(
  messages: Message[],
  e: Extract<SSEEvent, { type: "message.part.delta" }>,
): Message[] {
  return messages.map((msg) => {
    if (msg.id !== e.messageId) return msg;
    const parts = msg.parts.map((part) => {
      if (part.id !== e.partId) return part;
      if (part.type === "text") {
        const next: TextPart = { ...part, text: (part.text ?? "") + e.delta };
        return next;
      }
      if (part.type === "thinking") {
        const next: ThinkingPart = {
          ...part,
          text: (part.text ?? "") + e.delta,
        };
        return next;
      }
      return part;
    });
    return { ...msg, parts };
  });
}

export function applyPartUpdate(
  messages: Message[],
  e: Extract<SSEEvent, { type: "message.part.updated" }>,
): Message[] {
  let touched = false;
  const next = messages.map((msg) => {
    if (msg.id !== e.messageId) return msg;
    let found = false;
    const parts = msg.parts.map((part) => {
      if (part.id !== e.part.id) return part;
      found = true;
      return e.part;
    });
    if (!found) {
      parts.push(e.part);
    }
    touched = true;
    return { ...msg, parts };
  });
  if (!touched) return messages;
  return next;
}

export function applyMessageCreated(
  messages: Message[],
  e: Extract<SSEEvent, { type: "message.created" }>,
): Message[] {
  if (messages.some((m) => m.id === e.message.id)) {
    return messages.map((m) => (m.id === e.message.id ? e.message : m));
  }
  return [...messages, e.message];
}
