import { useState } from "react";
import { Play, Plus, CheckCircle2, XCircle, Camera, X, FlaskConical } from "lucide-react";
import { api, type UatAction, type UatStep } from "@/lib/api";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";

interface UatPanelProps {
  onClose: () => void;
}

const ACTION_OPTIONS: { value: UatAction; label: string }[] = [
  { value: "navigate", label: "Navigate" },
  { value: "click", label: "Click" },
  { value: "fill", label: "Fill" },
  { value: "wait", label: "Wait" },
  { value: "snapshot", label: "Snapshot" },
  { value: "screenshot", label: "Screenshot" },
];

export default function UatPanel({ onClose }: UatPanelProps) {
  const [url, setUrl] = useState("https://");
  const [steps, setSteps] = useState<UatStep[]>([
    { action: "navigate", value: "" },
  ]);
  const [running, setRunning] = useState(false);
  const [results, setResults] = useState<Map<number, { passed: boolean; error?: string }>>(
    new Map(),
  );
  const [currentStep, setCurrentStep] = useState(-1);

  function addStep() {
    setSteps([...steps, { action: "click", selector: "", value: "" }]);
  }

  function updateStep(index: number, updates: Partial<UatStep>) {
    const newSteps = [...steps];
    newSteps[index] = { ...newSteps[index], ...updates };
    setSteps(newSteps);
  }

  function removeStep(index: number) {
    if (steps.length <= 1) return;
    setSteps(steps.filter((_, i) => i !== index));
  }

  async function runTest() {
    if (!url || url === "https://") return;
    setRunning(true);
    setResults(new Map());
    setCurrentStep(-1);

    try {
      const { stream } = api.runUat(url, steps);
      for await (const event of stream) {
        if (event.type === "step.started") {
          setCurrentStep(event.stepIndex);
        } else if (event.type === "step.passed") {
          setResults((prev) => {
            const next = new Map(prev);
            next.set(event.stepIndex, { passed: true });
            return next;
          });
        } else if (event.type === "step.failed") {
          setResults((prev) => {
            const next = new Map(prev);
            next.set(event.stepIndex, { passed: false, error: event.error });
            return next;
          });
        } else if (event.type === "complete") {
          setRunning(false);
          setCurrentStep(-1);
        }
      }
    } catch (err) {
      console.error("UAT run error:", err);
      setRunning(false);
      setCurrentStep(-1);
    }
  }

  function openScreenshots() {
    window.open("/api/uat/screenshots", "_blank");
  }

  return (
    <div className="flex flex-col h-full">
      <div className="flex items-center justify-between p-3 border-b">
        <div className="flex items-center gap-2">
          <FlaskConical className="h-4 w-4" />
          <span className="text-sm font-medium">UAT Testing</span>
        </div>
        <div className="flex items-center gap-2">
          <Button
            variant="ghost"
            size="sm"
            onClick={openScreenshots}
            className="h-8"
          >
            <Camera className="h-3.5 w-3.5 mr-1" />
            Screenshots
          </Button>
          <button
            type="button"
            onClick={onClose}
            className="text-muted-foreground hover:text-foreground"
          >
            <X className="h-4 w-4" />
          </button>
        </div>
      </div>

      <div className="p-3 border-b space-y-3">
        <div className="flex gap-2">
          <Input
            placeholder="https://example.com"
            value={url}
            onChange={(e) => setUrl(e.target.value)}
            className="flex-1"
          />
          <Button
            onClick={runTest}
            disabled={running || !url || url === "https://"}
            size="sm"
          >
            {running ? (
              <>
                <span className="animate-spin mr-1">⟳</span>
                Running
              </>
            ) : (
              <>
                <Play className="h-3.5 w-3.5 mr-1" />
                Run Test
              </>
            )}
          </Button>
        </div>
      </div>

      <div className="flex-1 overflow-y-auto p-3 space-y-2">
        {steps.map((step, index) => {
          const result = results.get(index);
          const isCurrent = currentStep === index;
          return (
            <div
              key={index}
              className={`flex items-center gap-2 p-2 rounded-md border ${
                isCurrent
                  ? "border-primary bg-primary/10"
                  : result
                    ? result.passed
                      ? "border-green-500/50 bg-green-500/10"
                      : "border-red-500/50 bg-red-500/10"
                    : "border-border"
              }`}
            >
              <span className="text-xs text-muted-foreground w-5">{index + 1}.</span>
              <select
                value={step.action}
                onChange={(e) => updateStep(index, { action: e.target.value as UatAction })}
                disabled={running}
                className="w-28 h-8 px-2 rounded-md bg-background border border-border text-xs focus:outline-none focus:ring-2 focus:ring-ring"
              >
                {ACTION_OPTIONS.map((opt) => (
                  <option key={opt.value} value={opt.value}>
                    {opt.label}
                  </option>
                ))}
              </select>
              <Input
                placeholder="selector"
                value={step.selector || ""}
                onChange={(e) => updateStep(index, { selector: e.target.value })}
                disabled={running || step.action === "navigate" || step.action === "wait" || step.action === "screenshot" || step.action === "snapshot"}
                className="flex-1 h-8"
              />
              <Input
                placeholder="value"
                value={step.value || ""}
                onChange={(e) => updateStep(index, { value: e.target.value })}
                disabled={running || step.action === "click" || step.action === "screenshot" || step.action === "snapshot"}
                className="flex-1 h-8"
              />
              {result && (
                result.passed ? (
                  <CheckCircle2 className="h-4 w-4 text-green-500" />
                ) : (
                  <XCircle className="h-4 w-4 text-red-500" />
                )
              )}
              {steps.length > 1 && !running && (
                <button
                  type="button"
                  onClick={() => removeStep(index)}
                  className="text-muted-foreground hover:text-foreground"
                >
                  <X className="h-3.5 w-3.5" />
                </button>
              )}
            </div>
          );
        })}

        <Button
          variant="outline"
          size="sm"
          onClick={addStep}
          disabled={running}
          className="w-full"
        >
          <Plus className="h-3.5 w-3.5 mr-1" />
          Add Step
        </Button>

        {results.size > 0 && (
          <div className="mt-4 p-3 rounded-md border border-border">
            <div className="text-xs font-medium mb-2">Results</div>
            <div className="text-sm">
              <span className="text-green-500">
                {Array.from(results.values()).filter((r) => r.passed).length} passed
              </span>
              {" / "}
              <span className="text-red-500">
                {Array.from(results.values()).filter((r) => !r.passed).length} failed
              </span>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}