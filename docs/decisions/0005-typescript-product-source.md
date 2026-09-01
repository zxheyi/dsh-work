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

Use TypeScript source extensions for relative imports: `.ts` in ESM product and test modules, and `.cts` only where Electron requires a CommonJS preload artifact. Configure TypeScript to allow those source extensions and rewrite them to `.js` or `.cjs` during emission. This keeps source imports directly traceable to checked TypeScript modules while ensuring every production consumer loads ordinary JavaScript. Type checking and emission remain separate required commands so a no-emit check cannot be mistaken for a runnable build.

Minimize third-party dependencies and direct third-party imports. For DSH Work-owned logic, prefer the TypeScript type system, ECMAScript and Web APIs, and the Node.js standard library. Use Electron and official DeepSeek Harness packages only at their accepted platform and composition seams. Add another package only when repository evidence shows that it removes material implementation complexity or risk; record its necessity, license, packaging impact, security and maintenance cost, verification, and rollback. Convenience alone is not sufficient justification.

Keep repository bootstrap, provenance, build orchestration, and contract-verification scripts as directly executable `.mjs` unless a later decision proves that compiling them strengthens rather than weakens clean-checkout verification. This is a bounded exception, not permission to add new product behavior in untyped JavaScript.

The migration changes DSH Work implementation language and build inputs only. DeepSeek Harness continues to own the Agent runtime and plugin lifecycle; the official CLI, Profile, Bundle, and public-service seams remain unchanged.

## Acceptance and verification

- [x] A clean install exposes pinned TypeScript build and test tooling as development-only dependencies.
- [x] `pnpm typecheck` checks all migrated product source and product tests with strict settings and no emitted files.
- [x] `pnpm build` emits native JavaScript and required static/package assets beneath ignored `dist/`.
- [x] Relative TypeScript source imports use `.ts` or the bounded `.cts` preload exception, and build output rewrites them to runnable JavaScript extensions.
- [x] Electron starts the emitted desktop entry, and the generated Harness Profile contains an emitted JavaScript lifecycle Bundle rather than TypeScript source.
- [x] Existing unit, contract, official CLI/Profile integration, guardian recovery, and Electron E2E checks pass against the migrated implementation on native macOS arm64.
- [ ] The same affected gates pass against the migrated implementation on native Windows x64.
- [x] Bootstrap contract and provenance scripts remain directly runnable from a clean checkout before product output exists.
- [x] DSH Work-owned product logic introduces no general-purpose third-party utility or framework dependency.
- [x] No production dependency or parallel Harness extension boundary is introduced.

Implementation evidence comes from `pnpm typecheck`, `pnpm build`, `pnpm test`, `pnpm check`, the runtime integration suite, and the desktop lifecycle verifier on native macOS and Windows. Change this decision to `implemented` only after the complete migrated source and those affected gates pass.

The migration candidate passed strict type checking, 68 unit/contract tests, 10 official CLI/Profile and guardian integration scenarios, and all five Electron lifecycle modes on native macOS arm64. Product source and product tests are TypeScript; the remaining `.mjs` files are the bounded bootstrap/build/provenance/contract exception. The delayed-startup fixture also remains directly executable JavaScript because the official Harness test Profile loads it from generated `node_modules` without a TypeScript loader. Native Windows x64 evidence is still required before changing this decision from `accepted` to `implemented`.

## Alternatives considered

### Continue with `.mjs` plus declaration files or JSDoc

This retains zero-build execution and could incrementally improve editor feedback. It leaves protocol implementations and state transitions structurally unverified unless every module adopts and maintains detailed annotations, and it keeps declarations separate from their runtime implementation. That maintenance trade-off worsens as desktop and recovery surfaces grow.

### Execute TypeScript directly in production

Node can erase a subset of TypeScript syntax, and developer loaders can execute a broader subset. The lifecycle Bundle is copied beneath a generated Profile's `node_modules`, Electron and standalone Node must behave consistently, and packaged execution must not depend on ambient loader flags. Emitted JavaScript gives those consumers one explicit runtime artifact.

### Bundle all product modules into one artifact

A bundler could reduce runtime files and rewrite resolution. M0 still needs independently testable host, guardian, desktop, and Harness Bundle boundaries. TypeScript emission preserves those boundaries with less packaging policy; a later packaging ADR may add bundling when distribution measurements require it.

### Adopt utility libraries or an additional application framework

Utility packages can shorten individual implementations, and another framework could provide its own state, IPC, or process abstractions. M0 already has the TypeScript, Web, Node.js, Electron, and Harness public capabilities needed by the accepted product boundary. Adding another abstraction layer would enlarge the dependency, packaging, security, and maintenance surface before measured complexity justifies it.

## Consequences

- Product changes gain a mandatory install, type-check, and build step.
- Runtime entry points and tests must distinguish source paths from emitted paths.
- Static Electron assets and the lifecycle package manifest/patch must be copied deterministically into `dist/`.
- TypeScript and the development test executor are build-time dependencies only; emitted product code remains ordinary JavaScript.
- Relative imports name their TypeScript source files; build emission is responsible for producing runtime-safe JavaScript extensions.
- New third-party packages are exceptional and require repository evidence for necessity, lifecycle cost, and rollback.
- Migration commits must preserve behavior and keep the existing executable tests green after each boundary moves.
- New DSH Work product modules default to TypeScript; new bootstrap scripts require an explicit reason to remain JavaScript.

## Rollback or supersession

Before release, rollback by reverting the migration commits and this decision together; generated `dist/` output is disposable. After a release consumes emitted paths, supersede this decision with a migration plan that preserves Profile, Bundle, bridge, and persisted generation compatibility. Reconsider the toolchain if native platform packaging, upstream module semantics, or measured build performance makes the selected emission model untenable.
