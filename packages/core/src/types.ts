export type Tmpl = string;

export type Ctx = {
  tool: string;
  args: Record<string, unknown>;
  result: unknown;
  /** Optional pre-execution snapshot, captured by wrapTool's `snapshot` option, for delta
   *  checks ("row count increased by 1"). A custom `verify` reads `ctx.before`. */
  before?: unknown;
};

/** Expected JS type for a field in a `schema` check. `"present"` = any non-null value. */
export type SchemaType = "string" | "number" | "boolean" | "object" | "array" | "present";

export type Check =
  | { check: "file_exists"; path: Tmpl; minSize?: number; contains?: string }
  | { check: "http"; url: Tmpl; method?: "GET"; status?: number; jsonPath?: string; equals?: unknown }
  | { check: "shell"; cmd: Tmpl; exitCode?: number; stdoutMatches?: string }
  | { check: "result"; path: string; exists?: boolean; equals?: unknown }
  | { check: "schema"; path?: string; shape: Record<string, SchemaType> }
  | { verify: (ctx: Ctx) => boolean | Promise<boolean>; describe?: string };

export type Contract = {
  tool: string;
  description?: string;
  post: Check | Check[];
  timeoutMs?: number;
};

export type VerifyResult =
  | { ok: true }
  | {
      ok: false;
      tool: string;
      expected: string;
      actual: string;
      message: string;
      remediation?: string;
      error?: boolean;
    };
