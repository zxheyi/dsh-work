# 0009: Read-only conversation context import

Status: implemented

Date: 2026-09-02

## Problem

Users may already have useful conversations in DSH Desktop, DSH Web or the DSH CLI. DSH Work needs a low-cost way to continue that context without making users understand Session binding, and without letting two products write the same Harness Session.

The locked Harness package exposes `ctx.sessionQuery` as a trusted Host read interface for the current Harness corpus. A DSH Work installation, however, owns an isolated `DSH_HOME`; that query surface does not authorize or discover another product's private Profile. Reading `~/.dsh`, opening another product's persistence backend or parsing its private JSONL/SQLite layout would couple DSH Work to storage internals and weaken the Profile boundary.

## Decision

DSH Work treats an external conversation as a read-only source and always creates a new product-owned aggregate:

```text
readable external conversation
        ↓ copy as untrusted context
new Work + managed Workspace + new Primary Session
```

The first adapter is explicit readable-content import. The user selects the source label and pastes content they exported or copied. DSH Work then:

1. validates a bounded payload of at most 100,000 characters before provisioning;
2. creates a new Work, managed Workspace and Primary Session;
3. submits the copied content once with an instruction that treats it as reference context, not command authority;
4. persists only source system, optional source Session/version, import time and a SHA-256 content digest in the Work aggregate;
5. leaves the original conversation unchanged and never receives a source write capability.

Ordinary creation and conversation import acquire the same in-process provisioning queue, so Web and Desktop cannot create competing singleton aggregates from two different first actions.

The canonical imported content is carried by the new Harness Session. The Work aggregate does not persist a second transcript. Workspace IDs, Session IDs and import provenance remain outside the Client projection.

Automatic listing of DSH Desktop or system DSH conversations is deferred until those products expose an explicit authorized source adapter or portable export contract. The future adapter may use the same import command, but it must remain read-only and must not parse private storage.

## Consequences

- Users can continue useful context now without sharing execution ownership with another product.
- Import is deliberately a copy, not in-place continuation; new Turns exist only in DSH Work.
- Prompt injection inside imported text is reduced by an explicit untrusted-context wrapper, but imported content is still user-provided model input and must remain subject to normal tool and permission controls.
- Attachments, external absolute paths, tool state, Profile packages, locks and caches are not imported.
- The current UI does not auto-discover local conversations. It explains that the user must paste readable exported content and that the original will not change.
- A failed first imported Turn leaves a recoverable Work with stable failure state rather than deleting provisioned state.

## Verification

- Domain tests prove bounded validation, one managed Primary Session, one initial Turn, immutable source input, metadata-only Work persistence and serialized create/import provisioning.
- Remote tests prove strict payload limits and product-safe projections.
- Client tests prove the import command installs the returned Work projection.
- The bundled Work surface exposes “继续已有对话” and states “原对话不会改变”.

## Rollback

Remove the import Remote descriptor, Client command and UI entry together. Persisted `importSource` metadata is optional and defaults to `null`, so older ordinary Work records remain readable. Do not replace this path with direct private-profile scanning during rollback.
