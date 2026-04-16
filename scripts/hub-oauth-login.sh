#!/bin/bash
# Headless OAuth login for CodeZ Hub — no browser required.
#
# Creates or logs into an MCPAuthKit user, does the PKCE flow, and writes
# tokens to ~/.config/opzero-claude/hub-auth.json. Useful for containers,
# CI, or any environment where the browser-based login flow isn't practical.
#
# Usage:
#   HUB_EMAIL=you@example.com HUB_PASSWORD=... ./hub-oauth-login.sh
#
# If HUB_EMAIL is unset, defaults to opz-hub-agent@opzero.local.
# If HUB_PASSWORD is unset, generates a random one (printed at the end).

set -euo pipefail

BASE_URL="${AUTHKIT_URL:-https://authkit.open0p.com}"
REDIRECT_URI="http://127.0.0.1:0/callback"
EMAIL="${HUB_EMAIL:-opz-hub-agent@opzero.local}"
PASSWORD="${HUB_PASSWORD:-$(python3 -c 'import secrets; print(secrets.token_urlsafe(24))')}"
AUTH_FILE="$HOME/.config/opzero-claude/hub-auth.json"

mkdir -p "$(dirname "$AUTH_FILE")"

echo "→ Registering OAuth client at $BASE_URL"
CLIENT_RESP=$(curl -sf -X POST "$BASE_URL/oauth/register" \
  -H "Content-Type: application/json" \
  -d "{\"client_name\":\"CodeZero Machine Agent\",\"redirect_uris\":[\"$REDIRECT_URI\"],\"grant_types\":[\"authorization_code\",\"refresh_token\"],\"response_types\":[\"code\"],\"token_endpoint_auth_method\":\"none\"}")
CLIENT_ID=$(echo "$CLIENT_RESP" | python3 -c "import json,sys; print(json.load(sys.stdin)['client_id'])")
echo "  client_id: $CLIENT_ID"

echo "→ Generating PKCE verifier + challenge"
CV=$(python3 -c "import secrets; print(secrets.token_urlsafe(32))")
CC=$(echo -n "$CV" | openssl dgst -sha256 -binary | base64 | tr '+/' '-_' | tr -d '=')

run_authorize() {
  local mode="$1"
  curl -s -D- -o /dev/null -X POST "$BASE_URL/oauth/authorize" \
    --data-urlencode "response_type=code" \
    --data-urlencode "client_id=$CLIENT_ID" \
    --data-urlencode "redirect_uri=$REDIRECT_URI" \
    --data-urlencode "scope=mcp:tools agent:ws" \
    --data-urlencode "state=hubsetup" \
    --data-urlencode "code_challenge=$CC" \
    --data-urlencode "code_challenge_method=S256" \
    --data-urlencode "email=$EMAIL" \
    --data-urlencode "password=$PASSWORD" \
    --data-urlencode "action=approve" \
    --data-urlencode "auth_mode=$mode"
}

echo "→ Attempting signup"
CODE=$(run_authorize signup | grep -i "^location:" | grep -o 'code=[^&[:space:]]*' | cut -d= -f2 || true)

if [ -z "$CODE" ]; then
  echo "→ Signup didn't yield code (user likely exists); trying login"
  CODE=$(run_authorize login | grep -i "^location:" | grep -o 'code=[^&[:space:]]*' | cut -d= -f2 || true)
fi

if [ -z "$CODE" ]; then
  echo "✗ No auth code obtained. Check email/password." >&2
  exit 1
fi

echo "→ Exchanging code for tokens"
TOKEN_RESP=$(curl -sf -X POST "$BASE_URL/oauth/token" \
  -H "Content-Type: application/x-www-form-urlencoded" \
  --data-urlencode "grant_type=authorization_code" \
  --data-urlencode "code=$CODE" \
  --data-urlencode "redirect_uri=$REDIRECT_URI" \
  --data-urlencode "client_id=$CLIENT_ID" \
  --data-urlencode "code_verifier=$CV")

AT=$(echo "$TOKEN_RESP" | python3 -c "import json,sys; print(json.load(sys.stdin)['access_token'])")
RT=$(echo "$TOKEN_RESP" | python3 -c "import json,sys; print(json.load(sys.stdin).get('refresh_token',''))")
EXP=$(echo "$TOKEN_RESP" | python3 -c "import json,sys; print(json.load(sys.stdin).get('expires_in',3600))")

if [ -z "$RT" ]; then
  echo "✗ No refresh_token in response. MCPAuthKit may be outdated." >&2
  exit 1
fi

EXPIRES_AT=$(python3 -c "import time; print(int(time.time()*1000 + $EXP*1000))")
python3 -c "
import json
with open('$AUTH_FILE', 'w') as f:
    json.dump({
        'clientId': '$CLIENT_ID',
        'accessToken': '$AT',
        'refreshToken': '$RT',
        'expiresAt': $EXPIRES_AT,
    }, f, indent=2)
    f.write('\n')
"
chmod 600 "$AUTH_FILE"

echo "→ Tokens written to $AUTH_FILE"
echo ""
echo "user credentials (for future logins):"
echo "  email:    $EMAIL"
echo "  password: $PASSWORD"
