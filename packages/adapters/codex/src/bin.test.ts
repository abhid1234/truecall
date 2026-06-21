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

test("codex delegate bin emits block JSON on a failing post-condition (uses tool_response)", async () => {
  const dir = await mkdtemp(join(tmpdir(), "tc-codex-"));
  const mod = join(dir, "contracts.mjs");
  await writeFile(mod, `export default [{ contract: { tool: "demo", post: { check: "result", path: "ok", equals: true } } }];`);
  try {
    const out = await spawnBin(
      // Codex delivers the result under `tool_response`; the shared handler reads tool_output ?? tool_response.
      { tool_name: "demo", tool_input: {}, tool_response: { ok: false } },
      { ...process.env, TRUECALL_CONTRACTS: mod },
    );
    assert.equal(JSON.parse(out).decision, "block");
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});
