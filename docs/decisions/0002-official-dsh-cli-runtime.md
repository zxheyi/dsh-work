# 0002: Official `dsh` CLI and matched runtime pair

Status: proposed

Date: 2026-08-28

## Problem

DSH Work must select an exact DeepSeek Harness source/runtime pair and a supported integration boundary. Current official source is newer than published npm and PyPI distributions, so combining HEAD documentation with an older runtime would create an unverifiable contract. The product must also preserve the upstream source as read-only and avoid rebuilding Harness-owned services.

## Evidence

- [`../research/deepseek-harness-integration.md`](../research/deepseek-harness-integration.md) records current official source revision `cd5ef8148158c3a752a658978873241fdf8e2bbc`, published npm runtime `@deepseek-ai/dsh@0.1.1-rc.2`, and its matching official source commit `b150a551b8d465e31e418e1b2eaf5e79bbb7d28e`.
- Official architecture makes `dsh --profile <name>` the supported Node application launcher and treats Profiles, Bundles, plugins, and public services as the composition boundary.
- [`../research/m0-lifecycle-prototype.md`](../research/m0-lifecycle-prototype.md) records successful macOS CLI and Electron-child smokes for `@deepseek-ai/dsh@0.1.1-rc.2` without source changes.
- The same research records that current source adds `appReady`, `appExit`, and bounded lifecycle behavior that must not be assumed in the older published runtime.
- The current PyPI runtime release has no visible Windows wheel and is not a two-platform M0 candidate.

## Decision

Use only the official `dsh --profile <dsh-work-profile>` CLI as the Harness application boundary. Product behavior composes through a DSH Work-owned Profile, Bundle, plugins, and public services outside the Harness source tree. Direct `@deepseek-ai/dsh-app-boot` imports, copied Harness services, private launchers, and source edits are prohibited.

Propose the released npm pair as the first M0 runtime candidate:

| Item | Proposed value |
| --- | --- |
| Source repository | `https://github.com/deepseek-ai/deepseek-harness` |
| Source revision | `b150a551b8d465e31e418e1b2eaf5e79bbb7d28e` (`dsh-v0.1.1-rc.2`) |
| Runtime kind | official npm package family |
| Runtime package | `@deepseek-ai/dsh@0.1.1-rc.2` |
| Launch entry | `dsh --profile <dsh-work-profile> --no-open --port 0` |
| Product extension | external DSH Work Profile/Bundle/plugin tree |
| Runtime state | DSH Work-owned platform application-data directory and isolated `DSH_HOME` |

The source/runtime candidate is not accepted until its lifecycle Bundle, Windows stop path, packaged runtime, and native platform matrix pass. If the released pair lacks a public seam required by M0, return to Research and compare a reproducibly built, unmodified official source artifact; do not patch or fork Harness.

## Acceptance and verification

- [x] Source tag and npm package version are recorded as a matched official pair.
- [x] macOS CLI and Electron-child smokes reach HTTP `200` and exit cleanly after POSIX `SIGTERM`.
- [ ] Artifact hashes, exact standalone Node version, dependency/license inventory, and package-manager boundary are recorded in a reproducible runtime manifest.
- [ ] A DSH Work Profile or Bundle loads exactly once through the official CLI with a clean isolated `DSH_HOME`.
- [ ] Readiness is secret-safe and does not become Ready from TCP bind alone.
- [ ] Windows uses a verified child-visible public graceful-stop seam; `kill('SIGTERM')` is not accepted as proof.
- [ ] Packaged macOS and Windows smokes run without a repository checkout, global Node, or global package manager.
- [ ] An executable gate proves official remote, exact source revision, clean source tree/artifact, matched runtime version, and the native extension entry before and after tests.
- [ ] Missing runtime, version mismatch, invalid Profile, port conflict, startup timeout, nonzero exit, forced stop, and recovery are distinct structured outcomes without credential leakage.

## Alternatives considered

### Reproducibly built official `dsh-v0.1.2-alpha.1` artifact

This candidate exposes the newest public lifecycle services and keeps source byte-clean, but DSH Work would own build reproducibility, artifact signing, dependency closure, and platform distribution before an official registry release exists. It becomes the next candidate if the released npm pair fails a required public-seam check.

### Official PyPI runtime wheel

The wheel bundles the runtime and avoids a global Node requirement, but the currently visible release is older and has no Windows wheel. It cannot satisfy M0's two-platform package contract today.

### Direct library embedding or a DSH Work runtime implementation

Both conflict with the current official launcher contract and the product's upstream-first invariant. They are rejected.

## Consequences

- Source provenance, npm runtime, standalone Node, desktop host, and product Profile/Bundle remain independently versioned manifest fields.
- Published `0.1.1-rc.2` behavior, not current HEAD documentation, governs the candidate until compatibility is proven.
- Ordinary packaged launch must not require pnpm; dependency materialization may use a controlled, pinned build step.
- Readiness and Windows stop may require a DSH Work lifecycle Bundle, but that Bundle may use only public Harness services and must remain outside upstream source.
- A missing public seam blocks implementation and triggers an upstream proposal or a new official source/runtime candidate.

## Rollback or supersession

Before acceptance, replace the candidate pair by updating this proposal and repeating every compatibility check. After implementation, source-pin updates, runtime-package updates, and product adaptations must remain separate changes. Supersede this ADR when moving to a later official npm release, a reproducibly built official artifact, or a complete native runtime distribution; never rewrite historical implemented evidence.
