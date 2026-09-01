# 0004: Crash-safe runtime ownership and Profile generations

Status: implemented

Date: 2026-09-01

## Problem

The first Electron lifecycle slice supervises the official Harness CLI inside the Electron main process and creates a new temporary Home for every application launch. If that host is terminated, its startup and stop deadlines disappear with it. A later launch also has no durable fact that distinguishes a clean reusable Profile from a generation whose former runtime may still be writing.

DSH Work needs cross-launch recovery before it stores durable workspace state. Recovery must never infer termination authority from a PID, process name, process-tree snapshot, or stale file, and it must not claim arbitrary descendant containment that the current JavaScript host cannot prove.

## Evidence

- The current [runtime host](../../packages/runtime-host/index.ts) holds the official CLI child object, deadlines, and generation checks only in Electron memory. Its `close` observation proves the directly owned child and stdio are closed, not that every possible descendant is gone.
- The current [desktop entry](../../apps/desktop/main.mjs) creates a temporary Home per launch. That avoids reusing old state but cannot reconcile or preserve a clean Profile across launches.
- Node documents that child processes are independent of their parent except for configured IPC, that a Node child can observe IPC disconnection, and that `close` follows process exit plus stdio closure. This supports a separate Node guardian retaining deadlines after Electron dies; it does not prove arbitrary process-tree containment. [Node child-process API](https://nodejs.org/download/release/v24.11.1/docs/api/child_process.html)
- Electron's `app.requestSingleInstanceLock()` provides the supported same-user application-instance gate, including command-line launches on macOS. It is an application-instance control, not stale-runtime termination authority. [Electron app API](https://www.electronjs.org/docs/latest/api/app#apprequestsingleinstancelockadditionaldata)
- Windows Job Objects can provide stronger associated-process containment, while macOS process groups allow group signaling but do not prevent descendants from leaving the group. Neither capability is selected by this decision because the current runtime has no accepted, packaged native guardian artifact. [Windows Job Objects](https://learn.microsoft.com/en-us/windows/win32/procthread/job-objects), [macOS `kill(2)`](https://developer.apple.com/library/archive/documentation/System/Conceptual/ManPages_iPhoneOS/man2/kill.2.html)
- Frozen investigation and historical experiments remain on the [research revision](https://github.com/zxheyi/dsh-work/blob/4fd63ddefc347238f5a5c717a10bd59a2f326693/docs/research/desktop-crash-recovery.md). They are evidence, not a production dependency.

## Decision

### Ownership

Run one external **runtime guardian** under the accepted standalone Node `24.11.1`. Electron owns the local window and a private command channel to the guardian. The guardian owns the existing DSH Work supervisor and is the only process allowed to spawn, signal, or classify the official `dsh --profile` child.

The guardian registers IPC `message` and `disconnect` handlers before accepting commands. Electron disconnection enters the same bounded native EOF stop path as an ordinary application quit. The guardian remains responsible for the existing startup, stop, and reap deadlines until the direct child emits `close`; Electron death must not remove those deadlines.

The private guardian protocol carries versioned `start`, `stop`, `recover`, and `snapshot` commands plus fixed status snapshots. It is desktop process-lifecycle IPC, not a Harness plugin protocol. Renderer access remains limited to bounded status fields and zero-argument commands.

### Persistent generations and lease

Store product-owned runtime state beneath Electron's per-user `userData` directory:

```text
runtime/
  active.json
  last-clean.json
  generations/<generation>/
    dsh-work-terminal.json
  quarantine/<timestamp>-<generation>.json
  history/<timestamp>-<generation>.json
```

Each generation contains one isolated Harness Home and DSH Work Profile. `active.json` is claimed with exclusive creation before the CLI is launched. It records a schema version, opaque generation ID, guardian PID for diagnostics only, accepted runtime version, and bounded state/timestamps. It contains no credential, token, authenticated URL, arbitrary error, or termination authority. Updates use a same-directory temporary file and atomic rename with owner-only file permissions where the platform supports them.

Only a guardian holding the matching generation may publish a clean terminal receipt. After confirmed normal disposal and direct-child `close`, it atomically writes `dsh-work-terminal.json` inside that generation and exits without deleting or replacing `active.json`. This avoids pretending that portable filesystem APIs provide an atomic compare-and-delete operation.

A later guardian may reconcile only an exact `active.json` generation plus its matching clean terminal receipt. It archives that active record into `history/`, removes the consumed receipt, atomically records `last-clean.json`, and exclusively reclaims the same generation before launching the CLI. Failed or unconfirmed cleanup leaves the active lease without a matching receipt and never marks the generation reusable. A late old receipt cannot release a newer lease because reconciliation compares both generation records.

### Recovery

An existing `active.json` makes ordinary start fail closed with the fixed code `recovery-required`; no CLI is launched and the recorded PID is never signaled or probed as authority. Recovery requires a separate explicit renderer action. This explicit isolated recovery atomically moves the old record into `quarantine/`, leaves the old generation byte-for-byte untouched, and claims a new generation. A late old guardian may not remove or overwrite the new lease because every mutation compares the generation.

This isolated recovery can temporarily coexist with an unresolved old process, but the processes use different Homes and loopback ephemeral ports. The UI must describe that limitation. DSH Work never automatically reuses, recursively deletes, or migrates an uncertain generation.

Electron also acquires `app.requestSingleInstanceLock()` before opening the product window. A second normal desktop instance exits without touching the guardian lease. The lease remains the cross-launch Profile-generation authority because the Electron lock disappears when its process dies.

### Guaranteed and deferred scope

This decision guarantees single ownership of one Profile generation, retained direct-child deadlines after Electron host death, clean-generation reuse, and isolated explicit recovery without PID-based killing. It does not guarantee containment of arbitrary descendants, recovery after the guardian itself is forcibly killed, elimination of every orphan process, or safe reuse of an uncertain generation.

A future Windows Job Object, macOS native service, or other stronger containment artifact requires a separate ADR covering source, license, build provenance, signing, packaging, ABI, handle inheritance, failure semantics, and rollback.

## Acceptance and verification

- [x] Unit tests prove exclusive lease claim, clean reuse, collision refusal, explicit quarantine, and that a stale guardian cannot release a newer generation.
- [x] Protocol tests prove one guardian owner, strict versioned zero-argument commands, bounded snapshots, safe disconnect, and no paths or secrets in diagnostics.
- [x] Integration tests prove the official CLI/Profile reaches Ready, stops, and reuses one clean generation across guardian launches.
- [x] Host-death tests terminate the exact test-owned Electron host before and after Ready, then independently observe bounded guardian cleanup without treating a safety timeout as success.
- [x] Recovery tests leave an uncertain generation untouched, start a distinct generation only after explicit action, and prove an unrelated test-owned process remains alive.
- [x] macOS arm64 and Windows x64 run the same revision-bound lifecycle and recovery matrix with runtime provenance before and after.
- [x] Repository checks prove the pinned upstream source, runtime package family, Harness-native Bundle, narrow renderer bridge, and absence of research-path dependencies remain unchanged.

Implementation evidence is bound to revision `1b3ced4219ef011498e1d4fd4803d8f30c57a8fb`: [runtime matrix](https://github.com/zxheyi/dsh-work/actions/runs/33481966105) and [desktop lifecycle/recovery matrix](https://github.com/zxheyi/dsh-work/actions/runs/33481966097). Both macOS arm64 and Windows x64 passed, including exact Electron host termination before and after Ready.

## Alternatives considered

### Keep supervision in Electron

This is smaller, but every deadline disappears when Electron is terminated. A lease written by the dying owner cannot repair that gap.

### Kill by PID, process name, or tree snapshot

These approaches are rejected. A stored PID is not an identity-preserving process handle, names are not ownership, and snapshots race with exit and reuse. None may authorize termination.

### Reuse the old generation after a liveness probe

A PID probe or absent IPC endpoint cannot prove every old writer is gone. Automatic reuse would turn uncertainty into possible corruption, so uncertain generations are isolated instead.

### Add native containment now

Windows Job Objects are promising and macOS needs a different ownership mechanism, but a native helper introduces a new production artifact, toolchain, signing and packaging boundary. Selecting one without those contracts would exceed this slice.

### Always create temporary Homes

This avoids reuse but never establishes a persistent product Profile or clean cross-launch continuity. Generation records preserve known-clean continuity while quarantining uncertainty.

## Consequences

- One additional accepted Node process and private IPC protocol become part of the desktop lifecycle.
- Persistent runtime state needs a versioned schema, atomic writes, path containment checks, bounded retention, and future migrations.
- Explicit isolated recovery may leave old bytes and, in the guardian-crash case, an old process for later diagnosis. Safety takes priority over automatic cleanup.
- Packaging must include the guardian module and accepted standalone Node. No new production dependency or native binary is introduced by this decision.
- Product UI and diagnostics gain `recovery-required` and an explicit recovery action, but no raw lease contents or filesystem paths.

## Rollback or supersession

Before durable user workspaces depend on generation continuity, rollback removes the guardian and generation store together and returns to a new temporary development Home per launch. It must not delete product-owned generations or a user Harness Home.

Supersede this decision when native evidence supports stronger containment, safe guardian adoption, or persistent workspace migration. A superseding record must preserve the no-PID-kill rule or replace it with an identity-preserving operating-system capability and equivalent native tests.
