# Product runtime inputs

The [accepted baseline](baseline.json) is the machine-readable selection of the official DeepSeek Harness source, npm runtime, standalone Node, pnpm, and Electron versions. The root package manifest and lockfile materialize that selection independently of the frozen research branch. Ordinary product launch must never install packages or fall back to a global `dsh` or Node.

`@deepseek-ai/dsh` is the supported CLI application boundary. `@deepseek-ai/dsh-cmdline` exposes the public launcher helper needed by the separately delivered lifecycle Bundle. Both upstream package manifests declare MIT. Electron (MIT) is the accepted desktop host. Redistribution still requires a complete transitive license and notice inventory, including Chromium and Node notices; these direct declarations are not a distribution audit.

## Reproducible verification

Install exactly the accepted dependency graph without running package lifecycle scripts, then materialize and verify the official source, package, and native Node bytes:

```sh
pnpm install --frozen-lockfile --ignore-scripts
pnpm runtime:prepare
pnpm runtime:verify
pnpm test
pnpm check
```

The preparation command is a controlled build/verification action. It downloads the pinned official artifacts into a temporary directory and writes only an ignored `artifacts/runtime/context.json` receipt path into the repository. It is never part of ordinary application launch.

The verifier checks the exact upstream remote, tag, commit and byte-clean source; official root npm archive bytes against the installed package; official Node archive and executable bytes; the locked DSH-family version set; and the root lockfile integrity. The native CI matrix repeats this on macOS arm64 and Windows x64.

## Current boundary

This baseline makes `main` installable and independently verifiable. The repository also contains a separately reviewable development-only [Electron lifecycle slice](../docs/acceptance/electron-lifecycle-slice.md) with a persistent product-owned Profile generation and external runtime guardian. It does not provide packaging, signing, user workspace migration, or a runnable release.

Only Electron's install script is allowed by the root manifest when scripts are enabled. No Harness source build or patch step is introduced. The known upstream React/React DOM peer mismatch remains a browser-rendering gate, not a reason for an unreviewed override.

Rollback the bounded runtime-baseline change before dependent behavior is adopted, or revert it together with its dependent changes. Do not change global installations or downgrade an existing user Profile. Any future baseline change requires a superseding ADR and new native evidence.

## Development desktop

After preparing the verified runtime and installing Electron's accepted artifact, launch or test the status window with the explicit standalone Node path from `artifacts/runtime/context.json`:

```sh
pnpm typecheck
pnpm build
node node_modules/electron/install.js
DSH_WORK_NODE=/absolute/path/to/verified/node pnpm desktop
DSH_WORK_NODE=/absolute/path/to/verified/node pnpm test:runtime
DSH_WORK_NODE=/absolute/path/to/verified/node pnpm test:desktop
pnpm verify:local
```

On PowerShell, set `$env:DSH_WORK_NODE` before the relevant command. A missing or mismatched runtime produces a safe error state and never a global-tool fallback. `verify:local` runs the full revision-bound provenance, lifecycle, and actual Electron matrix using the prepared context.
