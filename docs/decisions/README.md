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
| [0003: Official dsh alpha.2 runtime pair](0003-dsh-alpha2-runtime-upgrade.md) | superseded | Selects the matched alpha.2 pair after macOS/Windows native verification; product lifecycle and packaging remain open. |
| [0004: Crash-safe runtime ownership and Profile generations](0004-crash-safe-runtime-ownership.md) | implemented | Selects an external Node guardian, atomic generation leases, clean reuse, and explicit isolated recovery without PID-based termination. |
| [0005: TypeScript product source and emitted JavaScript runtime](0005-typescript-product-source.md) | accepted | Selects strict TypeScript for product source and tests while keeping bootstrap verification directly executable. |
| [0006: Work as a product-owned aggregate over Harness Workspace and Session](0006-work-as-product-owned-aggregate.md) | accepted | Adds a DSH Work-owned outcome aggregate above Harness Workspace and Session while keeping execution and plugin lifecycles upstream-owned. |
| [0007: Authenticated desktop surface handoff](0007-authenticated-desktop-surface-handoff.md) | implemented | Carries the official authenticated loopback Work surface through trusted process memory without exposing it in renderer lifecycle APIs. |
| [0008: Revision-bound Work Remote mutations](0008-work-remote-mutation-lease.md) | implemented | Deduplicates reconnect retries and rejects concurrent stale client commands without copying Harness execution state. |
| [0009: Read-only conversation context import](0009-read-only-conversation-context-import.md) | implemented | Copies user-approved readable conversation context into a new managed Work without writing or parsing another product's private Session store. |
| [0010: Managed Work file resources](0010-managed-work-file-resources.md) | implemented | Copies bounded user-selected files into the managed Workspace and passes stable relative references to the Primary Session. |
| [0011: Primary Session Markdown production](0011-primary-session-markdown-production.md) | implemented | Produces one fixed Markdown result through a correlated Primary Session Turn and registers it only after bounded file validation. |
| [0012: Markdown review and natural-language revision](0012-markdown-review-and-natural-language-revision.md) | implemented | Reads bounded Markdown on demand for safe in-app preview and revises the same file through the Primary Session. |
| [0013: Managed export and native location opening](0013-managed-export-and-native-location-opening.md) | implemented | Separates acceptance from delivery, creates a non-overwriting managed export and opens only its validated directory natively. |
| [0014: Familiar conversations and versioned file outcomes](0014-familiar-conversations-and-versioned-files.md) | accepted | Supersedes Work-first presentation and coupled completion/export behavior for the authorized v5 implementation; implementation evidence remains per slice. |
| [0015: Immutable Session output version journal](0015-immutable-session-output-versions.md) | implemented | Defines append-only, content-addressed Session file versions outside Harness, Workspace files and the legacy Work aggregate. |
| [0016: Familiar desktop startup and local Harness compatibility](0016-familiar-desktop-startup.md) | accepted | Keeps the pinned runtime while adding source-clean profile discovery, shadow composition, safe mode, active-work close policy and native tray lifecycle. |

| [0017: Standalone desktop packaging](0017-standalone-desktop-packaging.md) | accepted | Frozen production staging, native relocated package smoke and explicit signing gates. |

| [0018: macOS runtime system utility path](0018-macos-runtime-system-utility-path.md) | accepted | Admits only `/usr/bin` after bundled Node for the pinned native picker; inherited PATH remains excluded. |

| [0020: Runtime environment compatibility](0020-runtime-environment-compatibility.md) | accepted | Restores macOS shell and Windows process-helper lookup; isolates guardian version probing. |

ADR 0001, ADR 0005, ADR 0006, and ADR 0021 are accepted; ADR 0004 and ADR 0007 through ADR 0013 are implemented against the locked alpha.2 pair. Every unchecked M0 criterion remains a delivery gate rather than an implemented claim. Frozen research is evidence, not the product controller.

[0019: Native source material delivery](0019-native-source-material-delivery.md) — accepted; self-contained, hash-locked native source/notice delivery with library replacement verification.

[0021: Official dsh 0.1.5 runtime pair](0021-dsh-015-runtime-upgrade.md) — accepted; supersedes the alpha.2 selection and composes versioned output through native Sidebar tabs. Native evidence remains version-specific.

[0022: Native file workflows and historical output identity](0022-native-file-compatibility.md) — accepted; preserves migrated history and composes native proxy, upload, attachment and present contracts.
