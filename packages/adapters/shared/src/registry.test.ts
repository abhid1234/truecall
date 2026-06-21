import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { loadBindings } from "./registry.ts";

async function moduleFrom(source: string): Promise<{ url: string; dir: string }> {
  const dir = await mkdtemp(join(tmpdir(), "tc-reg-"));
  const file = join(dir, "contracts.mjs");
  await writeFile(file, source);
  return { url: pathToFileURL(file).href, dir };
}

test("loads a Binding[] default export", async () => {
  const { url, dir } = await moduleFrom(
    `export default [{ contract: { tool: "Bash", post: { check: "result", path: "ok", equals: true } }, when: (c) => true }];`,
  );
  const bindings = await loadBindings(url);
  assert.equal(bindings.length, 1);
  assert.equal(bindings[0].contract.tool, "Bash");
  assert.equal(typeof bindings[0].when, "function");
  await rm(dir, { recursive: true, force: true });
});

test("coerces a bare Contract[] default export to bindings", async () => {
  const { url, dir } = await moduleFrom(
    `export default [{ tool: "Write", post: { check: "file_exists", path: "{{args.path}}" } }];`,
  );
  const bindings = await loadBindings(url);
  assert.equal(bindings.length, 1);
  assert.equal(bindings[0].contract.tool, "Write");
  assert.equal(bindings[0].when, undefined);
  await rm(dir, { recursive: true, force: true });
});

test("throws a clear error when the export is not an array", async () => {
  const { url, dir } = await moduleFrom(`export default { nope: true };`);
  await assert.rejects(() => loadBindings(url), /must default-export an array/);
  await rm(dir, { recursive: true, force: true });
});
