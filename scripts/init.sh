#!/bin/bash
set -e

CONFIG_DIR="$HOME/.config/opzero-claude"
CONFIG_FILE="$CONFIG_DIR/config.json"

echo "========================================"
echo "  CodeZero Setup"
echo "========================================"
echo ""

if [ -f "$CONFIG_FILE" ]; then
  echo "Config already exists at $CONFIG_FILE"
  read -p "Overwrite? (y/N): " -n 1 -r
  echo
  if [[ ! $REPLY =~ ^[Yy]$ ]]; then
    echo "Aborted."
    exit 0
  fi
fi

read -p "Username [default: opz]: " username
username=${username:-opz}

read -s -p "Password: " password
echo
if [ -z "$password" ]; then
  echo "Password cannot be empty."
  exit 1
fi

read -s -p "Confirm password: " password2
echo
if [ "$password" != "$password2" ]; then
  echo "Passwords do not match."
  exit 1
fi

hash=$(echo -n "$password" | bun x bcrypt-gen || bun run -e 'const p=await Bun.password.hash(await Bun.stdin.text(),"bcrypt");console.log(p)')
if [ -z "$hash" ]; then
  echo "Failed to generate bcrypt hash."
  exit 1
fi

auth_secret=$(openssl rand -hex 32 2>/dev/null || bun -e 'console.log(Array.from(crypto.getRandomValues(new Uint8Array(32)),b=>b.toString(16).padStart(2,"0")).join(""))')

mkdir -p "$CONFIG_DIR"

cat > "$CONFIG_FILE" << EOF
{
  "host": "0.0.0.0",
  "port": 4097,
  "auth": {
    "username": "$username",
    "password": "bcrypt:$hash"
  },
  "authSecret": "$auth_secret",
  "loopbackBypass": true,
  "authProvider": "cookie"
}
EOF

echo ""
echo "========================================"
echo "  Optional: MCP Servers"
echo "========================================"
echo ""
echo "CodeZero can install MCP servers for Claude Code."
echo ""

# CodeZero MCP connector
read -p "Add CodeZero as an MCP server in Claude Code? (y/N): " -n 1 -r
echo
if [[ $REPLY =~ ^[Yy]$ ]]; then
  MCP_CONFIG="$HOME/.config/claude/mcp_servers.json"
  mkdir -p "$(dirname "$MCP_CONFIG")"

  echo ""
  echo "  How will you access CodeZero?"
  echo "    1) Local only (http://127.0.0.1:4097/mcp)"
  echo "    2) Remote via domain (e.g. https://codez.yourdomain.com/mcp)"
  read -p "  Choice [1]: " mcp_choice
  mcp_choice=${mcp_choice:-1}

  if [ "$mcp_choice" = "2" ]; then
    read -p "  Your CodeZero domain (e.g. codez.yourdomain.com): " mcp_domain
    mcp_url="https://$mcp_domain/mcp"
  else
    mcp_url="http://127.0.0.1:4097/mcp"
  fi

  if [ -f "$MCP_CONFIG" ]; then
    # Merge into existing config
    bun -e "
      const fs = require('fs');
      const cfg = JSON.parse(fs.readFileSync('$MCP_CONFIG','utf8'));
      cfg.codezero = { type: 'http', url: '$mcp_url' };
      fs.writeFileSync('$MCP_CONFIG', JSON.stringify(cfg, null, 2));
    " 2>/dev/null || python3 -c "
import json, os
p='$MCP_CONFIG'
d=json.load(open(p)) if os.path.exists(p) else {}
d['codezero']={'type':'http','url':'$mcp_url'}
json.dump(d,open(p,'w'),indent=2)
"
  else
    cat > "$MCP_CONFIG" << MCPEOF
{
  "codezero": {
    "type": "http",
    "url": "$mcp_url"
  }
}
MCPEOF
  fi
  echo "  Added codezero -> $mcp_url to $MCP_CONFIG"
  echo "  Restart Claude Code to pick it up."
  echo ""
fi

# Desktop control (native computer use)
read -p "Install desktop-control MCP? (screenshots, mouse, keyboard) (y/N): " -n 1 -r
echo
if [[ $REPLY =~ ^[Yy]$ ]]; then
  if command -v claude &>/dev/null; then
    existing=$(claude mcp list 2>&1 | grep -c "desktop-control" || true)
    if [ "$existing" -gt 0 ]; then
      echo "  desktop-control already installed, skipping."
    else
      claude mcp add --scope user desktop-control -- npx -y computer-use-mcp 2>&1
      echo "  Installed desktop-control MCP (user scope)."
      echo ""
      echo "  NOTE: On macOS, grant Accessibility permissions to your terminal:"
      echo "    System Settings > Privacy & Security > Accessibility"
    fi
  else
    echo "  'claude' CLI not found in PATH, skipping."
    echo "  Install manually later: claude mcp add --scope user desktop-control -- npx -y computer-use-mcp"
  fi
  echo ""
fi

echo "========================================"
echo "  Setup Complete"
echo "========================================"
echo ""
echo "Config saved to: $CONFIG_FILE"
echo ""
echo "To expose via Cloudflare Tunnel:"
echo ""
echo "  1. Install cloudflared: brew install cloudflared"
echo "  2. Run: cloudflared tunnel --url http://localhost:4097"
echo "  3. Or create a persistent tunnel:"
echo "     cloudflared tunnel create codezero"
echo "     cloudflared tunnel route ip add --tunnel-name codezero 0.0.0.0/0"
echo "     cloudflared tunnel ingress rule --tunnel-name codezero --hostname your-domain.example.com --origin-port 4097"
echo "     cloudflared tunnel run codezero"
echo ""
echo "To run on macOS with launchd:"
echo "  Create ~/Library/LaunchAgents/com.opzero.claude.plist with:"
echo "    Label: com.opzero.claude"
echo "    ProgramArguments: [bun, run, /path/to/opzero-claude/server/index.ts]"
echo "    RunAtLoad: true"
echo ""
echo "To start the server:"
echo "  bun run start"
echo "  # or"
echo "  codezero serve"
echo ""