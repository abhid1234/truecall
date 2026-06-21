import type { Contract, Ctx } from "../../../core/src/types.ts";

export type Binding = { contract: Contract; when?: (ctx: Ctx) => boolean };

export async function loadBindings(moduleUrl: string): Promise<Binding[]> {
  let mod: Record<string, unknown>;
  try {
    mod = (await import(moduleUrl)) as Record<string, unknown>;
  } catch (e) {
    throw new Error(`TrueCall: could not load contracts module "${moduleUrl}": ${(e as Error).message}`);
  }
  const raw = mod.default as unknown;
  if (!Array.isArray(raw)) {
    throw new Error(
      `TrueCall: contracts module "${moduleUrl}" must default-export an array of bindings or contracts`,
    );
  }
  return raw.map((item) => {
    if (item && typeof item === "object" && "contract" in item) {
      const b = item as { contract: Contract; when?: (ctx: Ctx) => boolean };
      return { contract: b.contract, when: b.when };
    }
    return { contract: item as Contract };
  });
}
