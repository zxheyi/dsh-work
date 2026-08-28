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
| [0001: Electron child-process desktop host](0001-electron-desktop-host.md) | proposed | Recommends Electron after macOS lifecycle and Windows launch/readiness smokes; graceful Windows stop, packaging, and measurement gates remain open. |
| [0002: Official `dsh` CLI and matched runtime pair](0002-official-dsh-cli-runtime.md) | proposed | Fixes the public CLI boundary and proposes the released npm pair pending native lifecycle and packaging proof. |

No architecture decision has been accepted yet. Dependent production implementation remains blocked until the applicable proposal is accepted.
