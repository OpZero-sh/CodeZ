import * as React from "react";
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";
import { Button } from "@/components/ui/button";
import { Smartphone, Share2, MoreHorizontal, Check } from "lucide-react";
import { cn } from "@/lib/utils";

interface OnboardingSheetProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

const ONBOARDING_KEY = "onboardingDone";

export function getOnboardingDone(): boolean {
  if (typeof window === "undefined") return false;
  return localStorage.getItem(ONBOARDING_KEY) === "true";
}

export function setOnboardingDone(): void {
  if (typeof window !== "undefined") {
    localStorage.setItem(ONBOARDING_KEY, "true");
  }
}

function Step({
  num,
  title,
  children,
  done,
}: {
  num: number;
  title: string;
  children: React.ReactNode;
  done?: boolean;
}) {
  return (
    <div className="flex gap-4">
      <div
        className={cn(
          "flex h-6 w-6 shrink-0 items-center justify-center rounded-full border text-[10px] font-mono",
          done
            ? "border-primary/40 bg-primary/10 text-primary"
            : "border-border/40 bg-secondary/40 text-muted-foreground",
        )}
      >
        {done ? <Check className="h-3 w-3" /> : num}
      </div>
      <div className="flex-1">
        <p className="text-xs font-medium text-foreground">{title}</p>
        <div className="mt-1 text-[11px] text-muted-foreground">{children}</div>
      </div>
    </div>
  );
}

export function OnboardingSheet({ open, onOpenChange }: OnboardingSheetProps) {
  const handleDismiss = () => {
    setOnboardingDone();
    onOpenChange(false);
  };

  const isIOS = typeof navigator !== "undefined" && /iPhone|iPad|iPod/.test(navigator.userAgent);
  const isAndroid = typeof navigator !== "undefined" && /Android/.test(navigator.userAgent);

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent
        side="bottom"
        className="flex max-h-[85vh] flex-col p-0 sm:max-h-[80vh]"
      >
        <div
          className="pointer-events-none absolute inset-x-0 top-0 h-px bg-gradient-to-r from-transparent via-primary/60 to-transparent"
          aria-hidden
        />
        <SheetHeader className="border-b border-border/40 px-5 pb-4 pt-5">
          <div className="flex items-center gap-2">
            <span className="inline-flex h-6 w-6 items-center justify-center rounded-md border border-primary/40 bg-primary/10 text-primary shadow-[0_0_12px_rgba(0,245,255,0.25)]">
              <Smartphone className="h-3 w-3" />
            </span>
            <SheetTitle className="gradient-text text-base">
              Add to Home Screen
            </SheetTitle>
          </div>
          <SheetDescription className="text-muted-foreground">
            Install CodeZero as an app for the best experience.
          </SheetDescription>
        </SheetHeader>

        <div className="flex-1 space-y-6 overflow-y-auto px-5 py-5">
          {isIOS ? (
            <div className="space-y-4">
              <p className="text-[11px] uppercase tracking-wider text-muted-foreground">
                iOS (Safari)
              </p>
              <div className="space-y-4">
                <Step num={1} title="Tap the share button">
                  In Safari, tap the <Share2 className="inline h-3 w-3" /> button in the toolbar.
                </Step>
                <Step num={2} title="Scroll down and tap Add to Home Screen">
                  Scroll down in the share sheet and tap{" "}
                  <span className="text-primary">Add to Home Screen</span>.
                </Step>
                <Step num={3} title="Tap Add">
                  Confirm by tapping <span className="text-primary">Add</span> in the top right.
                </Step>
              </div>
            </div>
          ) : isAndroid ? (
            <div className="space-y-4">
              <p className="text-[11px] uppercase tracking-wider text-muted-foreground">
                Android (Chrome)
              </p>
              <div className="space-y-4">
                <Step num={1} title="Tap the menu">
                  Tap the <MoreHorizontal className="inline h-3 w-3" /> (three dots) menu in Chrome.
                </Step>
                <Step num={2} title="Tap Install App">
                  Select <span className="text-primary">Install App</span> or{" "}
                  <span className="text-primary">Add to Home Screen</span>.
                </Step>
                <Step num={3} title="Confirm">
                  Tap <span className="text-primary">Install</span> to confirm.
                </Step>
              </div>
            </div>
          ) : (
            <div className="space-y-4">
              <p className="text-[11px] uppercase tracking-wider text-muted-foreground">
                Instructions
              </p>
              <div className="space-y-4">
                <Step num={1} title="Open browser menu">
                  Tap the menu button in your browser (usually three dots or "Share").
                </Step>
                <Step num={2} title="Find Install option">
                  Look for <span className="text-primary">Add to Home Screen</span> or{" "}
                  <span className="text-primary">Install App</span>.
                </Step>
                <Step num={3} title="Confirm">
                  Tap <span className="text-primary">Install</span> or{" "}
                  <span className="text-primary">Add</span> to add CodeZero to your home screen.
                </Step>
              </div>
            </div>
          )}

          <div className="rounded-lg border border-primary/20 bg-primary/5 p-4">
            <p className="text-[11px] text-muted-foreground">
              <span className="text-primary font-medium">Why install?</span> Installed apps
              load faster, work offline, and feel like native apps. No address bar, no tabs —
              just CodeZero.
            </p>
          </div>
        </div>

        <div className="border-t border-border/40 px-5 py-4">
          <Button onClick={handleDismiss} className="w-full" variant="hero">
            Got it
          </Button>
        </div>
      </SheetContent>
    </Sheet>
  );
}

export default OnboardingSheet;