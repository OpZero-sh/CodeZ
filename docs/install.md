# CodeZ Installation Guide

## Docker (Recommended)

```bash
# Build and run
docker build -t codez .
docker run -d -p 4097:4097 -v ~/.config/opzero-claude:/root/.config/opzero-claude --restart unless-stopped codez

# Or with docker-compose
docker-compose up -d
```

## bunx

```bash
# Run directly without installation
bunx codez serve

# Or install globally
bun add -g opzero-claude
codez serve
```

## Homebrew (Tap)

```bash
# Add the tap
brew tap opzero-sh/tap

# Install
brew install codez

# Run
codez serve
```

Expected Homebrew formula (`opzero-sh/homebrew-tap`):

```ruby
class Codez < Formula
  desc "Self-hosted Claude Code server"
  homepage "https://github.com/OpZero-sh/CodeZ"
  url "https://github.com/OpZero-sh/CodeZ/archive/refs/tags/vX.Y.Z.tar.gz"
  sha256 "..."
  license "MIT"

  uses_from_bun "bun"

  def install
    system "bun", "run", "build"
    bin.install "bin/cli.ts"
  end

  test do
    system "#{bin}/codez", "version"
  end
end
```

## Cloudflare Tunnel Setup

For public access without a dedicated domain:

```bash
# Install cloudflared
brew install cloudflared

# Quick tunnel to localhost
cloudflared tunnel --url http://localhost:4097
```

For persistent tunnels with a domain:

```bash
# Create tunnel
cloudflared tunnel create codez

# Add DNS route
cloudflared tunnel route dns add codez your-domain.example.com

# Configure ingress
cloudflared tunnel ingress rule --tunnel-name codez --hostname your-domain.example.com --origin-port 4097

# Run
cloudflared tunnel run codez
```

## macOS launchd

Create `~/Library/LaunchAgents/com.opzero.claude.plist`:

```xml
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>Label</key>
  <string>com.opzero.claude</string>
  <key>ProgramArguments</key>
  <array>
    <string>bun</string>
    <string>run</string>
    <string>/path/to/opzero-claude/server/index.ts</string>
  </array>
  <key>RunAtLoad</key>
  <true/>
</dict>
</plist>
```

Load with: `launchctl load ~/Library/LaunchAgents/com.opzero.claude.plist`

## Environment Variables

Override config file settings:

- `CODEZ_PORT` - Server port (default: 4097)
- `CODEZ_HOST` - Server host (default: 127.0.0.1)
- `CODEZ_CONFIG_PATH` - Custom config file path

## First Run Setup

Run the interactive setup:

```bash
codez init
```

Or use Docker volume mounting to provide a config file at `~/.config/opzero-claude/config.json`.