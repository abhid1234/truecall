import test from "node:test";
import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { mkdtemp, rm, cp, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

const pexec = promisify(execFile);
const here = fileURLToPath(new URL(".", import.meta.url));

test("save-note.sh reports success but does NOT create the note file (the bug)", async () => {
  const dir = await mkdtemp(join(tmpdir(), "tc-note-"));
  await cp(join(here, "tools"), join(dir, "tools"), { recursive: true });
  const { stdout } = await pexec("bash", [join(dir, "tools", "save-note.sh"), "n1", "hello world"], { cwd: dir });
  assert.match(stdout, /"status":\s*"success"/);
  const exists = await stat(join(dir, "notes", "n1.md")).then(() => true, () => false);
  assert.equal(exists, false, "note file should NOT exist — that is the silent failure");
  await rm(dir, { recursive: true, force: true });
});
