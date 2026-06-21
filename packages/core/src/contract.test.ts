import test from "node:test";
import assert from "node:assert/strict";
import { validateContract, contract } from "./contract.ts";

test("a valid file_exists contract has no errors", () => {
  const errs = validateContract({
    tool: "create_file",
    post: { check: "file_exists", path: "{{args.path}}", minSize: 1 },
  });
  assert.deepEqual(errs, []);
});

test("missing tool is an error", () => {
  const errs = validateContract({ tool: "", post: { check: "result", path: "id" } });
  assert.ok(errs.some((e) => e.includes("tool")));
});

test("unknown check type is an error", () => {
  const errs = validateContract({ tool: "t", post: { check: "magic" } as never });
  assert.ok(errs.some((e) => e.includes("known check type")));
});

test("custom verify without describe is an error", () => {
  const errs = validateContract({ tool: "t", post: { verify: () => true } });
  assert.ok(errs.some((e) => e.includes("describe")));
});

test("an array post validates each check", () => {
  const errs = validateContract({
    tool: "t",
    post: [{ check: "file_exists", path: "{{args.path}}" }, { check: "result", path: "id", exists: true }],
  });
  assert.deepEqual(errs, []);
});

test("contract() throws on invalid input", () => {
  assert.throws(() => contract({ tool: "", post: { check: "result", path: "id" } }), /Invalid contract/);
});

test("contract() returns the contract when valid", () => {
  const c = contract({ tool: "create_file", post: { check: "file_exists", path: "{{args.path}}" } });
  assert.equal(c.tool, "create_file");
});
