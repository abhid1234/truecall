import test from "node:test";
import assert from "node:assert/strict";
import { recipes, fromSchema } from "./recipes.ts";
import { validateContract } from "./contract.ts";
import { runCheck } from "./checks.ts";
import type { Ctx } from "./types.ts";

const ctxWith = (result: unknown): Ctx => ({ tool: "t", args: {}, result });

test("every recipe produces a valid contract", () => {
  const cs = [
    recipes.fileExists("create_file", "{{args.path}}", { minSize: 1 }),
    recipes.httpOk("send_email", "https://x/{{result.id}}", { jsonPath: "state", equals: "sent" }),
    recipes.resultShape("publish", { url: "string" }),
    recipes.resultField("save", "id", "r1"),
  ];
  for (const c of cs) assert.deepEqual(validateContract(c), [], `${c.tool} contract should validate`);
});

test("fromSchema maps JSON-schema types and uses `required`", () => {
  const c = fromSchema("create_user", {
    type: "object",
    properties: { id: { type: "string" }, age: { type: "integer" }, active: { type: "boolean" }, meta: {} },
    required: ["id", "age", "meta"],
  });
  assert.deepEqual(validateContract(c), []);
  const post = c.post as { check: "schema"; shape: Record<string, string> };
  assert.equal(post.check, "schema");
  assert.deepEqual(post.shape, { id: "string", age: "number", meta: "present" }); // `active` not required -> omitted
});

test("a fromSchema contract passes good output and fails malformed output", async () => {
  const c = fromSchema("create_user", { properties: { id: { type: "string" }, age: { type: "integer" } } });
  const chk = (c.post as { check: "schema"; shape: Record<string, string> });
  assert.equal((await runCheck(chk as never, ctxWith({ id: "u1", age: 30 }))).passed, true);
  assert.equal((await runCheck(chk as never, ctxWith({ id: "u1", age: "thirty" }))).passed, false);
});
