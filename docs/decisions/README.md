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
| [0002: Official `dsh` CLI and matched runtime pair](0002-official-dsh-cli-runtime.md) | accepted | Locks the official npm/source pair and build-only materialization boundary; native lifecycle and packaging gates remain open. |

ADR 0001 and ADR 0002 are accepted, so Electron lifecycle implementation may begin against the locked official runtime pair. Every unchecked M0 criterion remains a delivery gate rather than an implemented claim.
