import { fileURLToPath } from "node:url";
import { contract, wrapTool } from "../../packages/core/src/index.ts";

export type Store = Map<string, { id: string; body: string }>;

// A tool with the tau-bench "silent success" bug: returns success but never persists.
function buggySaveRecord(_args: Record<string, unknown>) {
  return Promise.resolve({ status: "success", id: String(_args.id) });
}

export async function runWithout(store: Store) {
  const res = await buggySaveRecord({ id: "r1", body: "hello" });
  return { reported: res.status, persisted: store.has("r1") };
}

export async function runWith(store: Store) {
  const verified = wrapTool(
    contract({
      tool: "save_record",
      description: "the record is persisted in the store",
      post: { verify: ({ args }) => store.has(String(args.id)), describe: "record persisted in store" },
    }),
    buggySaveRecord,
  );
  const first = await verified({ id: "r1", body: "hello" });
  if (first.ok) return { corrected: false, persisted: store.has("r1") };

  // The agent reacts to the correction signal by calling the FIXED writer.
  store.set("r1", { id: "r1", body: "hello" });
  return { corrected: true, signal: first.signal.message, persisted: store.has("r1") };
}

async function main() {
  console.log("=== WITHOUT TrueCall ===");
  const a = await runWithout(new Map());
  console.log(`tool reported: ${a.reported}  ->  agent says: done ✅`);
  console.log(`reality: record persisted = ${a.persisted}  ${a.persisted ? "" : "❌ SILENT FAILURE"}\n`);

  console.log("=== WITH TrueCall ===");
  const store: Store = new Map();
  const b = await runWith(store);
  console.log(`TrueCall caught it: "${b.signal}"`);
  console.log(`agent self-corrects -> record persisted = ${b.persisted}  ${b.persisted ? "✅ actually done" : "❌"}`);
}

if (process.argv[1] === fileURLToPath(new URL(import.meta.url))) {
  main().catch(console.error);
}
