import { CheckSquare, Loader2, Square } from "lucide-react";
import type { ToolUsePart } from "@/lib/types";
import { cn } from "@/lib/utils";

interface TodoItem {
  content: string;
  activeForm?: string;
  status: "pending" | "in_progress" | "completed";
}

export function TodoToolView({ part }: { part: ToolUsePart }) {
  const todos: TodoItem[] = Array.isArray(part.input?.todos) ? part.input.todos : [];

  if (todos.length === 0) {
    return (
      <div className="text-xs italic text-muted-foreground opacity-70">(no todos)</div>
    );
  }

  return (
    <ul className="space-y-1.5">
      {todos.map((t, i) => {
        const label = t.status === "in_progress" ? t.activeForm ?? t.content : t.content;
        return (
          <li
            key={i}
            className={cn(
              "flex items-start gap-2 text-sm",
              t.status === "completed" && "text-[#00F5FF] line-through opacity-70",
              t.status === "in_progress" && "text-[#00F5FF]",
              t.status === "pending" && "text-muted-foreground",
            )}
          >
            {t.status === "completed" ? (
              <CheckSquare className="mt-0.5 h-4 w-4 shrink-0 fill-[#00F5FF]/20 text-[#00F5FF]" />
            ) : t.status === "in_progress" ? (
              <span className="mt-0.5 flex h-4 w-4 shrink-0 items-center justify-center">
                <span className="h-2.5 w-2.5 rounded-full bg-[#00F5FF]" />
              </span>
            ) : (
              <Square className="mt-0.5 h-4 w-4 shrink-0 text-muted-foreground" />
            )}
            <span className="flex-1 whitespace-pre-wrap break-words">{label}</span>
            {t.status === "in_progress" ? (
              <Loader2 className="mt-0.5 h-3.5 w-3.5 shrink-0 animate-spin text-[#00F5FF]" />
            ) : null}
          </li>
        );
      })}
    </ul>
  );
}
