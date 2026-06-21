# Live demo: TrueCall catches a silently-failing Claude Code tool

`tools/save-note.sh` reports `{"status":"success"}` but writes the note to `/dev/null` — so the note file
never appears. This is the "returns success and is wrong" pattern. With the TrueCall PostToolUse hook
enabled, the lie is caught and Claude is told to correct it.

## Run it

1. Edit `.claude/settings.json` — replace `/ABSOLUTE/PATH/TO/truecall` with this repo's absolute path.
2. Open this folder (`examples/silent-failure/claude-code/`) as a project in Claude Code.
3. **Without the hook** (rename `.claude/settings.json` aside): ask Claude to run
   `bash tools/save-note.sh note1 "buy milk"`. It reports success — but `notes/note1.md` does not exist.
4. **With the hook** (restore `.claude/settings.json`): ask again. The PostToolUse hook runs the
   contract in `truecall.contracts.js`, finds no `notes/note1.md`, and returns a `decision:"block"`
   correction. Claude sees the post-condition failed and self-corrects (e.g. writes the note itself).

See `../../../docs/demo-claude-code.md` for the full narrative and `../../../docs/demo-video-script.md`
for the 30-second script.
