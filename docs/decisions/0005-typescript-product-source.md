# 0005: TypeScript product source and emitted JavaScript runtime

Status: accepted

Date: 2026-09-01

## Problem

The M0 implementation began as directly executable ESM so the first Electron, runtime-host, and guardian slices could be verified with Node's built-in test runner and no product build step. That kept the prototype small, but the product now has versioned IPC messages, lifecycle state machines, persistent generation records, Electron bridge contracts, and platform-dependent process adapters. A standalone declaration file documents only the renderer surface; it does not type-check the implementations on both sides of these boundaries.

The repository needs one durable source and build convention before more work surfaces and Harness-native plugins are added. The convention must preserve the official CLI/Profile/Bundle boundary, keep the packaged runtime independent of developer-only loaders, and leave repository bootstrap verification runnable before TypeScript output exists.

## Evidence

- `package.json` currently runs product modules and tests directly as `.mjs` and has no type-check command.
- `apps/desktop/contracts.d.ts` declares the renderer bridge, while the Electron main process, guardian protocol, and runtime state implementations are untyped `.mjs` modules.
- `packages/lifecycle-bundle/package.json` exposes JavaScript from a package copied into the generated Harness Profile. Node does not receive a developer loader in that isolated runtime.
- `scripts/verify-contract.mjs` and the provenance scripts are repository bootstrap gates. Keeping those gates directly executable avoids making contract verification depend on generated product output.
- The accepted runtime is Node.js `24.11.1`, the accepted desktop host is Electron `44.0.0`, and both execute native ESM JavaScript.

## Decision

Use strict TypeScript for DSH Work-owned product source, boundary types, and product tests. Compile product source to native ESM JavaScript under ignored `dist/` output before Electron or the official Harness Profile loads it. Production execution must not require `tsx`, `ts-node`, a custom Node loader, or TypeScript source inside generated `node_modules`.

Use TypeScript's Node ESM resolution rules and explicit `.js` import specifiers in source so emitted imports are valid without rewriting. Use `.cts` only where Electron requires a CommonJS preload artifact. Type checking and emission are separate required commands so a no-emit check cannot be mistaken for a runnable build.

Keep repository bootstrap, provenance, build orchestration, and contract-verification scripts as directly executable `.mjs` unless a later decision proves that compiling them strengthens rather than weakens clean-checkout verification. This is a bounded exception, not permission to add new product behavior in untyped JavaScript.

The migration changes DSH Work implementation language and build inputs only. DeepSeek Harness continues to own the Agent runtime and plugin lifecycle; the official CLI, Profile, Bundle, and public-service seams remain unchanged.

## Acceptance and verification

- [ ] A clean install exposes pinned TypeScript build and test tooling as development-only dependencies.
- [ ] `pnpm typecheck` checks all migrated product source and product tests with strict settings and no emitted files.
- [ ] `pnpm build` emits native JavaScript and required static/package assets beneath ignored `dist/`.
- [ ] Electron starts the emitted desktop entry, and the generated Harness Profile contains an emitted JavaScript lifecycle Bundle rather than TypeScript source.
- [ ] Existing unit, contract, official CLI/Profile integration, guardian recovery, and Electron E2E checks pass against the migrated implementation.
- [ ] Bootstrap contract and provenance scripts remain directly runnable from a clean checkout before product output exists.
- [ ] No production dependency or parallel Harness extension boundary is introduced.

Implementation evidence comes from `pnpm typecheck`, `pnpm build`, `pnpm test`, `pnpm check`, the runtime integration suite, and the desktop lifecycle verifier on native macOS and Windows. Change this decision to `implemented` only after the complete migrated source and those affected gates pass.

## Alternatives considered

### Continue with `.mjs` plus declaration files or JSDoc

This retains zero-build execution and could incrementally improve editor feedback. It leaves protocol implementations and state transitions structurally unverified unless every module adopts and maintains detailed annotations, and it keeps declarations separate from their runtime implementation. That maintenance trade-off worsens as desktop and recovery surfaces grow.

### Execute TypeScript directly in production

Node can erase a subset of TypeScript syntax, and developer loaders can execute a broader subset. The lifecycle Bundle is copied beneath a generated Profile's `node_modules`, Electron and standalone Node must behave consistently, and packaged execution must not depend on ambient loader flags. Emitted JavaScript gives those consumers one explicit runtime artifact.

### Bundle all product modules into one artifact

A bundler could reduce runtime files and rewrite resolution. M0 still needs independently testable host, guardian, desktop, and Harness Bundle boundaries. TypeScript emission preserves those boundaries with less packaging policy; a later packaging ADR may add bundling when distribution measurements require it.

## Consequences

- Product changes gain a mandatory install, type-check, and build step.
- Runtime entry points and tests must distinguish source paths from emitted paths.
- Static Electron assets and the lifecycle package manifest/patch must be copied deterministically into `dist/`.
- TypeScript and the development test executor are build-time dependencies only; emitted product code remains ordinary JavaScript.
- Migration commits must preserve behavior and keep the existing executable tests green after each boundary moves.
- New DSH Work product modules default to TypeScript; new bootstrap scripts require an explicit reason to remain JavaScript.

## Rollback or supersession

Before release, rollback by reverting the migration commits and this decision together; generated `dist/` output is disposable. After a release consumes emitted paths, supersede this decision with a migration plan that preserves Profile, Bundle, bridge, and persisted generation compatibility. Reconsider the toolchain if native platform packaging, upstream module semantics, or measured build performance makes the selected emission model untenable.
