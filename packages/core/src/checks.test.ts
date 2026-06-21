import test from "node:test";
import assert from "node:assert/strict";
import { writeFile, mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createServer } from "node:http";
import type { AddressInfo } from "node:net";
import { runCheck } from "./checks.ts";
import type { Ctx } from "./types.ts";

function ctxWith(args: Record<string, unknown>, result: unknown = {}): Ctx {
  return { tool: "t", args, result };
}

test("file_exists passes for a non-empty file, fails when absent", async () => {
  const dir = await mkdtemp(join(tmpdir(), "tc-"));
  const path = join(dir, "out.txt");
  await writeFile(path, "hello");
  const pass = await runCheck({ check: "file_exists", path: "{{args.path}}", minSize: 1 }, ctxWith({ path }));
  assert.equal(pass.passed, true);
  const fail = await runCheck({ check: "file_exists", path: "{{args.path}}" }, ctxWith({ path: join(dir, "nope.txt") }));
  assert.equal(fail.passed, false);
  await rm(dir, { recursive: true, force: true });
});

test("file_exists honors contains", async () => {
  const dir = await mkdtemp(join(tmpdir(), "tc-"));
  const path = join(dir, "c.ini");
  await writeFile(path, "[settings]\nx=1");
  const ok = await runCheck({ check: "file_exists", path: "{{args.path}}", contains: "[settings]" }, ctxWith({ path }));
  assert.equal(ok.passed, true);
  const no = await runCheck({ check: "file_exists", path: "{{args.path}}", contains: "[missing]" }, ctxWith({ path }));
  assert.equal(no.passed, false);
  await rm(dir, { recursive: true, force: true });
});

test("result asserts on the tool payload", async () => {
  const ctx = ctxWith({}, { id: "x1", state: "sent" });
  assert.equal((await runCheck({ check: "result", path: "id", exists: true }, ctx)).passed, true);
  assert.equal((await runCheck({ check: "result", path: "state", equals: "sent" }, ctx)).passed, true);
  assert.equal((await runCheck({ check: "result", path: "state", equals: "draft" }, ctx)).passed, false);
  assert.equal((await runCheck({ check: "result", path: "missing", exists: true }, ctx)).passed, false);
});

test("shell checks exit code and stdout", async () => {
  const okExit = await runCheck({ check: "shell", cmd: "exit 0" }, ctxWith({}));
  assert.equal(okExit.passed, true);
  const badExit = await runCheck({ check: "shell", cmd: "exit 3" }, ctxWith({}));
  assert.equal(badExit.passed, false);
  const match = await runCheck({ check: "shell", cmd: "echo hello-{{args.name}}", stdoutMatches: "hello-bob" }, ctxWith({ name: "bob" }));
  assert.equal(match.passed, true);
});

test("shell escapes interpolated values", async () => {
  // a value with a space must not break the command; printf echoes it back
  const out = await runCheck(
    { check: "shell", cmd: "printf %s {{args.v}}", stdoutMatches: "^a b$" },
    ctxWith({ v: "a b" }),
  );
  assert.equal(out.passed, true);
});

test("http re-fetch asserts status and json field", async () => {
  const server = createServer((req, res) => {
    if (req.url === "/m/abc") {
      res.writeHead(200, { "content-type": "application/json" });
      res.end(JSON.stringify({ state: "sent" }));
    } else {
      res.writeHead(404);
      res.end();
    }
  });
  await new Promise<void>((r) => server.listen(0, r));
  const port = (server.address() as AddressInfo).port;
  const ctx = ctxWith({}, { id: "abc" });
  const ok = await runCheck(
    { check: "http", url: `http://127.0.0.1:${port}/m/{{result.id}}`, status: 200, jsonPath: "state", equals: "sent" },
    ctx,
  );
  assert.equal(ok.passed, true);
  const wrong = await runCheck(
    { check: "http", url: `http://127.0.0.1:${port}/m/{{result.id}}`, status: 200, jsonPath: "state", equals: "draft" },
    ctx,
  );
  assert.equal(wrong.passed, false);
  await new Promise<void>((r) => server.close(() => r()));
});

test("custom verify is dispatched and uses describe", async () => {
  const ok = await runCheck({ verify: () => true, describe: "always true" }, ctxWith({}));
  assert.equal(ok.passed, true);
  assert.equal(ok.expected, "always true");
  const no = await runCheck({ verify: async () => false, describe: "never" }, ctxWith({}));
  assert.equal(no.passed, false);
});

test("custom verify throw propagates (verifier error)", async () => {
  await assert.rejects(() => runCheck({ verify: () => { throw new Error("boom"); }, describe: "x" }, ctxWith({})));
});
