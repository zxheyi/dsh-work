# DWork dsh 0.1.5 upgrade

Date: 2026-09-10

## Outcome and scope

Upgrade the DWork desktop composition from `0.1.2-alpha.2` to the official `0.1.5-rc.1` release candidate. Keep the Harness CLI, Profile, Bundle, session and authorization boundaries. Preserve unrelated local research. No upstream patch, global dsh replacement, user-profile rewrite, merge or public release is part of this local delivery.

Work is on `chore/dsh-0.1.5-rc.1`, based on `7cf906f8640e009d470b33ce24650cb0a7a65463`. Evidence below was collected from the modified working tree before the upgrade commits; the historical packaging scripts' revision field names the base commit, not the upgrade revision. The bundle and lockfile digests identify the built artifacts.

## Changes

- Pin source `183f08e9c6dde7e36cd2318eaee70b0da08fb35e` and all 231 installed DSH packages to rc.1. Keep Node 24.11.1, Cordis 4.0.2 and Electron 44.0.0.
- Replace removed `details` APIs with the native Sidebar tab registry, body slot and navigation service. DWork file versions occupy their own tab; native Tool inspection remains usable in the center while the preview retains its subview. Session selections are separate, and tab closing uses the native session-bound action.
- New runtime claims/readiness checkpoints identify rc.1. An alpha.2 active claim remains protected and old readiness cannot establish rc.1 readiness.
- Run the reviewed official subprocess helper permission hook in development and controlled packaging (after runtime verification). General dependency install scripts stay disabled during staging.
- Update pi 0.85.1 and Koffi 3.2.1 notice coverage. Pin standardwebhooks 1.1.1's library-level MIT text to its published source commit; its root Apache license does not replace the library license.

## Acceptance evidence

| Check | Result |
| --- | --- |
| Red upgrade regression | Before changes, `tests/runtime-upgrade.test.ts` failed on the old baseline version. |
| `pnpm test` | 249 passed, 1 Windows-only process-helper check skipped on macOS; 250 total. |
| `pnpm check` | TypeScript and repository contract passed. |
| `node --test scripts/verify-contract.test.mjs scripts/package-desktop.test.mjs scripts/distribution-notices.test.mjs` | 14 passed after final packaging-hook ordering and documentation changes. |
| `pnpm runtime:verify` | Official source/tag/cleanliness, root npm archive bytes, Node archive/executable and 231-package family passed. |
| `pnpm test:runtime` | 12 passed using the official archive-verified standalone Node 24.11.1 (final run: 86.1 seconds). |
| `pnpm test:session-output` | Passed on official standalone Node: source references, failed-read retry, native Tool inspection coexistence, session switching, versions/diff/adoption/revision/save, keyboard/focus and 736/390px states. |
| `pnpm package:desktop` | macOS arm64 unsigned internal-test app built with frozen production dependencies. |
| `pnpm notices:verify-release` | 503 packages, zero distribution-material blockers; native addon accepted the modified ABI-compatible library. |
| `pnpm test:package` | Final notice-complete package passed relocation, two launches and clean shutdown; developer Node override was ignored. |
| `git diff --check` | Passed. |

Local screenshots/reports live under `artifacts/session-output/`; package, notices and relocation evidence live under `artifacts/package/`. Failed early runs remain only in temporary logs: old Sidebar DOM assertions were updated to test native tab behavior; obsolete temporary Node paths were rematerialized before provenance passed.

## Limits and rollback

Windows rc.1 native checks, macOS Intel, signing/notarization and live-provider/model requests were not run. This is an unsigned local macOS arm64 build, not a published release. Fixture-model success is not live-provider evidence. The existing untracked surface-context research document was not modified.

Revert the source pin, package/lockfile changes and dependent UI/state adaptations together and rematerialize alpha.2. Do not downgrade a shared Harness data home based on an application revert; restore its backup if an upstream data migration needs reversal.

## Final artifact identity

- Lockfile SHA-256: `4373527e31a0e9cad08457c376ba28523906610ebe35d8a2f39216b7b9d7de58`.
- Final macOS arm64 bundle SHA-256: `06317aa73714d80de056baef4e878b69774dd7f08a140408da6959d921bb91d5`.
- Application: `artifacts/package/bundles/DSH Work-darwin-arm64/DSH Work.app`.
