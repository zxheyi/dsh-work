# 0021: Official dsh 0.1.5 runtime pair

Status: accepted

Date: 2026-09-10

## Decision

For the requested DWork upgrade, select official `@deepseek-ai/dsh@0.1.5-rc.1` and source `183f08e9c6dde7e36cd2318eaee70b0da08fb35e` (`dsh-v0.1.5-rc.1`). Supersede ADR 0003's runtime selection; its historical verification remains bound to alpha.2. Keep Node.js `24.11.1`, pnpm `10.34.4`, Cordis `4.0.2` and Electron `44.0.0`.

## Evidence and compatibility

- [Official release](https://github.com/deepseek-ai/deepseek-harness/releases/tag/dsh-v0.1.5-rc.1) is a release candidate, not a stable 1.5.0 release.
- [Official CLI manifest](https://github.com/deepseek-ai/deepseek-harness/blob/183f08e9c6dde7e36cd2318eaee70b0da08fb35e/apps/cli/package.json) retains the CLI/Profile/Bundle boundary. The npm archive integrity is pinned in `runtime/baseline.json` and checked against installed bytes.
- `ui-layout` removes `details`, `openDetails` and `closeDetails`. DWork registers its versioned file preview as a page type through `sidebarRightTabs`, renders through `sidebar.right.pane.tab`, and navigates through `sidebarRight.openTab`. Native preview tabs and layout remain upstream-owned. Each session retains its own DWork selection; closing uses that tab's session-bound action.
- Exact top-level manifests and the full lockfile select one DSH family. Reusing pnpm's previous hidden lock retained alpha.2 peers; clean resolution is required and the family gate rejects mixed versions.
- New readiness checkpoints and runtime claims identify rc.1. Old readiness checkpoints are ignored. Existing ownership/recovery rules still prevent taking over an unclean generation; no user Profile is rewritten.

## Acceptance and verification

Run `pnpm test`, `pnpm check`, provenance verification, real CLI/Profile/Guardian integration, and affected desktop output/navigation tests. Results and limitations belong in the upgrade receipt; accepting the selection does not claim a native Windows or signed release passed.

## Alternatives and rollback

Keeping alpha.2 does not deliver the requested upstream upgrade. Replacing the entire right column would discard native tabs; using its public tab extension preserves the upstream boundary. No upstream patch is accepted.

Revert the source pin, package/lockfile updates and dependent sidebar/state changes together, then rematerialize the old runtime. Back up a selected shared data home before trying a different runtime; reverting application code is not a downgrade migration for data written by Harness. Distribution notices/native materials must pass again for newly resolved transitive packages before release.
