# npm Publish Plan

> How to get from "clone the repo" to `npm install @truecall/core`. Grounded in a verified local build —
> not speculative. Publishing itself is an outward-facing step that needs your npm auth (and possibly an
> unrestricted network); everything up to that point is automatable in-repo.

## Strategy: publish the core first, defer the adapters

**v1 — publish `@truecall/core` only.** It's the valuable, reusable, genuinely dependency-free unit: the
contract format + the verifier. It is fully self-contained (no cross-package imports), so it publishes
cleanly today.

**Defer the three adapter packages to v2.** They import the core/shared package by *relative source path*
(`../../../core/src/...`, `../../shared/src/...`), which only resolves inside this monorepo. To publish them
as standalone npm packages they'd need to import by package name (`@truecall/adapter-core`) + declare it as
a dependency + a workspace-linking setup — and workspace linking needs `npm install`, which the locked-down
build environment blocks locally. The adapters are also thin hook-glue that users wire via a hook `command`
pointing at a path, so npm distribution matters far less for them than for the core. Ship the core now;
solve the adapter-publish story deliberately later (see "v2" below).

This keeps the rule intact: **the published core has zero runtime dependencies.**

## The build (verified working)

The source uses `.ts`-extension imports (`import { x } from "./verify.ts"`), which normally break when tsc
emits. TypeScript 5.7+'s `rewriteRelativeImportExtensions` rewrites them to `.js` on emit. Confirmed locally
with tsc 5.9.3: the emitted `dist/` is plain JS + `.d.ts`, the import specifiers become `./verify.js`, and
**the output runs on vanilla Node with no tsx** (`exports: contract,runCheck,runContract,validateContract,wrapTool`).

### Step 1 — add `packages/core/tsconfig.build.json`
```json
{
  "compilerOptions": {
    "target": "ES2022",
    "module": "NodeNext",
    "moduleResolution": "NodeNext",
    "strict": true,
    "declaration": true,
    "skipLibCheck": true,
    "types": ["node"],
    "allowImportingTsExtensions": true,
    "rewriteRelativeImportExtensions": true,
    "noEmit": false,
    "outDir": "dist",
    "rootDir": "src"
  },
  "include": ["src/**/*.ts"],
  "exclude": ["src/**/*.test.ts"]
}
```
(Keep the existing `tsconfig.json` with `noEmit: true` for typecheck/tests; the build config is separate.)

### Step 2 — update `packages/core/package.json`
```json
{
  "name": "@truecall/core",
  "version": "0.1.0",
  "description": "Deterministic runtime post-condition verification for AI agent tool calls.",
  "license": "MIT",
  "type": "module",
  "main": "./dist/index.js",
  "module": "./dist/index.js",
  "types": "./dist/index.d.ts",
  "exports": { ".": { "types": "./dist/index.d.ts", "default": "./dist/index.js" } },
  "files": ["dist", "README.md", "LICENSE"],
  "repository": { "type": "git", "url": "git+https://github.com/abhid1234/truecall.git", "directory": "packages/core" },
  "homepage": "https://github.com/abhid1234/truecall#readme",
  "keywords": ["ai", "agent", "tool-use", "verification", "post-condition", "llm", "reliability", "mcp", "claude-code", "codex"],
  "scripts": {
    "typecheck": "tsc --noEmit",
    "test": "tsx --test \"src/**/*.test.ts\"",
    "build": "rm -rf dist && tsc -p tsconfig.build.json",
    "prepublishOnly": "npm run build"
  }
}
```
Notes: bump to `0.1.0` (first real release). `prepublishOnly` is **build-only** on purpose — `typecheck`/`test`
need `@types/node`/`tsx` from the symlinked toolchain, which won't exist on a different publish machine, so
gating publish on them would be fragile cross-machine. Run them as a manual pre-publish gate instead (runbook
step 0). Scoped packages publish private by default, so publishing needs `--access public` (see runbook).

### Step 3 — ignore the build output
Add `dist` to `packages/core/.gitignore` (alongside `node_modules`). `dist` is generated at publish time;
don't commit it.

### Step 4 — a publish-facing README
`packages/core/` currently has no README. Add a short one (install + a 6-line usage example + a link back to
the monorepo). The root `README.md` is great for the repo; npm shows the *package* README, so the core needs
its own. Reuse the example from the root README's quick-start.

## Publish runbook (your steps — needs auth + network)

> `npm publish` is an outbound call to `registry.npmjs.org`. The locked-down build environment may block it —
> if so, publish from an unrestricted network. None of the steps above require that; only these do.

0. **Build on the toolchain machine** (where `tsc` + `@types/node` resolve via the symlink): `cd packages/core
   && npm run typecheck && npm test && npm run build`. This produces `dist/`. If you'll publish from a
   *different* machine that lacks the toolchain, copy the built `dist/` over and publish with
   `npm publish --access public --ignore-scripts` so `prepublishOnly` doesn't try to rebuild there.
1. **One-time:** ensure the npm `@truecall` scope/org exists under your account, and `npm login`.
2. `cd packages/core`
3. **Dry run** (no upload, purely local): `npm pack --dry-run` — inspect the file list; confirm only
   `dist/`, `README.md`, `LICENSE`, `package.json` are included (no `src`, no `node_modules`, no tests).
4. **Publish:** `npm publish --access public` (add `--ignore-scripts` if `dist/` is prebuilt per step 0).
5. **Verify:** `npm view @truecall/core version` → `0.1.0`; then in a scratch dir:
   `npm init -y && npm i @truecall/core && node -e "import('@truecall/core').then(m=>console.log(Object.keys(m)))"`
   — confirm it imports on plain Node with no extra tooling.
6. Tag the release in git: `git tag core-v0.1.0 && git push --tags`.

## v2 — publishing the adapters (deferred)

When ready, the adapters need standalone resolution. The cleanest path:
1. Rename the shared package to a published name (already `@truecall/adapter-core`) and give it the same
   build treatment as the core.
2. Change adapter imports from `../../shared/src/...` to `@truecall/adapter-core`, and add it to each
   adapter's `dependencies` (an internal dep — still zero *external* deps).
3. Restore local dev with an npm workspace or `npm link` (needs a one-time `npm install`/link in an
   unrestricted environment; document it so the Airlock machine isn't required for dev).
4. Each adapter publishes its own thin `bin` + the build; the install docs switch from a repo path to
   `npx @truecall/adapter-codex` (or a published bin).
This is a self-contained follow-up; it doesn't block the core release.

## Acceptance
- `@truecall/core@0.1.0` is installable from npm and imports on vanilla Node with zero dependencies.
- The published tarball contains only `dist` + `README` + `LICENSE` (verified via `--dry-run`).
- The repo build (`npm run build` in `packages/core`) reproduces `dist/` deterministically.
- Adapters remain repo-installed (documented), with a clear v2 path to publish them.
