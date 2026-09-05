# 0015: Immutable Session output version journal

Status: implemented

Date: 2026-09-06

## Problem

ADR 0014 requires a file identity separate from immutable versions, but the current product only validates live Workspace bytes and keeps one in-memory revision protection. A later write can replace those bytes, a restart loses the protection, and the existing Work storage record cannot represent outputs from ordinary native Sessions. T15 needs a durable format before version history, comparison, restore or adoption can use it.

## Evidence

- `packages/work-domain/index.ts` discovers outputs only from completed, successful file-tool events and already captures bounded bytes with no-follow and file-identity checks for save and revision protection.
- `packages/work-bundle/index.ts` stores the legacy singleton Work aggregate in storage-domain version 1. Changing that aggregate would couple native Session files to the optional Work object and require a destructive migration.
- The managed save protocol proves that product-owned files can be published under a DSH Home root without changing Workspace bytes. Save copies are user exports and cannot serve as internal history because users may remove them.
- ADR 0014 forbids invented legacy history: an old Work may create one baseline only from the file that still exists.

## Decision

Store Session output history in a product-owned filesystem journal at `session-output-versions/v1` under DSH Home. This journal is independent of Harness Session persistence, Workspace files, user save copies and the legacy Work aggregate.

A file identity is the SHA-256-derived identifier of its Session id and normalized Workspace-relative path. The stable event key and version id derive only from that file id, completed Turn and the Turn's unique completion-event sequence. A generated version binds the key to the first validated byte count, media type, SHA-256 content digest, creation time and source snapshot metadata. Retries reuse that frozen metadata; different bytes for an already frozen event cannot create another version. Equal bytes from two completed Turns remain two events. Records use only hashed directory/file names; user paths stay inside validated JSON metadata.

Publication first writes one complete, bounded transaction capsule containing the frozen metadata and captured bytes, fsyncs it, then exposes it under the stable event key with an exclusive hard link. It derives and exclusively publishes a content-addressed blob from that capsule, then exclusively publishes the immutable metadata record. A randomized, self-validating confirmation file commits that record only after its exact bytes and parent identity are verified; readers ignore unconfirmed records and incomplete confirmations. This extra boundary prevents a path replacement during the final hard link from becoming a readable version. Half-written pending files are also ignored. A restart can finish an intent or confirm a complete record from the capsule without consulting changed live bytes. Existing capsules, blobs and confirmed records must match their digest or fail closed. Published capsules and pending hard links remain inert recovery evidence because path-based deletion after a parent replacement cannot prove entry identity.

One controller serializes publication. The ordinal is the next value after all committed records and live capsules for that file and is frozen in the winning capsule. Cross-process publication is excluded by the existing one-Profile Runtime ownership; exclusive links still prevent overwrite if that invariant is violated. These guarantees cover cancellation and process interruption. The journal fsyncs file content but does not claim power-loss durability for directory entries on every supported filesystem.

The first successful inspection of a completed file-producing Turn publishes its versions before exposing the output list only when that Turn's end is the latest sequenced Session event. The controller reads the current Harness Session again after byte capture and source inspection; if another event appears, publication stops. This terminal-frontier rule prevents bytes observed after a later Turn from being attributed backward. The full-content arguments of `write` and `str_replace_editor create` are also compared with captured bytes when available. Other supported mutations are explicitly boundary observations: the version records the validated bytes seen at the immediate completed-Turn frontier, because alpha.2 does not expose a tool-result digest. If the first inspection happens after another Session event, no generated version is reconstructed. Failed tools, incomplete Turns and invalid files publish nothing.

On startup, an existing legacy Work deliverable may publish one `migration-baseline` record only after the current file bytes are safely validated; absent or invalid files produce no baseline and do not block recovery. A baseline makes no claim about an old Turn or missing history.

T15 exposes strict list and read contracts for later UI slices. It does not add version controls, comparison, restore or adoption.

## Acceptance and verification

- [x] Two completed mutations of one path publish two immutable records whose historical bytes remain readable after the live file changes.
- [x] A retry cannot duplicate a record; equal bytes in distinct completed Turns remain distinct versions.
- [x] Failed, incomplete, missing or invalid output events publish no version.
- [x] Two overwrites followed by a first late inspection cannot assign the latest bytes to the earlier Turn.
- [x] Interruption after capsule, blob or unconfirmed record publication leaves no visible version and a later controller run completes the same frozen record.
- [x] Restarted list/read operations return the same ids and digests.
- [x] A legacy deliverable creates at most one explicit baseline from actual retained bytes; an absent file creates none.
- [x] Strict Remote descriptors reject unknown fields and invalid ids.

Verification uses targeted Work controller and Remote tests, then `pnpm test`, `pnpm check` and the existing Session-output desktop regression.

## Alternatives considered

### Add versions to the singleton Work storage record

This makes ordinary native Sessions depend on an optional legacy aggregate, grows one mutable record with file bytes or unbounded history, and turns T15 into the full D01 migration. It is rejected.

### Keep only the latest Workspace path

This is the current behavior. It cannot prove historical bytes, survive later overwrite, compare versions or bind adoption to a digest.

### Use managed save copies as history

Save is an independent user action and its files may be removed. Treating it as internal history would couple unrelated product actions and miss unsaved generations.

## Consequences

The product owns bounded duplicate bytes, retained capsules and pending hard links. Version records are append-only and capped at 512 per file; later retention or verified cleanup needs a separate decision. Source status records what was verifiable at publication time and is historical evidence, not a claim that the source supports every sentence.

## Rollback or supersession

Older product builds ignore the additive journal and continue reading the unchanged Work and Harness data. Rolling back presentation leaves journal bytes intact. A replacement protocol must read v1 records and blobs before changing or deleting them; removing the feature consists of stopping new publication, not erasing history.
