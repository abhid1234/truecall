import { resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { handleHookEvent, type HookInput } from "./hook.ts";
import { loadBindings, type Binding } from "./registry.ts";

async function readStdin(): Promise<string> {
  return new Promise((resolve, reject) => {
    const chunks: string[] = [];
    let resolved = false;
    let dataReceived = false;

    process.stdin.setEncoding("utf8");

    // If stdin is not a TTY and no data is available immediately, wait a bit
    // But if we get data, resolve as soon as we detect the pattern or timeout
    const initialTimer = setTimeout(() => {
      if (!resolved) {
        if (dataReceived) {
          resolved = true;
          resolve(chunks.join(""));
        }
      }
    }, 50);

    process.stdin.on("data", (chunk) => {
      if (!resolved) {
        dataReceived = true;
        chunks.push(typeof chunk === "string" ? chunk : chunk.toString());
      }
    });

    process.stdin.on("end", () => {
      if (!resolved) {
        resolved = true;
        clearTimeout(initialTimer);
        resolve(chunks.join(""));
      }
    });

    process.stdin.on("error", (err) => {
      if (!resolved) {
        resolved = true;
        clearTimeout(initialTimer);
        reject(err);
      }
    });
  });
}

async function main(): Promise<void> {
  const raw = await readStdin();
  let input: HookInput;
  try {
    input = JSON.parse(raw) as HookInput;
  } catch {
    return; // malformed hook input: do nothing
  }

  const modPath = process.env.TRUECALL_CONTRACTS ?? resolve(process.cwd(), "truecall.contracts.js");
  let bindings: Binding[];
  try {
    bindings = await loadBindings(pathToFileURL(modPath).href);
  } catch (e) {
    // No (or unloadable) contracts module = verification not configured here. Don't block tool calls.
    process.stderr.write(`${(e as Error).message}\n`);
    return;
  }

  const out = await handleHookEvent(input, bindings);
  if (out) process.stdout.write(out);
}

main().catch((e) => {
  // Unexpected failure: fail-closed so a broken hook doesn't silently disable verification.
  process.stdout.write(
    JSON.stringify({
      decision: "block",
      reason: `TrueCall hook error: ${(e as Error).message}`,
      hookSpecificOutput: {
        hookEventName: "PostToolUse",
        additionalContext: "TrueCall could not run its post-condition check; verify the tool's effect manually.",
      },
    }),
  );
});
