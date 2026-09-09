# Desktop packaging

Status: standalone internal-test packaging; public release gates remain open.

## Build and verify

Use native macOS arm64 or Windows x64 with the pinned Node and pnpm versions:

```sh
pnpm install --frozen-lockfile --ignore-scripts
pnpm runtime:prepare
pnpm package:desktop
pnpm test:package
pnpm notices:verify-release
pnpm package:archive
```

The bundle is under `artifacts/package/bundles/`; `receipt.json` records revision, lock digest, platform and signing classification. `smoke.json` and screenshots record two launches of a relocated bundle. The test uses an isolated user-data directory and a loopback-only debugging port on the test process; normal application launch does not enable debugging. Test fixtures and credentials are not bundled.

The archive command retains the complete tested bundle as a macOS tar.gz or Windows zip with a versioned filename and SHA-256 receipt. CI uploads these complete candidate archives separately from package evidence. They are internal observation candidates; neither archive creation nor CI upload publishes a Release. Follow the [v0.0.1-alpha.1 candidate handoff](acceptance/v0.0.1-alpha.1.md) to freeze a draft and collect actual observations.

On macOS copy `DSH Work.app` to an installation directory. On Windows preserve the entire generated folder and launch `DSH Work.exe`. These unsigned internal-test bundles are not signed installers or Gatekeeper-approved downloads. Do not publish them as stable releases.

## Signed macOS build

First provision a Developer ID Application identity in the build machine's keychain and store notarization credentials using Apple's `notarytool store-credentials`. Do not commit certificates or credentials. Set `DSH_WORK_SIGN_IDENTITY` to the exact Developer ID Application identity and `DSH_WORK_NOTARY_PROFILE` to that keychain profile name, then run:

```sh
pnpm package:desktop --signed
pnpm test:package
```

The build requires signing and notarization, then verifies codesign, the stapled ticket and Gatekeeper assessment. Missing configuration or any failed check fails the build. The current owner has no Developer ID certificate, so this path is implemented but actual signing/notarization is unverified. Windows Authenticode and installer delivery are follow-on gates. Automatic updates are not implemented.

## Remaining release gates

The project MIT license and generated production dependency inventory are included. Real F13 observations remain required before public release. Native-library sources, notices, patches and replacement instructions are now prepared and included automatically; see the [license inventory](../third-party/README.md). Run `pnpm notices:verify-release` on the staged application to verify material completeness and native library replacement. The approximately 216 MiB source delivery is part of the application resources and must accompany public binaries. Packaging evidence does not replace those checks. See [ADR 0017](decisions/0017-standalone-desktop-packaging.md).

Release follow-ups: [Developer ID and real notarization #37](https://github.com/zxheyi/dsh-work/issues/37), [F13 human observation #36](https://github.com/zxheyi/dsh-work/issues/36), and [native distribution materials #38](https://github.com/zxheyi/dsh-work/issues/38) (implemented by the hash-locked material delivery; verification remains mandatory).
