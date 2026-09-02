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
| [0004: Crash-safe runtime ownership and Profile generations](0004-crash-safe-runtime-ownership.md) | implemented | Selects an external Node guardian, atomic generation leases, clean reuse, and explicit isolated recovery without PID-based termination. |
| [0005: TypeScript product source and emitted JavaScript runtime](0005-typescript-product-source.md) | accepted | Selects strict TypeScript for product source and tests while keeping bootstrap verification directly executable. |
| [0006: Work as a product-owned aggregate over Harness Workspace and Session](0006-work-as-product-owned-aggregate.md) | accepted | Adds a DSH Work-owned outcome aggregate above Harness Workspace and Session while keeping execution and plugin lifecycles upstream-owned. |
| [0007: Authenticated desktop surface handoff](0007-authenticated-desktop-surface-handoff.md) | implemented | Carries the official authenticated loopback Work surface through trusted process memory without exposing it in renderer lifecycle APIs. |
| [0008: Revision-bound Work Remote mutations](0008-work-remote-mutation-lease.md) | implemented | Deduplicates reconnect retries and rejects concurrent stale client commands without copying Harness execution state. |
| [0009: Read-only conversation context import](0009-read-only-conversation-context-import.md) | implemented | Copies user-approved readable conversation context into a new managed Work without writing or parsing another product's private Session store. |
| [0010: Managed Work file resources](0010-managed-work-file-resources.md) | implemented | Copies bounded user-selected files into the managed Workspace and passes stable relative references to the Primary Session. |
| [0011: Primary Session Markdown production](0011-primary-session-markdown-production.md) | implemented | Produces one fixed Markdown result through a correlated Primary Session Turn and registers it only after bounded file validation. |

ADR 0001, ADR 0003, ADR 0005, and ADR 0006 are accepted; ADR 0004 and ADR 0007 through ADR 0011 are implemented against the locked alpha.2 pair. Every unchecked M0 criterion remains a delivery gate rather than an implemented claim. Frozen research is evidence, not the product controller.
