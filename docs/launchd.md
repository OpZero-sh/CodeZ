# launchd auto-start (macOS)

Run the `opzero-claude` Bun server automatically on macOS login, with
auto-restart on crash, via a user LaunchAgent.

## What it does

Installs `~/Library/LaunchAgents/sh.opzero.claude.plist`, which runs
`bun run server/index.ts` from the project root at login. The server
binds to `127.0.0.1:4097` and reads config from
`~/.config/opzero-claude/config.json`.

`KeepAlive` is set to restart the process when it crashes, but **not**
when it exits cleanly, so you can stop it with `launchctl bootout`
without it immediately respawning.

## Requirements

- macOS (launchd / `launchctl`)
- `bun` on your `PATH` (the install script reads `command -v bun`)

## Install

```sh
./scripts/install-launchd.sh
```

This substitutes `{{PROJECT_ROOT}}` and `{{BUN_BIN}}` in
`scripts/sh.opzero.claude.plist.template`, writes the result to
`~/Library/LaunchAgents/sh.opzero.claude.plist`, bootstraps it into
`gui/$(id -u)`, and kickstarts it.

## Uninstall

```sh
./scripts/uninstall-launchd.sh
```

## Logs

- `./.logs/server.out.log` — stdout
- `./.logs/server.err.log` — stderr

The install script creates `./.logs/` if it doesn't exist. You'll want
to add `.logs/` to `.gitignore` yourself — this script intentionally
does not modify `.gitignore`.

## Check status

```sh
launchctl print gui/$(id -u)/sh.opzero.claude
```

## Restart manually

```sh
launchctl kickstart -k gui/$(id -u)/sh.opzero.claude
```

## Cloudflared tunnel

This agent **only** manages the Bun server. If you also want the
`cloudflared` tunnel to auto-start, manage it separately, e.g.:

```sh
brew services start cloudflared
```

or write a second LaunchAgent plist for it. That is intentionally out
of scope here so the two services can be started, stopped, and
debugged independently.
