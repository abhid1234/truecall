# 30-second demo video script — "Your agent says done. Did it?"

**0:00–0:05 — Hook.** Title card: *"Your AI agent returns success. The work didn't happen."*

**0:05–0:13 — Without TrueCall.** Split screen. Left: Claude Code runs `save-note.sh note1 "buy milk"`,
prints `{"status":"success"}`, says "Saved your note." Right: a terminal `ls notes/` → empty. Caption:
*"200 OK. Nothing saved. The agent has no idea."*

**0:13–0:23 — With TrueCall.** Same prompt, hook enabled. The tool returns success, but a red TrueCall
banner appears: *"`Bash` failed its post-condition — notes/note1.md does not exist."* Claude reads it and
self-corrects; `ls notes/` now shows `note1.md`. Caption: *"A deterministic post-condition caught the lie
— and the agent fixed it."*

**0:23–0:30 — Close.** Title card: *"TrueCall — open, cross-harness, deterministic verification that your
agent actually did the thing. github.com/abhid1234/truecall"*
