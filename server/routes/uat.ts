import { join } from "path";
import { existsSync } from "fs";
import { Config } from "../config";

export interface UatStep {
  action: "navigate" | "click" | "fill" | "wait" | "snapshot" | "screenshot";
  selector?: string;
  value?: string;
}

interface UatRunRequest {
  url: string;
  steps: UatStep[];
}

type UatEvent =
  | { type: "step.started"; stepIndex: number; action: string }
  | { type: "step.passed"; stepIndex: number }
  | { type: "step.failed"; stepIndex: number; error: string }
  | { type: "complete"; passed: number; failed: number };

function buildJsCommand(step: UatStep, stepIndex: number): string {
  const { action, selector, value } = step;
  switch (action) {
    case "navigate":
      return `await go("${value}");`;
    case "click":
      return `await click("${selector}");`;
    case "fill":
      return `await fill("${selector}", "${value}");`;
    case "wait":
      return `await wait(${value || "3000"});`;
    case "snapshot":
      return `await snapshot("step-${stepIndex}");`;
    case "screenshot":
      return `await screenshot("step-${stepIndex}");`;
    default:
      return `// unknown action: ${action}`;
  }
}

function parseUatEvent(line: string): UatEvent | null {
  try {
    const data = JSON.parse(line);
    if (data.type === "step-start") {
      return { type: "step.started", stepIndex: data.index, action: data.action };
    }
    if (data.type === "step-pass") {
      return { type: "step.passed", stepIndex: data.index };
    }
    if (data.type === "step-fail") {
      return { type: "step.failed", stepIndex: data.index, error: data.error || "failed" };
    }
    if (data.type === "complete") {
      return { type: "complete", passed: data.passed, failed: data.failed };
    }
    return null;
  } catch {
    return null;
  }
}

function isAgentBrowserInstalled(): boolean {
  try {
    const result = Bun.spawnSync(["which", "agent-browser"]);
    return result.exitCode === 0;
  } catch {
    return false;
  }
}

function getScreenshotsDir(): string {
  const home = process.env.HOME || process.env.USERPROFILE || "";
  return join(home, ".config", "opzero-claude", "uat-screenshots");
}

export async function uatRunRoute(
  req: Request,
  _config: Config,
): Promise<Response> {
  if (!isAgentBrowserInstalled()) {
    return Response.json(
      { error: "agent-browser not found on PATH" },
      { status: 500 },
    );
  }

  let body: UatRunRequest;
  try {
    body = (await req.json()) as UatRunRequest;
  } catch {
    return Response.json({ error: "invalid JSON" }, { status: 400 });
  }

  const { url, steps } = body;
  if (!url || !Array.isArray(steps) || steps.length === 0) {
    return Response.json(
      { error: "url and steps are required" },
      { status: 400 },
    );
  }

  const initJs = `require('turnbet').init({ url: "${url}" });`;
  const stepCommands = steps.map((s, i) => buildJsCommand(s, i)).join("\n");
  const jsCode = initJs + "\n" + stepCommands + "\n" + `console.log(JSON.stringify({ type: "complete", passed: ${steps.length}, failed: 0 }));`;

  const encoder = new TextEncoder();
  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      const proc = Bun.spawn(["agent-browser", "--headless", "--script", "-"], {
        stdout: "pipe",
        stderr: "pipe",
        stdin: "pipe",
      });

      proc.stdin?.write(jsCode);
      proc.stdin?.end();

      let passed = 0;
      let failed = 0;

      const reader = proc.stdout?.getReader();
      if (reader) {
        const readLoop = async () => {
          try {
            while (true) {
              const { done, value } = await reader.read();
              if (done) break;
              const chunk = new TextDecoder().decode(value);
              const lines = chunk.split("\n").filter(Boolean);
              for (const rawLine of lines) {
                const evt = parseUatEvent(rawLine.trim());
                if (!evt) continue;
                if (evt.type === "step.started") {
                  const stepJs = JSON.stringify(evt);
                  controller.enqueue(encoder.encode(`data: ${stepJs}\n\n`));
                } else if (evt.type === "step.passed") {
                  passed++;
                  const stepJs = JSON.stringify(evt);
                  controller.enqueue(encoder.encode(`data: ${stepJs}\n\n`));
                } else if (evt.type === "step.failed") {
                  failed++;
                  const stepJs = JSON.stringify(evt);
                  controller.enqueue(encoder.encode(`data: ${stepJs}\n\n`));
                }
              }
            }
            const completeEvt = { type: "complete", passed, failed };
            controller.enqueue(encoder.encode(`data: ${JSON.stringify(completeEvt)}\n\n`));
          } catch (err) {
            const errorEvt = {
              type: "step.failed",
              stepIndex: 0,
              error: String(err),
            };
            controller.enqueue(encoder.encode(`data: ${JSON.stringify(errorEvt)}\n\n`));
          } finally {
            controller.close();
          }
        };
        readLoop();
      }
    },
  });

  return new Response(stream, {
    headers: {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache",
      "Connection": "keep-alive",
    },
  });
}

export async function uatScreenshotsRoute(): Promise<Response> {
  const dir = getScreenshotsDir();
  if (!existsSync(dir)) {
    return new Response("No screenshots yet", { status: 404 });
  }
  return new Response(dir);
}