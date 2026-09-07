# 0014: Familiar conversations and versioned file outcomes

Status: accepted

Date: 2026-09-05

## Problem

The Work-first shell adds learning cost for existing DSH Desktop and Harness Web users. Its required goal, single Work-managed Workspace, hidden model controls, and completion-before-export gate conflict with the revised product design.

## Evidence

- The product owner requested the familiar DSH shape, reviewed the interactive PRD and four page designs, then authorized implementing the ordered tasks with independent local commits on 2026-09-05.
- [Frozen requirements and design references](../design/familiar-v5/README.md) define R01-R18 and eight scenarios. [Local implementation issue](../implementation/familiar-v5.md) records the authorized sequence.
- `packages/work-api/surface.ts` currently replaces sidebar and conversation slots and repeatedly selects `snapshot.items[0]`.
- `packages/work-domain/index.ts` stores a single deliverable path and requires `completed` before `deliver`.
- ADR 0006 establishes product-owned file metadata without transferring Harness-owned session authority. ADR 0012 updates one current path; a Work revision is not a retained file snapshot. ADR 0013 proves managed export, not native Save As.
- Public integration remains locked to the [alpha.2 compatibility baseline](../upstream-compatibility.md). Later upstream behavior is not assumed available.

## Decision

Preserve native Workspace → Session navigation, conversation rendering, composer, model, mode, permission and settings behavior. Product file capabilities compose beside the native conversation through public slots and services. Do not create a second Session controller, authorization service or extension ecosystem.

Ordinary conversation does not require a Work, goal, output type or acceptance. A Work may retain compatible product metadata and references; it is not a mandatory user-facing navigation object. One Workspace may contain multiple Sessions. The selected native Session, never the first list item, determines the action target.

Represent a file identity separately from its immutable versions. A version binds actual validated bytes, digest, originating Turn and sources. A successful file mutation publishes a version; an ordinary answer or failed write does not. Restore creates a new current version without deleting later history. The public version format and persistence protocol require their own reviewed storage decision in T15 before implementation.

Adoption is an optional record bound to a file version and digest. It does not finish the Session or prohibit revision. A new version does not inherit adoption, and historical adoption remains available. Saving is independent: save any selected valid file/version, record success only after the actual copy succeeds, and reject conflicting bytes. Native Save As remains deferred; first delivery uses the bounded managed export.

### Supersession map

| Previous contract | Replacement |
| --- | --- |
| ADR 0006 default `1 Work = 1 managed Workspace + 1 primary Session` as required topology | Native Workspace supports multiple Sessions; Work association is optional for new conversation flows |
| ADR 0006 acceptance completes a Work before delivery | Per-file/version adoption and save records are independent |
| ADR 0011 fixed result file as the sole product outcome | Actual validated file events determine file entries; ordinary answers create no result |
| ADR 0012 escaped source-only preview and same-path history | Sanitized Markdown presentation, protected last-valid content, then immutable versions |
| ADR 0013 completed-only export and revision prohibition after acceptance | Saving without adoption and continued conversation/revision after adoption |
| Shell S1 goal-first home, S2 hidden models and Workspace | Familiar native conversation surface with native controls visible |

The original ADRs and receipts remain historical evidence. Their ownership, containment, request correlation, mutation lease and authenticated desktop boundaries remain in force.

### Compatibility and migration

Keep existing Work IDs, Workspace IDs, Session IDs and files. When enabling the native shell in T02, retain an explicit legacy Work access path for existing records. T04 must map those records to their existing Sessions through public services before that temporary access path can be removed. Do not move files, parse another client's private database or let two clients take over one Profile concurrently.

Legacy `completed` and `delivered` express historical actions, not immutable file versions. Retain them as legacy metadata; do not synthesize version history or adoption digests. If only one actual file remains, validate it and create an explicitly identified migration baseline, not imaginary v1/v2 history. Existing exports stay on disk and remain discoverable through their legacy bounded capability.

Use versioned, additive migration markers and rollback fixtures before writing a new persistent format. T04 requires legacy compatibility for navigation; D01 proves full upgrade/rollback. No destructive migration is authorized merely by accepting this decision.

## Acceptance and verification

- [ ] Native Profile and Loader smoke prove public composition without upstream modifications.
- [ ] A same-directory two-Session test proves correct selection, ordinary chat and preserved drafts.
- [ ] Refusal tests prove the original Harness permission owner still controls operations.
- [ ] File tests prove actual bytes, safe preview, failed-revision retention and independent save.
- [ ] Snapshot tests prove v1/v2 retention, restore-as-new, per-version adoption and conflict rejection.
- [ ] Old Work fixtures retain IDs/files and do not fabricate history.
- [ ] Desktop E2E and screenshots satisfy the new shell contract; S3-S6 lifecycle/security regressions remain green.

The decision is accepted product direction, not an implementation receipt. See the implementation issue for fresh evidence per slice.

## Alternatives considered

### Keep the goal-first Work home

Preserves current code but retains the learning cost explicitly rejected by the product owner.

### Build a replacement chat runtime or copy upstream UI internals

Offers apparent UI freedom but violates the existing native ownership invariant and creates incompatible services. Rejected. A verified missing extension must produce an upstream proposal before dependent implementation.

## Consequences

More native presentation is reused. File identity, snapshots and legacy compatibility require explicit product persistence work. Concept artwork cannot be shipped as nonfunctional controls; version/adoption actions appear only when their implementation is verified.

## Rollback or supersession

Keep legacy reads and files intact. A presentation rollback can restore the historical Work slot contributions before new persistent data is written. After new formats land, use their explicit migration/rollback decision; never drop new snapshots or misinterpret saved versions as old lifecycle flags. The alpha.2 pin and runtime packages remain unchanged in this decision.
