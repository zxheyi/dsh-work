# ADR 0017: Standalone desktop packaging

Status: accepted

## Context and evidence

[Issue #30](https://github.com/zxheyi/dsh-work/issues/30) requests a runnable desktop distribution. The current launcher resolves ordinary files from the product root and launches a separate, pinned Node guardian. Node cannot read Electron ASAR archives. Runtime staging already verifies and copies the accepted Node distribution.

[Electron distribution documentation](https://www.electronjs.org/docs/latest/tutorial/application-distribution) supports ordinary `Resources/app` directories. [Electron Packager](https://github.com/electron/packager) provides native bundle construction and macOS signing/notarization integration.

## Decision

Use pinned `@electron/packager` as a build-only MIT dependency. Stage emitted product files, the baseline and a fresh frozen production-only pnpm installation. Use the hoisted production layout to avoid absolute Windows junctions into staging; keep ASAR disabled so the external Node runtime can resolve the same packages. Copy the verified Node tree to `Resources/runtime/node`. Do not install packages at application launch or modify Harness source.

Build only on the target native platform. Verify the actual executable after relocation to a temporary installation directory, with an isolated user home and invalid developer Node override. Require authenticated native UI readiness, clean quit and restart. CI artifacts are unsigned internal-test bundles, never public-release evidence.

An explicit signed macOS build requires a Developer ID Application identity and a preconfigured notarization keychain profile. Missing credentials fail before building. Successful signed output additionally requires codesign verification, a valid stapled ticket and Gatekeeper assessment. The user has no Developer ID certificate; actual signing/notarization remains pending. Windows Authenticode signing is also not claimed.

## Alternatives

A custom Electron bundle copier would duplicate platform metadata/signing logic. Electron Forge or electron-builder adds installer/update policy beyond this slice. ASAR would require new external-runtime resolution rules. Keep this implementation bounded to standalone native bundles.

## Verification and rollback

Run packaging policy tests, repository tests/check, runtime provenance, `pnpm package:desktop` and `pnpm test:package` on native macOS and Windows. Release still requires license/notices, current product acceptance and real human observation. Revert this ADR, packaging scripts, build dependency and native packaging workflow together; development startup is unaffected.
