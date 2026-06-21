import test from "node:test";
import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { mkdtemp, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

const pexec = promisify(execFile);
const here = fileURLToPath(new URL(".", import.meta.url));
const tsx = join(here, "..", "node_modules", ".bin", "tsx");
const bin = join(here, "bin.ts");

async function runBin(input: object, contractsSource: string) {
  const dir = await mkdtemp(join(tmpdir(), "tc-bin-"));
  const mod = join(dir, "contracts.mjs");
  await writeFile(mod, contractsSource);
  const res = await pexec(tsx, [bin], {
    env: { ...process.env, TRUECALL_CONTRACTS: mod },
    input: JSON.stringify(input),
  } as never);
  await rm(dir, { recursive: true, force: true });
  return ((res.stdout as unknown) as string).trim();
}

const FAIL_CONTRACTS = `export default [{ contract: { tool: "demo", post: { check: "result", path: "ok", equals: true } } }];`;

test("bin emits block JSON on a failing post-condition", async () => {
  const out = await runBin({ tool_name: "demo", tool_input: {}, tool_output: { ok: false } }, FAIL_CONTRACTS);
  assert.equal(JSON.parse(out).decision, "block");
});

test("bin emits nothing on a passing post-condition", async () => {
  const out = await runBin({ tool_name: "demo", tool_input: {}, tool_output: { ok: true } }, FAIL_CONTRACTS);
  assert.equal(out, "");
});

test("bin emits nothing when no contract matches", async () => {
  const out = await runBin({ tool_name: "unmatched", tool_input: {}, tool_output: {} }, FAIL_CONTRACTS);
  assert.equal(out, "");
});
