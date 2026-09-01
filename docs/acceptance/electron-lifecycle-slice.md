# Electron lifecycle: first implementation slice

Status: native macOS/Windows development lifecycle verified at `96f7ff9`; not M0 completion.

## Outcome and boundary

From a trusted local Electron status window, start one official alpha.2 CLI, observe committed Harness readiness, stop through stdin EOF, and retry after a confirmed exit. This is a development slice of [M0](m0.md), on the [accepted runtime](../decisions/0003-dsh-alpha2-runtime-upgrade.md). It does not add a second Agent or plugin runtime.

Local Issue draft: implement the formerly blocked Electron lifecycle seam. Attach a remote Issue before merge; commit, push, Issue/PR creation and merge each require their own current authorization. Full Harness browser UI, user workspace/config import, tools, descendants, crash recovery, signing and distribution remain separate M0 gates.

## Acceptance mapping

| ID | Observable requirement | Check |
| --- | --- | --- |
| L1 | Only one child per supervisor; Ready comes from the native Bundle's `appReady` callback | Unit races; real CLI/Profile smoke |
| L2 | Stop sends EOF; disposal plus direct-child close is observed; rejection and forced cleanup never become success | Unit failure matrix; real stop/restart cycles |
| L3 | Missing runtime, unexpected exit and timeout expose a safe code and retry only after ownership is settled | Unit failure matrix; desktop missing-runtime/retry path |
| L4 | No arbitrary output, token, URL, path, shell or filesystem API crosses the renderer bridge | Unit negative paths; sandboxed renderer E2E |
| L5 | Start, ready, stopping, stopped and failure states are readable and controls match state | Actual Electron interactions and screenshots; visual acceptance remains candidate until compared with an agreed baseline |
| L6 | Same product revision works on native macOS and Windows | Both native jobs passed at `96f7ff9`; see the receipt below; later behavior changes require fresh native evidence |

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

Verification status for this repair: `RUNTIME_PASS` on native macOS arm64 and Windows x64 at `96f7ff9`. Whole-tree cleanup, host-crash recovery, agreed visual acceptance and packaging remain unverified; the whole M0 status is still `PARTIAL`.

- Before the fix, four virtual-time regressions failed. Both real CLI delay cases loaded their external plugin, then the host requested force at about 8026 ms, before the test plugin's 9-second initialization completed. This reproduces the budget defect without modifying Harness. The Windows wait point remains unproven.
- After the fix, `pnpm test` passed 41 checks and `pnpm check` passed. The [supervisor tests](../../tests/runtime-host.test.mjs) retain deadline, duplicate request, fault, ownership and reentrancy coverage. The [real CLI suite](../../tests/runtime-integration.test.mjs) passed all five scenarios on macOS arm64 / Node 24.11.1: the original three plus delayed failure and delayed success. The delayed cases observed disposal, exit and close, without host force; failure remained `runtime-exit-failed`. These controlled delays are regression inputs, not performance benchmarks.
- `node scripts/verify-local.mjs <verified-context.json> --desktop` passed unit, contract, runtime and both Electron 44.0.0 E2E modes. The [normal desktop path](../../tests/desktop-e2e.mjs) also starts and immediately stops through the renderer bridge, observes no transient `ready`, then retries and closes while Ready. Existing close/before-quit wiring still shares the controller; no separate renderer-crash injection was added in this repair.
- Before/after source and runtime provenance matched. No Harness source, Bundle, dependency pin or public interface changed. Reports in `artifacts/verification/` bind the base HEAD plus **dirty-worktree input SHA256s**; they do not prove a committed revision or Windows. Prior clean-HEAD artifacts were retained separately. Independent review found and closed the early-stop control-channel deadline regression; no remaining production-code blocker was reported.

### Native receipt

