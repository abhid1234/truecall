import type { Contract, SchemaType } from "./types.ts";

// Ready-made contract factories for common tool shapes — cut the boilerplate of the
// most frequent post-conditions. Each returns a plain Contract you can pass to wrapTool
// or an adapter binding (and tweak afterward).
export const recipes = {
  /** After a tool writes a file: assert it exists (optionally non-empty / contains text). */
  fileExists(tool: string, path: string, opts: { minSize?: number; contains?: string } = {}): Contract {
    return { tool, description: `a file exists at ${path}`, post: { check: "file_exists", path, ...opts } };
  },
  /** After a write-style API call: re-fetch and assert status (and optionally a JSON field). */
  httpOk(tool: string, url: string, opts: { status?: number; jsonPath?: string; equals?: unknown } = {}): Contract {
    const post = { check: "http" as const, url, status: opts.status ?? 200,
      ...(opts.jsonPath !== undefined ? { jsonPath: opts.jsonPath, equals: opts.equals } : {}) };
    return { tool, description: `${url} responds ${post.status}`, post };
  },
  /** Assert the tool's result matches an expected shape (field -> type). */
  resultShape(tool: string, shape: Record<string, SchemaType>, path?: string): Contract {
    return { tool, description: "the result matches the expected shape",
      post: path ? { check: "schema", path, shape } : { check: "schema", shape } };
  },
  /** Assert a field on the tool's own result (present, or equal to a value). */
  resultField(tool: string, path: string, equals?: unknown): Contract {
    return { tool, description: `result.${path} is correct`,
      post: equals === undefined ? { check: "result", path, exists: true } : { check: "result", path, equals } };
  },
};

const JSON_TYPE: Record<string, SchemaType> = {
  string: "string", number: "number", integer: "number", boolean: "boolean", array: "array", object: "object",
};

/**
 * Generate a STARTER contract from a tool's result schema (a JSON-Schema-ish object).
 * It produces a `schema` check over the required (or all) result fields — a fast on-ramp
 * that catches malformed/missing output. It is a *shape* check, not a real-world-effect
 * check: strengthen it (file_exists / http re-fetch / custom verify) to confirm the world
 * actually changed.
 */
export function fromSchema(
  tool: string,
  schema: { type?: string; properties?: Record<string, { type?: string }>; required?: string[] },
): Contract {
  const props = schema.properties ?? {};
  const required = schema.required ?? Object.keys(props);
  const shape: Record<string, SchemaType> = {};
  for (const key of required) {
    const t = props[key]?.type;
    shape[key] = t ? (JSON_TYPE[t] ?? "present") : "present";
  }
  return {
    tool,
    description: "(starter) result matches the tool's declared schema — strengthen to a real-world-effect check",
    post: { check: "schema", shape },
  };
}
