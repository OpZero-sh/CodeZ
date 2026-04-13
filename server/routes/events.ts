import type { SSEEvent } from "../types";
import type { EventBus } from "../bus";

export function eventsRoute(_req: Request, bus: EventBus): Response {
  const encoder = new TextEncoder();
  let unsubscribe: (() => void) | null = null;
  let interval: ReturnType<typeof setInterval> | null = null;

  const stream = new ReadableStream({
    start(controller) {
      const send = (event: SSEEvent) => {
        try {
          controller.enqueue(encoder.encode(`data: ${JSON.stringify(event)}\n\n`));
        } catch {}
      };
      send({ type: "server.connected" } as SSEEvent);
      unsubscribe = bus.subscribe(send);

      interval = setInterval(() => {
        try {
          controller.enqueue(encoder.encode(": ping\n\n"));
        } catch {
          if (interval) clearInterval(interval);
        }
      }, 20000);
    },
    cancel() {
      unsubscribe?.();
      if (interval) clearInterval(interval);
    },
  });

  return new Response(stream, {
    headers: {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache, no-transform",
      "Connection": "keep-alive",
      "X-Accel-Buffering": "no",
    },
  });
}
