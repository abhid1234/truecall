import test from "node:test";
import assert from "node:assert/strict";
import { runContract } from "./engine.js";
import { SCENARIOS } from "./scenarios.js";

for (const s of SCENARIOS) {
  test(`${s.id}: verified when the world reflects the effect`, async () => {
    const r = await runContract(s.contract, s.call, s.worlds.ok);
    assert.equal(r.ok, true);
  });
  test(`${s.id}: silent failure caught when the world didn't change`, async () => {
    const r = await runContract(s.contract, s.call, s.worlds.bug);
    assert.equal(r.ok, false);
    assert.ok(r.expected && r.actual && r.message, "signal must carry expected/actual/message");
  });
}

test("fail-closed: a throwing verify yields error:true", async () => {
  const c = { tool: "x", post: { verify: () => { throw new Error("boom"); }, describe: "x" } };
  const r = await runContract(c, { tool: "x", args: {}, result: {} }, {});
  assert.equal(r.ok, false);
  assert.equal(r.error, true);
});

test("missing template path is fail-closed", async () => {
  const c = { tool: "create_file", post: { check: "file_exists", path: "{{args.nope}}" } };
  const r = await runContract(c, { tool: "create_file", args: {}, result: {} }, { files: {} });
  assert.equal(r.ok, false);
  assert.equal(r.error, true);
});
