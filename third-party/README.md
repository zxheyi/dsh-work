# Distribution licenses

DSH Work uses the [MIT License](../LICENSE), selected by the owner on 2026-09-07. Third-party code retains its own terms. This inventory covers the actual production installation, not all development dependencies in the lockfile.

## Generate and inspect

`pnpm package:desktop` generates `artifacts/package/resources/third-party/inventory.json`, copies upstream notice texts into a deduplicated `texts` directory and includes them in the application's Resources. It also includes the project LICENSE, Node's complete LICENSE and Electron/Chromium notices. Copying only the macOS `.app` retains these materials.

For an existing staged package, run `pnpm notices:generate`. The generated table links every package to retained notice texts. Inventory entries include version, declared license, repository, installed relative path and SHA-256 evidence. Missing license metadata fails generation. Build-only Electron Packager is not distributed. Platform-specific optional dependencies are inventoried on their native CI hosts.

[Supplemental source receipts](license-sources.json) pin the exact source commits published in npm metadata for xterm 6.0.0, pi 0.84.4 and sharp-libvips 1.3.3. The generator verifies every supplemental digest. AWS packages missing their root LICENSE use the license shipped by the same SDK repository in `@aws-sdk/types`; Koffi platform binaries use their exact-version parent LICENSE. `data-uri-to-buffer` embeds its full MIT text in README, which is retained. No dependency is silently relicensed.

## Native source delivery

The supported macOS arm64 and Windows x64 sharp/libvips binaries now have a locked source-and-notice delivery in [native-materials.json](native-materials.json). It records the exact native package and component versions, actual library hashes, 28 top-level component sources per platform, the 350 registry archives from librsvg's Cargo.lock, upstream build recipes/patches, complete license texts and [replacement instructions](native/REBUILDING.md). The Rust set intentionally includes build/test/other-platform dependencies as a source superset. Windows uses AOM 3.14.1; macOS uses 3.15.0.

Run `pnpm notices:prepare-native` to download/cache the 407 hash-locked materials (about 216 MiB). `pnpm package:desktop` performs this preparation automatically and includes the materials under the application's `third-party/native` resource directory. No application-startup download is introduced. Verification works offline once materials are cached. Packaging fails on a failed download or digest mismatch instead of silently substituting current upstream contents.

`pnpm notices:verify-release` checks every native component's corresponding-source mapping, package versions, library bytes, source/notice/build/replacement material bytes, and a native addon replacement smoke. Unknown package versions/platforms, absent materials and changed binaries fail closed. This replaces the unconditional blocker tracked in [Issue #38](https://github.com/zxheyi/dsh-work/issues/38) with verifiable evidence. Keep the source material directory with publicly distributed application binaries; publishing binaries separately without these materials is not what this gate verifies.

The extracted [attribution collection](native/native-attributions.txt) supplements the full original archives. For crates declaring MIT but omitting a standalone license file, it retains the package's declared authors/license and supplies the standard MIT permission text without inventing copyright years or ownership. All original embedded source notices remain in the supplied archives. The pinned build-win64-mxe recipes reference MXE's license, retained with the supplied MXE source snapshot.

This is a material-completeness check, not proof of a byte-for-byte native rebuild or of signed/notarized replacement behavior. The replacement smoke tests modified ABI-equivalent library bytes in a temporary copy. F13 usability observations and signing/notarization remain separate release gates.

## Rollback

Revert the notice generator and packaging integration together if needed. Do not remove upstream copyright notices or change their licenses. MIT adoption is the owner's explicit licensing decision.
