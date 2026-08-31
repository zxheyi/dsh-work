# Electron lifecycle: first implementation slice

Status: candidate implementation; not M0 completion.

## Outcome and boundary

From a trusted local Electron status window, start one official alpha.2 CLI, observe committed Harness readiness, stop through stdin EOF, and retry after a confirmed exit. This is a development slice of [M0](m0.md), on the [accepted runtime](../decisions/0003-dsh-alpha2-runtime-upgrade.md). It does not add a second Agent or plugin runtime.

Local Issue draft: implement the formerly blocked Electron lifecycle seam. Remote Issue/PR creation and push are not authorized in this turn; attach a remote Issue before merge. Full Harness browser UI, user workspace/config import, tools, descendants, crash recovery, signing and distribution remain separate M0 gates.

## Acceptance mapping

| ID | Observable requirement | Check |
| --- | --- | --- |
| L1 | Only one child per supervisor; Ready comes from the native Bundle's `appReady` callback | Unit races; real CLI/Profile smoke |
| L2 | Stop sends EOF; disposal plus direct-child close is observed; rejection and forced cleanup never become success | Unit failure matrix; real stop/restart cycles |
| L3 | Missing runtime, unexpected exit and timeout expose a safe code and retry only after ownership is settled | Unit failure matrix; desktop missing-runtime/retry path |
| L4 | No arbitrary output, token, URL, path, shell or filesystem API crosses the renderer bridge | Unit negative paths; sandboxed renderer E2E |
| L5 | Start, ready, stopping, stopped and failure states are readable and controls match state | Actual Electron interactions and screenshots; visual acceptance remains candidate until compared with an agreed baseline |
| L6 | Same product revision works on native macOS and Windows | Local macOS evidence first; Windows CI required before completion |

## Interface and ownership

The host-independent controller exposes `start()`, `stop()`, `snapshot()`, `subscribe(listener)`. Commands return bounded status snapshots, not raw child-process objects. A snapshot contains only `state`, `code`, `canStart`, `canStop`. States are `stopped`, `starting`, `ready`, `stopping`, `failed`. One private generation owns its child until `close`; unresolved cleanup blocks another start.

The external Bundle composes public `exitOnStdinEnd`, `appReady.onReady`, and `ctx.effect`. Its otherwise-unused stdin pipe is explicitly resumed by the Bundle. It sends only versioned Ready/Disposed facts on the private Node IPC pipe. There is no URL/token transfer in this status-only slice. The host does not mount `dsh-app-boot`, implement authorization, or replace Harness shutdown.

The trusted local renderer has a sandboxed preload with only start, stop, snapshot and status subscription. IPC checks exact WebContents, main frame and local URL. Navigation, popups, downloads and permissions are denied. No Harness/remote content is loaded in this privileged window.

## Diagnostics, environment and recovery

Harness stdout/stderr are drained with a cumulative 1 MiB ceiling per child and never retained or forwarded. This development limit deliberately stops an overly noisy process; it is not a long-running production log policy. Arbitrary errors collapse to fixed codes. The child runs standalone Node with `shell: false`, an explicit Profile, and an isolated development home. Ambient `NODE_OPTIONS`, `NODE_PATH`, `DSH_*` and user secrets are not inherited. Development runtime provenance is verified separately before/after tests; the launch-time version check alone is not an integrity check. Launch never installs dependencies or uses global tools.

Stop allows Harness its own 5-second shutdown budget, then requests bounded direct-child force cleanup. A forced or unreaped child is a failure. Even Bundle disposal plus exit 0 is only direct-child evidence: upstream can itself force exit after its deadline with code 0. No whole-tree graceful-cleanup claim is made.

Rollback: revert the behavior slice(s), keeping historical probes and accepted baseline reviewable. No user Harness home is migrated or removed. Temporary homes created by tests are test-owned; development homes are isolated and not automatically recursively deleted by the app.
