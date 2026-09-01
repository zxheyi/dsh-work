# 0003: Official dsh alpha.2 runtime pair

Status: accepted

Date: 2026-08-31

## Decision

Replace the runtime pair in [ADR 0002](0002-official-dsh-cli-runtime.md) with official `@deepseek-ai/dsh@0.1.2-alpha.2`, matched to source commit `0a53fb55bea101816fa226bb964ae2bed71c343b` (`dsh-v0.1.2-alpha.2`). Keep standalone Node.js `24.11.1`, build-only pnpm `10.34.4`, and the Electron-only direction from [ADR 0001](0001-electron-desktop-host.md).

This record supersedes ADR 0002 after native evidence review and the user's instruction to proceed. The old runtime and its historical Windows evidence remain unchanged. Frozen research [source provenance](https://github.com/zxheyi/dsh-work/blob/4fd63ddefc347238f5a5c717a10bd59a2f326693/prototypes/m0-runtime-upgrade/source-pin.json) and [runtime artifacts](https://github.com/zxheyi/dsh-work/blob/4fd63ddefc347238f5a5c717a10bd59a2f326693/prototypes/m0-runtime-upgrade/runtime-pin.json) retain their original candidate labels so the tested input hashes remain reproducible. The accepted machine-readable selection is [`runtime/baseline.json`](../../runtime/baseline.json); it is not an implementation-complete or signed distribution manifest.

The accepted npm integrity is `sha512-4TvTC5kRKlgtSU2UTBv+cID9a2Z+6+m6mpvjXWJfVzuTkflCff6s4MsQpFJTCmwFh/k7zNWe7qFXcLYMV/5VvA==`.

## User outcome and scope

The user requested sequential upgrade verification, baseline adoption, Electron lifecycle implementation, native/package verification, and local commits on 2026-08-31. The first slice determines whether the new released pair provides the public lifecycle boundary required to proceed, without modifying Harness or using the globally installed CLI.

Local upstream-update Issue draft: compare rc.2 to alpha.2; prove official provenance, one external Bundle activation, committed readiness, child-visible EOF stop, startup rejection, authentication, and restart in an isolated home. A dedicated remote Issue is still required before merge; no remote Issue is claimed created here. The CI receipt is recorded below. New push/remote execution requires separate authorization.

## Evidence and reason

- Frozen [independent upstream research](https://github.com/zxheyi/dsh-work/blob/4fd63ddefc347238f5a5c717a10bd59a2f326693/docs/research/dsh-alpha2-upgrade.md) verifies the release tag, registry metadata, public Profile/Bundle boundary, and version-specific lifecycle behavior.
- The old runtime already had `appExit` and bounded shutdown. The important new candidate capabilities are launcher-committed `appReady`, `exitOnStdinEnd`, and startup-only patch composition; this corrects the overbroad historical grouping of `appExit` with newer-only behavior without changing the old experiment results.
- The frozen [candidate probe](https://github.com/zxheyi/dsh-work/blob/4fd63ddefc347238f5a5c717a10bd59a2f326693/prototypes/m0-runtime-upgrade/README.md) exercises the actual official CLI and out-of-tree Bundle on Node `24.11.1`. Its web fixture verifies HTTP 401 without authentication, official 303 token exchange, authenticated HTML, and EOF stop. No model request is made.
- Browser authentication changed; the product must use the public Connection service and keep tokens out of diagnostic streams. The former bare-root HTTP-200 check cannot be reused unchanged.
- Frozen [executable provenance checks](https://github.com/zxheyi/dsh-work/blob/4fd63ddefc347238f5a5c717a10bd59a2f326693/scripts/verify-upstream-candidate.mjs) compare remote/tag/commit and source cleanliness, official root npm archive against installed bytes, Node archive against executed bytes, and installed DSH-family versions before and after smokes. They do not constitute a complete dependency-byte/license inventory or prove reproducible equivalence between source and npm build output.

## Adoption gates

- [x] Exact official source/tag and npm integrity are recorded independently.
- [x] Native macOS arm64 candidate checks pass on Node `24.11.1`, including provenance before and after execution.
- [x] One minimal Bundle and one base/web Profile use public services without Harness source edits.
- [x] Startup failure is not converted to success by early stdin EOF; output-token leakage is a failing check.
- [x] Rejected startup can be retried and the isolated minimal Profile can complete three normal cycles.
- [x] The same candidate commit passes Windows-native tests, with EOF, disposal marker, process exit, and no host force-kill; see the native receipt below.
- [x] Both native reports were reviewed, and this ADR is accepted before dependent product implementation.

Native receipt: [CI run 33391284357](https://github.com/zxheyi/dsh-work/actions/runs/33391284357), tested commit `77a7aa3e0adf19d9557e4dd13a46c7427799d839`, passed on 2026-08-31. [macOS arm64 job](https://github.com/zxheyi/dsh-work/actions/runs/33391284357/job/99485262361) and [Windows x64 job](https://github.com/zxheyi/dsh-work/actions/runs/33391284357/job/99485262444) each passed 6 lifecycle checks and the repository gates. Downloaded reports matched the tested SHA, all 12 input hashes (Windows CRLF checkout accounted for), and before/after provenance. Both used Node 24.11.1, the same official root package bytes, and 215 DSH-family packages at alpha.2. This is evidence for the probe revision, not for later product code.

These are baseline-adoption gates, not the whole M0 acceptance contract. Plugin disposal plus exit does not prove every owned descendant has exited, and an upstream forced-shutdown timeout may also return zero. Electron UI, all-resource cleanup, interrupted-host recovery, actual browser rendering, and no-global-tools product packaging remain separate mandatory [M0 gates](../acceptance/m0.md).

## Alternatives and risks

Keeping rc.2 avoids a runtime migration but lacks the newly verified Ready/EOF helper combination. Building an unmodified source artifact remains possible, but a published npm pair now avoids taking ownership of the upstream build pipeline. Patching Harness, direct library embedding, parallel Agent services, and reopening Tauri are outside this change.

Alpha.2 is a prerelease. Fresh pnpm resolution reports a React/React DOM peer mismatch; do not silence it with an unreviewed dependency override. HTTP HTML delivery is not React rendering, so record the warning and test the actual Electron UI before a product compatibility claim. No existing user's DSH_HOME or credentials are migrated by these checks.

## Adoption, rollback, and next slice

ADR 0002 is now superseded; the active compatibility contract and executable baseline select alpha.2. Source provenance, runtime lock updates, and product behavior remain separately reviewable commits. Preserve the old research branch evidence.

Implement the Electron start → trusted Ready → stop → restart slice with an external lifecycle Bundle. Use a private channel for sensitive navigation, a narrow renderer bridge for status, and Harness-owned shutdown. Packaging and native M0 acceptance follow that implementation, not this research fixture.

If subsequent verification invalidates this baseline, stop dependent delivery and record a superseding decision; do not silently restore ADR 0002 as active. Roll back the bounded implementation commit set rather than changing global packages or touching a user home. Reusing a home written by alpha.2 with rc.2 requires separate migration/backup evidence.
