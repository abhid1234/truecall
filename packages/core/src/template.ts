import type { Ctx } from "./types.ts";

export class TemplateError extends Error {}

export function getPath(obj: unknown, path: string): unknown {
  return path.split(".").reduce<unknown>((acc, key) => {
    if (acc == null || typeof acc !== "object") return undefined;
    return (acc as Record<string, unknown>)[key];
  }, obj);
}

export function deepEqual(a: unknown, b: unknown): boolean {
  if (a === b) return true;
  if (typeof a !== "object" || typeof b !== "object" || a === null || b === null) return false;
  if (Array.isArray(a) !== Array.isArray(b)) return false;
  const ka = Object.keys(a as object);
  const kb = Object.keys(b as object);
  if (ka.length !== kb.length) return false;
  return ka.every(
    (k) =>
      Object.prototype.hasOwnProperty.call(b, k) &&
      deepEqual((a as Record<string, unknown>)[k], (b as Record<string, unknown>)[k]),
  );
}

const TOKEN = /\{\{\s*([\w.]+)\s*\}\}/g;

export function interpolate(tmpl: string, ctx: Ctx, transform: (v: string) => string = (v) => v): string {
  return tmpl.replace(TOKEN, (_match, expr: string) => {
    const val = getPath(ctx, expr);
    if (val === undefined) {
      throw new TemplateError(`template path "{{${expr}}}" resolved to undefined`);
    }
    return transform(String(val));
  });
}
