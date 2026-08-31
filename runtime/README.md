# Product runtime inputs

The [accepted baseline](baseline.json) selects the official standalone Node, Harness CLI, and Electron versions. The root package manifest and lockfile materialize that selection separately from historical research fixtures. Ordinary desktop launch must not install packages or fall back to a global `dsh` or Node.

Dependency purpose and license: `@deepseek-ai/dsh` is the supported CLI application boundary; `@deepseek-ai/dsh-cmdline` exposes the public `exitOnStdinEnd` helper to the out-of-tree Bundle. Both upstream package manifests declare MIT. Electron (MIT) is the accepted desktop host. Redistribution still requires a complete transitive license/notice inventory, including Chromium/Node notices; these direct declarations are not a distribution audit.

Build-time install: `pnpm install --frozen-lockfile`. Only Electron's installation script is allowed; no Harness source build or patch step is introduced. All DSH-family packages must resolve to alpha.2. The known upstream React/React DOM peer mismatch remains a browser-rendering gate, not a reason for an unreviewed override.

Packaging status: development inputs only. Per-platform standalone Node archives, complete dependency bytes, native modules, ASAR placement, signing, and no-global-tools launch still need immutable distribution manifests and native package verification. No runnable release is claimed by adding this lockfile.

Rollback: revert the bounded product dependency commit before dependent behavior is adopted, or revert its dependent commit set together. Do not change user global installations or downgrade an existing user Profile without separate migration evidence. Baseline changes require a superseding ADR.

## Development lifecycle checks

Use a prepared archive context (`source`, `tarball`, `node`, `nodeArchive`) from the [frozen preparation tool](../prototypes/m0-runtime-upgrade/README.md). Check the **root product installation**, not the historical probe installation:

```sh
node scripts/verify-product-runtime.mjs /absolute/path/to/context.json
pnpm test
DSH_WORK_NODE=/absolute/path/to/verified/node pnpm test:runtime
node scripts/verify-product-runtime.mjs /absolute/path/to/context.json
pnpm check
```

The real Profile tests cover three normal cycles, invalid startup with early EOF and retry in the same isolated home, and successful early EOF. These prove direct-child/Bundle observations only. [Slice acceptance](../docs/acceptance/electron-lifecycle-slice.md) tracks the security, desktop and native-platform gates separately.

## Electron development window

```sh
DSH_WORK_NODE=/absolute/path/to/verified/node pnpm desktop
DSH_WORK_NODE=/absolute/path/to/verified/node pnpm test:desktop
```

These POSIX shell examples require the verified standalone Node path; on PowerShell set `$env:DSH_WORK_NODE` before running the pnpm command. A missing or mismatched runtime produces a safe error state, never a global-tool fallback. The window uses a new isolated temporary Profile per application launch, preserved across start/stop cycles in that launch. Closing the window waits for direct-child shutdown. This is not the persistent user workspace or a packaged app.

`test:desktop` explicitly opens real Electron windows and records normal and missing-runtime scenarios plus screenshots under ignored `artifacts/desktop/`. Ordinary `pnpm test` remains headless. The Electron UI uses a private custom protocol and no remote scripts, fonts or content. Sender checks and sandboxed preload follow the [Electron security guidance](https://www.electronjs.org/docs/latest/tutorial/security); startup scheduling observes the [ESM ready-event caveat](https://www.electronjs.org/docs/latest/tutorial/esm).

The local status page is not the Harness browser UI. Its readiness evidence comes from public `appReady`; these desktop screenshots do not verify the upstream React UI or its peer-dependency mismatch. Visual review is a candidate until compared with a product-approved baseline; screenshots alone do not imply visual acceptance.

## Reproducible native verification

```sh
node scripts/verify-local.mjs /absolute/path/to/context.json --desktop
```

Without `--desktop`, the same command runs only headless checks. The runner invalidates stale success first, verifies product provenance before/after, runs unit/contract/real Profile checks and optional Electron E2E, then compares the Git revision and SHA-256 of every repository input. A dirty-tree run is labelled; only a clean revision-bound run is a candidate for CI handoff. Reports and sanitized test logs live under ignored `artifacts/verification/`; desktop reports bind per-run IDs and screenshot hashes.

[Desktop lifecycle CI](../.github/workflows/desktop-lifecycle.yml) runs the same command on native macOS arm64 and Windows x64 after push/PR. It is development verification, not an installer or M0 release gate replacement. Configuration in Git is not evidence that a remote run happened or passed.
