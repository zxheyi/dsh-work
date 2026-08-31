# 0003: Candidate upgrade to the official dsh alpha.2 pair

Status: proposed

Date: 2026-08-31

## Decision proposed

Replace the runtime pair in [ADR 0002](0002-official-dsh-cli-runtime.md) with official `@deepseek-ai/dsh@0.1.2-alpha.2`, matched to source commit `0a53fb55bea101816fa226bb964ae2bed71c343b` (`dsh-v0.1.2-alpha.2`), only after the native candidate gates below pass. Keep standalone Node `24.11.1`, build-only pnpm `10.34.4`, and the Electron-only direction from [ADR 0001](0001-electron-desktop-host.md).

This record does not yet supersede ADR 0002. The old accepted runtime and its Windows evidence remain unchanged. Candidate [source provenance](../../prototypes/m0-runtime-upgrade/source-pin.json) and [runtime artifacts](../../prototypes/m0-runtime-upgrade/runtime-pin.json) are recorded separately; their `candidate` status is not a production runtime manifest.

## User outcome and scope

The user requested sequential upgrade verification, baseline adoption, Electron lifecycle implementation, native/package verification, and local commits on 2026-08-31. The first slice determines whether the new released pair provides the public lifecycle boundary required to proceed, without modifying Harness or using the globally installed CLI.

Local upstream-update Issue draft: compare rc.2 to alpha.2; prove official provenance, one external Bundle activation, committed readiness, child-visible EOF stop, startup rejection, authentication, and restart in an isolated home. A dedicated remote Issue and CI receipt must be attached before merge; neither is claimed created here. Push/remote execution requires separate authorization.

## Evidence and reason

- [Independent upstream research](../research/dsh-alpha2-upgrade.md) verifies the release tag, registry metadata, public Profile/Bundle boundary, and version-specific lifecycle behavior.
- The old runtime already had `appExit` and bounded shutdown. The important new candidate capabilities are launcher-committed `appReady`, `exitOnStdinEnd`, and startup-only patch composition; this corrects the overbroad historical grouping of `appExit` with newer-only behavior without changing the old experiment results.
- The [candidate probe](../../prototypes/m0-runtime-upgrade/README.md) exercises the actual official CLI and out-of-tree Bundle on Node `24.11.1`. Its web fixture verifies HTTP 401 without authentication, official 303 token exchange, authenticated HTML, and EOF stop. No model request is made.
- Browser authentication changed; the product must use the public Connection service and keep tokens out of diagnostic streams. The former bare-root HTTP-200 check cannot be reused unchanged.
- [Executable provenance checks](../../scripts/verify-upstream-candidate.mjs) compare remote/tag/commit and source cleanliness, official root npm archive against installed bytes, Node archive against executed bytes, and installed DSH-family versions before and after smokes. They do not constitute a complete dependency-byte/license inventory or prove reproducible equivalence between source and npm build output.

## Adoption gates

- [x] Exact official source/tag and npm integrity are recorded independently.
- [x] Native macOS arm64 candidate checks pass on Node `24.11.1`, including provenance before and after execution.
- [x] One minimal Bundle and one base/web Profile use public services without Harness source edits.
- [x] Startup failure is not converted to success by early stdin EOF; output-token leakage is a failing check.
- [x] Rejected startup can be retried and the isolated minimal Profile can complete three normal cycles.
- [ ] The same candidate commit passes Windows-native tests, with EOF, disposal marker, process exit, and no host force-kill; attach the run URL and tested SHA.
- [ ] Review both native reports and accept this ADR before dependent product implementation.

These are baseline-adoption gates, not the whole M0 acceptance contract. Plugin disposal plus exit does not prove every owned descendant has exited, and an upstream forced-shutdown timeout may also return zero. Electron UI, all-resource cleanup, interrupted-host recovery, actual browser rendering, and no-global-tools product packaging remain separate mandatory [M0 gates](../acceptance/m0.md).

## Alternatives and risks

Keeping rc.2 avoids a runtime migration but lacks the newly verified Ready/EOF helper combination. Building an unmodified source artifact remains possible, but a published npm pair now avoids taking ownership of the upstream build pipeline. Patching Harness, direct library embedding, parallel Agent services, and reopening Tauri are outside this change.

Alpha.2 is a prerelease. Fresh pnpm resolution reports a React/React DOM peer mismatch; do not silence it with an unreviewed dependency override. HTTP HTML delivery is not React rendering, so record the warning and test the actual Electron UI before a product compatibility claim. No existing user's DSH_HOME or credentials are migrated by these checks.

## Adoption, rollback, and next slice

After native evidence passes, accept this ADR, mark ADR 0002 superseded with a forward link, and update the active compatibility contract and executable product baseline together. Source provenance, runtime lock updates, and product behavior remain separately reviewable commits. Preserve the old research branch evidence.

Only then implement the Electron start → trusted Ready → stop → restart slice with an external lifecycle Bundle. Use a private channel for sensitive navigation, a narrow renderer bridge for status, and Harness-owned shutdown. Packaging and native M0 acceptance follow that implementation, not this research fixture.

If candidate validation fails, retain ADR 0002 as accepted and investigate the failed public seam. Roll back the candidate commit set rather than changing global packages or touching a user home. Reusing a home written by alpha.2 with rc.2 requires separate migration/backup evidence.