[Desktop lifecycle run 33398937292](https://github.com/zxheyi/dsh-work/actions/runs/33398937292) passed on 2026-08-31 for exact commit `96f7ff9cbc50dabaaee1c3d703b3d3713c40d558`. Downloaded artifacts were independently checked against that Git tree, per-check log hashes, desktop report/screenshot hashes, clean-worktree flags and before/after runtime provenance. Windows checkout CRLF conversion accounts for all 96 input byte differences; it is not a source change.

| Native job | Executed checks | SHA256 of `verification/result.json` |
| --- | --- | --- |
| [macOS arm64](https://github.com/zxheyi/dsh-work/actions/runs/33398937292/job/99510198135) | 41 tests, contract gate, 5 real CLI cases, 2 Electron modes; 96 inputs matched | `edc3e8e6e586824b28f2acfd4d168376ce8c9890d3e55b73ebf754b519655d7d` |
| [Windows x64](https://github.com/zxheyi/dsh-work/actions/runs/33398937292/job/99510198424) | 41 tests, contract gate, 5 real CLI cases, 2 Electron modes; 96 inputs matched after CRLF accounting | `45ebae1ade3918870dde8c417b966234776115e6ca5b55121ff7cd25233c47ce` |

Windows invalid Profile plus early EOF and same-home retry passed in 11.69 seconds for the complete test. The delayed rejection observed loaded → rejected → disposed → exit → close with no host force; delayed success observed Ready and stopped normally. Both use Node 24.11.1, Electron 44.0.0, the same official root Harness alpha.2 bytes and 215 matching DSH-family packages. No full dependency-byte audit or whole-process-tree guarantee is inferred.

This closes the reported early-stop regression for the tested inputs and revision, not every possible Windows failure. Future lifecycle changes must run fresh native gates. Do not weaken the `runtime-exit-failed` assertion, turn force into success, or patch Harness.

Rollback: revert the behavior slice(s), keeping historical probes and accepted baseline reviewable. No user Harness home is migrated or removed. Temporary homes created by tests are test-owned; development homes are isolated and not automatically recursively deleted by the app.

## Surviving-host abnormal-exit recovery

Status: `local-development-pass` on macOS arm64; fresh Windows verification for this slice is `NOT_RUN`. The broader M0 remains `PARTIAL`. The [ownership research](../research/desktop-crash-recovery.md) separates this slice from host-death and complete process-tree recovery. Tests use the existing supervisor interface, real official CLI/Profile and Electron renderer seam. No new production interface, native dependency, persistent lease or automatic recovery is introduced.

The baseline controller observed only `close`. Node emits `exit` when the process ends, but `close` can wait for shared stdio. Treating that wait as a still-running process could trigger an unnecessary force attempt or display stale Ready. The controller now latches observed exit, cancels termination deadlines, waits at most the existing reap allowance for `close`, and keeps ownership if closure remains unconfirmed. An exit is not permission to kill a PID, release the owner, reuse a workspace, or declare an entire tree recovered. [Node 24.11.1 event contract](https://nodejs.org/download/release/v24.11.1/docs/api/child_process.html#event-close).

| Scenario | Baseline | Required result | Change | Caller/check |
| --- | --- | --- | --- | --- |
| Process exits before delayed stdio close | Startup/stop deadline may still attempt force; Ready may remain displayed | Latch exit; no later signals or Ready; bounded wait for close | Change | All supervisor callers; virtual-time regression |
| Exit observed but close never confirmed | Force/reap path conflates process life and pipe ownership | Fixed `cleanup-unconfirmed`; retain ownership and refuse retry until close | Change | Renderer start/stop; window close/before-quit/renderer-gone shared controller |
| Unexpected direct-child death with surviving host | Fixed failure, depending on disconnect/close order | Preserve failure; no automatic restart; explicit retry only after close | Preserve | Actual owned CLI kill and user-visible retry |
| Ordinary stop, early stop, startup timeout and live-child fault | Phase-aware deadlines and failed forced cleanup | Preserve native Ready/EOF and prior error precedence | Preserve | Existing unit, CLI and desktop gates |
| Late Ready/disposal/channel events after exit | Can change live state until close | Never reannounce Ready or send a signal; allow a queued disposal fact before close | Change | Event-order unit matrix |
| User directories, unrelated processes, stale generations | No user-home mutation or process-name/PID recovery | Preserve; only test-created processes may receive injected faults | Preserve | Isolated Profile/unrelated sentinel; generation and launcher tests |

### Verification and remaining gates

The behavior ledger above was established before implementation. The delayed-close regression first failed because the old controller attempted to kill the already-exited fixture after its stop deadline. The renderer regression first failed because the fixed recovery explanation was absent. Both passed after their respective minimal changes.

On 2026-08-31, `node scripts/verify-local.mjs <verified-context.json> --desktop` passed on macOS arm64 with Node 24.11.1 and Electron 44.0.0:

- 45 unit/contract tests and the repository contract gate passed. The new event-order cases cover no signal after exit, retained ownership without close, no late Ready, queued disposal, and stale-generation isolation; previous deadline, reentrancy and security coverage remains in place.
- Six real official CLI cases passed, including abrupt termination of the exact test-owned child, independently observed exit/close before replacement, structured failure, no automatic restart, unchanged Profile patch, an unrelated test-owned sentinel still alive after recovery, and successful explicit retry. This fixture does not create arbitrary descendants or prove old-workspace integrity.
- Four actual Electron modes passed: normal operation/window close, missing runtime, intentionally crashed renderer, and runtime failure through the real status window/bridge followed by clicking retry. The [recovery driver](../../tests/desktop-recovery-e2e.mjs) records the renderer's failure/button states, independently observes child exit/close before replacement, captures failed/recovered screenshots, then stops the replacement. It composes existing production interfaces with a test-owned launcher; the other modes separately exercise actual `main.mjs` shutdown wiring.
- Renderer crash was observed and the surviving main process reached confirmed direct-child stop before quitting. Neither renderer crash nor the recovery driver is an Electron main-process death test. Independent review prompted the additional combined UI/CLI check and independent close observation; passing separate unit tests alone was not treated as equivalent evidence.
- Before/after upstream and runtime provenance matched. Harness source, the native Bundle, public interfaces and dependency pins were unchanged. The initial aggregate report binds base `4ad0c66` plus dirty-worktree input hashes; a clean-commit rerun must identify its own revision in `artifacts/verification/result.json`.

The existing native workflow invokes this same runner and will include the new CLI case and both new Electron modes on the next authorized push. The earlier Windows receipt at `96f7ff9` does not validate this new slice; it remains historical evidence only.

The stronger host-death/descendant cases remain open until an ownership ADR is accepted and independently verified on both native platforms. The pending decision must define containment scope, identity-preserving cleanup, old-home reuse rules, macOS/Windows mechanisms, and any new helper's provenance/security/packaging. No production native mechanism is selected or introduced here. Do not mark these cases complete using this surviving-host slice.

## Windows post-verification provenance failure

Status: `REPRODUCED`; root cause pending. [CI run 33460732471](https://github.com/zxheyi/dsh-work/actions/runs/33460732471) failed twice on Windows x64 at clean revision `98bfdf7a4915310c3e31438d4f56d0d3358c1b5c`. In both attempts, 45 tests, the contract gate, six real CLI cases and four Electron modes passed. The report then failed inside the second `verifyProductRuntime()` call before producing an `after` value. macOS passed both attempts. This proves a post-run provenance-gate failure, not its cause and not a lifecycle behavior failure.

Behavior ledger, established before diagnostic and repair changes:

| Scenario/input partition | Current behavior | Required behavior | Change? | Caller | Verification signal |
| --- | --- | --- | --- | --- | --- |
| A provenance sub-check rejects | Aggregate report exposes only `after-provenance` | Record one fixed, path-free sub-check code; retain overall failure | Change | Local/native verification runner | Unit red/green plus failed native artifact |
| Source, npm archive/install, Node archive/executable, DSH family, lock integrity | Every mismatch fails closed | Preserve every byte/version/inventory gate; never retry a content mismatch into success | Preserve | `verifyProductRuntime()` CLI and aggregate runner | Existing candidate/product verification tests and before/after equality |
| Unit, contract, runtime and Electron checks | All pass on the failing Windows revision | Preserve commands, assertions and failure semantics | Preserve | `verify-local.mjs` | 45 + contract + six CLI + four Electron modes |
| Transient OS read failure, if proven | Indistinguishable from content mismatch | Remains failure until a bounded identity-preserving policy is specified and tested | Preserve for diagnosis | Provenance verifier | Native reproduction; no speculative sleep/retry |
| Diagnostics | Generic fixed message | Fixed allowlisted code only; no paths, raw exceptions, output or credentials | Change | JSON report and CLI stderr | Negative unit checks and contract gate |

The first diagnostic slice may add sub-stage observations after existing check groups, but it must not change Harness, accepted pins, test order, pass criteria, or provenance comparisons. A later repair requires a minimized Windows reproduction and a separate red/green result. Until then, fresh Windows recovery evidence remains `candidate`.
