import test from "node:test";
import assert from "node:assert/strict";
import { highlightJson } from "./highlight.js";

test("tokens concatenate back to the exact pretty JSON", () => {
  const obj = { tool: "create_file", post: { minSize: 1, ok: true, note: null } };
  const tokens = highlightJson(obj);
  assert.equal(tokens.map((t) => t.text).join(""), JSON.stringify(obj, null, 2));
});

test("classifies keys, strings, numbers", () => {
  const tokens = highlightJson({ a: "x", n: 5 });
  assert.equal(tokens.some((t) => t.cls === "key" && t.text.includes('"a"')), true);
  assert.equal(tokens.some((t) => t.cls === "str" && t.text.includes('"x"')), true);
  assert.equal(tokens.some((t) => t.cls === "num" && t.text.includes("5")), true);
});

test("every token has a class from the known set", () => {
  const tokens = highlightJson({ a: [1, "two", false] });
  const known = new Set(["key", "str", "num", "punct", "plain"]);
  assert.ok(tokens.every((t) => known.has(t.cls)));
});
