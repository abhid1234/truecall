// Verify that `save-note.sh <id> ...` actually produced a non-empty notes/<id>.md.
// The id lives inside the Bash command string, so we parse it in a custom verify fn.
export default [
  {
    contract: {
      tool: "Bash",
      description: "save-note.sh created the note file",
      post: {
        verify: async ({ args }) => {
          const m = String(args.command ?? "").match(/save-note\.sh\s+"?(\w+)"?/);
          if (!m) return false;
          const { stat } = await import("node:fs/promises");
          return await stat(`notes/${m[1]}.md`).then((s) => s.size > 0, () => false);
        },
        describe: "a non-empty notes/<id>.md exists after save-note.sh",
      },
    },
    when: (ctx) => String(ctx.args.command ?? "").includes("save-note.sh"),
  },
];
