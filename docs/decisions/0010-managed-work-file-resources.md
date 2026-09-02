# 0010: Managed Work file resources

Status: implemented

Date: 2026-09-02

## Problem

Ordinary users need to attach existing files before asking DSH Work to produce an outcome. The locked Harness file-reference Client discovers paths that already exist inside a Workspace, and its deliverables Client recognizes files written by successful Agent tools. Neither public surface imports browser-selected bytes into a Workspace.

Passing an arbitrary host path to Harness would expose machine layout, fail for Browser clients, and make restart behavior depend on the original file. Reading another product's private Profile or adding a parallel attachment store would weaken the boundary established by ADR 0006.

## Decision

DSH Work owns a bounded **file resource import** command above the public Harness Workspace seam:

```text
user-selected browser file
        ↓ bounded Work Remote bytes
managed Workspace/resources/<resource-prefix>/<original-name>
        ↓ relative @ reference
Primary Session Turn
```

The Client may stage a selection before the singleton Work exists. On “开始工作” or “继续工作”, it creates or resolves the Work, imports every staged file, then submits the Turn with the resulting Workspace-relative resource paths.

The Host accepts at most 20 file resources per Work and 25 MiB of decoded bytes per file. It requires strict canonical base64, a bounded basename without separators or control characters, and an optional bounded media type. The persisted resource record contains a product resource ID, original name, Workspace-relative path, byte count, media type and SHA-256 content digest.

The Host creates only plain directories beneath the managed Workspace, rejects symbolic-link parents, writes a new file without overwriting, resolves its real path and proves it remains inside the Workspace. A retry is idempotent only when the existing bytes have the same digest. The original external file remains unchanged; later changes to it do not silently change the Work resource.

This command does not introduce a second Workspace, Session, transcript, upload service or file editor. Harness still owns Agent file reads, tools, permissions and Turn execution. DSH Work owns only the resource copy and its aggregate metadata.

## Consequences

- A user can choose files before creating the Work without choosing or understanding a Workspace directory.
- Every submitted Turn receives stable relative references that survive restart with the managed Workspace.
- Browser-to-Host transfer is intentionally bounded; large files, folders, webpages and pasted content remain separate future source adapters.
- Copying bytes consumes Workspace storage and does not preserve external-file change tracking.
- A partially failed multi-file import may leave already imported resources in the Work; retry deduplication makes continuing safe.
- Filename validation is stricter than the host filesystem so Remote behavior is stable across supported platforms.

## Verification

- Domain tests prove safe bytes are copied inside the managed Workspace, persisted and restored, while unsafe names, malformed base64 and oversized files are rejected before writing.
- Bundle and Remote tests prove legacy records default to no resources, strict resource projections and bounded commands.
- Client bundle tests prove the surface includes a real file input and documents the 25 MiB bound.
- Electron acceptance selects a real browser `File` and observes a removable “待添加” resource chip on the 1440×900 Work home.

## Rollback

Remove the Client entry, Remote command and Host mutation together. Existing resource files may remain as ordinary managed Workspace files; persisted `resources` defaults to an empty list for older records. Do not delete resource directories automatically during rollback.
