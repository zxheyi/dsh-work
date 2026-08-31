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

The stop contract is phase-aware: an ordinary stop before Ready sends EOF immediately but preserves the original 30-second startup deadline. It must not restart that deadline or replace the remaining startup allowance with the 8-second stop budget. Ready while stopping starts the 8-second stop budget without publishing `ready`. A startup timeout or explicit supervisor fault also starts bounded stop cleanup; repeated requests cannot extend either deadline. Control-pipe errors or IPC disconnection during an early stop start this cleanup budget too, without overriding native exit classification: these events can accompany a normal failure exit. Force cleanup then has a 2-second close-confirmation allowance. Ownership remains held after `cleanup-unconfirmed` until direct-child `close`.

The 8-second stop budget accommodates the accepted CLI's 5-second `appExit` shutdown timer, but that upstream timer does **not** bound every startup failure: `exitOnStdinEnd` waits for committed Ready, and `boot()` awaits failed-tree disposal before rethrowing. These facts are pinned to [cmdline](https://github.com/deepseek-ai/deepseek-harness/blob/0a53fb55bea101816fa226bb964ae2bed71c343b/packages/boot/cmdline/src/index.ts), [app-boot](https://github.com/deepseek-ai/deepseek-harness/blob/0a53fb55bea101816fa226bb964ae2bed71c343b/packages/boot/app-boot/src/index.ts), and [CLI shutdown](https://github.com/deepseek-ai/deepseek-harness/blob/0a53fb55bea101816fa226bb964ae2bed71c343b/apps/cli/src/process-shutdown.ts); local source and installed alpha.2 bytes were checked. A forced or unreaped child is a failure. Even Bundle disposal plus exit 0 is only direct-child evidence: upstream can itself force exit after its deadline with code 0. No whole-tree graceful-cleanup claim is made.

## Windows early-stop regression

Baseline: [CI run 33395469659](https://github.com/zxheyi/dsh-work/actions/runs/33395469659), revision `4c85ab642493a41e8ab47cdbd496fee215f12f03`. Windows invalid Profile plus early EOF returned `forced-stop` at 8195.6 ms instead of `runtime-exit-failed`; the other two runtime scenarios passed, and Electron E2E did not run. macOS passed the original three scenarios. The old [supervisor](../../packages/runtime-host/index.mjs) cleared its startup timer as soon as stop was requested, although native EOF could not yet request successful exit. The exact Windows load/disposal wait point is still unknown; the budget defect must not be presented as proof that every Windows failure is resolved.

Behavior ledger, established before implementation:

| Scenario/input partition | Baseline behavior | Required behavior | Change? | Caller | Verification |
| --- | --- | --- | --- | --- | --- |
| Early stop; startup rejects after the stop budget but within the startup budget | Premature forced stop | Natural nonzero exit remains `runtime-exit-failed` | Change | Renderer stop; all desktop shutdown entries | Timed host regression; delayed real CLI rejection; original invalid Profile retry |
| Early stop; Ready arrives after the stop budget but within startup budget | Premature forced stop | Stay `stopping`, then allow the normal stop budget | Change | Same entries | Timed host regression; delayed real CLI success |
| Early stop near startup deadline; never Ready | Stop incorrectly replaces the original deadline | Original startup deadline wins; bounded force/reap, never success | Change | Same entries | Virtual-time original-deadline and repeated-stop cases |
| Ready then stop, including repeated stop | EOF, disposal plus close, or bounded force/reap | Unchanged; repeated stop cannot reset timers | Preserve | Renderer; window close; before-quit; render-process-gone | Existing host tests; desktop E2E and shared shutdown policy |
| Startup timeout without user stop | Failed bounded cleanup | Unchanged | Automatic supervisor | Existing timeout test; virtual-time timeout boundary |
| Explicit protocol/output/process fault during startup or after early stop | Bounded failed cleanup | Unchanged; do not wait out startup budget after a supervisor fault | Preserve | Automatic supervisor | Fault matrix before/after early stop |
| EOF write throws, asynchronous pipe error, or IPC disconnect after early stop | Stop deadline already bounds cleanup; natural nonzero close retains failure classification | Keep bounded cleanup and native close classification; repeated channel events cannot reset the deadline | Preserve | Control pipe and child event callbacks | Synchronous/asynchronous fault tests; delayed real rejection |
| Missing runtime; unexpected exit; missing disposal; unreaped child | Safe fixed failure codes; no overlapping child | Unchanged; only confirmed close releases ownership | Preserve | All start/stop and shutdown entries | Existing unit/security/renderer tests; missing-runtime desktop E2E |
| Reentrant notifications, retry and stale-generation events | Frozen command result and single-owner isolation | Unchanged | Renderer subscribers and IPC commands | Existing reentrancy/retry tests |

Verification status for this repair: `PARTIAL` — local checks pass, Windows native rerun is `NOT_RUN`.

- Before the fix, four virtual-time regressions failed. Both real CLI delay cases loaded their external plugin, then the host requested force at about 8026 ms, before the test plugin's 9-second initialization completed. This reproduces the budget defect without modifying Harness. The Windows wait point remains unproven.
- After the fix, `pnpm test` passed 41 checks and `pnpm check` passed. The [supervisor tests](../../tests/runtime-host.test.mjs) retain deadline, duplicate request, fault, ownership and reentrancy coverage. The [real CLI suite](../../tests/runtime-integration.test.mjs) passed all five scenarios on macOS arm64 / Node 24.11.1: the original three plus delayed failure and delayed success. The delayed cases observed disposal, exit and close, without host force; failure remained `runtime-exit-failed`. These controlled delays are regression inputs, not performance benchmarks.
- `node scripts/verify-local.mjs <verified-context.json> --desktop` passed unit, contract, runtime and both Electron 44.0.0 E2E modes. The [normal desktop path](../../tests/desktop-e2e.mjs) also starts and immediately stops through the renderer bridge, observes no transient `ready`, then retries and closes while Ready. Existing close/before-quit wiring still shares the controller; no separate renderer-crash injection was added in this repair.
- Before/after source and runtime provenance matched. No Harness source, Bundle, dependency pin or public interface changed. Reports in `artifacts/verification/` bind the base HEAD plus **dirty-worktree input SHA256s**; they do not prove a committed revision or Windows. Prior clean-HEAD artifacts were retained separately. Independent review found and closed the early-stop control-channel deadline regression; no remaining production-code blocker was reported.

After commit/push authorization, rerun the same native CI gates on the new revision; if failure persists inside the full startup deadline, diagnose the upstream wait before changing more policy. Do not weaken the `runtime-exit-failed` assertion, turn force into success, or patch Harness. A local delayed CLI check is not Windows proof, and no new remote run is authorized by a local fix request.

Rollback: revert the behavior slice(s), keeping historical probes and accepted baseline reviewable. No user Harness home is migrated or removed. Temporary homes created by tests are test-owned; development homes are isolated and not automatically recursively deleted by the app.
