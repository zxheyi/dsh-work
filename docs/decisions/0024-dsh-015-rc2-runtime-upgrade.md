# 0024: Official dsh 0.1.5-rc.2 runtime pair

Status: accepted

Date: 2026-09-20

## Decision

Select official `@deepseek-ai/dsh@0.1.5-rc.2` and source `fb2c4b9e698e30edb738bca4cf0618587db7d203` (`dsh-v0.1.5-rc.2`) for the requested DWork upgrade. Supersede ADR 0021's runtime selection while retaining its integration boundaries and historical evidence. Keep Node.js `24.11.1`, pnpm `10.34.4`, Cordis `4.0.2` and Electron `44.0.0`.

## Evidence and compatibility

- The [official release](https://github.com/deepseek-ai/deepseek-harness/releases/tag/dsh-v0.1.5-rc.2) improves feedback confirmation and failure handling, delivered-file layout, conversation spacing and code-file icons.
- The [source comparison](https://github.com/deepseek-ai/deepseek-harness/compare/dsh-v0.1.5-rc.1...dsh-v0.1.5-rc.2) contains four commits. Changes preserve DWork's CLI/Profile/Bundle, Sidebar, attachment, delivery and session-persistence contracts; no upstream patch or product API adaptation is required.
- Pin the official npm archive integrity in `runtime/baseline.json` and resolve one rc.2 DSH package family. Source provenance and runtime dependencies remain separate commits.
- Checkpoints and active generation claims identify rc.2. Prior rc.1 and alpha.2 readiness cannot establish rc.2 readiness, and prior active claims remain protected from takeover. Source Profiles remain untouched.

## Acceptance and verification

Run the upgrade regression, unit and contract suites, typecheck/build, official source/package/Node provenance, CLI/Profile/Guardian integration and desktop file upload/output checks. Record actual evidence and platform limitations in [the upgrade receipt](../implementation/dsh-015-rc2-upgrade.md). Acceptance of this selection does not claim Windows, signing or a public release passed.

## Alternatives and rollback

Keeping rc.1 does not fulfill the requested update; the newer alpha channel is outside this upgrade. Revert the source pin, package family and runtime identity commits together, then rematerialize rc.1. Reverting application code does not migrate data backwards: restore a compatible data-home backup if a downgrade requires one. Regenerate and verify distribution materials before release.
