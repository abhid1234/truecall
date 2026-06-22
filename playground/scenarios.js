// Curated silent-failure scenarios. Each has a success-shaped tool result, a contract,
// and two simulated worlds: `ok` (the tool really did it) and `bug` (silent failure).
export const SCENARIOS = [
  {
    id: "create_file",
    label: "create_file",
    tool: "create_file",
    blurb: "Writes a file — but did the file actually land?",
    call: { tool: "create_file", args: { path: "/notes/out.txt", contents: "hello world" }, result: { status: "success", path: "/notes/out.txt" } },
    contract: {
      tool: "create_file",
      description: "a non-empty file exists at the requested path",
      post: { check: "file_exists", path: "{{args.path}}", minSize: 1 },
    },
    worlds: {
      ok: { files: { "/notes/out.txt": { size: 11, content: "hello world" } } },
      bug: { files: {} },
    },
    remediation: "retry create_file and confirm the write actually flushed to disk",
  },
  {
    id: "save_record",
    label: "save_record",
    tool: "save_record",
    blurb: "Persists a record to a store — or only claims to.",
    call: { tool: "save_record", args: { id: "r1", body: "buy milk" }, result: { status: "success", id: "r1" } },
    contract: {
      tool: "save_record",
      description: "the record is persisted in the store",
      post: { verify: (ctx, world) => !!(world.store && world.store[ctx.args.id]), describe: "record persisted in the store" },
    },
    worlds: {
      ok: { store: { r1: { id: "r1", body: "buy milk" } } },
      bug: { store: {} },
    },
    remediation: "the write returned success but committed nothing — retry inside a transaction and verify the row",
  },
  {
    id: "send_email",
    label: "send_email",
    tool: "send_email",
    blurb: "Sends an email — re-fetch to confirm it really sent.",
    call: { tool: "send_email", args: { to: "a@b.com", id: "m1" }, result: { status: "success", id: "m1" } },
    contract: {
      tool: "send_email",
      description: "a sent message exists for this recipient",
      post: { check: "http", url: "https://mail.local/api/messages/{{result.id}}", status: 200, jsonPath: "state", equals: "sent" },
    },
    worlds: {
      ok: { http: { "https://mail.local/api/messages/m1": { status: 200, body: { state: "sent" } } } },
      bug: { http: { "https://mail.local/api/messages/m1": { status: 404, body: {} } } },
    },
    remediation: "the API returned 200 but no message record exists — re-queue the send and re-check",
  },
];
