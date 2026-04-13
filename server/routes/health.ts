import type { SelfHeal } from "../self-heal";

let selfHeal: SelfHeal | null = null;
let shutdownFn: (() => Promise<void>) | null = null;

export function setSelfHeal(sh: SelfHeal): void {
  selfHeal = sh;
}

export function setShutdownFn(fn: () => Promise<void>): void {
  shutdownFn = fn;
}

export function healthRoute(_req: Request): Response {
  return Response.json({ ok: true, name: "codez", version: "0.1.0" });
}

export function healthDetailsRoute(_req: Request): Response {
  if (!selfHeal) {
    return Response.json({ error: "self-heal not initialized" }, { status: 503 });
  }
  return Response.json({
    log: selfHeal.getLog(),
    subsystems: selfHeal.getStatus(),
  });
}

export function restartRoute(req: Request): Response {
  if (req.method !== "POST") {
    return new Response("Method Not Allowed", { status: 405 });
  }

  const scriptPath = import.meta.dir + "/../index.ts";

  setTimeout(async () => {
    console.log("[opzero-claude] restart requested via API");
    Bun.spawn(["bun", "run", scriptPath], {
      stdio: ["ignore", "ignore", "ignore"],
      env: process.env,
    });
    if (shutdownFn) {
      await shutdownFn();
    } else {
      process.exit(0);
    }
  }, 200);

  return Response.json({ ok: true, restarting: true });
}
