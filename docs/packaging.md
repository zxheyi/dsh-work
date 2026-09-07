# Desktop packaging

Status: standalone internal-test packaging; public release gates remain open.

## Build and verify

Use native macOS arm64 or Windows x64 with the pinned Node and pnpm versions:

```sh
pnpm install --frozen-lockfile --ignore-scripts
pnpm runtime:prepare
pnpm package:desktop
pnpm test:package
```

The bundle is under `artifacts/package/bundles/`; `receipt.json` records revision, lock digest, platform and signing classification. `smoke.json` and screenshots record two launches of a relocated bundle. The test uses an isolated user-data directory and a loopback-only debugging port on the test process; normal application launch does not enable debugging. Test fixtures and credentials are not bundled.

On macOS copy `DSH Work.app` to an installation directory. On Windows preserve the entire generated folder and launch `DSH Work.exe`. These unsigned internal-test bundles are not signed installers or Gatekeeper-approved downloads. Do not publish them as stable releases.

## Signed macOS build

First provision a Developer ID Application identity in the build machine's keychain and store notarization credentials using Apple's `notarytool store-credentials`. Do not commit certificates or credentials. Set `DSH_WORK_SIGN_IDENTITY` to the exact Developer ID Application identity and `DSH_WORK_NOTARY_PROFILE` to that keychain profile name, then run:

```sh
pnpm package:desktop --signed
pnpm test:package
```

The build requires signing and notarization, then verifies codesign, the stapled ticket and Gatekeeper assessment. Missing configuration or any failed check fails the build. The current owner has no Developer ID certificate, so this path is implemented but actual signing/notarization is unverified. Windows Authenticode and installer delivery are follow-on gates. Automatic updates are not implemented.

## Remaining release gates

Current product acceptance, real F13 observations, MIT project license and complete third-party notices must be available before public release. Packaging evidence does not replace those checks. See [ADR 0017](decisions/0017-standalone-desktop-packaging.md).
