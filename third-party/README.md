# Distribution licenses

DSH Work uses the [MIT License](../LICENSE), selected by the owner on 2026-09-07. Third-party code retains its own terms. This inventory covers the actual production installation, not all development dependencies in the lockfile.

## Generate and inspect

`pnpm package:desktop` generates `artifacts/package/resources/third-party/inventory.json`, copies upstream notice texts into a deduplicated `texts` directory and includes them in the application's Resources. It also includes the project LICENSE, Node's complete LICENSE and Electron/Chromium notices. Copying only the macOS `.app` retains these materials.

For an existing staged package, run `pnpm notices:generate`. The generated table links every package to retained notice texts. Inventory entries include version, declared license, repository, installed relative path and SHA-256 evidence. Missing license metadata fails generation. Build-only Electron Packager is not distributed. Platform-specific optional dependencies are inventoried on their native CI hosts.

[Supplemental source receipts](license-sources.json) pin the exact source commits published in npm metadata for xterm 6.0.0, pi 0.84.4 and sharp-libvips 1.3.3. The generator verifies every supplemental digest. AWS packages missing their root LICENSE use the license shipped by the same SDK repository in `@aws-sdk/types`; Koffi platform binaries use their exact-version parent LICENSE. `data-uri-to-buffer` embeds its full MIT text in README, which is retained. No dependency is silently relicensed.

## Current native distribution gap

The macOS arm64 staged inventory contains 505 packages. Every package has license metadata and shipped or verified supplemental notice evidence. The sharp/libvips binary includes additional native libraries: its exact component versions and upstream license table are retained in the inventory. Full native component license texts and corresponding-source/relinking distribution still need completion before public redistribution. This is one explicit material blocker, not a completed license audit.

`pnpm notices:verify-release` rejects that blocker. Signed packaging also rejects incomplete distribution materials. Unsigned internal-test builds remain available for verification; they are not public releases. Do not remove the blocker merely because the npm wrapper declares LGPL or because its README lists library names. Record actual native materials before clearing it.

## Rollback

Revert the notice generator and packaging integration together if needed. Do not remove upstream copyright notices or change their licenses. MIT adoption is the owner's explicit licensing decision.
