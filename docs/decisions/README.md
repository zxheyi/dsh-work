# Architecture decisions

Use a decision record when a change affects the desktop stack, upstream integration, public interfaces, persistence, security boundaries, production dependencies, packaging, or a stable product boundary.

## Lifecycle

1. Copy `TEMPLATE.md` to `NNNN-short-title.md`.
2. Start with `Status: proposed` and attach repository or upstream evidence.
3. Review the decision independently from broad implementation when practical.
4. Change the status to `accepted` before dependent implementation lands.
5. Change the status to `implemented` only after its verification passes.
6. Supersede rather than rewrite a historical implemented decision.

## Index

| Decision | Status | Summary |
| --- | --- | --- |
| [0001: Electron child-process desktop host](0001-electron-desktop-host.md) | accepted | Selects Electron for M0 and pauses Tauri product work; graceful Windows stop, packaging, security, and lifecycle gates remain open. |
| [0002: Official `dsh` CLI and matched runtime pair](0002-official-dsh-cli-runtime.md) | superseded | Historical rc.2 selection; replaced by ADR 0003 without rewriting its evidence. |
| [0003: Official dsh alpha.2 runtime pair](0003-dsh-alpha2-runtime-upgrade.md) | accepted | Selects the matched alpha.2 pair after macOS/Windows native verification; product lifecycle and packaging remain open. |
| [0004: Crash-safe runtime ownership and Profile generations](0004-crash-safe-runtime-ownership.md) | accepted | Selects an external Node guardian, atomic generation leases, clean reuse, and explicit isolated recovery without PID-based termination. |

ADR 0001, ADR 0003, and ADR 0004 are accepted. ADR 0004's guardian and generation-recovery implementation is undergoing revision-bound native verification against the locked alpha.2 pair. Every unchecked M0 criterion remains a delivery gate rather than an implemented claim. Frozen research is evidence, not the product controller.
