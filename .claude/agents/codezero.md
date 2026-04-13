---
name: CodeZero
description: Web UI for driving Claude Code sessions remotely, phone-first

tools: [edit, read, glob, grep, bash, webfetch, codesearch]
---

# CodeZero Agent

You are a subagent working on the CodeZero project. This file orients you to the codebase so you can make changes without asking for guidance on project layout or conventions.

## Project Overview

Web UI for driving Claude Code sessions remotely. Primary target: iPhone 15 Pro Max. Users access via their own Cloudflare tunnel (e.g. `codez.yourdomain.com` -> local Bun server).

**Tech stack:**
- Bun HTTP server (`server/index.ts`) — no framework, Bun.serve
- React 19 SPA (`web/`) — Vite + Tailwind v4, new JSX transform
- SessionProcess wraps `claude -p --input-format stream-json` for live sessions
- EventBus pub/sub fans out SSE events to `/api/events` endpoint
- Auth: pluggable AuthProvider (cookie JWT default)

**Key distinction:** stream-json is what the subprocess emits to stdout. JSONL is what Claude Code persists to disk. These are different formats with different shapes—never mix them.

## Directory Layout

```
opzero-claude/
  server/                    # Bun runtime
    index.ts                 # entry, Bun.serve wiring, idleTimeout: 0
    config.ts                # loads ~/.config/opzero-claude/config.json
    auth.ts                 # AuthProvider interface + cookie JWT
    types.ts                # AUTHORITATIVE session/event types (SSEEvent union)
    bus.ts                  # EventBus subscribe() + emit()
    routes/                 # /api/* handlers
      sessions.ts          # GET :id, POST :id/prompt, abort, dispose
      projects.ts          # GET /api/projects, .../:slug/sessions
      events.ts            # GET /api/events (SSE)
    claude/
      process.ts           # SessionProcess (spawn, stdin pump, stream-json parser, auth fallback)
      pool.ts             # SessionPool (live process map + tailer map)
      tailer.ts           # SessionTailer (fs.watch JSONL for mirror sessions)
      history.ts          # loadSessionMessagesAndMetadata (JSONL walker)

  web/                     # React 19 + Vite
    src/
      App.tsx              # root with safe-area padding
      lib/
        store.ts           # useSyncExternalStore, immutable rebuilds
        types.ts           # client mirror of server types
        api.ts             # fetch wrapper
        parts.ts           # SSE event reducers
      components/
        parts/            # tool-use renderers (BashToolView, EditToolView, etc.)
        ui/                # shadcn primitives
        PromptBox.tsx      # textarea with slash picker
        SessionList.tsx    # left rail project/session browser
        MessageThread.tsx  # scrollable conversation
    theme/
      globals.css          # Tailwind v4 tokens (cyberpunk palette)
```

## Key Conventions

**Store mutations:** Never mutate `state` directly. Always rebuild: `state = { ...state, ...patch }`. The useSyncExternalStore snapshot check uses Object.is—if you mutate, React skips the re-render.

**Session status enum:**
- `"live"` — we own the SessionProcess in the pool, can prompt
- `"mirror"` — externally owned, JSONL touched in last 60s, read-only
- `"idle"` — archived, safe to resume

**EventBus:** All real-time state flows through `EventBus.emit({type, ...})`. Single SSE endpoint multiplexes all sessions. Client filters by sessionId in the reducer.

**Auth:** Cookie JWT via `createCookieAuthProvider(config)`. Future providers (OIDC, Cloudflare Access) implement the AuthProvider interface.

**PWA assets:** `web/public/manifest.json` and icons. The SPA must be built (`bun run build`) before PWA assets are available.

## Style Rules

- **No emojis** in source, commits, or user-facing strings
- **Tailwind v4 tokens** from `web/src/theme/globals.css` — use `.bg-background`, `.text-primary`, `.border-accent`, never hardcode colors
- **Cyberpunk palette:** Hyper Cyan `#00F5FF` (primary), Neural Violet `#8B5CF6` (accent), Synthetic Void `hsl(240 20% 1%)` (bg)
- **Lucide icons** only
- **React 19:** New JSX transform. No `import React`—use named imports: `import { useEffect, useState } from "react"`
- **Strict TypeScript:** No `any` unless deliberately casting

## Gotchas

1. **Store mutation bug:** Mutating `state.foo = bar` breaks reactivity. Always `state = { ...state, foo: bar }`
2. **idleTimeout: 0:** Bun.serve defaults to 10s. SSE streams die without this.
3. **session-id vs resume:** Mutually exclusive flags in SessionProcess spawn. Don't pass both.
4. **JSONL source of truth:** For historical sessions, read from JSONL not from memory.
5. **Tailer + pool ownership:** When pool takes ownership (create/resume), it stops the tailer to avoid double-emitting.

## How to Run

```bash
# Development (concurrent server + vite)
bun run dev

# Production build
bun run build

# Production serve
bun run start

# Typecheck
bun run typecheck        # server
cd web && bunx tsc --noEmit  # web
```

## Known Open Items

**Shipped:**
- PWA install manifest + icons
- Cost tracking in message footer
- Permission mode picker
- Disposal confirmation dialog
- Inline send errors (replaces ErrorBanner)
- Live sidebar status (cyan dot)
- Auth fallback (OAuth <-> API key retry on billing/auth errors)
- Self-heal auth health monitoring
- Desktop control MCP (optional install via init.sh)

**Partially shipped:**
- Channels bidirectional write to mirror sessions (permission relay TBD)

**Open:**
- Session sidebar overhaul (naming, sorting, effort level controls) — Roadmap item 41

**Deferred:**
- Fork session (session ID remap complexity)
- Subagent streaming (channels prerequisite)

## Making Changes

When adding API routes or SSE events:

1. Add types to both `server/types.ts` AND `web/src/lib/types.ts`
2. Emit from server (SessionProcess, SessionTailer, etc.)
3. Handle in `web/src/lib/store.ts::dispatch`
4. Add reducer in `web/src/lib/parts.ts` if mutating messages

When adding tool-use renderers:
1. Create `web/src/components/parts/XyzToolView.tsx`
2. Add case to dispatcher in `ToolUsePart.tsx`

Keep server and web types in sync. Changes to one must update the other.