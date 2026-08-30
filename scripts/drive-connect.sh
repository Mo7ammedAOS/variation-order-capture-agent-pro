#!/usr/bin/env bash
# Connect (or reconnect) Google Drive, end to end, in one command.
#
#   ./scripts/drive-connect.sh
#
# Mints a refresh token on this machine, pushes it and the client credentials
# straight to the server over SSH, switches storage to Drive, and redeploys.
#
# ── Nothing secret is printed, echoed, or kept ─────────────────────────────
# The client secret is read with `read -s`, so it never appears on screen or in
# shell history. The refresh token goes to a file with mode 600 that is deleted
# on exit, including on failure. Neither is ever passed as a command argument,
# because arguments are visible in `ps` to every user on the machine.
#
# ── When you need this ─────────────────────────────────────────────────────
# First connection, and any time the OAuth client is DELETED and recreated.
# Rotating only the client SECRET does not need a new token — the token is bound
# to the client id, so it survives a secret change. Deleting the client does
# not, and the failure reads `deleted_client`.
set -euo pipefail

cd "$(dirname "$0")/.."

VPS="${VPS_HOST:-root@187.127.210.248}"
REMOTE_DIR="${VPS_DIR:-/docker/vo}"
REDIRECT="http://localhost:53682/callback"

TOKEN_FILE="$(mktemp -t vo-drive-token)"
chmod 600 "$TOKEN_FILE"
trap 'rm -f "$TOKEN_FILE"' EXIT

cat <<BANNER

┌───────────────────────────────────────────────────────────────────────┐
│  Connect Google Drive                                                 │
└───────────────────────────────────────────────────────────────────────┘

In console.cloud.google.com, on the OAuth client you are about to use:

  •  Google Drive API is enabled
  •  OAuth consent screen is PUBLISHED, not left in Testing
     (Google expires testing-mode refresh tokens after 7 days, and every
      Drive call then fails at once with nothing pointing at the cause)
  •  Authorised redirect URIs contains exactly

         ${REDIRECT}

     A trailing slash is a different URI and Google will refuse it.

BANNER

read -r -p "Client ID:     " CLIENT_ID
read -r -s -p "Client secret: " CLIENT_SECRET
echo
echo

[[ -n "$CLIENT_ID" && -n "$CLIENT_SECRET" ]] || { echo "Both are required."; exit 1; }

echo "==> Opening consent. Approve in the browser, signed in to the RIGHT account."
GOOGLE_OAUTH_CLIENT_ID="$CLIENT_ID" \
GOOGLE_OAUTH_CLIENT_SECRET="$CLIENT_SECRET" \
  node scripts/google-oauth-token.mjs > "$TOKEN_FILE"

# Surface only what is safe to read aloud: which account consented, and how much
# room is left on it. A token minted while signed in to the wrong Google account
# is caught here rather than by a site engineer three weeks from now.
grep -E '^Authorised as:|^Drive storage:' "$TOKEN_FILE" || true

REFRESH_TOKEN="$(grep -m1 '^GOOGLE_OAUTH_REFRESH_TOKEN=' "$TOKEN_FILE" | cut -d= -f2-)"
[[ -n "$REFRESH_TOKEN" ]] || { echo "No refresh token came back — see above."; exit 1; }

echo
echo "==> Ensuring the root folder exists in that Drive"
ROOT_ID="$(TOKEN_FILE="$TOKEN_FILE" node scripts/drive-ensure-root.mjs)"
echo "    root folder: $ROOT_ID"

echo "==> Writing credentials to $VPS:$REMOTE_DIR/.env.production"
# Values travel on stdin, never as arguments.
printf '%s\n%s\n%s\n%s\n' "$CLIENT_ID" "$CLIENT_SECRET" "$REFRESH_TOKEN" "$ROOT_ID" \
  | ssh "$VPS" "cd $REMOTE_DIR && python3 scripts/write-drive-env.py"

echo "==> Releasing"
ssh "$VPS" "cd $REMOTE_DIR && ./deploy/release.sh"

echo
echo "Done. Storage is Google Drive. The local token file has been deleted."
