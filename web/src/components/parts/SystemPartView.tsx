import type { SystemPart } from "@/lib/types";

export function SystemPartView({ part }: { part: SystemPart }) {
  if (part.subtype !== "init") return null;
  const data = part.data ?? {};
  const model: string | undefined = data.model;
  const tools: unknown = data.tools;
  const toolCount = Array.isArray(tools) ? tools.length : undefined;
  const bits: string[] = ["Session started"];
  if (model) bits.push(`model: ${model}`);
  if (toolCount != null) bits.push(`tools: ${toolCount}`);

  return (
    <div className="my-2 text-[11px] text-muted-foreground">
      {bits.join(" • ")}
    </div>
  );
}
