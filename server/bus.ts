import type { SSEEvent } from "./types";

type Subscriber = (event: SSEEvent) => void;

export class EventBus {
  private subs = new Set<Subscriber>();

  emit(event: SSEEvent): void {
    for (const sub of this.subs) {
      try {
        sub(event);
      } catch {}
    }
  }

  subscribe(fn: Subscriber): () => void {
    this.subs.add(fn);
    return () => {
      this.subs.delete(fn);
    };
  }

  get size(): number {
    return this.subs.size;
  }
}
