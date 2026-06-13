#!/bin/bash
# Double-click to run Josie's gallery locally — the WEBSITE and the EDITOR.
# Keep this window open while you work. Close it (or press Ctrl+C) to stop.
cd "$(dirname "$0")" || exit 1
PORT=8091
SITE="Josie"

# 0) Self-update: quietly pull the latest gallery + editor from GitHub, but ONLY
#    when it's safe — a clean folder that can fast-forward. If you have unpublished
#    edits (or anything that would clash), it skips and uses your current copy, so
#    it can NEVER overwrite your work. Press Publish to sync your own edits up.
if command -v git >/dev/null 2>&1 && git rev-parse --is-inside-work-tree >/dev/null 2>&1; then
  if [ -z "$(git status --porcelain)" ]; then
    echo "Checking for updates…"
    if git pull --ff-only --quiet origin main 2>/dev/null; then echo "  Up to date."
    else echo "  (kept your current version)"; fi
  else
    echo "  You have unsaved edits — skipping auto-update (press Publish to sync)."
  fi
fi

# 0b) Show this launcher's custom icon. macOS keeps a custom file icon in the file's
#     resource fork, which git does NOT track and strips whenever it rewrites the file
#     (e.g. on an update). So we (re)apply the icon from the bundled PNG whenever it's
#     missing, using Swift (ships with the Command Line Tools). Runs only when needed,
#     so normal launches stay instant.
ICON="manage-josie-icon.png"
SELF="$PWD/$(basename "$0")"
if [ -f "$ICON" ] && command -v swift >/dev/null 2>&1 && ! xattr "$SELF" 2>/dev/null | grep -q com.apple.ResourceFork; then
  swift - "$SELF" "$ICON" >/dev/null 2>&1 <<'SWIFT'
import AppKit
let a = CommandLine.arguments
NSWorkspace.shared.setIcon(NSImage(contentsOfFile: a[2]), forFile: a[1], options: [])
SWIFT
fi

# 1) Free the port: stop a previous copy of this server still holding it, so a
#    re-launch never fails with "address already in use".
STALE=$(lsof -ti tcp:$PORT 2>/dev/null)
if [ -n "$STALE" ]; then
  CMD=$(ps -p $STALE -o comm= 2>/dev/null)
  case "$CMD" in
    *[Pp]ython*) echo "Restarting $SITE (stopping the previous server on port $PORT)…"
                 kill $STALE 2>/dev/null; sleep 1 ;;
    *) echo "Port $PORT is in use by '$CMD'. I'll try to start anyway…" ;;
  esac
fi

# 2) Start the server in the background.
echo "Starting $SITE's gallery…"
python3 manage/server.py --port "$PORT" &
SRV=$!

# 3) Wait until it actually answers before opening the browser (no more blank "failed to load").
READY=""
for i in $(seq 1 60); do
  if curl -s -o /dev/null "http://127.0.0.1:$PORT/"; then READY=1; break; fi
  if ! kill -0 $SRV 2>/dev/null; then break; fi   # server exited early (see its message above)
  sleep 0.25
done

if [ -z "$READY" ]; then
  echo ""
  echo "  Couldn't start $SITE's gallery on port $PORT."
  echo "  Tip: close any other 'Manage $SITE' window, then double-click this again."
  echo ""
  read -n 1 -s -r -p "Press any key to close."
  exit 1
fi

# 4) Open the website and the editor.
open "http://127.0.0.1:$PORT/"          # the website (what visitors see)
open "http://127.0.0.1:$PORT/admin/"    # the editor (Manage tool)

echo ""
echo "  $SITE's gallery is running:"
echo "    Website : http://127.0.0.1:$PORT/"
echo "    Editor  : http://127.0.0.1:$PORT/admin/"
echo ""
echo "  Leave this window open while you work. Reload the browser to see edits."
echo "  Close this window (or press Ctrl+C) to stop."
wait $SRV
