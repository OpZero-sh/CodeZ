import { createElement, type ReactNode } from "react";
import type { Part } from "@/lib/types";
import { TextPartView } from "./TextPart";
import { ThinkingPartView } from "./ThinkingPart";
import { ToolUsePartView } from "./ToolUsePart";
import { SystemPartView } from "./SystemPartView";
import { ResultPartView } from "./ResultPartView";

export { TextPartView } from "./TextPart";
export { ThinkingPartView } from "./ThinkingPart";
export { ToolUsePartView } from "./ToolUsePart";
export { SystemPartView } from "./SystemPartView";
export { ResultPartView } from "./ResultPartView";
export { BashToolView } from "./BashToolView";
export { EditToolView } from "./EditToolView";
export { ReadToolView } from "./ReadToolView";
export { SearchToolView } from "./SearchToolView";
export { TodoToolView } from "./TodoToolView";
export { TaskToolView } from "./TaskToolView";
export { WebToolView } from "./WebToolView";
export { JsonFallbackView } from "./JsonFallbackView";

export interface PartRenderContext {}

export function renderPart(part: Part, _ctx?: PartRenderContext): ReactNode {
  switch (part.type) {
    case "text":
      return createElement(TextPartView, { part, key: part.id });
    case "thinking":
      return createElement(ThinkingPartView, { part, key: part.id });
    case "tool_use":
      return createElement(ToolUsePartView, { part, key: part.id });
    case "tool_result":
      return null;
    case "system":
      return createElement(SystemPartView, { part, key: part.id });
    case "result":
      return createElement(ResultPartView, { part, key: part.id });
    default:
      return null;
  }
}
