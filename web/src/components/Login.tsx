import { useState, type FormEvent } from "react";

import BrandLogo from "@/components/BrandLogo";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { authApi } from "@/lib/authClient";
import { cn } from "@/lib/utils";

interface LoginProps {
  onAuthed: () => void;
  onOpenOnboarding?: () => void;
}

const Login = ({ onAuthed, onOpenOnboarding }: LoginProps) => {
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  const handleSubmit = async (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    if (submitting) return;
    setError(null);
    setSubmitting(true);
    try {
      await authApi.login(username, password);
      onAuthed();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Login failed");
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div
      className={cn(
        "min-h-screen w-full flex items-center justify-center px-4 py-10",
        "bg-background text-foreground relative overflow-hidden",
      )}
    >
      {/* Ambient backdrop */}
      <div
        aria-hidden
        className="pointer-events-none absolute inset-0 opacity-60"
        style={{
          background:
            "radial-gradient(ellipse at top, rgba(0,245,255,0.12), transparent 55%), radial-gradient(ellipse at bottom, rgba(139,92,246,0.10), transparent 60%)",
        }}
      />

      <form
        onSubmit={handleSubmit}
        method="post"
        action="/api/auth/login"
        className={cn(
          "relative z-10 w-full max-w-sm rounded-2xl p-8",
          "glass glass-border card-glow glow-border",
          "shadow-[0_20px_80px_-20px_rgba(0,245,255,0.25)]",
        )}
      >
        <div className="flex flex-col items-center gap-6">
          <BrandLogo size="lg" showTagline />

          <div className="w-full flex flex-col items-center gap-1 mt-2">
            <h1 className="text-2xl font-bold tracking-tight gradient-text">
              Sign in
            </h1>
            <p className="text-xs text-muted-foreground">
              Enter your credentials to continue.
            </p>
          </div>

          <p className="text-[11px] text-center text-muted-foreground font-medium">
            Claude Code in your pocket.
          </p>

          {onOpenOnboarding && (
            <button
              type="button"
              onClick={onOpenOnboarding}
              className="text-[10px] text-primary hover:underline"
            >
              New here?
            </button>
          )}

          <div className="w-full flex flex-col gap-3">
            <label className="flex flex-col gap-1.5">
              <span className="text-xs uppercase tracking-[0.2em] text-muted-foreground font-medium">
                Username
              </span>
              <Input
                type="text"
                name="username"
                autoComplete="username"
                autoCapitalize="off"
                autoCorrect="off"
                spellCheck={false}
                required
                value={username}
                onChange={(e) => setUsername(e.target.value)}
                disabled={submitting}
                className="bg-background/40"
              />
            </label>

            <label className="flex flex-col gap-1.5">
              <span className="text-xs uppercase tracking-[0.2em] text-muted-foreground font-medium">
                Password
              </span>
              <Input
                type="password"
                name="password"
                autoComplete="current-password"
                required
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                disabled={submitting}
                className="bg-background/40"
              />
            </label>

            {error && (
              <div
                role="alert"
                className="rounded-md border border-destructive/40 bg-destructive/10 px-3 py-2 text-xs text-destructive-foreground"
              >
                {error}
              </div>
            )}
          </div>

          <Button
            type="submit"
            variant="hero"
            size="lg"
            disabled={submitting}
            className="w-full"
          >
            {submitting ? "Signing in..." : "Sign in"}
          </Button>

          <p className="text-[10px] uppercase tracking-[0.25em] text-muted-foreground/70">
            opzero/claude console
          </p>
        </div>
      </form>
    </div>
  );
};

export default Login;
