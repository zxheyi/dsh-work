# 0012: Markdown review and natural-language revision

Status: implemented

Date: 2026-09-02

## Problem

A generated file is not a usable Work outcome until the user can inspect it and request changes. A full in-app editor would require selection semantics, conflict handling, autosave, undo, accessibility, large-document behavior and a second write owner alongside Harness tools. Opening an external editor alone would also break the product's goal-first review loop.

Putting complete Markdown content into every Work list and follow frame would make routine state synchronization carry up to several MiB, and duplicating it in the Work aggregate would create two canonical copies of the same result.

## Decision

Keep the managed Workspace file as the canonical result and add two narrow product capabilities:

1. `work/readDeliverable` validates and reads the registered Markdown file on demand, returning only its relative path, UTF-8 content and SHA-256 digest.
2. `revise-markdown` sends a bounded natural-language change request through the same Primary Session, waits for its correlated completed Turn, validates the same file again and publishes a new Work revision.

The review surface renders the Markdown source as escaped plain text in a bounded scroll region. It does not evaluate HTML, run scripts or grant browser file access. The user enters a change request such as “make the recommendation more specific” and DSH Work instructs Harness to read and update the existing result path. No second deliverable is created, and the Work remains `awaiting-review` until the user explicitly accepts it.

Deliverable reads resolve containment before reading bytes, reject files outside the managed Workspace and retain the 5 MiB/non-empty/fatal-UTF-8 bounds from production. Content is neither added to list/follow projections nor persisted in the Work aggregate.

## Consequences

- Ordinary users can review and revise without learning file paths, Sessions or editor mechanics.
- Harness remains the only Agent/tool writer; DSH Work does not introduce autosave or direct editing conflicts.
- The preview shows Markdown source rather than styled rich text. Rich rendering may be added later only with an explicit sanitization policy.
- Every accepted revision is a new Primary Session Turn and a new Work revision over the same canonical file.
- A failed revision leaves the Work in review with a visible execution failure so the user can retry or adjust the request.
- On-demand reads can temporarily fail if an external writer corrupts or replaces the registered file; invalid bytes are never displayed as a valid outcome.

## Verification

- Domain tests prove on-demand reads return content and digest, natural-language revision updates the same file and increments the same Primary Session.
- Containment checks occur before file bytes are read, and all production validation bounds are reapplied after revision.
- Remote tests lock a dedicated unary read surface and the bounded revision command.
- Client tests prove deliverable content is not installed in the Work list projection.
- Client bundle tests lock the “Markdown 原文预览” and “提出修改要求” review language.

## Rollback

Remove the read Remote, revision command and review UI together. The registered Markdown path and review status remain valid in the Work aggregate, so users can still inspect the file through a later delivery or native-open capability without migrating persisted state.
