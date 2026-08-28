# M0 desktop host prototypes

Status: **throwaway research code — do not merge into product implementation**

Question: can Electron and Tauri supervise the same official DeepSeek Harness `dsh` child through the M0 start, executable readiness, HTTP check, and stop sequence without modifying Harness source?

These prototypes are primary evidence for Issue #5 and the proposed architecture decisions. They intentionally use the published `@deepseek-ai/dsh@0.1.1-rc.2` runtime and keep all mutable state in temporary directories. They are not the DSH Work product architecture, lifecycle module, or production packaging layout.

## What the result means

- A green macOS run proves only development-host launch, readiness, HTTP `200`, and POSIX SIGTERM behavior.
- A green Windows run proves launch and forced owned-child cleanup. It deliberately reports `forced-no-public-carrier`; it does **not** satisfy the ADR requirement for a public child-visible graceful-stop carrier.
- Neither run proves native Profile/Bundle activation, packaged runtime independence, signing, installer behavior, descendant cleanup, or recovery.

## Local macOS commands

Prerequisites are Node.js 24, pnpm 10.34.4, and a Rust toolchain. The checked-in code contains no Node, Rust, Electron, Tauri, or Harness binary.

```bash
pnpm install --dir prototypes/m0-desktop-hosts --frozen-lockfile
DSH_WORK_NODE="$(node -p 'process.execPath')" pnpm --dir prototypes/m0-desktop-hosts electron:smoke
node prototypes/m0-desktop-hosts/scripts/materialize-tauri-sidecar.mjs
cargo run --locked --manifest-path prototypes/m0-desktop-hosts/tauri/src-tauri/Cargo.toml
```

The research branch CI runs the equivalent checks on `windows-latest`.

## Branch lifecycle

Keep this directory on `research/m0-architecture` as prototype evidence. Before merging architecture documentation to `main`, remove the throwaway source from the merge diff and leave links to the research branch and CI run in Issue #5 and the decision evidence.
