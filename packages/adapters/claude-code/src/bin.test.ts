import test from "node:test";
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { mkdtemp, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

const here = fileURLToPath(new URL(".", import.meta.url));
const tsx = join(here, "..", "node_modules", ".bin", "tsx");
const bin = join(here, "bin.ts");

// Run bin.ts as a subprocess, piping the hook JSON to its stdin.
// (execFile has no `input` option — stdin must be written explicitly, or bin.ts hangs.)
function spawnBin(input: object, env: NodeJS.ProcessEnv): Promise<string> {
  return new Promise((resolve, reject) => {
    const child = spawn(tsx, [bin], { env });
    let out = "";
    child.stdout.on("data", (d) => (out += d.toString()));
    child.on("error", reject);
    child.on("close", () => resolve(out.trim()));
    child.stdin.write(JSON.stringify(input));
    child.stdin.end();
  });
}

async function runBin(input: object, contractsSource: string) {
  const dir = await mkdtemp(join(tmpdir(), "tc-bin-"));
  const mod = join(dir, "contracts.mjs");
  await writeFile(mod, contractsSource);
  try {
    return await spawnBin(input, { ...process.env, TRUECALL_CONTRACTS: mod });
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
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

test("bin is a no-op (does NOT block) when the contracts module is missing", async () => {
  const out = await spawnBin(
    { tool_name: "demo", tool_input: {}, tool_output: { ok: false } },
    { ...process.env, TRUECALL_CONTRACTS: "/nonexistent/truecall.contracts.js" },
  );
  assert.equal(out, "");
});
