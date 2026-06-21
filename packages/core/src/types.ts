export type Tmpl = string;

export type Ctx = {
  tool: string;
  args: Record<string, unknown>;
  result: unknown;
};

export type Check =
  | { check: "file_exists"; path: Tmpl; minSize?: number; contains?: string }
  | { check: "http"; url: Tmpl; method?: "GET"; status?: number; jsonPath?: string; equals?: unknown }
  | { check: "shell"; cmd: Tmpl; exitCode?: number; stdoutMatches?: string }
  | { check: "result"; path: string; exists?: boolean; equals?: unknown }
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
