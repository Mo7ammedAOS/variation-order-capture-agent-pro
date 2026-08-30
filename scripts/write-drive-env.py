#!/usr/bin/env python3
"""Writes the four Drive values into .env.production, reading them from stdin.

Runs ON THE SERVER. Values arrive on stdin rather than as arguments because
arguments are visible in `ps` to every user on the box, and this is the one
moment the refresh token is in the open.

Rewrites in place rather than appending: appending leaves the earlier empty
placeholder above the real value, and which one wins then depends on how the
file is parsed.
"""
import pathlib
import re
import sys

lines = [line.rstrip("\n") for line in sys.stdin]
if len(lines) < 4:
    sys.exit("expected four lines: client id, secret, refresh token, root folder id")

values = {
    "GOOGLE_OAUTH_CLIENT_ID": lines[0],
    "GOOGLE_OAUTH_CLIENT_SECRET": lines[1],
    "GOOGLE_OAUTH_REFRESH_TOKEN": lines[2],
    "GOOGLE_DRIVE_ROOT_FOLDER_ID": lines[3],
    "GOOGLE_DRIVE_AUTH_MODE": "oauth",
    "STORAGE_PROVIDER": "google_drive",
}

path = pathlib.Path(".env.production")
text = path.read_text()
for key, value in values.items():
    pattern = rf"^{key}=.*$"
    if re.search(pattern, text, flags=re.M):
        text = re.sub(pattern, f"{key}={value}", text, flags=re.M)
    else:
        text += f"\n{key}={value}\n"

path.write_text(text)
path.chmod(0o600)

for key in values:
    length = len(values[key])
    shown = values[key] if key in ("STORAGE_PROVIDER", "GOOGLE_DRIVE_AUTH_MODE") else f"set, {length} chars"
    print(f"    {key} = {shown}")
