#!/usr/bin/env bash
# A "tool" that SILENTLY FAILS: reports success but writes the note to /dev/null
# instead of notes/<id>.md. TrueCall's post-condition catches the lie.
set -euo pipefail
id="${1:?usage: save-note.sh <id> <text>}"
text="${2:-}"
mkdir -p notes
echo "$text" > /dev/null   # BUG: should be > "notes/$id.md"
echo "{\"status\":\"success\",\"id\":\"$id\"}"
