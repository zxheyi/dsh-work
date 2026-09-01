# 0002: Official `dsh` CLI and matched runtime pair

Status: superseded by ADR 0003

Superseded on 2026-08-31 by [ADR 0003](0003-dsh-alpha2-runtime-upgrade.md). The decision and evidence below describe the historical rc.2 baseline, not the current runtime selection.

Date: 2026-08-28

## Problem

DSH Work must select an exact DeepSeek Harness source/runtime pair and a supported integration boundary. Current official source is newer than published npm and PyPI distributions, so combining HEAD documentation with an older runtime would create an unverifiable contract. The product must also preserve the upstream source as read-only and avoid rebuilding Harness-owned services.

## Evidence

- The frozen [Harness integration research](https://github.com/zxheyi/dsh-work/blob/4fd63ddefc347238f5a5c717a10bd59a2f326693/docs/research/deepseek-harness-integration.md) records current official source revision `cd5ef8148158c3a752a658978873241fdf8e2bbc`, published npm runtime `@deepseek-ai/dsh@0.1.1-rc.2`, and its matching official source commit `b150a551b8d465e31e418e1b2eaf5e79bbb7d28e`.
- Official architecture makes `dsh --profile <name>` the supported Node application launcher and treats Profiles, Bundles, plugins, and public services as the composition boundary.
- The frozen [M0 lifecycle prototype record](https://github.com/zxheyi/dsh-work/blob/4fd63ddefc347238f5a5c717a10bd59a2f326693/docs/research/m0-lifecycle-prototype.md) records successful macOS CLI and Electron-child smokes for `@deepseek-ai/dsh@0.1.1-rc.2` without source changes.
- [Windows CI run `33159188420`](https://github.com/zxheyi/dsh-work/actions/runs/33159188420) materialized the same locked npm runtime with Node.js `24.11.1` and pnpm `10.34.4`, then launched it successfully through both prototype hosts and reached HTTP `200`.
- The official Git tag `dsh-v0.1.1-rc.2` resolves to commit `b150a551b8d465e31e418e1b2eaf5e79bbb7d28e`. The npm registry reports version `0.1.1-rc.2`, bin entry `dsh -> lib/bin.js`, and integrity `sha512-UP1UIh6q3Gme/yXRn/QL2P8IsVlv8Shpg22TRJIZPsCRWLm4CBiA1MUvXmJAfsOEETBMLAl+xWPtFw6ICsN3wg==`; the checked-in prototype lockfile records the same integrity.
- The same research records that current source adds `appReady`, `appExit`, and bounded lifecycle behavior that must not be assumed in the older published runtime.
- The current PyPI runtime release has no visible Windows wheel and is not a two-platform M0 candidate.

## Decision

Use only the official `dsh --profile <dsh-work-profile>` CLI as the Harness application boundary. Product behavior composes through a DSH Work-owned Profile, Bundle, plugins, and public services outside the Harness source tree. Direct `@deepseek-ai/dsh-app-boot` imports, copied Harness services, private launchers, and source edits are prohibited.

Accept the released npm pair as the M0 runtime baseline:

| Item | Accepted value |
| --- | --- |
| Source repository | `https://github.com/deepseek-ai/deepseek-harness` |
| Source revision | `b150a551b8d465e31e418e1b2eaf5e79bbb7d28e` (`dsh-v0.1.1-rc.2`) |
| Runtime kind | official npm package family |
| Runtime package | `@deepseek-ai/dsh@0.1.1-rc.2` |
| Runtime integrity | `sha512-UP1UIh6q3Gme/yXRn/QL2P8IsVlv8Shpg22TRJIZPsCRWLm4CBiA1MUvXmJAfsOEETBMLAl+xWPtFw6ICsN3wg==` |
| Standalone Node baseline | Node.js `24.11.1`; final platform artifact hashes remain a packaging gate |
| Materialization tool | pnpm `10.34.4` in controlled build/staging only; never required for ordinary launch |
| Launch entry | `dsh --profile <dsh-work-profile> --no-open --port 0` |
| Product extension | external DSH Work Profile/Bundle/plugin tree |
| Runtime state | DSH Work-owned platform application-data directory and isolated `DSH_HOME` |

This acceptance locks the implementation baseline; it does not claim that its lifecycle Bundle, secret-safe readiness, Windows graceful stop, packaged runtime, or native platform matrix is complete. Only behavior present in the accepted source/runtime pair may be used. Current HEAD's `appReady`, `appExit`, and bounded lifecycle behavior remain unavailable unless independently proven in this exact pair.

If the accepted pair lacks a public seam required by M0, stop implementation, record the failed executable check, and compare a reproducibly built, unmodified official source artifact or later official release through a superseding ADR. Do not patch, fork, copy, or reimplement Harness-owned behavior.

## Acceptance and verification

- [x] Source tag and npm package version are recorded as a matched official pair.
- [x] macOS CLI and Electron-child smokes reach HTTP `200` and exit cleanly after POSIX `SIGTERM`.
- [x] Windows development smokes materialize the locked npm runtime and reach HTTP `200` with the accepted Node/pnpm baseline.
- [x] The npm package integrity, exact standalone Node baseline, and build-only package-manager boundary are recorded.
- [ ] Per-platform Node artifact hashes, the full dependency/license inventory, and all staged file hashes are recorded in a reproducible runtime manifest.
- [ ] A DSH Work Profile or Bundle loads exactly once through the official CLI with a clean isolated `DSH_HOME`.
- [ ] Readiness is secret-safe and does not become Ready from TCP bind alone.
- [ ] Windows uses a verified child-visible public graceful-stop seam; `kill('SIGTERM')` is not accepted as proof.
- [ ] Packaged macOS and Windows smokes run without a repository checkout, global Node, or global package manager.
- [ ] An executable gate proves official remote, exact source revision, clean source tree/artifact, matched runtime version, and the native extension entry before and after tests.
- [ ] Missing runtime, version mismatch, invalid Profile, port conflict, startup timeout, nonzero exit, forced stop, and recovery are distinct structured outcomes without credential leakage.

## Alternatives considered

### Reproducibly built official `dsh-v0.1.2-alpha.1` artifact

This alternative exposes the newest public lifecycle services and keeps source byte-clean, but DSH Work would own build reproducibility, artifact signing, dependency closure, and platform distribution before an official registry release exists. It becomes the next candidate only through a superseding ADR if the accepted npm pair fails a required public-seam check.

### Official PyPI runtime wheel

The wheel bundles the runtime and avoids a global Node requirement, but the currently visible release is older and has no Windows wheel. It cannot satisfy M0's two-platform package contract today.

### Direct library embedding or a DSH Work runtime implementation

Both conflict with the current official launcher contract and the product's upstream-first invariant. They are rejected.

## Consequences

- Source provenance, npm runtime, standalone Node, desktop host, and product Profile/Bundle remain independently versioned manifest fields.
- Published `0.1.1-rc.2` behavior, not current HEAD documentation, governs implementation and compatibility claims.
- Ordinary packaged launch must not require pnpm; dependency materialization may use a controlled, pinned build step.
- Readiness and Windows stop may require a DSH Work lifecycle Bundle, but that Bundle may use only public Harness services and must remain outside upstream source.
- A missing public seam blocks implementation and triggers an upstream proposal or a new official source/runtime candidate.

## Rollback or supersession

Stop and reevaluate this baseline when an executable check proves a required public Profile/Bundle/service seam is absent, the package cannot be staged or launched without a global package manager, the selected Node cannot support the dependency closure on a target platform, or a security/platform policy makes the accepted artifact unsuitable.

Any replacement requires a dedicated research issue, full compatibility checks against the new exact pair, and a superseding ADR. Source-pin updates, runtime-package updates, and product adaptations remain separate changes. Never rewrite historical implemented evidence or carry a temporary Harness patch forward as part of the baseline.
