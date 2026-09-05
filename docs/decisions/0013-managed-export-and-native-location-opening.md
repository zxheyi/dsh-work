# 0013: Managed export and native location opening

Status: implemented

Date: 2026-09-02

Product direction note (2026-09-05): Completed-only delivery and disabling revisions after acceptance are superseded for new implementation by [ADR 0014](0014-familiar-conversations-and-versioned-files.md). This historical decision and its original evidence remain intact; ownership, file containment and request-correlation guarantees still apply.

## Problem

Work completion and delivery are different user decisions. Marking a Work complete should mean “I accept this result”; delivery should require a successful file export. Changing status without copying a file would claim an outcome that the user cannot take away.

The Harness Web Client does not provide a product save dialog, and exposing an arbitrary destination path through Work Remote would grant broad host filesystem authority. Moving export ownership into Electron would also turn the thin desktop host into a second product controller.

## Decision

Keep three explicit actions:

1. `complete` accepts the current reviewable Markdown and moves the Work to `completed`.
2. `deliver` revalidates the canonical Markdown, copies it into a DSH Work-managed delivery root without overwriting different bytes, and moves the Work to `delivered` only after that copy succeeds.
3. `showDelivery` revalidates the deterministic delivery location and hands its directory to Harness `sessionController.openWorkspacePath()`. On macOS this opens the location in Finder; other desktop hosts use their native path opener.

The delivery directory is derived from a SHA-256 prefix of `workId`. The filename is a cross-platform-safe, bounded form of the Work title plus `.md`. Neither path is accepted from the Client. Existing bytes make a retry idempotent only when their SHA-256 digest matches the accepted source; a conflicting file fails closed.

The first slice calls this a **managed export**. It does not pretend to offer Save As, a user-selected folder, sharing, cloud upload or Office conversion. The user can open the exported location and move or copy the file with the operating system.

## Consequences

- Work status cannot become `delivered` before a real export copy exists.
- Completion remains a reversible product decision only through a future explicit workflow; revision is disabled after acceptance in this slice.
- Client callers cannot ask the Host to open or write an arbitrary path.
- Export retries after a Remote reconnect cannot overwrite different user-visible bytes.
- Deleting or modifying the managed export outside DSH Work can make later location opening fail; the product reports that failure instead of silently recreating a different delivery.
- A native Save As dialog requires a separately designed authenticated desktop capability and remains deferred.

## Verification

- Domain tests prove review, completion and delivery ordering, exact exported bytes, safe deterministic naming and native directory handoff.
- Adapter tests prove native opening goes through the public Harness Session controller.
- Remote and Client tests lock the narrow `showDelivery(workId)` capability rather than a caller-provided path.
- Client bundle tests lock separate “确认完成”, “导出成果” and “在 Finder 中显示” actions.

## Rollback

Remove native location opening and disable the delivery action. Existing managed export files are intentionally retained and can be recovered manually. Do not downgrade a persisted `delivered` Work to `completed` without verifying whether its export was already handed to the user.
