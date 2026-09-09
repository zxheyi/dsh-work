# ADR 0019: Native source material delivery

Status: accepted

## Problem and evidence

Issue [#38](https://github.com/zxheyi/dsh-work/issues/38) blocks public binary distribution because npm license tables do not include the complete native source and notice delivery. The pinned sharp-libvips scripts combine native libraries into replaceable shared libraries. macOS and Windows use different AOM versions and different build recipes; librsvg adds a Cargo.lock dependency graph beyond the 28 entries in versions.json.

## Decision

Keep the installed dependencies and Harness runtime unchanged. Lock the original source archives, build recipes, patches, license/attribution texts, replacement instructions and actual native binary hashes in `third-party/native-materials.json`. Supply the whole material set in the application's existing third-party resource directory. Prepare it at build time, then verify it offline. Do not turn license collection into an application-startup network operation.

Choose self-contained source delivery over a remote source offer or a separate release attachment: copying the application also retains the source materials. The cost is approximately 216 MiB of additional packaged resources. A later separate source-asset design must verify that binaries and matching source assets are actually distributed together before replacing this approach.

Preserve original source archives including embedded copyright notices. Extract an attribution collection for reading. For MIT-declared crates without standalone texts, retain their manifest authors and license declaration and supply the standard permission text; do not invent copyright years or relicense a dependency. Upstream build recipes retain original patch operations and source URL mappings. Compiler/SDK prerequisites remain external; no byte-identical rebuild claim is made.

Replace the unconditional sharp/libvips blocker with checks for reviewed package/component versions, library hashes, component-source mappings and material hashes. Unknown platforms or changed versions still block release. Test that a fresh addon process loads modified ABI-equivalent DLL/dylib bytes from a temporary copy. This is a loader replacement test, not signed/notarized acceptance or a full native rebuild.

## Verification and rollback

Verifier regressions cover missing, changed and unmapped materials and changed native bytes. Native packaging prepares and bundles the locked materials and runs the replacement smoke on macOS and Windows. Keep F13 and signing gates separate. Revert this source-delivery change to restore the original blocked release state; do not publish binary-only artifacts after rollback.
