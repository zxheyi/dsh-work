# ADR 0023: Compact desktop distribution with matching source assets

Status: accepted

Date: 2026-09-10

## Problem and evidence

Issue [#56](https://github.com/zxheyi/dsh-work/issues/56) requests a smaller desktop download and installed application. The macOS arm64 rc.1 package measured 997 MiB: Electron 286 MiB, application 279 MiB, third-party materials 237 MiB and standalone Node 194 MiB. Native sources account for about 217 MiB and Node headers 64 MiB. The existing production install already excludes development dependencies. ADR 0019 deliberately includes source archives inside the application; this decision supersedes that placement only.

## Decision

Preserve the pinned runtime, standalone Node executable, npm/npx, licenses and relative executable links. Exclude Node headers and manuals from product staging. Terminal tools continue to have npm/npx; this is not an embedded native-addon development SDK.

Prune only JavaScript/CSS/declaration debug maps, reviewed node-pty compiled tests and Domino fixtures, and foreign node-pty prebuilds. Keep runtime JS/TS, declarations, package metadata, README/license texts and active-platform libraries. Apply pruning only to the generated production staging tree. Record each removed file and its byte count. Keep the original upstream checkout and installed development packages unchanged.

Package native source archives in a separate platform/version companion asset. Retain copyright/attribution texts, build/replacement instructions, material inventory and locked native binary hashes inside the application. Embed the companion filename, size and SHA256 before signing and launch verification. Application startup remains offline and does not need the source archive. The archive gate extracts and verifies the actual companion against the same material lock and bundled native library bytes, then emits both application and companion with a common receipt and checksums. CI uploads that whole directory as one candidate artifact. A distribution entry must make both downloads available together; neither a filename nor a remote offer alone counts as source-delivery evidence. This changes artifact placement, not the material coverage or license selection.

## Acceptance and verification

- Node staging and pruning regressions preserve npm/npx, runtime sources, notices and active-platform PTY.
- Source-pair tests reject missing/modified archives and mismatched locks; native material tests still cover missing/changed component source and library bytes.
- `pnpm test:package` runs relocated Node/npm/npx through a real PTY and exercises sharp image processing before two UI launches and clean shutdown.
- `pnpm package:archive` requires current revision, bundle digest, native tool smoke and the matching companion; a failed rerun invalidates prior completion records.
- Run native macOS and Windows packaging CI and report installed/archive sizes. Signing/notarization and live-provider behavior remain separate gates.

## Alternatives and consequences

Keeping all sources inside the app preserves copy-only distribution, but adds 217 MiB to every installation. Removing npm/npx saves another 18 MiB at the cost of terminal tooling, so retain them. Broad source/type/document deletion could break dynamic plugins or lose embedded notices; use a narrow pruning policy instead. Electron remains the largest fixed runtime cost.

## Rollback

Revert staging, companion verification and documentation together to restore ADR 0019's self-contained delivery. Do not publish the smaller binary without its matching source asset. No user-data migration is needed.
