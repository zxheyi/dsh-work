# DWork dsh 0.1.5-rc.2 upgrade

Date: 2026-09-20

## Outcome and scope

Upgrade the official Harness runtime from `0.1.5-rc.1` to `0.1.5-rc.2` under [ADR 0024](../decisions/0024-dsh-015-rc2-runtime-upgrade.md). The reviewed upstream changes improve feedback dialogs, delivered-file layout and file icons. DWork continues to compose the official CLI, Profiles, Bundles and public services without an upstream patch.

- Pin source `fb2c4b9e698e30edb738bca4cf0618587db7d203`, its release tag and the official root npm archive integrity.
- Upgrade all 231 installed DSH packages and local Bundle peer declarations to rc.2. Retain every non-DSH lockfile package and resolution snapshot from the prior baseline, including Koffi 3.2.1 and the existing native distribution materials.
- Record rc.2 in startup checkpoints and runtime generation claims. Regression checks reject prior rc.1 and alpha.2 readiness and preserve prior active claims without taking ownership.
- Keep Node 24.11.1, pnpm 10.34.4, Cordis 4.0.2 and Electron 44.0.0. Global installations and user Profiles are outside this local upgrade.

## Acceptance evidence

Checks ran on macOS arm64 against the modified working tree based on `85b88bb9f5f5dcef30c254309b6c73cbe913889a`, before the upgrade commits and this receipt were written. Commands below used the verified standalone Node from `artifacts/runtime/context.json` on `PATH`, with `DSH_WORK_NODE` pointing to that executable.

| Check | Result |
| --- | --- |
| Red upgrade regression | The rc.2 expectation failed against the previous rc.1 baseline before implementation. |
| `pnpm install --frozen-lockfile --ignore-scripts` | The final minimal lock installed successfully in a clean temporary directory; the package builder also installed its frozen production graph. |
| `pnpm test` | 257 passed, 1 Windows-only skip; 258 total. |
| `pnpm check` | TypeScript and repository contract passed. |
| `node --test scripts/verify-contract.test.mjs` | 12 passed; included again in the final unit/local verification suites. |
| `pnpm runtime:verify` | Official source/tag/cleanliness, root package archive bytes, Node archive/executable and all 231 DSH versions passed. |
| `node scripts/verify-local.mjs artifacts/runtime/context.json --desktop` | `local-development-pass`: build, unit, contract, all 14 runtime integration tests, and five desktop lifecycle modes passed, with provenance checked before and after execution. |
| `node scripts/run-session-output-test.mjs` | Native file delivery/source tracking, preview, versions, revision, save, session isolation and responsive states passed. |
| `node scripts/run-session-resource-test.mjs` | Native picker, failure/retry, cancellation, mixed drop, session isolation and receipt submission passed. |
| `pnpm package:desktop` | Unsigned macOS arm64 internal-test package built. |
| `pnpm notices:verify-release` | 503 production packages, zero distribution-material blockers; modified ABI-compatible native library accepted. |
| `pnpm test:package` | Relocated package passed two launches, native surface/tool checks and clean shutdown. |
| Lockfile review | Parsed non-DSH package metadata and resolution snapshots are identical to the prior lockfile. |

Initial checks exposed retained rc.1 peer resolutions and tests launched with ambient Node 22. Clean DSH resolution and the pinned Node resolved those failures. An unrestricted fresh resolution also advanced unrelated libraries; those entries were restored from the prior lock, and the final dependency graph passed the checks above. No product workaround was introduced.

## Artifact identity and limitations

- Lockfile SHA-256: `1a9def40b810eec76e12f8619274552b5d88bd2b30935d15ffa20d4362de2c86`.
- Tested bundle SHA-256: `f38784b9f718498b2fb74952adaab9f6893d58c5fa66450ffb10e2ba076d2172`.
- Local package: `artifacts/package/bundles/DSH Work-darwin-arm64/DSH Work.app`.
- Local evidence: `artifacts/verification/`, `artifacts/session-output/`, `artifacts/session-resource/` and `artifacts/package/`.

The packaging receipt names the pre-commit base revision; its lockfile and bundle digests identify the tested modified artifact. Windows, macOS Intel, signing/notarization and live-provider requests were not run. The packager reported the existing missing optional `.icns` asset; packaging and relocated launch checks still passed. This is a local unsigned test build, not a published release.

## Rollback

Revert the source pin, runtime dependency and runtime identity commits together, then rematerialize the rc.1 environment. Restore a compatible data-home backup if reverting data written by Harness requires it; reverting application code does not perform a downgrade migration. The unrelated local surface-context research document is excluded from the upgrade commits.
