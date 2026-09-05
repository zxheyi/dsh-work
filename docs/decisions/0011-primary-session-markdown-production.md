# 0011: Primary Session Markdown production

Status: implemented

Date: 2026-09-02

Product direction note (2026-09-05): Single fixed outcome as the product-wide constraint is superseded for new implementation by [ADR 0014](0014-familiar-conversations-and-versioned-files.md). This historical decision and its original evidence remain intact; ownership, file containment and request-correlation guarantees still apply.

## Problem

The first product slice needs one result that an ordinary user can recognize and review. Merely recording an arbitrary existing Workspace file does not cause Harness to produce an outcome, while treating an assistant message as the outcome would detach review and delivery from a durable file.

Harness prompt admission is asynchronous: `sessionController.prompt()` confirms queue acceptance, not Turn completion. Registering a result immediately after admission could capture a missing or partially written file. Polling private Session persistence would violate the public integration boundary.

## Decision

Add a product command that produces exactly one Markdown deliverable through the Work's existing Primary Session:

```text
Work goal + user instruction + managed resources
        ↓ one correlated Harness Turn
deliverables/result.md
        ↓ validate and register
Work awaiting-review
```

DSH Work builds an outcome-oriented instruction that identifies the Work goal, the current request, every managed resource path and the fixed Workspace-relative target `deliverables/result.md`. Harness remains responsible for the Agent loop, file tools and permissions.

The Host opens the public Session follow stream before prompt admission, submits the prompt with a unique `requestId`, then ignores unrelated Session events until it observes that exact user-message correlation, its `turn/start` and matching `turn/end`. Only `{ kind: 'completed' }` is accepted as successful production.

After the Turn completes, DSH Work resolves the target inside the managed Workspace and accepts it only when it is a non-empty regular UTF-8 Markdown file no larger than 5 MiB. It then records the file as the singleton deliverable, increments the Primary Session Turn count and moves the Work to `awaiting-review`.

The existing generic `record-file` recovery seam is narrowed to the same Markdown validation. It cannot register an Office file or a path outside the managed Workspace.

## Consequences

- The first visible result is predictable and can be reviewed without asking users to choose a filename or directory.
- An unrelated external Turn ending in the same Session cannot prematurely register the Work result.
- The Remote production request remains open while the correlated Turn runs. Cancellation or a non-completed Turn becomes a recoverable Work failure.
- If the process stops after the Agent wrote the fixed file but before registration, retrying production updates the same target and can register it; it does not create a second deliverable.
- A Turn that answers only in chat is treated as failed production because no valid file exists.
- Rich Office deliverables, multiple files, version histories and background job progress remain later product slices.

## Verification

- Adapter tests prove prompt admission happens after opening Session follow and only the correlated completed Turn resolves the wait.
- Domain tests prove managed resources enter the production instruction, the exact target is produced, one Turn is counted and the Work enters review.
- Failure tests prove a missing target and non-Markdown file cannot become a deliverable.
- Remote tests lock the bounded `produce-markdown` command.
- Client bundle tests lock the user-facing Markdown outcome state.

## Rollback

Remove `produce-markdown` from the Remote and Client and restore the composer to ordinary Turn submission. Existing `deliverables/result.md` files remain ordinary managed Workspace files, and already registered file deliverables remain readable by the prior aggregate schema.
