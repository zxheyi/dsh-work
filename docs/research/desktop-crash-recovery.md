# Desktop crash recovery and process ownership

Date: 2026-08-31

Status: PARTIAL — pinned source and operating-system API research completed; the new crash and descendant experiments below are NOT_RUN in this research. This note is not an accepted architecture decision or M0 completion evidence.

Follow-up implementation and executed checks are recorded separately in [surviving-host recovery acceptance](../acceptance/electron-lifecycle-slice.md#surviving-host-abnormal-exit-recovery). The baseline observations and proposed experiment matrix below remain the research record; they are not a claim that every proposed experiment subsequently passed.

## Recommendation and scope

Implement abnormal **direct-child** exit reporting and explicit retry within the same surviving desktop host first. Preserve the official CLI, external native Bundle, and public lifecycle services. Do not promise complete process-tree recovery from that result.

A desktop host killed without cleanup cannot run its JavaScript deadlines. Guaranteeing bounded cleanup after that event requires an independently surviving owner or operating-system containment, with a separately accepted ownership/security/packaging decision. An old PID, process name, or successful direct-child `close` event is not sufficient authority or evidence.

This investigation fixes product observations at `96f7ff9cbc50dabaaee1c3d703b3d3713c40d558`, official Harness source at `0a53fb55bea101816fa226bb964ae2bed71c343b` (`dsh-v0.1.2-alpha.2`), npm runtime `0.1.2-alpha.2`, standalone Node `24.11.1`, and Electron `44.0.0`. Later documentation commits do not change that tested-code baseline. See [ADR 0003](../decisions/0003-dsh-alpha2-runtime-upgrade.md) and the separate [native receipt](../acceptance/electron-lifecycle-slice.md#native-receipt).

Non-goals: modifying Harness source, copying its shutdown controller, adding a parallel plugin API, accepting a new native dependency, killing existing user processes, or implementing automatic cross-launch recovery in this research.

## Confirmed repository and upstream facts

| Owner | Confirmed behavior at the reviewed revision | Evidence |
| --- | --- | --- |
| Runtime launcher | Starts the official CLI with standalone Node, `shell: false`, isolated home/environment, piped stdio and private Node IPC. No process group, Windows Job Object, native guardian, or persisted ownership lease is established. | [Official launcher](../../packages/runtime-host/official-launcher.mjs) |
| Runtime host | Tracks one in-memory child owner. Defaults are 30 seconds for startup, 8 seconds for stop, then 2 seconds for reap confirmation. An ordinary early stop retains the original startup deadline. Only `close` releases the owner; unconfirmed cleanup retains it. There is no separate `exit` listener at this revision. | [Host controller](../../packages/runtime-host/index.mjs) |
| Product Bundle | Calls public `exitOnStdinEnd`, resumes the otherwise-empty control pipe, sends only `ready`/`disposed` facts on private IPC, and pauses stdin on disposal. It does not add a child-side IPC message/disconnect listener. | [Lifecycle Bundle](../../packages/lifecycle-bundle/index.mjs) |
| Electron main | Ordinary window close, quit, and renderer failure converge on `host.stop()`. Each application launch prepares a new temporary development home; it does not reconcile an old runtime lease. | [Desktop main](../../apps/desktop/main.mjs) |

In the pinned Harness helper, stdin EOF registers an `appReady.onReady` callback which requests `appExit(0)`. EOF before Ready therefore waits for Ready; it does not override a startup rejection. The helper itself does not resume stdin. [Pinned `exitOnStdinEnd`, lines 112–145](https://github.com/deepseek-ai/deepseek-harness/blob/0a53fb55bea101816fa226bb964ae2bed71c343b/packages/boot/cmdline/src/index.ts#L112-L145).

The launcher commits Ready after boot and setup succeed. Its five-second shutdown timer starts only when the shutdown controller is invoked. For normal `appExit`, successful disposal cancels that timer and sets `process.exitCode`; it does not unconditionally terminate the process. Thus five seconds is not a universal process-exit guarantee: before Ready the EOF callback has not requested shutdown, and after successful disposal a leaked referenced handle can still prevent natural exit. This last case is an inference from the explicit control flow, not a reproduced defect. [Pinned launcher](https://github.com/deepseek-ai/deepseek-harness/blob/0a53fb55bea101816fa226bb964ae2bed71c343b/apps/cli/src/profile-boot.ts), [pinned shutdown controller, lines 33–68](https://github.com/deepseek-ai/deepseek-harness/blob/0a53fb55bea101816fa226bb964ae2bed71c343b/apps/cli/src/process-shutdown.ts#L33-L68).

## Platform facts and their limits

Node distinguishes `exit` from `close`: stdio can remain open after process exit, including when another process shares it. A successful `kill()` call does not establish termination; Node also warns about signaling an exited process whose PID has been reassigned. On Windows the supported termination signals are forceful rather than POSIX-style graceful requests. On non-Windows platforms, `detached` creates a new session/process group. These facts do not establish ownership of every descendant. [Node 24.11.1 child-process API](https://nodejs.org/download/release/v24.11.1/docs/api/child_process.html).

`SIGKILL` cannot be handled by JavaScript. Therefore the normal Electron quit path, `finally` blocks, and host timers cannot implement recovery after the host is killed. This does not invalidate cooperative stdin EOF; it limits which process is still able to enforce a deadline. [Node 24.11.1 signal events](https://nodejs.org/download/release/v24.11.1/docs/api/process.html#signal-events).

On macOS, process-group signaling addresses group membership, not an immutable process-tree capability. `setsid()` creates a new session/group for an eligible caller. A descendant can therefore leave the original group; `detached: true` plus negative-PGID signaling is not sufficient for an all-descendant guarantee. The Apple references are archived API documentation, not fresh macOS acceptance results. [Apple `kill(2)`](https://developer.apple.com/library/archive/documentation/System/Conceptual/ManPages_iPhoneOS/man2/kill.2.html), [Apple `setsid(2)`](https://developer.apple.com/library/archive/documentation/System/Conceptual/ManPages_iPhoneOS/man2/setsid.2.html).

Windows Job Objects can associate processes, normally include children created with `CreateProcess`, and terminate associated processes when the last job handle closes with `JOB_OBJECT_LIMIT_KILL_ON_JOB_CLOSE`. Breakaway settings change membership; Microsoft also documents that children created through WMI `Win32_Process.Create` are not automatically associated. A job is therefore a concrete containment primitive with a declared scope, not a universal sandbox for arbitrary external brokers. [Windows Job Objects](https://learn.microsoft.com/en-us/windows/win32/procthread/job-objects), [job limit flags](https://learn.microsoft.com/en-us/windows/win32/api/winnt/ns-winnt-jobobject_basic_limit_information).

Windows process handles remain valid until closed, including after termination; process identifiers have a narrower lifetime. A retained kernel handle is materially different from reopening whichever process now occupies a PID from a file. [Process handles and identifiers](https://learn.microsoft.com/en-us/windows/win32/procthread/process-handles-and-identifiers).

## What the current public seams can prove

| Scenario | Available claim or hypothesis | Missing evidence or authority |
| --- | --- | --- |
| Direct child exits while host survives | Host can report a sanitized failure, retain ownership until `close`, then allow an explicit retry for a fixture known not to leave descendants. | `close` alone does not establish safety of arbitrary shared workspace state or every descendant. |
| Host is killed after Ready | Hypothesis: closing the only stdin writer delivers EOF; a responsive Harness requests native disposal. | Actual host-death experiment; independent confirmation of child exit; leaked writers, handles, or unresponsive event loop remain outside this inference. |
| Host is killed before Ready | Public EOF waits for Ready. | No surviving host startup deadline; never-Ready startup requires an independent cleanup owner. |
| Direct child is killed but descendant survives | A descendant using separate/ignored stdio can outlive direct-child `close`. | A process-tree containment mechanism or narrower verified process-creation contract. |
| Desktop is launched again | A fresh home avoids deliberately reopening the old development home. | It does not prove the old process stopped, release old resources, or authorize terminating it. |

The proposed incremental host change is to observe `exit` separately, latch that fact, and prohibit further termination attempts after it. Still wait for `close` before releasing the direct-child owner. Preserve generation checks against stale callbacks, bounded cleanup, immutable command results, and fixed public failure codes. This is a design recommendation requiring red tests, not code implemented by this note.

## Minimal falsifiable experiments

All cases below are proposed checks, not new passing evidence. Use only disposable test homes and processes created by the test. A safety timeout firing is an experiment failure, never successful product cleanup.

| Check | Setup and observation | Failure that falsifies the intended claim |
| --- | --- | --- |
| A: abnormal direct-child exit and retry | A test-only external native plugin requests public `ctx.appExit` with a nonzero code after Ready. Separately, terminate only the test's retained direct-child object to exercise abrupt exit. Observe failure, absence of automatic restart, confirmed `close`, and an explicit successful retry. | Success/stopped reported for the failure, replacement before `close`, leaked ownership, or sensitive output exposed. An orderly nonzero exit alone does not cover abrupt death. |
| B: `exit` before delayed `close` | Unit fixture emits `exit`, retains stdio, advances stop/reap deadlines, then emits `close`. Exercise disconnect/error/late Ready in different orders. | Any further signal after observed exit; stale Ready presentation; owner released before `close`; unresolved command; old callback mutates a replacement owner. |
| C: direct-child `close` is not tree cleanup | An external test plugin spawns a bounded, self-expiring sentinel with ignored stdio; repeat with a detached sentinel. Terminate only the test-owned Harness child. Observe a private nonce-bearing sentinel heartbeat after the direct child's `close`. | A heartbeat after `close` refutes the all-tree-clean interpretation. The sentinel's eventual safety expiry must not be credited to the product. |
| D: host death after/before Ready | An outer controller creates a disposable host which creates the official CLI. Terminate only the retained disposable-host object, once after Ready and once while a test plugin deliberately delays Ready. Observe child liveness independently of the now-dead host. | Ready case survives the stated bound, or early-Ready case is incorrectly reported as recovered without independent evidence. |
| E: stale identity and restart refusal | Unit fixture supplies an old run record and a different current process identity; exercise restart while cleanup remains unconfirmed. | Any kill based on the record/name/PID alone, automatic old-home reuse, or replacement launched while the previous owner remains unresolved. |

For C and D, establish an independently owned cleanup mechanism before running the experiment. A finite, nonblocking sentinel can safely self-expire, but a killed host cannot relay its child's final status. A proposed assertion based only on a PID probe is insufficient. If the controller cannot independently observe and safely retire its fixture without discovering and killing unknown processes, stop at test design and resolve the ownership mechanism first. Do not deliberately exhaust system PIDs to test reuse.

Record monotonic timestamps for spawn, Ready, requested stop/host termination, direct-child exit, stdio close, disposal observation, sentinel liveness, and safety cleanup. Missing events must fail explicitly; never let arithmetic on an absent timestamp silently pass. Run the real CLI and real Electron cases separately on macOS and Windows; mocked signal labels are not native-platform evidence.

## OS-owned recovery: proposed next decision, not implementation

### Windows candidate

A candidate launcher would create the official Node process suspended, associate it with a Job Object, and resume only after assignment succeeds. Starting suspended is a proposed way to remove the spawn-before-assignment race; it is not a claim that every use of Job Objects requires suspension. Assignment failure must fail closed. [CreateProcess flags](https://learn.microsoft.com/en-us/windows/win32/procthread/process-creation-flags), [AssignProcessToJobObject](https://learn.microsoft.com/en-us/windows/win32/api/jobapi2/nf-jobapi2-assignprocesstojobobject).

The proposed contract would retain a non-inherited job handle, enable kill-on-last-handle-close, avoid breakaway permissions, define nested-job/CI behavior, and verify the membership is empty before declaring cleanup. It must explicitly exclude or prevent unsupported broker-created processes rather than silently calling the result a universal process tree. Test abrupt host death and descendant behavior, including job-handle leakage.

This requires access to native Windows APIs not exposed by the current JavaScript launcher. An external native helper or Node-API component is a **new production artifact/dependency and ownership boundary**. Before implementation, an ADR must cover necessity, licensing, build provenance, Electron versus standalone-Node ABI constraints where applicable, signing, packaging, handle inheritance, failure handling, and rollback. No language or helper is selected here.

### macOS unresolved choice

A process group may improve cooperative cleanup but does not close the escaping-descendant or dead-owner gaps. A separate guardian can improve supervision but is itself killable unless a stronger operating-system owner supplies the required contract. A native guardian/launch-service design needs focused research and native experiments; this note does not select a macOS equivalent to Windows Job Objects or claim one has been proven.

Do not silently resume Tauri work, introduce Rust, or add a native helper under the label of a small JavaScript lifecycle fix. [Architecture decision rules](../decisions/README.md) and [ADR 0001](../decisions/0001-electron-desktop-host.md) remain in force.

## Safe stopping conditions

- Stop implementation and propose a decision when the required outcome expands from observing a directly owned child to cross-launch adoption, persisted ownership, arbitrary descendants, or new native containment.
- Never use process-name killing, `taskkill /IM`, PID-file killing, or a process-tree snapshot as proof of safe ownership. A PID plus creation-time check still needs an atomic identity-preserving operation before it can authorize termination.
- After observed direct-child exit, send no further signals. While cleanup is unconfirmed, retain the owner and refuse replacement; do not convert uncertainty into a success state.
- Do not reuse an old home/workspace automatically when an old owner may still write to it. Creating a fresh home does not count as recovering or cleaning the old instance.
- Preserve user directories and state. Do not recursively remove them as crash recovery; tests may operate only on their precisely owned disposable resources.
- Keep tokens, authenticated URLs, raw runtime output, arbitrary errors, and persistent PID authority out of renderer status and committed evidence. Continue using the narrow private lifecycle IPC; it is not an Agent protocol.
- If public Harness composition cannot supply a required lifecycle fact, return to upstream extension research. Do not modify the pinned source or reproduce Harness-owned disposal.

## Verification performed for this note

The read-only command `node scripts/verify-product-runtime.mjs /private/tmp/dsh-work-alpha2.jJgxkc/context.json` passed during this investigation. It reported the pinned source commit, runtime `0.1.2-alpha.2`, Node `24.11.1`, 10 root package files, and 215 installed DSH-family packages. Reported Node SHA-256: `b05aa3a66efe680023f930bd5af3fdbbd542794da5644ca2ad711d68cbd4dc35`; lockfile SHA-256: `512f73829d05a6fd356d4ddb075440afbf7c6cf2f0a5b71f12739d1d49b065f0`.

That gate checks source cleanliness, official root-package/Node bytes, and DSH-family versions. It does not prove all transitive package bytes, packaged distribution, crash recovery, or containment. The temporary path records the actual local invocation and is not a portable setup command; use the [runtime preparation instructions](../../runtime/README.md) for a fresh environment.

No new crash experiment, GUI launch, Windows rerun, remote mutation, or process termination was performed for this research. Existing two-platform lifecycle evidence remains scoped to its original acceptance cases and code revision. This document changes no product behavior, upstream source, or accepted ADR.
