#!/bin/bash
# WorkOS status line. The renderer is WORKOS/STATUSLINE/Render.ts, one Bun process (see WORKOS/STATUSLINE/README.md);
# this file stays the entry point settings.json and the installer call. A render only reads files: the one shared
# cache it uses is refreshed by STATUSLINE/Refresh.ts from MaintenanceJobs. The pre-port bash renderer (2,469 lines,
# about 53 processes per render) is in git history before WorkOS 2.0.0.
case "$0" in */*) dir="${0%/*}" ;; *) dir=. ;; esac
# Statusline spawn contexts can arrive with $HOME unset; Render.ts resolves the account's home itself.
bun="$(command -v bun 2>/dev/null)"
if [ -z "$bun" ]; then
    for b in "$HOME/.bun/bin/bun" /usr/local/bin/bun /usr/bin/bun /opt/homebrew/bin/bun; do
        [ -x "$b" ] && bun="$b" && break
    done
fi
[ -n "$bun" ] && exec "$bun" "$dir/STATUSLINE/Render.ts"
cat > /dev/null
echo "WorkOS"
