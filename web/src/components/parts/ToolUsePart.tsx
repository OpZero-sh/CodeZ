import {
  AlertTriangle,
  Bot,
  CheckSquare,
  Edit,
  FileCode,
  FileText,
  Globe,
  Monitor,
  Search,
  Terminal,
} from "lucide-react";
import type { ComponentType, ReactElement } from "react";
import type { ToolUsePart } from "@/lib/types";
import { cn } from "@/lib/utils";
import { BashToolView } from "./BashToolView";
import { ComputerUsePartView } from "./ComputerUsePartView";
import { EditToolView } from "./EditToolView";
import { JsonFallbackView } from "./JsonFallbackView";
import { ReadToolView } from "./ReadToolView";
import { SearchToolView } from "./SearchToolView";
import { TaskToolView } from "./TaskToolView";
import { TodoToolView } from "./TodoToolView";
import { WebToolView } from "./WebToolView";

type IconType = ComponentType<{ className?: string }>;

interface ToolMeta {
  Icon: IconType;
  View: (props: { part: ToolUsePart }) => ReactElement;
}

function resolveTool(tool: string): ToolMeta {
  switch (tool) {
    case "Bash":
      return { Icon: Terminal, View: BashToolView };
    case "Write":
    case "Edit":
    case "NotebookEdit":
      return { Icon: tool === "Write" ? FileCode : Edit, View: EditToolView };
    case "Read":
      return { Icon: FileText, View: ReadToolView };
    case "Grep":
    case "Glob":
      return { Icon: Search, View: SearchToolView };
    case "TodoWrite":
      return { Icon: CheckSquare, View: TodoToolView };
    case "Task":
    case "Agent":
      return { Icon: Bot, View: TaskToolView };
    case "WebFetch":
    case "WebSearch":
      return { Icon: Globe, View: WebToolView };
    case "computer":
    case "computer_20241022":
      return { Icon: Monitor, View: ComputerUsePartView };
    default:
      return { Icon: FileCode, View: JsonFallbackView };
  }
}

function StateIndicator({ state }: { state: ToolUsePart["state"] }) {
  if (state === "error") {
    return <AlertTriangle className="h-3.5 w-3.5 text-destructive" />;
  }
  if (state === "completed") {
    return (
      <span className="flex h-3.5 w-3.5 items-center justify-center rounded-full bg-[#00F5FF]/20 text-[9px] font-bold text-[#00F5FF]">
        ✓
      </span>
    );
  }
  return (
    <span className="relative flex h-3 w-3 items-center justify-center">
      <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-[#00F5FF]/60" />
      <span className="relative inline-flex h-2 w-2 rounded-full bg-[#00F5FF]" />
    </span>
  );
}

export function ToolUsePartView({ part }: { part: ToolUsePart }) {
  const { Icon, View } = resolveTool(part.tool);
  const borderClass =
    part.state === "error"
      ? "border-l-2 border-destructive"
      : part.state === "running"
        ? "border-l-2 border-accent animate-pulse"
        : "border-l-2 border-accent";

  return (
    <div
      className={cn(
        "card-glow my-2 rounded-lg border border-border bg-card p-4",
        borderClass,
      )}
    >
      <div className="mb-3 flex items-center gap-2">
        <Icon className="h-4 w-4 text-[#00F5FF]" />
        <span className="font-mono text-xs font-medium uppercase tracking-wide text-foreground">
          {part.tool}
        </span>
        <div className="ml-auto flex items-center gap-2">
          <StateIndicator state={part.state} />
        </div>
      </div>
      <View part={part} />
    </div>
  );
}
