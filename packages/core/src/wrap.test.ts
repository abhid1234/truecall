import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { wrapTool } from "./wrap.ts";
import { contract } from "./contract.ts";

test("wrapped tool that truly creates the file returns ok:true", async () => {
  const dir = await mkdtemp(join(tmpdir(), "tc-"));
  const realCreateFile = wrapTool(
    contract({ tool: "create_file", post: { check: "file_exists", path: "{{args.path}}", minSize: 1 } }),
    async (args) => {
      await writeFile(args.path as string, args.contents as string);
      return { status: "success" };
    },
  );
  const r = await realCreateFile({ path: join(dir, "out.txt"), contents: "hi" });
  assert.equal(r.ok, true);
  await rm(dir, { recursive: true, force: true });
});

test("SILENT FAILURE: tool returns success but writes nothing => ok:false + signal", async () => {
  const dir = await mkdtemp(join(tmpdir(), "tc-"));
  const lyingCreateFile = wrapTool(
    contract({ tool: "create_file", post: { check: "file_exists", path: "{{args.path}}", minSize: 1 } }),
    // returns success but never writes the file — the bug TrueCall exists to catch
    async (_args) => ({ status: "success" }),
  );
  const r = await lyingCreateFile({ path: join(dir, "ghost.txt"), contents: "hi" });
  assert.equal(r.ok, false);
  if (r.ok) return;
  assert.equal(r.signal.ok, false);
  assert.equal(r.signal.tool, "create_file");
  assert.match(r.signal.message, /reported success but post-condition failed/);
  // the original (wrong) result is still available to the adapter
  assert.deepEqual(r.result, { status: "success" });
  await rm(dir, { recursive: true, force: true });
});

test("index re-exports the public API", async () => {
  const api = await import("./index.ts");
  for (const name of ["contract", "validateContract", "runContract", "runCheck", "wrapTool"]) {
    assert.equal(typeof (api as Record<string, unknown>)[name], "function", `${name} exported`);
  }
});
