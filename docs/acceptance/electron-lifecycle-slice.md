# Electron lifecycle: first production slice

Status: implemented; every merge candidate requires fresh native macOS and Windows verification.

## User outcome

From a trusted local Electron status window, a developer can start one official DeepSeek Harness alpha.2 CLI, observe committed readiness, stop it through stdin EOF, recover from a failed direct child, and explicitly retry after ownership is settled.

This is the first runnable development slice of [M0](m0.md). It is not a packaged release and it does not add another Agent runtime or plugin system.

## Ownership boundary

- The Electron main process owns the window and direct-child supervision only.
- The external DSH Work Bundle composes public `exitOnStdinEnd`, `appReady`, `appExit`, and `ctx.effect` services.
- Harness owns startup, Profile loading, plugin lifecycle, and shutdown.
- The pinned upstream source remains unchanged; the product launches the official `dsh --profile` CLI.
- Ordinary launch never installs dependencies or falls back to global Node or `dsh` executables.

The host controller exposes only `start()`, `stop()`, `snapshot()`, and `subscribe(listener)`. Renderer-visible snapshots contain `state`, a fixed diagnostic `code`, `canStart`, and `canStop`. No child object, raw output, path, URL, token, shell, or filesystem capability crosses the bridge.

## Acceptance contract

| ID | Observable requirement | Executable evidence |
| --- | --- | --- |
| L1 | One supervisor owns at most one child; Ready comes from the external Bundle's `appReady` callback | Host unit races and official CLI/Profile integration tests |
| L2 | Stop sends EOF; direct-child exit and close are bounded and disposal is observed | Unit failure matrix and real stop/restart cycles |
| L3 | Missing runtime, invalid startup, unexpected exit, timeout, and unconfirmed cleanup expose fixed safe codes | Unit tests and Electron failure/recovery modes |
| L4 | The renderer bridge is narrow, frame-bound, local-only, and carries no sensitive runtime data | Security and renderer negative tests |
| L5 | Window close, app quit, and renderer loss share the same supervised shutdown path | Actual Electron E2E modes |
| L6 | The exact product revision passes on native macOS arm64 and Windows x64 | `desktop-lifecycle.yml` native matrix |

## Security and diagnostics

The status renderer is sandboxed and loaded from a private local protocol. IPC validates the exact WebContents, main frame, and local URL. Navigation, popups, downloads, and permissions are denied. Harness stdout and stderr are drained but never retained or forwarded; a fixed cumulative limit terminates an overly noisy child. Arbitrary errors collapse to allowlisted codes.

The child receives explicit standalone Node and isolated Profile paths with `shell: false`. Ambient `NODE_OPTIONS`, `NODE_PATH`, `DSH_*`, and user secrets are not inherited. Development Profiles use test- or app-owned temporary homes and never import or delete an existing user home.

## Verification

Prepare the accepted artifacts, install Electron, and run the revision-bound verifier:

```sh
pnpm install --frozen-lockfile --ignore-scripts
node node_modules/electron/install.js
pnpm runtime:prepare
pnpm verify:local
```

The verifier checks runtime provenance before and after unit, contract, official CLI/Profile, and four actual Electron modes: normal operation, missing runtime, renderer crash, and direct-child failure with explicit retry. Reports and screenshot hashes are written below ignored `artifacts/` paths.

The implementation was distilled from the frozen [research branch at `4fd63dd`](https://github.com/zxheyi/dsh-work/tree/4fd63ddefc347238f5a5c717a10bd59a2f326693). Historical experiments and diagnostic ledgers remain there; they are evidence, not production dependencies.

## Remaining M0 gates

This slice proves direct-child behavior while the Electron host survives. It does not prove full descendant containment, main-process crash recovery, persistent workspace migration, Harness browser UI rendering, product-approved visual design, packaging, signing, update delivery, or complete transitive byte/license inventory. Those require separate decisions and clean PRs.

Rollback by reverting this lifecycle slice while retaining the accepted runtime baseline. Do not modify global tools or remove a user Harness home.
