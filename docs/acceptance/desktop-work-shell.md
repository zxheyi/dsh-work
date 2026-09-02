# Desktop Work Shell

Status: implemented

## User outcome

When a user opens DSH Work, the desktop starts its managed Harness runtime and enters the real Work home. The product does not ask the user to understand DSH Web, Workspace, Session, Profile, models, or plugins. Runtime failure returns to a product recovery screen, and a clean restart restores the same Work.

## Ownership

- Harness owns browser authentication, Web Client boot, Client plugins, Agent execution, Workspace, Session, and plugin lifecycle.
- DSH Work owns the Electron window, automatic lifecycle start, trusted surface handoff, failure presentation, and explicit isolated recovery.
- Work remains the product-owned aggregate defined by ADR 0006 and is rendered through the existing Work Client contribution.

## Acceptance contract

| ID | Observable requirement | Evidence |
| --- | --- | --- |
| S1 | Opening the desktop automatically reaches the real Work home | Electron E2E asserts `你想完成什么？`, `常见工作`, and `最近工作` in the main window |
| S2 | Ordinary UI exposes no DSH Web, Workspace, Session, Profile, model, or plugin configuration | Electron text assertions and screenshot |
| S3 | Only the exact authenticated loopback surface can replace the local shell; the Work page receives no desktop bridge | Protocol validation, security unit tests, Electron E2E |
| S4 | Runtime failure returns to a product-language recovery shell; explicit recovery reaches Work again | Runtime-recovery Electron E2E |
| S5 | A clean close and second launch reuse the same managed generation and restore the same Work | Two-launch Electron E2E using one owned `userData` directory |
| S6 | Existing runtime cleanup and uncertain-generation isolation remain unchanged | Lifecycle, guardian, host-death, and recovery regression suites |

## Verification record

Verified on 2026-09-02 on macOS arm64 with Electron 44.0.0 and the accepted standalone Node.js 24.11.1 runtime:

- `pnpm test`: 103 repository, domain, protocol, security, and contract tests passed.
- `pnpm check`: TypeScript and the 92-file repository contract passed.
- `DSH_WORK_NODE=/usr/local/bin/node pnpm test:runtime`: 11 real CLI, Guardian, lifecycle, and Loader integration tests passed.
- `DSH_WORK_NODE=/usr/local/bin/node pnpm test:desktop`: normal launch, missing runtime, renderer crash, explicit recovery, and host death before and after Ready passed.
- `DSH_WORK_NODE=/usr/local/bin/node pnpm test:work-ui`: the real Harness Work home passed at 1440×900.
- `DSH_WORK_NODE=/usr/local/bin/node pnpm test:work-shell`: a fresh desktop automatically reached the real Work home with no desktop bridge or technical configuration surface.
- `DSH_WORK_NODE=/usr/local/bin/node pnpm test:work-persistence`: a created Work survived a clean close and second desktop launch in the same managed generation.

Visual evidence is written to `artifacts/design/`, `artifacts/desktop/work-shell/`, `artifacts/desktop/runtime-recovery/`, and `artifacts/desktop/work-persistence/` by the corresponding acceptance commands.

## Non-goals

- Selecting a Work directory or exposing a Workspace path.
- Replacing the Harness Web Client with an Electron-specific Work renderer.
- Adding file/folder inputs, multiple Work support, model selection, or plugin management.
- Persisting, logging, or exposing the authenticated launch URL outside trusted process memory.
