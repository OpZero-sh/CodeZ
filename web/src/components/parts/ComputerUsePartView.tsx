import { useCallback, useRef, useState } from "react";
import {
  AlertTriangle,
  CheckCircle2,
  Loader2,
  Monitor,
} from "lucide-react";
import type { ToolUsePart } from "@/lib/types";
import { cn } from "@/lib/utils";
import { Badge } from "@/components/ui/badge";
import {
  Dialog,
  DialogContent,
  DialogTitle,
} from "@/components/ui/dialog";

type Action =
  | "screenshot"
  | "click"
  | "double_click"
  | "type"
  | "key"
  | "scroll"
  | "move"
  | "drag";

interface ComputerInput {
  action: Action;
  coordinate?: [number, number];
  text?: string;
  scroll_direction?: "up" | "down" | "left" | "right";
  scroll_amount?: number;
  start_coordinate?: [number, number];
}

function extractScreenshot(result: unknown): string | null {
  if (Array.isArray(result)) {
    for (const item of result) {
      if (item?.type === "image" && item?.source?.type === "base64") {
        return `data:${item.source.media_type};base64,${item.source.data}`;
      }
    }
  }
  if (typeof result === "string" && result.startsWith("data:image")) {
    return result;
  }
  return null;
}

function describeAction(input: ComputerInput): string {
  const { action, coordinate, text, scroll_direction, start_coordinate } =
    input;
  switch (action) {
    case "screenshot":
      return "Capturing screen";
    case "click":
      return coordinate
        ? `Click at (${coordinate[0]}, ${coordinate[1]})`
        : "Click";
    case "double_click":
      return coordinate
        ? `Double-click at (${coordinate[0]}, ${coordinate[1]})`
        : "Double-click";
    case "type":
      if (!text) return "Typing";
      return `Typing: ${text.length > 60 ? text.slice(0, 60) + "..." : text}`;
    case "key":
      return text ? `Key: ${text}` : "Key press";
    case "scroll":
      return scroll_direction ? `Scroll ${scroll_direction}` : "Scroll";
    case "move":
      return coordinate
        ? `Move to (${coordinate[0]}, ${coordinate[1]})`
        : "Move";
    case "drag":
      if (start_coordinate && coordinate) {
        return `Drag from (${start_coordinate[0]},${start_coordinate[1]}) to (${coordinate[0]},${coordinate[1]})`;
      }
      return "Drag";
    default:
      return String(action);
  }
}

function StatusPill({ state }: { state: ToolUsePart["state"] }) {
  if (state === "running") {
    return (
      <div className="flex items-center gap-1.5 rounded-full border border-[#00F5FF]/40 bg-[#00F5FF]/10 px-2 py-0.5 text-[10px] font-mono uppercase tracking-wide text-[#00F5FF]">
        <Loader2 className="h-3 w-3 animate-spin" />
        <span>running</span>
      </div>
    );
  }
  if (state === "error") {
    return (
      <div className="flex items-center gap-1.5 rounded-full border border-destructive/40 bg-destructive/10 px-2 py-0.5 text-[10px] font-mono uppercase tracking-wide text-destructive">
        <AlertTriangle className="h-3 w-3" />
        <span>failed</span>
      </div>
    );
  }
  return (
    <div className="flex items-center gap-1.5 rounded-full border border-[#00F5FF]/40 bg-[#00F5FF]/10 px-2 py-0.5 text-[10px] font-mono uppercase tracking-wide text-[#00F5FF]">
      <CheckCircle2 className="h-3 w-3" />
      <span>done</span>
    </div>
  );
}

function ClickOverlay({
  coordinate,
  imgEl,
}: {
  coordinate: [number, number];
  imgEl: HTMLImageElement | null;
}) {
  if (!imgEl || !coordinate) return null;
  const naturalW = imgEl.naturalWidth;
  const naturalH = imgEl.naturalHeight;
  if (!naturalW || !naturalH) return null;
  const pctX = (coordinate[0] / naturalW) * 100;
  const pctY = (coordinate[1] / naturalH) * 100;
  return (
    <span
      className="pointer-events-none absolute h-4 w-4 -translate-x-1/2 -translate-y-1/2"
      style={{ left: `${pctX}%`, top: `${pctY}%` }}
    >
      <span className="absolute inset-0 animate-ping rounded-full bg-[#00F5FF]/60" />
      <span className="absolute inset-[3px] rounded-full bg-[#00F5FF] shadow-[0_0_8px_rgba(0,245,255,0.9)]" />
    </span>
  );
}

