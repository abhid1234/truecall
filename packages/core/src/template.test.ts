import test from "node:test";
import assert from "node:assert/strict";
import { getPath, deepEqual, interpolate, TemplateError } from "./template.ts";
import type { Ctx } from "./types.ts";

const ctx: Ctx = {
  tool: "create_file",
  args: { path: "/tmp/out.txt", nested: { id: 7 } },
  result: { id: "abc", state: "sent" },
};

test("getPath reads dotted paths", () => {
  assert.equal(getPath(ctx, "args.path"), "/tmp/out.txt");
  assert.equal(getPath(ctx, "args.nested.id"), 7);
  assert.equal(getPath(ctx, "result.state"), "sent");
  assert.equal(getPath(ctx, "args.missing.deep"), undefined);
});

test("deepEqual compares primitives, arrays, objects", () => {
  assert.equal(deepEqual(1, 1), true);
  assert.equal(deepEqual({ a: [1, 2] }, { a: [1, 2] }), true);
  assert.equal(deepEqual({ a: 1 }, { a: 2 }), false);
  assert.equal(deepEqual([1], [1, 2]), false);
});

test("interpolate substitutes resolved values", () => {
  assert.equal(interpolate("GET /m/{{result.id}}", ctx), "GET /m/abc");
  assert.equal(interpolate("{{args.path}}", ctx), "/tmp/out.txt");
});

test("interpolate applies a transform to each value", () => {
  assert.equal(interpolate("{{result.id}}", ctx, (v) => `'${v}'`), "'abc'");
});

test("interpolate throws TemplateError on missing path (fail-closed)", () => {
  assert.throws(() => interpolate("{{args.nope}}", ctx), TemplateError);
});