function TypeOverlay({
  coordinate,
  text,
  imgEl,
}: {
  coordinate: [number, number];
  text: string;
  imgEl: HTMLImageElement | null;
}) {
  if (!imgEl || !coordinate || !text) return null;
  const naturalW = imgEl.naturalWidth;
  const naturalH = imgEl.naturalHeight;
  if (!naturalW || !naturalH) return null;
  const pctX = (coordinate[0] / naturalW) * 100;
  const pctY = (coordinate[1] / naturalH) * 100;
  const display = text.length > 40 ? text.slice(0, 40) + "..." : text;
  return (
    <span
      className="pointer-events-none absolute max-w-[60%] -translate-x-1/2 rounded bg-[#00F5FF]/90 px-1.5 py-0.5 font-mono text-[10px] text-black shadow-lg"
      style={{ left: `${pctX}%`, top: `calc(${pctY}% - 1.5rem)` }}
    >
      {display}
    </span>
  );
}

function ScreenshotViewer({
  src,
  input,
}: {
  src: string;
  input: ComputerInput;
}) {
  const [fullscreen, setFullscreen] = useState(false);
  const [loaded, setLoaded] = useState(false);
  const imgRef = useRef<HTMLImageElement | null>(null);

  const handleLoad = useCallback(() => setLoaded(true), []);

  const showClickDot =
    loaded &&
    (input.action === "click" || input.action === "double_click") &&
    input.coordinate;

  const showTypeLabel =
    loaded && input.action === "type" && input.coordinate && input.text;

  return (
    <>
      <button
        type="button"
        onClick={() => setFullscreen(true)}
        className="relative mt-3 block w-full overflow-hidden rounded-md border border-border/40 focus:outline-none focus:ring-2 focus:ring-[#00F5FF]/40"
      >
        <img
          ref={imgRef}
          src={src}
          alt="Screenshot"
          onLoad={handleLoad}
          className="h-auto w-full object-contain"
          draggable={false}
        />
        {showClickDot ? (
          <ClickOverlay
            coordinate={input.coordinate!}
            imgEl={imgRef.current}
          />
        ) : null}
        {showTypeLabel ? (
          <TypeOverlay
            coordinate={input.coordinate!}
            text={input.text!}
            imgEl={imgRef.current}
          />
        ) : null}
      </button>

      <Dialog open={fullscreen} onOpenChange={setFullscreen}>
        <DialogContent className="max-h-[90vh] max-w-[95vw] overflow-auto border-border bg-background p-2">
          <DialogTitle className="sr-only">Screenshot full view</DialogTitle>
          <img
            src={src}
            alt="Screenshot full view"
            className="h-auto w-full object-contain"
          />
        </DialogContent>
      </Dialog>
    </>
  );
}

export function ComputerUsePartView({ part }: { part: ToolUsePart }) {
  const input = (part.input ?? {}) as ComputerInput;
  const action = input.action ?? "screenshot";
  const running = part.state === "running";

  const screenshot =
    extractScreenshot(part.result) ?? extractScreenshot(part.resultText);

  const hasTextResult =
    !screenshot &&
    part.resultText &&
    typeof part.resultText === "string" &&
    part.resultText.length > 0;

  return (
    <div>
      <div className="mb-2 flex flex-wrap items-center gap-2">
        <Monitor
          className={cn(
            "h-4 w-4 text-[#00F5FF]",
            running && "animate-pulse",
          )}
        />
        <span className="font-mono text-xs font-medium uppercase tracking-wide text-foreground">
          Computer Use
        </span>
        <Badge
          variant="outline"
          className="border-[#00F5FF]/40 bg-[#00F5FF]/10 px-2 py-0 font-mono text-[10px] uppercase tracking-wide text-[#00F5FF]"
        >
          {action.replace("_", " ")}
        </Badge>
        <div className="ml-auto">
          <StatusPill state={part.state} />
        </div>
      </div>

      <p className="mb-2 text-sm text-muted-foreground">
        {describeAction(input)}
      </p>

      {running && !screenshot ? (
        <div className="flex items-center gap-2 rounded-md border border-border/40 bg-background/40 px-4 py-6">
          <Monitor className="h-5 w-5 animate-pulse text-[#00F5FF]/60" />
          <span className="font-mono text-xs text-muted-foreground">
            Capturing...
          </span>
        </div>
      ) : null}

      {screenshot ? (
        <ScreenshotViewer src={screenshot} input={input} />
      ) : null}

      {hasTextResult ? (
        <pre className="mt-2 max-h-48 overflow-auto whitespace-pre-wrap break-words rounded-md border border-border/40 bg-background/40 p-3 font-mono text-xs text-muted-foreground">
          {part.resultText}
        </pre>
      ) : null}

      {part.state === "error" && part.resultText ? (
        <div className="mt-2 rounded-md border border-destructive/40 bg-destructive/10 p-3">
          <div className="mb-1 flex items-center gap-1.5">
            <AlertTriangle className="h-3 w-3 text-destructive" />
            <span className="font-mono text-[10px] uppercase tracking-wide text-destructive">
              Error
            </span>
          </div>
          <pre className="whitespace-pre-wrap break-words font-mono text-xs text-destructive/90">
            {part.resultText}
          </pre>
        </div>
      ) : null}
    </div>
  );
}

export default ComputerUsePartView;
